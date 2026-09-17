/**
 * Adapter Instagram — canal nativo (Fase 3, seção 12 da auditoria). Mesmo
 * papel dos outros três: tradutor de formato, nada de regra de negócio
 * (pacing/janela/cap é da cadeia `before_send`, ver `ChannelAdapter` em
 * `../types`).
 *
 * ⚠️ ENDPOINTS DE ENVIO NÃO MEDIDOS CONTRA CHAMADOR REAL — diferente do
 * `uazapi.ts`, que confere linha a linha contra Edge Functions do Studio CRM
 * em produção, o sistema de referência de Instagram (Robson/Rowaize) foi lido
 * só até onde a pesquisa precisou (webhook, fila, pacing) — a FORMA de envio
 * abaixo é a convenção documentada da Graph API (Send API/Messenger Platform,
 * que o Instagram Login reaproveita), não uma chamada conferida contra
 * `src/lib/instagram.ts` linha a linha. Testar contra a conta real antes de
 * confiar em produção — mesmo aviso que `uazapi.ts` já dá pro download de
 * mídia dele.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import { instagramGraphBaseUrl, instagramGraphVersion, resolveInstagramCreds } from "../instagram/credentials";
import type { ChannelAdapter, OutboundEnvelope, RecipientInput } from "../types";

export const instagramAdapter: ChannelAdapter = {
  provider: "instagram",

  /**
   * Instagram endereça DM pelo id de usuário Instagram-scoped (IGSID), não
   * por telefone. Não há campo de telefone em `RecipientInput` que sirva —
   * quem resolve o IGSID é o webhook de entrada (`sender.id`), guardado como
   * identidade do contato. Grupo devolve `null`: não existe DM em grupo no
   * escopo desta automação (comentário→DM 1:1).
   *
   * `waIdentity` é reaproveitado como o carregador genérico do id opaco —
   * mesmo campo que outros canais de identidade-não-telefônica usariam, não
   * um campo específico de WhatsApp por acidente de nome.
   */
  resolveRecipient(input: RecipientInput): string | null {
    if (input.isGroup) return null;
    const identidade = input.waIdentity ?? null;
    return identidade && identidade.length > 0 ? identidade : null;
  },

  isConfigured(): boolean {
    return true;
  },

  codes: {
    notConfigured: "instagram_not_configured",
    sendFailed: "instagram_error",
    unknownError: "instagram_unknown",
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    if (envelope.kind !== "text") {
      throw new Error(`instagram_kind_not_supported: ${envelope.kind} não suportado neste canal ainda (só texto).`);
    }
    const admin = createAdminClient();
    const creds = await resolveInstagramCreds(admin, {
      organizationId: envelope.organizationId,
      businessId: envelope.sessionRef,
    });
    if (!creds) {
      throw new Error("instagram_not_configured: nenhuma credencial para esta conta (nem na sessão, nem no ambiente).");
    }

    await envelope.beforeSend?.();

    const url = `${instagramGraphBaseUrl()}/${instagramGraphVersion()}/${creds.businessId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: envelope.to },
        message: { text: envelope.body ?? "" },
        access_token: creds.accessToken,
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      message_id?: string;
      error?: { message?: string; code?: number };
    } | null;
    if (!res.ok || json?.error) {
      const detalhe = json?.error?.message ?? res.statusText;
      throw new Error(`instagram_send_failed: ${res.status} ${detalhe}`.trim());
    }
    return { externalId: json?.message_id ?? null };
  },

  /**
   * Resposta pública a um comentário — verbo e formato diferentes de DM, por
   * isso é método próprio (`replyToComment`), não uma variação de `send()`.
   */
  async replyToComment(input) {
    const admin = createAdminClient();
    const creds = await resolveInstagramCreds(admin, {
      organizationId: input.organizationId,
      businessId: input.sessionRef,
    });
    if (!creds) {
      throw new Error("instagram_not_configured: nenhuma credencial para esta conta.");
    }

    const url = `${instagramGraphBaseUrl()}/${instagramGraphVersion()}/${input.commentId}/replies`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input.body, access_token: creds.accessToken }),
    });
    const json = (await res.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
    if (!res.ok || json?.error) {
      const detalhe = json?.error?.message ?? res.statusText;
      throw new Error(`instagram_reply_failed: ${res.status} ${detalhe}`.trim());
    }
    return { externalId: json?.id ?? null };
  },
};
