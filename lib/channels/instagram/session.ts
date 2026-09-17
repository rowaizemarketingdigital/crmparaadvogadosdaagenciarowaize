/**
 * Resolução da sessão dona de um webhook do Instagram — mesmo papel de
 * `../meta/session.ts`, mesmo motivo: a rota de webhook não pode escrever
 * `.eq("provider", "instagram")` (invariante 1, `lint-channels`), então a
 * query mora aqui, não na rota.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { CHANNEL_PROVIDER_INSTAGRAM } from "../capabilities";

export interface InstagramWebhookSession {
  id: string;
  organizationId: string;
  businessId: string;
}

/**
 * Sessão amarrada a este token de webhook. `null` = token desconhecido (a
 * rota responde 404 sem revelar por quê) — mesma disciplina de
 * `metaSessionByWebhookToken`, incluindo tratar canal arquivado como token
 * desconhecido (evita ressuscitar canal excluído por evento em voo/reentrega).
 */
export async function instagramSessionByWebhookToken(
  token: string,
): Promise<InstagramWebhookSession | null> {
  if (!token || token.length < 8) return null;

  const admin = createAdminClient();
  const base = () =>
    admin
      .from("channel_sessions")
      .select("id, organization_id, instagram_business_id")
      .eq("webhook_path_token", token)
      .eq("provider", CHANNEL_PROVIDER_INSTAGRAM);
  const { data } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );

  if (!data || !data.instagram_business_id) return null;
  return {
    id: data.id,
    organizationId: data.organization_id,
    businessId: data.instagram_business_id,
  };
}
