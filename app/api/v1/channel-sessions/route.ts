import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/channel-sessions — lista os canais WhatsApp da org (do DB).
 *   Acessível a qualquer membro (usado pelo seletor do inbox e pela sidebar).
 * POST /api/v1/channel-sessions — conecta um NOVO número (cria a sessão com
 *   nome único e inicia no WAHA). Admin only.
 *
 * organization_id resolvido da sessão (cookie) — nunca do body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { mfaEmDivida } from "@/lib/auth/server";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import {
  UAZAPI_CHANNEL_LABEL,
  provisionUazapiInstance,
  saveUazapiSession,
} from "@/lib/channels/uazapi/connect";
import { env } from "@/lib/env";
import { createChannelSchema } from "@/lib/schemas/channels";
import { createClient } from "@/lib/supabase/server";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { randomBytes } from "node:crypto";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export const CHANNEL_COLUMNS =
  "id, provider, uazapi_instance_id, display_name, phone_number, status, status_reason, last_health_check_at, last_status_change_at, daily_message_limit, is_warmup_complete, created_at";

/**
 * `waha_session_name` some da SELECT (a coluna só existe pra sessões WAHA, que
 * não nascem mais). O front (`ConnectionsClient.tsx::dependeDoTransporte`)
 * ainda lê esse campo pra saber "este canal depende do transporte pareado por
 * QR?" — em vez de tocar o componente, a resposta ECOA `uazapi_instance_id`
 * nesse mesmo nome de campo. Zero linha de tela muda.
 */
function comCampoLegado<T extends { provider?: string | null; uazapi_instance_id?: string | null }>(
  linha: T,
): T & { waha_session_name: string | null } {
  return { ...linha, waha_session_name: linha.provider === "uazapi" ? (linha.uazapi_instance_id ?? null) : null };
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const base = () =>
    supabase
      .from("channel_sessions")
      .select(CHANNEL_COLUMNS)
      .eq("organization_id", activeOrg.orgId);
  // Canais arquivados sobrevivem só como âncora das FKs RESTRICT
  // (conversations/messages). Para o usuário eles foram excluídos.
  //
  // Tolerante à coluna ausente porque esta é a PRIMEIRA tela de quem já tem
  // número ligado: num clone que subiu o código sem a migration 0106, o filtro
  // devolveria 42703 → 500 → "Nenhum número conectado ainda", convidando o
  // operador a parear de novo um número que já está no ar. Sem a coluna, nada
  // está arquivado, e a lista sem o filtro é a lista certa (ver lib/channels/archived).
  const { data, error, schemaOutdated } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).order("created_at", { ascending: true }),
    () => base().order("created_at", { ascending: true }),
  );
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok((data ?? []).map((linha) => comCampoLegado(linha as Record<string, unknown>)), {
    requestId,
    ...(schemaOutdated ? { meta: { schema_outdated: true } } : {}),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org: activeOrg } = authz;
  if (await mfaEmDivida()) return fail("mfa_required", t("Confirme a verificação em duas etapas."), 403, { requestId });

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = createChannelSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const admin = createAdminClient();

  // Sempre uma instância NOVA (não reaproveita): "Conectar novo WhatsApp"
  // pede outro número, e a org pode ter vários canais uazapi ativos —
  // diferente da tela de onboarding (que assume o primeiro/único número da
  // org). ⚠️ Sem a reserva transacional idempotente que o WAHA tinha
  // (`fn_reserve_channel_connection`/lease token): um duplo-clique rápido
  // pode, na pior hipótese, abrir duas instâncias na UAZAPI. Aceitável por
  // ora — a UAZAPI cobra por instância contratada, não por chamada, e o
  // botão desabilita durante `creating` do lado do front.
  const pathToken = randomBytes(16).toString("hex");
  const segredoWebhook = randomBytes(32).toString("hex");
  const segredoCifrado = await encryptWebhookSecret(admin, segredoWebhook);
  if (!segredoCifrado) {
    return fail("invalid_request", t("cifra indisponível nesta instalação — a chave não foi gravada"), 422, { requestId });
  }
  const configurada = env.NEXT_PUBLIC_APP_URL;
  const baseInstalacao = (
    (configurada && !configurada.includes("placeholder.invalid") ? configurada : null) ??
    req.headers.get("origin") ??
    `${req.nextUrl.protocol}//${req.nextUrl.host}`
  ).replace(/\/+$/, "");
  const webhookUrl = `${baseInstalacao}/api/v1/webhooks/channel/${pathToken}?secret=${encodeURIComponent(segredoWebhook)}`;

  const provisionado = await provisionUazapiInstance({
    webhookUrl,
    webhookSecret: segredoWebhook,
    existingInstanceToken: null,
    displayName: parsed.data.display_name ?? UAZAPI_CHANNEL_LABEL,
  });
  if (!provisionado.ok) {
    const isLimit = provisionado.reason === "uazapi_instance_limit_reached";
    return fail(
      provisionado.reason,
      isLimit
        ? t("Sua conta na UAZAPI atingiu o limite de instâncias contratadas. Acesse o painel da UAZAPI para liberar mais uma.")
        : t("Não foi possível concluir a conexão. Abra Conexões para tentar novamente ou reparar o número."),
      isLimit ? 422 : 502,
      { requestId },
    );
  }

  const tokenCifrado = await encryptWebhookSecret(admin, provisionado.instanceToken);
  if (!tokenCifrado) {
    return fail("invalid_request", t("cifra indisponível nesta instalação — a instância não foi gravada"), 422, { requestId });
  }

  const { error } = await saveUazapiSession(admin, {
    organizationId: activeOrg.orgId,
    existingId: null,
    instanceId: provisionado.instanceId,
    instanceTokenEncrypted: tokenCifrado,
    webhookPathToken: pathToken,
    webhookSecretEncrypted: segredoCifrado,
    phoneNumber: null,
    displayName: parsed.data.display_name ?? UAZAPI_CHANNEL_LABEL,
    status: provisionado.status.toUpperCase(),
  });
  if (error) return fail("internal_error", error, 500, { requestId });

  const { data: criado } = await (await createClient())
    .from("channel_sessions")
    .select(CHANNEL_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "uazapi")
    .eq("uazapi_instance_id", provisionado.instanceId)
    .maybeSingle();

  void audit({
    action: "channel.connected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    requestId,
    metadata: { provider: "uazapi", origin: "connections" },
  });

  return ok(
    criado ? comCampoLegado(criado as Record<string, unknown>) : { instance_id: provisionado.instanceId, status: provisionado.status },
    { requestId, status: 201 },
  );
}
