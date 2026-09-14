/**
 * Adapter UAZAPI — canal não oficial (WhatsApp Web automatizado via QR), no
 * lugar do WAHA. Mesmo papel que `zernio.ts`: tradutor de formato, nada de
 * regra de negócio (janela de 24h, cap, horário — isso é da cadeia
 * `before_send`, ver `ChannelAdapter` em `../types`).
 *
 * ─── Fonte da forma da API: o Studio CRM, não a documentação da UAZAPI ──────
 *
 * Este canal não existia neste projeto. Os três endpoints abaixo (texto,
 * mídia, status) vêm da integração UAZAPI real que já roda em produção no
 * Studio CRM da agência (`supabase/functions/uazapi-send-message`,
 * `uazapi-send-media`, `uazapi-check-status`) — CONFERIDOS linha a linha, não
 * lidos de doc. O que NÃO tem chamador de produção equivalente para conferir
 * — o download de mídia recebida — está marcado como tal abaixo.
 *
 * Auth: header `token` com o valor CRU (não `Bearer`) — diferente dos outros
 * dois canais deste repo, que usam `Authorization: Bearer`. Confirmado nos
 * três Edge Functions de referência.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { FetchedMedia } from "@/lib/messaging/media/types";

import { resolveUazapiCreds } from "../uazapi/credentials";
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import type { ChannelAdapter, ChannelHealth, OutboundEnvelope, RecipientInput } from "../types";

/** Só dígitos — é o formato de `number` que os três endpoints esperam. */
function toDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export const uazapiAdapter: ChannelAdapter = {
  provider: "uazapi",

  /**
   * UAZAPI endereça por telefone em dígitos (`number`), igual ao WAHA que
   * este canal substitui — não por thread/id opaco como o `zernio`.
   *
   * Grupo devolve `null`: os três endpoints de referência (`send-message`,
   * `send-media`, `check-status`) só tratam contato 1-a-1; UAZAPI expõe
   * grupo por outro recurso, que este adapter não implementa nesta primeira
   * versão (mesmo corte que `docs/doctrine/restricao-de-canal.md` já aplica
   * a outros canais deste repo).
   */
  resolveRecipient(input: RecipientInput): string | null {
    if (input.isGroup) return null;
    const bruto = input.phoneNumber ?? null;
    if (!bruto) return null;
    const digitos = toDigits(bruto);
    return digitos.length > 0 ? digitos : null;
  },

  // Mesmo motivo do `zernio.isConfigured`: a credencial pode viver só na
  // SESSÃO (conta conectada pela tela, cifrada no banco), e este método é
  // síncrono — não pode consultar o banco para responder de verdade. Quem
  // decide é `send()`, que pode e lança quando não encontra credencial
  // alguma (nem sessão, nem env). Responder `false` aqui faria uma sessão
  // conectada pela tela cair no mesmo bug que o `zernio` já documentou
  // corrigido: mensagem parada em `queued` para sempre, sem erro visível.
  isConfigured(): boolean {
    return true;
  },

  codes: {
    notConfigured: "uazapi_not_configured",
    sendFailed: "uazapi_error",
    unknownError: "uazapi_unknown",
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    if (envelope.kind === "contact") {
      throw new Error("uazapi_contact_not_supported: envio de cartão de contato não suportado neste canal ainda.");
    }
    const admin = createAdminClient();
    const creds = await resolveUazapiCreds(admin, {
      organizationId: envelope.organizationId,
      instanceId: envelope.sessionRef,
    });
    if (!creds) {
      throw new Error(
        "uazapi_not_configured: nenhuma credencial para esta instância (nem na sessão, nem no ambiente).",
      );
    }

    await envelope.beforeSend?.();

    // Sem mídia: POST /send/text — confirmado em uazapi-send-message/index.ts.
    if (!envelope.media) {
      const res = await fetch(`${creds.baseUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: creds.token },
        body: JSON.stringify({
          number: envelope.to,
          text: envelope.body ?? "",
          // `replyid` é o nome real do campo (não `replyTo`) — conferido no
          // Studio CRM. Só entra quando existe: citação é enfeite, nunca
          // condição de envio (mesma regra do `zernio`).
          ...(envelope.replyToExternalId ? { replyid: envelope.replyToExternalId } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        id?: string;
        messageId?: string;
        key?: { id?: string };
        error?: string;
        message?: string;
      } | null;
      if (!res.ok || json?.error) {
        const detalhe = json?.error ?? json?.message ?? res.statusText;
        throw new Error(`uazapi_send_failed: ${res.status} ${detalhe}`.trim());
      }
      return { externalId: json?.id ?? json?.messageId ?? json?.key?.id ?? null };
    }

    // Com mídia: POST /send/media — confirmado em uazapi-send-media/index.ts.
    // O campo `file` aceita tanto uma URL (assinada ou pública) quanto um
    // data: URL base64; aqui só o caminho de URL é usado, porque é o que
    // `OutboundEnvelope.media.url` já entrega pronto — o outro caminho
    // (upload inline) é otimização do Studio CRM para o próprio front dele,
    // não algo que este seam precisa reproduzir.
    const tipo =
      envelope.kind === "image"
        ? "image"
        : envelope.kind === "video"
          ? "video"
          : envelope.kind === "audio"
            ? "audio"
            : "document";
    const payload: Record<string, unknown> = {
      number: envelope.to,
      type: tipo,
      file: envelope.media.url,
    };
    if (envelope.media.caption) payload.text = envelope.media.caption;
    if (tipo === "document" && envelope.media.filename) payload.docName = envelope.media.filename;

    const res = await fetch(`${creds.baseUrl}/send/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: creds.token },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as {
      id?: string;
      messageId?: string;
      key?: { id?: string };
      error?: string;
      message?: string;
    } | null;
    if (!res.ok || json?.error) {
      const detalhe = json?.error ?? json?.message ?? res.statusText;
      throw new Error(`uazapi_send_failed: ${res.status} ${detalhe}`.trim());
    }
    return { externalId: json?.id ?? json?.messageId ?? json?.key?.id ?? null };
  },

  /**
   * Pergunta ao provedor se a instância ainda está conectada.
   *
   * `GET /instance/status` — confirmado em uazapi-check-status/index.ts, que
   * lê `data.instance.status` com fallback para `data.status`. O Studio CRM
   * NÃO normaliza esse valor (grava a string crua); aqui ele é traduzido para
   * o vocabulário que `lib/channels/health.ts` já entende (`WORKING` /
   * `SCAN_QR_CODE` / `STOPPED` / `FAILED`), porque é esse vocabulário que
   * decide quando abrir aviso (`STATUS_QUE_AVISAM`).
   *
   * ⚠️ NÃO MEDIDO: os valores exatos que a UAZAPI devolve em `status`
   * ('connected'/'disconnected'/'qrcode' são os nomes mais comuns na API
   * dela, mas o Studio CRM nunca precisou distinguir — só checa
   * `status === 'connected'`). Testar contra a instância real antes de
   * confiar neste mapeamento em produção.
   */
  async checkHealth(
    input: { organizationId: string; sessionRef: string },
  ): Promise<ChannelHealth> {
    const admin = createAdminClient();
    const creds = await resolveUazapiCreds(admin, {
      organizationId: input.organizationId,
      instanceId: input.sessionRef,
    });
    if (!creds) return { reachable: false, status: null, detail: "sem_credencial_para_a_instancia" };

    let res: Response;
    try {
      res = await fetch(`${creds.baseUrl}/instance/status`, {
        headers: { token: creds.token },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "erro_desconhecido";
      return { reachable: false, status: null, detail: detail.slice(0, 200) };
    }

    if (res.status === 401 || res.status === 403) {
      return { reachable: true, status: "FAILED", detail: "credencial_recusada_pelo_transporte" };
    }
    if (res.status === 404) {
      return { reachable: true, status: "STOPPED", detail: null };
    }
    if (!res.ok) {
      return { reachable: false, status: null, detail: `provedor_respondeu_${res.status}` };
    }

    const json = (await res.json().catch(() => null)) as {
      instance?: { status?: string };
      status?: string;
    } | null;
    const bruto = (json?.instance?.status ?? json?.status ?? "unknown").toLowerCase();

    if (bruto === "connected") return { reachable: true, status: "WORKING", detail: null };
    if (bruto === "disconnected") return { reachable: true, status: "STOPPED", detail: null };
    if (bruto.includes("qr") || bruto === "connecting") {
      return { reachable: true, status: "SCAN_QR_CODE", detail: null };
    }
    // Estado que não bate com o vocabulário conhecido: não inventa alerta.
    return { reachable: true, status: null, detail: `uazapi_status_${bruto}` };
  },

  /**
   * Baixa o anexo que o cliente mandou.
   *
   * ⚠️ NÃO CONFERIDO contra chamador de produção: o webhook do Studio CRM
   * extrai `media_url` do payload de entrada (`c.URL || c.url || c.directPath`,
   * ver `uazapi-webhook/index.ts::parseMessageContent`) mas dispara um worker
   * assíncrono para persistir a mídia (`kickMediaWorker`) em vez de baixar
   * ali mesmo — o código real que faz esse download não foi lido ainda, então
   * a autenticação abaixo (header `token`) é INFERIDA por paridade com os
   * outros dois endpoints, não medida. Confirmar contra a UAZAPI real antes
   * de depender disto em produção.
   */
  async fetchInboundMedia(input: {
    organizationId: string;
    sessionRef: string;
    url: string;
    hintMime?: string | null;
  }): Promise<FetchedMedia> {
    const admin = createAdminClient();
    const creds = await resolveUazapiCreds(admin, {
      organizationId: input.organizationId,
      instanceId: input.sessionRef,
    });
    if (!creds) throw new Error("uazapi_not_configured: sem credencial para baixar a mídia.");

    // Mesma guarda de SSRF que o `zernio` aplica: a URL vem do PAYLOAD do
    // webhook, e este fetch levaria a credencial do tenant no header — sem
    // guarda, um payload malicioso faria o servidor buscar metadado de nuvem
    // e entregar a credencial ao host escolhido pelo payload.
    assertSafeOutboundUrl(input.url);
    await assertDestinoResolvidoSeguro(new URL(input.url).hostname);

    const res = await fetch(input.url, { headers: { token: creds.token } });
    if (!res.ok) {
      throw new Error(`uazapi_media_failed: ${res.status} ${res.statusText}`.trim());
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || input.hintMime || "application/octet-stream";
    return { buffer, mime };
  },
};
