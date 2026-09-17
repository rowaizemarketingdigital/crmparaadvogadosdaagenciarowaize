/**
 * Ingestão do canal Instagram: webhook → contato. Continuação da fatia
 * anterior (que só recebia/verificava/arquivava) — mesma disciplina da 0238:
 * contato do Instagram entra no MESMO cadastro único (`fn_upsert_instagram_contact`),
 * nunca um sistema de identidade à parte.
 *
 * ─── O que este módulo NÃO cobre ainda ──────────────────────────────────────
 *
 * Conversa/mensagem (linha em `conversations`/`messages`) e o motor de
 * automação por palavra-chave — próximas fatias. Esta resolve só "quem é essa
 * pessoa no cadastro", que é o que as duas seguintes precisam existir antes
 * de fazer sentido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import type { InstagramWebhookEvent } from "./webhook";

export interface InstagramIngestSession {
  organizationId: string;
}

export interface InstagramIngestResult {
  status: "contact_resolved" | "ignored_echo" | "failed";
  contactId?: string;
  reason?: string;
}

async function upsertContact(
  admin: SupabaseClient,
  orgId: string,
  instagramId: string,
  username: string | null,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_instagram_contact" as never, {
    p_org: orgId,
    p_instagram_id: instagramId,
    p_username: username,
  } as never);
  if (error) {
    logger.error("[instagram.ingest] fn_upsert_instagram_contact falhou", {
      detail: error.message.slice(0, 200),
    });
    return null;
  }
  return (data as string | null) ?? null;
}

export async function ingestInstagramInbound(
  admin: SupabaseClient,
  event: InstagramWebhookEvent,
  session: InstagramIngestSession,
): Promise<InstagramIngestResult> {
  if (event.kind === "dm") {
    // Eco do que A PRÓPRIA conta mandou (via API ou manual) — nunca é uma
    // mensagem de cliente, nunca dispara nada. Mesmo cuidado que `is_echo`
    // exige no Messenger Platform/Instagram Login inteiro.
    if (event.isEcho) return { status: "ignored_echo" };

    const contactId = await upsertContact(admin, session.organizationId, event.senderId, null);
    if (!contactId) return { status: "failed", reason: "upsert_contact_failed" };
    return { status: "contact_resolved", contactId };
  }

  // Comentário: o autor é quem comentou, não a conta dona da página.
  const contactId = await upsertContact(admin, session.organizationId, event.fromUserId, event.fromUsername);
  if (!contactId) return { status: "failed", reason: "upsert_contact_failed" };
  return { status: "contact_resolved", contactId };
}
