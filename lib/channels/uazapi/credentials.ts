/**
 * Credenciais do canal não oficial (UAZAPI) — **por sessão**, com env como
 * fallback. Mesmo desenho de `../zernio/credentials.ts`, e de propósito: dois
 * canais com formato de credencial diferente só fariam o self-hoster aprender
 * duas coisas.
 *
 * ─── O que muda em relação ao canal intermediado (zernio) ───────────────────
 *
 * Lá o `sessionRef` é o `accountId` que o BSP devolve ao conectar a WABA, e a
 * base da API é fixa por provider. Aqui o `sessionRef` é o id da instância
 * UAZAPI (uma por número conectado — `whatsapp_instances.id` no Studio CRM,
 * que é o precedente real desta integração) e o token é o `instance_token`
 * que a UAZAPI emite POR INSTÂNCIA — não uma API key única da organização.
 * `baseUrl` continua um único valor por instalação (`UAZAPI_BASE_URL`),
 * porque é a mesma UAZAPI self-hosted ou gerenciada atendendo todas as
 * instâncias, só o token muda por número.
 *
 * A cifra usa as MESMAS RPCs do resto do repo (`fn_encrypt_oauth` /
 * `fn_decrypt_oauth`, ver `lib/webhooks/secrets.ts`) — mesmo motivo do
 * `zernio/credentials.ts`: um terceiro caminho de cifra é mais um lugar por
 * onde a chave vaza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export interface UazapiCredentials {
  /** Id da instância na UAZAPI — endereça o webhook e é a chave de busca. */
  instanceId: string;
  /** `instance_token` emitido pela UAZAPI para ESTA instância. */
  token: string;
  baseUrl: string;
  /** De onde veio — aparece no log de diagnóstico, nunca no payload. */
  source: "session" | "env";
}

export interface UazapiCredsLookup {
  /** Resolvido de fonte confiável (sessão, linha já escopada, token do webhook). */
  organizationId: string;
  /** `channel_sessions.uazapi_instance_id` — o `sessionRef` deste canal. */
  instanceId: string;
}

/**
 * Base da API. Explícita e sobrescrevível, mesmo padrão de `zernioBaseUrl()`:
 * quem roda a própria UAZAPI (self-hosted) ou um plano gerenciado aponta para
 * onde for. Sem valor configurado o canal é tratado como não conectado — não
 * há "produção do provedor" padrão para uma API que cada instalação hospeda
 * ou contrata por si.
 */
export function uazapiBaseUrl(): string | null {
  const v = process.env.UAZAPI_BASE_URL?.trim();
  return v ? v.replace(/\/$/, "") : null;
}

/**
 * Credencial do ambiente — a instância ÚNICA configurada por `.env`, para
 * instalação com um número só. `null` quando faltar base ou token: o
 * chamador trata como canal não conectado (noop), nunca como erro.
 */
export function uazapiCredsFromEnv(): UazapiCredentials | null {
  const baseUrl = uazapiBaseUrl();
  const instanceId = process.env.UAZAPI_INSTANCE_ID?.trim();
  const token = process.env.UAZAPI_INSTANCE_TOKEN?.trim();
  if (!baseUrl || !instanceId || !token) return null;
  return { instanceId, token, baseUrl, source: "env" };
}

/**
 * Credencial gravada na sessão DESTA ORGANIZAÇÃO que atende esta instância.
 *
 * `null` significa "esta sessão não tem chave gravada" — o chamador cai no
 * env. NÃO significa erro.
 *
 * **LANÇA quando a consulta falha** — mesma razão de `zernioCredsForAccountId`
 * (issue #236 do canal irmão): descartar o `error` de uma colisão de
 * `maybeSingle()` manda a organização errada para a conta do `.env` em
 * silêncio. Índice único parcial por `(organization_id, uazapi_instance_id)`
 * entre sessões ativas fecha a colisão na origem (ver a migration que
 * acompanha este módulo).
 */
export async function uazapiCredsForInstanceId(
  admin: SupabaseClient,
  lookup: UazapiCredsLookup,
): Promise<UazapiCredentials | null> {
  const { organizationId, instanceId } = lookup;
  if (!organizationId || !instanceId) return null;

  const base = () =>
    admin
      .from("channel_sessions")
      .select("uazapi_instance_id, uazapi_token_encrypted")
      .eq("organization_id", organizationId)
      .eq("uazapi_instance_id", instanceId);
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error) {
    throw new Error(
      `uazapi_creds_lookup_failed: ${error.code ?? "sem_codigo"} ${error.message ?? ""}`.trim(),
    );
  }

  const cifrado = data?.uazapi_token_encrypted;
  if (!data || !cifrado) return null;

  const token = await decryptWebhookSecret(admin, cifrado as unknown as string);
  // Decifra que falha devolve null: a chave (GUC) pode não estar configurada
  // nesta instalação. Cair no env é melhor que derrubar o envio.
  if (!token) return null;

  const baseUrl = uazapiBaseUrl();
  if (!baseUrl) return null;

  return {
    instanceId: data.uazapi_instance_id as string,
    token,
    baseUrl,
    source: "session",
  };
}

/**
 * A credencial em vigor para esta instância: **sessão primeiro, env como
 * fallback** — mesma ordem e mesmo motivo de `resolveZernioCreds`: com a
 * chave gravada pela tela, um env esquecido não deve silenciar a configuração
 * que o operador já fez.
 */
export async function resolveUazapiCreds(
  admin: SupabaseClient,
  lookup: UazapiCredsLookup,
): Promise<UazapiCredentials | null> {
  return (await uazapiCredsForInstanceId(admin, lookup)) ?? uazapiCredsFromEnv();
}
