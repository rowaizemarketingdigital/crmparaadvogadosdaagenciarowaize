/**
 * Credenciais do canal Instagram — por sessão (conta conectada), com env como
 * fallback pra instalação de conta única. Mesmo desenho de
 * `../uazapi/credentials.ts`/`../zernio/credentials.ts`.
 *
 * ─── O que muda em relação aos outros canais ────────────────────────────────
 *
 * Não há "admin token que emite token por instância" (UAZAPI) nem "API key
 * única do BSP" (zernio) — é OAuth Instagram Login: a conta autoriza uma vez
 * (fora do escopo desta fatia — tela de conectar é trabalho futuro) e o
 * resultado é um access token de LONGA DURAÇÃO (`ig_exchange_token`) por
 * conta conectada. `sessionRef` é o `ig_user_id` (`instagram_business_id`,
 * migration 0237), não um id de instância nem de conta BSP.
 *
 * A cifra usa as MESMAS RPCs do resto do repo (`fn_encrypt_oauth`/
 * `fn_decrypt_oauth`) — mesmo motivo dos outros dois: um terceiro caminho de
 * cifra é mais um lugar por onde a chave vaza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export interface InstagramCredentials {
  /** `ig_user_id` da conta conectada — o `sessionRef` deste canal. */
  businessId: string;
  /** Access token de longa duração (Instagram Login). */
  accessToken: string;
  /** De onde veio — aparece no log de diagnóstico, nunca no payload. */
  source: "session" | "env";
}

export interface InstagramCredsLookup {
  organizationId: string;
  /** `channel_sessions.instagram_business_id` — o `sessionRef` deste canal. */
  businessId: string;
}

/**
 * Base da Graph API do Instagram Login — explícita e com fallback pro valor
 * real conferido no sistema de automação em produção. `graph.instagram.com`,
 * NÃO `graph.facebook.com` (esse é o produto "Facebook Login for Business",
 * outro fluxo de credencial — misturar os dois responde 400 em silêncio).
 */
export function instagramGraphBaseUrl(): string {
  return (process.env.INSTAGRAM_GRAPH_BASE_URL?.trim() || "https://graph.instagram.com").replace(/\/$/, "");
}

/** Versão explícita — bump é decisão, não deriva. Mesmo motivo do `META_GRAPH_VERSION`. */
export function instagramGraphVersion(): string {
  return process.env.INSTAGRAM_GRAPH_VERSION?.trim() || "v25.0";
}

/**
 * Credencial do ambiente — a conta ÚNICA configurada por `.env`, pra
 * instalação com uma conta Instagram só. `null` quando faltar id ou token: o
 * chamador trata como canal não conectado (noop), nunca como erro.
 */
export function instagramCredsFromEnv(): InstagramCredentials | null {
  const businessId = process.env.INSTAGRAM_BUSINESS_ID?.trim();
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!businessId || !accessToken) return null;
  return { businessId, accessToken, source: "env" };
}

/**
 * Credencial gravada na sessão DESTA ORGANIZAÇÃO que atende esta conta.
 *
 * **LANÇA quando a consulta falha** — mesma razão de `uazapiCredsForInstanceId`
 * (issue #236 do canal irmão): descartar o `error` de uma colisão de
 * `maybeSingle()` manda a organização errada pro token do `.env` em silêncio.
 * Índice único parcial por `(organization_id, instagram_business_id)` entre
 * sessões ativas fecha a colisão na origem (migration 0237).
 */
export async function instagramCredsForBusinessId(
  admin: SupabaseClient,
  lookup: InstagramCredsLookup,
): Promise<InstagramCredentials | null> {
  const { organizationId, businessId } = lookup;
  if (!organizationId || !businessId) return null;

  const base = () =>
    admin
      .from("channel_sessions")
      .select("instagram_business_id, instagram_access_token_encrypted")
      .eq("organization_id", organizationId)
      .eq("instagram_business_id", businessId);
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error) {
    throw new Error(
      `instagram_creds_lookup_failed: ${error.code ?? "sem_codigo"} ${error.message ?? ""}`.trim(),
    );
  }

  const cifrado = data?.instagram_access_token_encrypted;
  if (!data || !cifrado) return null;

  const accessToken = await decryptWebhookSecret(admin, cifrado as unknown as string);
  if (!accessToken) return null;

  return { businessId: data.instagram_business_id as string, accessToken, source: "session" };
}

/**
 * A credencial em vigor pra esta conta: **sessão primeiro, env como
 * fallback** — mesma ordem e mesmo motivo de `resolveUazapiCreds`.
 */
export async function resolveInstagramCreds(
  admin: SupabaseClient,
  lookup: InstagramCredsLookup,
): Promise<InstagramCredentials | null> {
  return (await instagramCredsForBusinessId(admin, lookup)) ?? instagramCredsFromEnv();
}
