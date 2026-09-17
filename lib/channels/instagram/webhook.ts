/**
 * Webhook do Instagram (Graph API, produto Instagram Login) — parse. **Puro e
 * síncrono**: nada aqui toca banco nem rede, mesma regra do `meta/webhook.ts`.
 *
 * Verificação de assinatura e handshake NÃO são reimplementados aqui —
 * `verifyMetaSignature`/`verificationChallenge` (`../meta/webhook.ts`) são o
 * mesmo esquema HMAC-SHA256/App-Secret usado por QUALQUER app da Meta,
 * WhatsApp Cloud ou Instagram Login (confirmado por pesquisa contra os dois
 * sistemas reais antes de escrever este arquivo) — duplicar seria a segunda
 * cópia que diverge no primeiro conserto.
 *
 * O ENVELOPE, porém, é forma própria — `object: "instagram"`,
 * `entry[].changes[]` para comentário, `entry[].messaging[]` para DM/resposta
 * de story, nenhuma sobreposição real com o shape de WhatsApp que
 * `meta/webhook.ts` já interpreta (`object: "whatsapp_business_account"`,
 * `entry[].changes[].value.messages[]`). Por isso é um parser NOVO, irmão do
 * de WhatsApp, não um ramo dentro dele — mesma decisão que `uazapi/webhook.ts`
 * e `zernio/webhook.ts` já tomaram como irmãos de `meta/webhook.ts`.
 *
 * Formas confirmadas contra o sistema de automação de Instagram real
 * (Robson/Rowaize) antes de escrever este arquivo, não inventadas:
 *   - comentário: `change.field === "comments"`, `value.{id,text,media.id,from.{id,username}}`
 *   - DM:         `messaging[].{sender.id, message.{mid,text,is_echo,quick_reply.payload}}`
 *   - resp. story: `messaging[].message.reply_to.story.id` presente
 */
export { verifyMetaSignature, verificationChallenge } from "../meta/webhook";

export interface InstagramCommentEvent {
  kind: "comment";
  businessId: string;
  commentId: string;
  mediaId: string | null;
  text: string;
  fromUserId: string;
  fromUsername: string | null;
}

export interface InstagramDirectMessageEvent {
  kind: "dm";
  businessId: string;
  messageId: string;
  senderId: string;
  text: string | null;
  /** Payload do botão de quick-reply, quando a pessoa tocou um em vez de digitar. */
  quickReplyPayload: string | null;
  /** Id da story respondida, quando o DM nasceu de "responder a uma story". */
  storyReplyId: string | null;
  /** Eco do que a PRÓPRIA conta mandou (via API ou manual) — nunca dispara automação. */
  isEcho: boolean;
}

export type InstagramWebhookEvent = InstagramCommentEvent | InstagramDirectMessageEvent;

interface RawChange {
  field?: unknown;
  value?: {
    id?: unknown;
    text?: unknown;
    media?: { id?: unknown };
    from?: { id?: unknown; username?: unknown };
  };
}

interface RawMessaging {
  sender?: { id?: unknown };
  message?: {
    mid?: unknown;
    text?: unknown;
    is_echo?: unknown;
    quick_reply?: { payload?: unknown };
    reply_to?: { story?: { id?: unknown } };
  };
}

interface RawEntry {
  id?: unknown;
  changes?: RawChange[];
  messaging?: RawMessaging[];
}

interface RawEnvelope {
  object?: unknown;
  entry?: RawEntry[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * `entry[].id` é o `ig_user_id` da conta ONDE o evento aconteceu — pode ser
 * diferente da conta que este token de app assina se o app atende N contas.
 * Quem chama (a rota) decide se aceita comparando com a sessão resolvida pelo
 * token do path — mesma disciplina do `meta/webhook.ts` (nunca confiar no
 * corpo pra escolher o tenant).
 */
export function parseInstagramWebhook(raw: unknown): InstagramWebhookEvent[] {
  const envelope = raw as RawEnvelope;
  if (envelope?.object !== "instagram") return [];

  const eventos: InstagramWebhookEvent[] = [];
  for (const entry of envelope.entry ?? []) {
    const businessId = str(entry.id);
    if (!businessId) continue;

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue; // outros fields (ex. mentions) ainda não têm handler — cai fora de propósito, igual ao meta/webhook.ts
      const v = change.value;
      const commentId = str(v?.id);
      if (!commentId) continue;
      eventos.push({
        kind: "comment",
        businessId,
        commentId,
        mediaId: str(v?.media?.id),
        text: str(v?.text) ?? "",
        fromUserId: str(v?.from?.id) ?? "",
        fromUsername: str(v?.from?.username),
      });
    }

    for (const msg of entry.messaging ?? []) {
      const messageId = str(msg.message?.mid);
      const senderId = str(msg.sender?.id);
      if (!messageId || !senderId) continue;
      eventos.push({
        kind: "dm",
        businessId,
        messageId,
        senderId,
        text: str(msg.message?.text),
        quickReplyPayload: str(msg.message?.quick_reply?.payload),
        storyReplyId: str(msg.message?.reply_to?.story?.id),
        isEcho: msg.message?.is_echo === true,
      });
    }
  }
  return eventos;
}
