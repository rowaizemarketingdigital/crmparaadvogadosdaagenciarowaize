import { randomBytes, randomUUID } from "node:crypto";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/channels";
import {
  UAZAPI_CHANNEL_LABEL,
  provisionUazapiInstance,
  saveUazapiSession,
} from "@/lib/channels/uazapi/connect";
import { loadOnboardingChannel } from "@/lib/channels/onboarding-session";
import { env } from "@/lib/env";
import { encryptWebhookSecret, decryptWebhookSecret } from "@/lib/webhooks/secrets";

/**
 * Mesma tela de sempre (`app/onboarding/connect-whatsapp/_client.tsx`), motor
 * trocado de WAHA pra UAZAPI — contrato de resposta (`{status, session,
 * channel_session_id}`) preservado igual, então o componente da tela não
 * precisou de uma linha de mudança.
 */
function baseUrlDaInstalacao(req: Request): string {
  const configurada = env.NEXT_PUBLIC_APP_URL;
  const usavel = configurada && !configurada.includes("placeholder.invalid") ? configurada : null;
  const url = new URL(req.url);
  return (usavel ?? req.headers.get("origin") ?? `${url.protocol}//${url.host}`).replace(/\/+$/, "");
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser(); if (!user) return fail("unauthenticated", "Sessão expirada", 401, { requestId });
  const org = await resolveActiveOrg(user); if (!org) return fail("tenant_not_found", "Sem organização ativa", 404, { requestId });
  if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });

  try {
    const db = await createClient();
    const channel = await loadOnboardingChannel(db, org.orgId);
    if (!channel || channel.archived_at) return ok({ status: "NOT_STARTED", session: null }, { requestId });
    if (!channel.uazapi_instance_id) return ok({ status: "NOT_STARTED", session: null }, { requestId });

    const adapter = getAdapter("uazapi");
    const saude = adapter.checkHealth
      ? await adapter.checkHealth({ organizationId: org.orgId, sessionRef: channel.uazapi_instance_id })
      : null;
    const status = saude?.reachable && saude.status ? saude.status : (channel.status ?? "STOPPED");

    const { error, data } = await db.from("channel_sessions")
      .update({ status, last_health_check_at: new Date().toISOString() })
      .eq("organization_id", org.orgId).eq("id", channel.id).is("archived_at", null).select("id").maybeSingle();
    if (error || !data) throw new Error("connection_sync_failed");
    return ok({ status, session: channel.uazapi_instance_id, channel_session_id: channel.id }, { requestId });
  } catch { return fail("connection_status_failed", "Não foi possível conferir a conexão. Tente novamente.", 502, { requestId }); }
}

export async function POST(req: Request): Promise<Response> {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_sessions", allowPlatformAdmin: true });
  if (!auth.ok) return auth.response;
  if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });

  const db = await createClient();
  const admin = createAdminClient();
  const existente = await loadOnboardingChannel(db, auth.org.orgId);

  const pathToken = randomBytes(16).toString("hex");
  const segredoWebhook = randomBytes(32).toString("hex");
  const segredoCifrado = await encryptWebhookSecret(admin, segredoWebhook);
  if (!segredoCifrado) {
    return fail("invalid_request", "cifra indisponível nesta instalação — a chave não foi gravada", 422, { requestId });
  }
  const webhookUrl =
    `${baseUrlDaInstalacao(req)}/api/v1/webhooks/channel/${pathToken}?secret=${encodeURIComponent(segredoWebhook)}`;

  let tokenExistente: string | null = null;
  if (existente?.uazapi_token_encrypted) {
    tokenExistente = await decryptWebhookSecret(admin, existente.uazapi_token_encrypted);
  }

  // `restart=1` não muda nada aqui: reaproveita o token existente do mesmo
  // jeito de sempre (não recria a instância na UAZAPI) — é ela quem gira o
  // código novo dentro de `provisionUazapiInstance`.
  const provisionado = await provisionUazapiInstance({
    webhookUrl,
    webhookSecret: segredoWebhook,
    existingInstanceToken: tokenExistente,
    displayName: UAZAPI_CHANNEL_LABEL,
  });
  if (!provisionado.ok) {
    return fail(provisionado.reason, "Não foi possível concluir a conexão. Tente novamente ou repare o número em Conexões.", 502, { requestId });
  }

  const tokenCifrado = await encryptWebhookSecret(admin, provisionado.instanceToken);
  if (!tokenCifrado) {
    return fail("invalid_request", "cifra indisponível nesta instalação — a instância não foi gravada", 422, { requestId });
  }

  const { error } = await saveUazapiSession(admin, {
    organizationId: auth.org.orgId,
    existingId: existente?.id ?? null,
    instanceId: provisionado.instanceId,
    instanceTokenEncrypted: tokenCifrado,
    // Sempre novo, mesmo numa reconexão: o webhook é re-registrado na UAZAPI
    // nesta MESMA chamada (dentro de `provisionUazapiInstance`), então o
    // token antigo nunca fica órfão — não há motivo pra preservá-lo aqui
    // (diferente da tela de Conexões, que só re-registra sob pedido).
    webhookPathToken: pathToken,
    webhookSecretEncrypted: segredoCifrado,
    phoneNumber: null,
    displayName: UAZAPI_CHANNEL_LABEL,
    status: provisionado.status.toUpperCase(),
  });
  if (error) return fail("internal_error", error, 500, { requestId });

  return ok(
    { status: provisionado.status.toUpperCase(), session: provisionado.instanceId, channel_session_id: existente?.id ?? null },
    { requestId },
  );
}
