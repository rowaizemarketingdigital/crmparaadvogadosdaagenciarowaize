/**
 * Entrada do canal não oficial (UAZAPI) — verificação do segredo e leitura do
 * payload. PURO de propósito, mesmo motivo de `zernio/webhook.ts`: nada aqui
 * toca banco, rede ou relógio.
 *
 * ─── Fonte: o Studio CRM, linha por linha ────────────────────────────────────
 *
 * Toda função abaixo espelha `uazapi-webhook/index.ts` do Studio CRM
 * (CONFERIDO, não lido de doc da UAZAPI). Onde o Studio CRM não tinha
 * chamador equivalente para conferir contra, está marcado como tal.
 *
 * ─── Por que a auth aqui NÃO é HMAC, ao contrário do WAHA e do zernio ───────
 *
 * Os outros dois canais deste repo assinam o CORPO (SHA-512/SHA-256). A
 * UAZAPI, no Studio CRM, verifica um SEGREDO ESTÁTICO enviado inteiro no
 * header `x-webhook-secret` (ou, historicamente, via `?secret=` na URL) —
 * comparação direta, não assinatura derivada do corpo. É mais fraco que HMAC
 * (um segredo vazado permite forjar qualquer payload; numa assinatura, só
 * vazando o segredo E sabendo o formato do corpo), mas é o que a API
 * realmente oferece — fingir HMAC aqui seria inventar segurança que a UAZAPI
 * não dá.
 */
import { timingSafeEqual } from "node:crypto";

/** Comparação de tempo constante do segredo estático. */
export function verifyUazapiSecret(headerValue: string | null, secret: string): boolean {
  if (!secret || !headerValue) return false;
  const a = Buffer.from(headerValue, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Classificação do evento — mesma ordem de checagem do Studio CRM. */
export type UazapiEventKind = "message_update" | "connection" | "message" | "ignored";

export function classifyUazapiEvent(payload: unknown): UazapiEventKind {
  const p = obj(payload);
  if (!p) return "ignored";
  const eventType = str(p.EventType) ?? str(p.event) ?? str(p.type) ?? "unknown";

  // Reação/edição/exclusão vindas do PRÓPRIO WhatsApp (contato reage ou
  // apaga do lado dele). Formato não totalmente confirmado no Studio CRM
  // (comentário original: "sem chamador equivalente para comparar") — só o
  // caminho de REVOKE é implementado do lado de cá (ver ingest.ts).
  if (/update/i.test(eventType)) return "message_update";

  const connStatus =
    obj(p.instance)?.status ?? p.status ?? obj(p.data)?.status ?? null;
  if (eventType === "connection" || (connStatus && !p.message && !p.chat)) {
    return "connection";
  }

  return "message";
}

/** A instância de destino, pelo TOKEN que o próprio payload carrega — não
 * pela URL. Diferente dos outros dois canais (sessão vem do path token da
 * rota); aqui a rota resolve a sessão do jeito de sempre (path token
 * genérico do seam, `webhook_path_token`), e este campo serve só para
 * conferência/log — a fonte confiável da organização continua sendo a
 * sessão que a rota já resolveu, nunca o corpo. */
export function uazapiTokenDoPayload(payload: unknown): string | null {
  const p = obj(payload);
  if (!p) return null;
  return str(p.token) ?? str(obj(p.instance)?.token) ?? str(p.instanceToken);
}

/** Grupo — não faz binding de CRM (mesma regra dos outros dois canais). */
export function isUazapiGroup(payload: unknown): boolean {
  const p = obj(payload);
  const chat = obj(p?.chat);
  const msg = obj(p?.message) ?? obj(p?.data);
  return chat?.wa_isGroup === true || msg?.isGroup === true;
}

/**
 * Telefone de quem enviou/recebeu — varre os mesmos candidatos que
 * `extractContactPhone` do Studio CRM, na mesma ordem.
 */
export function extrairTelefoneUazapi(
  payload: unknown,
  instanceOwnerNormalized: string | null,
): { raw: string; normalized: string } | null {
  const p = obj(payload) ?? {};
  const chat = obj(p.chat) ?? {};
  const msg = obj(p.message) ?? obj(p.data) ?? {};

  const candidatos: unknown[] = [
    chat.wa_chatid,
    chat.phone,
    chat.owner !== instanceOwnerNormalized ? chat.owner : null,
    msg.chatid,
    msg.sender_pn,
    msg.fromMe !== true ? msg.sender : null,
    msg.from,
    obj(msg.key)?.remoteJid,
    msg.remoteJid,
  ];
  for (const c of candidatos) {
    if (!c) continue;
    const digitos = String(c).replace(/[^0-9]/g, "");
    if (digitos.length >= 10 && digitos !== instanceOwnerNormalized) {
      return { raw: String(c), normalized: digitos };
    }
  }
  return null;
}

export type UazapiMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "unknown";

export interface UazapiParsedMessage {
  type: UazapiMessageType;
  text: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaFileName: string | null;
  mediaCaption: string | null;
  preview: string;
}

/**
 * Tipo e conteúdo da mensagem — espelha `parseMessageContent` do Studio CRM
 * (mediaType/messageType + fallback pelo `content`/`hydratedTemplate`, forma
 * bruta do Baileys por trás da UAZAPI).
 */
export function parseUazapiMessage(msgRaw: unknown): UazapiParsedMessage {
  const msg = obj(msgRaw) ?? {};
  const mt = String(msg.mediaType ?? "").toLowerCase();
  const mtype = String(msg.messageType ?? msg.type ?? "").toLowerCase();
  const rawText = typeof msg.text === "string" ? msg.text : null;

  if ((!mt || mt === "text") && rawText && msg.type !== "media") {
    return { type: "text", text: rawText, mediaUrl: null, mediaMime: null, mediaFileName: null, mediaCaption: null, preview: rawText.slice(0, 200) };
  }

  let kind: UazapiMessageType = "unknown";
  if (mt === "image" || mtype.includes("image")) kind = "image";
  else if (mt === "video" || mtype.includes("video")) kind = "video";
  else if (mt === "audio" || mt === "ptt" || mtype.includes("audio")) kind = "audio";
  else if (mt === "document" || mtype.includes("document")) kind = "document";
  else if (mt === "sticker" || mtype.includes("sticker")) kind = "sticker";
  else if (rawText) {
    return { type: "text", text: rawText, mediaUrl: null, mediaMime: null, mediaFileName: null, mediaCaption: null, preview: rawText.slice(0, 200) };
  }

  const c = obj(msg.content) ?? {};
  const hidratado = obj(obj(c.hydratedTemplate)?.Title) ?? {};
  const hMedia =
    obj(hidratado.ImageMessage) ?? obj(hidratado.VideoMessage) ??
    obj(hidratado.DocumentMessage) ?? obj(hidratado.AudioMessage) ?? {};
  if (kind === "unknown" && hMedia.URL) {
    kind = hidratado.ImageMessage ? "image" : hidratado.VideoMessage ? "video" : hidratado.AudioMessage ? "audio" : "document";
  }

  const url = str(c.URL) ?? str(c.url) ?? str(c.directPath) ?? str(hMedia.URL);
  const mime = str(c.mimetype) ?? str(c.mimeType) ?? str(hMedia.mimetype);
  const fileName = str(c.fileName) ?? str(c.filename) ?? str(hMedia.fileName);
  const caption = (typeof c.caption === "string" ? c.caption : null) ?? (rawText && msg.type === "media" ? rawText : null);

  const emoji = { image: "📷", video: "🎥", audio: "🎧", document: "📎", sticker: "💬", unknown: "❔", text: "" }[kind];
  const label: Record<UazapiMessageType, string> = { image: "Imagem", video: "Vídeo", audio: "Áudio", document: "Documento", sticker: "Figurinha", unknown: "Mensagem não suportada", text: "" };
  let preview = `${emoji} ${label[kind]}`;
  if (kind === "document" && fileName) preview = `📎 ${fileName}`;
  if (caption) preview = `${emoji} ${caption.slice(0, 180)}`;

  return { type: kind, text: caption, mediaUrl: url, mediaMime: mime, mediaFileName: fileName, mediaCaption: caption, preview: preview.slice(0, 200) };
}

export function resolveUazapiMessageId(msgRaw: unknown): string | null {
  const msg = obj(msgRaw) ?? {};
  return str(msg.messageid) ?? str(msg.id) ?? str(obj(msg.key)?.id);
}

export function resolveUazapiFromMe(msgRaw: unknown): boolean {
  const msg = obj(msgRaw) ?? {};
  if (typeof msg.fromMe === "boolean") return msg.fromMe;
  const key = obj(msg.key);
  return key?.fromMe === true;
}

/**
 * O objeto `externalAdReply` do evento, cru — presente quando a conversa
 * começou por um clique em anúncio "Clique para o WhatsApp". Confirmado no
 * Studio CRM em `msg.content.contextInfo.externalAdReply` (e o fallback
 * `msg.content.externalAdReply`); só `ctwaClid`/`sourceID` foram vistos
 * sendo lidos de lá — `título`/`corpo`/`sourceUrl` do tipo
 * `AtribuicaoDeAnuncio` deste repo NÃO têm equivalente confirmado neste
 * payload, então saem `null` em vez de adivinhados.
 */
export function extrairAtribuicaoUazapi(msgRaw: unknown): {
  plataforma: "meta_ads";
  sourceId: string | null;
  titulo: null;
  corpo: null;
  sourceUrl: null;
  bruto: unknown;
} | null {
  const msg = obj(msgRaw) ?? {};
  const content = obj(msg.content) ?? {};
  const ctx = obj(content.contextInfo);
  const ad = obj(ctx?.externalAdReply) ?? obj(content.externalAdReply);
  if (!ad) return null;
  const ctwaClid = str(ad.ctwaClid);
  const sourceId = str(ad.sourceID) ?? str(ad.sourceId) ?? ctwaClid;
  if (!sourceId) return null;
  return { plataforma: "meta_ads", sourceId, titulo: null, corpo: null, sourceUrl: null, bruto: ad };
}

/**
 * O evento avisa que uma mensagem já existente foi apagada ("apagar para
 * todos")? Único desfecho de `message_update` implementado do lado de cá —
 * ver o comentário em `classifyUazapiEvent` sobre por que reação não entra
 * (formato não confirmado contra chamador real).
 */
export function parseUazapiRevoke(payload: unknown): { externalId: string } | null {
  const p = obj(payload) ?? {};
  const upd = obj(p.message) ?? obj(p.data) ?? p;
  const externalId = str(upd.id) ?? str(upd.messageid) ?? str(obj(upd.key)?.id);
  if (!externalId) return null;
  const isRevoked =
    upd.messageStubType === "REVOKE" ||
    upd.status === "REVOKED" ||
    upd.type === "revoked" ||
    upd.deleted === true;
  return isRevoked ? { externalId } : null;
}

/**
 * Status cru da conexão → o vocabulário que `lib/channels/health.ts` já
 * entende. Mesma tradução usada em `adapters/uazapi.ts::checkHealth` — ver
 * o aviso "NÃO MEDIDO" lá: os valores exatos ('connected'/'disconnected')
 * vêm do `uazapi-check-status` do Studio CRM, que nunca precisou distinguir
 * mais que `=== 'connected'`.
 */
export function mapUazapiStatus(bruto: string): "WORKING" | "STOPPED" | "SCAN_QR_CODE" | null {
  const s = bruto.toLowerCase();
  if (s === "connected") return "WORKING";
  if (s === "disconnected") return "STOPPED";
  if (s.includes("qr") || s === "connecting") return "SCAN_QR_CODE";
  return null;
}

export function resolveUazapiConnectionStatus(payload: unknown): string | null {
  const p = obj(payload) ?? {};
  return str(obj(p.instance)?.status) ?? str(p.status) ?? str(obj(p.data)?.status);
}
