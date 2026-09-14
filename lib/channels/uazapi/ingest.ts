/**
 * Ingestão do canal não oficial (UAZAPI): webhook → contato, conversa,
 * mensagem. Estrutura espelhada em `lib/waha/ingest.ts` (mesma categoria de
 * canal — WhatsApp Web automatizado via QR, mesma família de RPCs
 * provider-agnósticas) — os PARSERS vêm de `./webhook.ts`, confirmados
 * contra o Studio CRM; os EFEITOS (o que gravar) reaproveitam as mesmas
 * RPCs e helpers que WAHA e zernio já usam neste repo.
 *
 * ─── O que este módulo NÃO cobre ainda ──────────────────────────────────────
 *
 * Reação a mensagem (o Studio CRM guarda isso numa coluna `reactions` que
 * não existe no schema deste projeto) e o caminho de "editar mensagem" (o
 * Studio CRM nunca confirmou o formato desse evento contra um caso real —
 * ver `classifyUazapiEvent`). Revogação ("apagar para todos") está coberta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import { estamparAtribuicaoDoContato } from "@/lib/leads/atribuicao-de-anuncio";
import { pausarIaPorAtendimentoManual } from "@/lib/escalacao/atendimento-manual";
import { aplicarEfeitosPosEntrada } from "../pos-entrada";
import { sincronizarSaudeDaConexao } from "../health";

import {
  classifyUazapiEvent,
  extrairAtribuicaoUazapi,
  extrairTelefoneUazapi,
  isUazapiGroup,
  mapUazapiStatus,
  parseUazapiMessage,
  parseUazapiRevoke,
  resolveUazapiConnectionStatus,
  resolveUazapiFromMe,
  resolveUazapiMessageId,
} from "./webhook";

export interface UazapiIngestSession {
  id: string;
  organization_id: string;
  display_name?: string | null;
  phone_number?: string | null;
}

export interface UazapiIngestResult {
  status: "ingested" | "duplicate" | "ignored" | "status_updated";
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

async function upsertContact(
  admin: SupabaseClient,
  orgId: string,
  phoneNormalizedDigits: string,
  chatIdParaMetadado: string,
  notifyName: string | null,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: orgId,
    p_kind: "phone",
    p_phone: canonicalPhoneBR(`+${phoneNormalizedDigits}`),
    p_lid: null,
    p_chat_id: chatIdParaMetadado,
    p_notify: notifyName,
  } as never);
  if (error) {
    logger.warn("[uazapi.ingest] fn_upsert_wa_contact falhou", { detail: error.message });
    return null;
  }
  return (data as string) ?? null;
}

async function upsertConversation(
  admin: SupabaseClient,
  orgId: string,
  contactId: string,
  sessionId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation" as never, {
    p_org: orgId,
    p_contact: contactId,
    p_session: sessionId,
  } as never);
  if (error) {
    logger.warn("[uazapi.ingest] fn_upsert_wa_conversation falhou", { detail: error.message });
    return null;
  }
  return (data as string) ?? null;
}

async function markConversation(
  admin: SupabaseClient,
  organizationId: string,
  convId: string,
  direction: "inbound" | "outbound",
  preview: string,
  at: string,
): Promise<void> {
  const { error } = await admin.rpc("fn_mark_conversation_message" as never, {
    p_conv: convId,
    p_direction: direction,
    p_preview: preview,
    p_at: at,
  } as never);
  if (error) {
    logger.warn("[uazapi.ingest] carimbo da conversa falhou", { conversationId: convId, detail: error.message });
  }
}

async function pedirPersistenciaDaMidia(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const { error } = await admin.rpc("emit_event" as never, {
    p_event_type: "media.persist_requested",
    p_entity_kind: "message",
    p_entity_id: messageId,
    p_payload: { message_id: messageId, conversation_id: conversationId },
    p_metadata: { source: "uazapi_webhook" },
    p_organization_id: organizationId,
  } as never);
  if (error) {
    logger.warn("[uazapi.ingest] emit media.persist_requested falhou", { messageId, detail: error.message });
  }
}

/**
 * Roteador único de eventos UAZAPI — chamado pela rota genérica de webhook
 * depois de resolver a sessão e conferir o segredo (`lib/channels/inbound.ts`).
 */
export async function handleUazapiEvent(
  admin: SupabaseClient,
  session: UazapiIngestSession,
  payload: unknown,
  requestId: string,
): Promise<UazapiIngestResult> {
  const kind = classifyUazapiEvent(payload);

  if (kind === "message_update") {
    const revoke = parseUazapiRevoke(payload);
    if (!revoke) return { status: "ignored", reason: "message_update_sem_revoke_reconhecido" };
    const { data } = await admin
      .from("messages")
      .update({ revoked_at: new Date().toISOString() })
      .eq("organization_id", session.organization_id)
      .eq("external_id", revoke.externalId)
      .select("id");
    return (data ?? []).length > 0
      ? { status: "ingested", reason: "revoked" }
      : { status: "ignored", reason: "revoke_sem_mensagem_correspondente" };
  }

  if (kind === "connection") {
    const bruto = resolveUazapiConnectionStatus(payload);
    if (!bruto) return { status: "ignored", reason: "connection_sem_status" };
    const status = mapUazapiStatus(bruto);
    if (!status) return { status: "ignored", reason: `status_desconhecido_${bruto}` };

    await admin
      .from("channel_sessions")
      .update({ status, last_status_change_at: new Date().toISOString() })
      .eq("id", session.id);

    await sincronizarSaudeDaConexao(
      admin,
      { id: session.id, organization_id: session.organization_id, status },
      { reachable: true, status, detail: null },
      session.display_name ?? session.phone_number ?? "sem nome",
    );
    return { status: "status_updated", reason: status };
  }

  if (kind === "ignored") return { status: "ignored", reason: "evento_sem_interesse" };

  // ─── kind === "message" ────────────────────────────────────────────────
  if (isUazapiGroup(payload)) return { status: "ignored", reason: "grupo" };

  const p = payload as Record<string, unknown>;
  const msgRaw = p.message ?? p.data ?? {};
  const instanceOwnerDigits = (session.phone_number ?? "").replace(/\D/g, "") || null;
  const telefone = extrairTelefoneUazapi(payload, instanceOwnerDigits);
  if (!telefone) return { status: "ignored", reason: "sem_telefone_de_contato" };

  const fromMe = resolveUazapiFromMe(msgRaw);
  const externalId = resolveUazapiMessageId(msgRaw);
  const parsed = parseUazapiMessage(msgRaw);
  if (!externalId && parsed.type === "unknown" && !parsed.text) {
    return { status: "ignored", reason: "sem_conteudo_reconhecido" };
  }

  const chat = (p.chat as Record<string, unknown>) ?? {};
  const notifyName =
    (chat.wa_name as string | undefined) ??
    (chat.wa_contactName as string | undefined) ??
    (chat.name as string | undefined) ??
    ((msgRaw as Record<string, unknown>).senderName as string | undefined) ??
    ((msgRaw as Record<string, unknown>).pushName as string | undefined) ??
    null;

  const contactId = await upsertContact(
    admin,
    session.organization_id,
    telefone.normalized,
    `${telefone.normalized}@uazapi`,
    fromMe ? null : notifyName, // fromMe: quem escreve é o operador, não o contato — mesma regra do WAHA.
  );
  if (!contactId) return { status: "ignored", reason: "contato_nao_resolvido" };

  // Atribuição de anúncio — só na entrada, e só grava na primeira vez
  // (estamparAtribuicaoDoContato não sobrescreve).
  if (!fromMe) {
    const atribuicao = extrairAtribuicaoUazapi(msgRaw);
    if (atribuicao) await estamparAtribuicaoDoContato(admin, contactId, atribuicao);
  }

  const conversationId = await upsertConversation(admin, session.organization_id, contactId, session.id);
  if (!conversationId) return { status: "ignored", reason: "conversa_nao_resolvida" };

  const now = new Date().toISOString();
  let messageId: string | null = null;
  let wasNew = false;

  if (externalId) {
    const { data: existing } = await admin
      .from("messages")
      .select("id")
      .eq("organization_id", session.organization_id)
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) {
      messageId = (existing as { id: string }).id;
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("messages")
        .insert({
          organization_id: session.organization_id,
          conversation_id: conversationId,
          channel_session_id: session.id,
          contact_id: contactId,
          external_id: externalId,
          type: parsed.type === "unknown" ? "text" : parsed.type,
          direction: fromMe ? "outbound" : "inbound",
          status: fromMe ? "sent" : "delivered",
          body: parsed.text,
          media_url: parsed.mediaUrl,
          media_mime: parsed.mediaMime,
          sent_via: "external_device",
          sent_at: now,
          ...(fromMe ? {} : { delivered_at: now }),
          metadata: { raw_type: parsed.type, media_file_name: parsed.mediaFileName },
        })
        .select("id")
        .maybeSingle();
      // 23505 = unique(organization_id, external_id) — reentrega, esperado.
      if (insErr && insErr.code !== "23505") {
        throw new Error(`uazapi_ingest_insert_failed: ${insErr.message}`);
      }
      if (insErr?.code === "23505") {
        logger.info("uazapi.ingest: mensagem ja ingerida, dedup por external_id", {
          organizationId: session.organization_id,
          conversationId,
          externalId,
        });
      } else if (inserted?.id) {
        messageId = inserted.id;
        wasNew = true;
      }
    }
  }

  if (wasNew && messageId) {
    await markConversation(
      admin,
      session.organization_id,
      conversationId,
      fromMe ? "outbound" : "inbound",
      parsed.preview,
      now,
    );
    if (parsed.mediaUrl) await pedirPersistenciaDaMidia(admin, session.organization_id, conversationId, messageId);

    if (fromMe) {
      // Alguém respondeu direto do celular, fora do composer/IA — pausa a IA
      // nesta conversa (mesma regra do WAHA/zernio). Sem a checagem de "é
      // eco do nosso próprio envio" que o WAHA tem: esta primeira versão não
      // distingue os dois casos, então uma mensagem enviada pelo composer
      // que ecoa aqui também pausaria a IA por engano — anotar como
      // limitação conhecida, não decisão.
      await pausarIaPorAtendimentoManual(admin, {
        organizationId: session.organization_id,
        conversationId,
        canal: "uazapi",
      });
    } else {
      await aplicarEfeitosPosEntrada(admin, {
        organizationId: session.organization_id,
        contactId,
        conversationId,
        messageId,
        channelSessionId: session.id,
        texto: parsed.text,
        nomeDoContato: notifyName,
        requestId,
        origem: "uazapi_webhook",
      });
    }
  }

  return wasNew
    ? { status: "ingested", conversationId, messageId: messageId ?? undefined }
    : { status: "duplicate", conversationId, messageId: messageId ?? undefined };
}
