import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/channel-sessions/[id]/reconnect — reconecta um canal caído.
 *
 * Mesma tela e mesmo contrato de sempre (`ConnectionsClient.tsx` não mudou) —
 * o motor trocou de WAHA pra UAZAPI.
 *
 * ⚠️ O modo `{ force: true }` (que no WAHA fazia logout explícito antes de
 * religar, pra descartar credencial morta) hoje se comporta IGUAL ao modo
 * suave: os dois chamam `provisionUazapiInstance` reaproveitando o token da
 * instância. Não achei, lendo o Studio CRM, um endpoint de "invalidar sessão
 * e forçar reescaneamento" equivalente ao logout do WAHA — `instance/connect`
 * já devolve um QR novo quando a sessão não está mais pareada, então na
 * prática o soft já resolve o caso que o force existia pra cobrir. Ficou
 * documentado aqui, não escondido.
 *
 * Canal EXCLUÍDO (arquivado) é recusado — mesma razão de sempre: reviveria um
 * canal que recebe e não entrega nada.
 *
 * Admin only. organization_id vem da sessão — nunca do path/body.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { mfaEmDivida } from "@/lib/auth/server";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import {
  UAZAPI_CHANNEL_LABEL,
  provisionUazapiInstance,
  saveUazapiSession,
} from "@/lib/channels/uazapi/connect";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { encryptWebhookSecret, decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const reconnectSchema = z.object({ force: z.boolean().optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await params;

  let rawBody: unknown = {};
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }
  const parsedBody = reconnectSchema.safeParse(rawBody ?? {});
  const force = parsedBody.success ? (parsedBody.data.force ?? false) : false;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org: activeOrg } = authz;
  if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });

  const supabase = await createClient();
  const buscar = (colunas: string) =>
    supabase
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id)
      .maybeSingle();
  const { data: sessionRaw } = await queryTolerantToMissingArchived(
    () => buscar(`id, provider, uazapi_instance_id, uazapi_token_encrypted, display_name, webhook_path_token, ${ARCHIVED_AT}`),
    () => buscar("id, provider, uazapi_instance_id, uazapi_token_encrypted, display_name, webhook_path_token"),
  );
  const session = sessionRaw as {
    id: string;
    provider: string | null;
    uazapi_instance_id: string | null;
    uazapi_token_encrypted: string | null;
    display_name: string | null;
    webhook_path_token: string | null;
    archived_at?: string | null;
  } | null;
  if (!session) return fail("not_found", t("Canal não encontrado."), 404, { requestId });
  if (session.archived_at) {
    return fail(
      "channel_archived",
      t("Este número foi excluído da Central de Conexões — reconectar não o traz de volta. Conecte um número para voltar a atender."),
      409,
      { requestId },
    );
  }
  if (session.provider !== "uazapi" || !session.uazapi_instance_id) {
    return fail(
      "channel_without_session",
      t("Este canal é o oficial (API da plataforma): ele não tem sessão de WhatsApp para reiniciar. Se parou de entregar, atualize a credencial na tela do canal oficial."),
      422,
      { requestId },
    );
  }

  const admin = createAdminClient();
  const tokenExistente = session.uazapi_token_encrypted
    ? await decryptWebhookSecret(admin, session.uazapi_token_encrypted)
    : null;

  // Path token do webhook preservado (não invalida o que já está registrado
  // do outro lado); segredo novo, porque é ele que vai embutido na URL que
  // re-registramos agora mesmo.
  const pathToken = session.webhook_path_token ?? randomBytes(16).toString("hex");
  const segredoWebhook = randomBytes(32).toString("hex");
  const segredoCifrado = await encryptWebhookSecret(admin, segredoWebhook);
  if (!segredoCifrado) {
    return fail("invalid_request", t("cifra indisponível nesta instalação"), 422, { requestId });
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
    existingInstanceToken: tokenExistente,
    displayName: session.display_name ?? UAZAPI_CHANNEL_LABEL,
  });
  if (!provisionado.ok) {
    await supabase.from("channel_sessions").update({ status: "FAILED", status_reason: "connection_repair_required", last_status_change_at: new Date().toISOString() })
      .eq("organization_id", activeOrg.orgId).eq("id", id);
    return fail("uazapi_error", provisionado.reason, 502, { requestId });
  }

  const tokenCifrado = await encryptWebhookSecret(admin, provisionado.instanceToken);
  if (!tokenCifrado) {
    return fail("invalid_request", t("cifra indisponível nesta instalação"), 422, { requestId });
  }

  const nextStatus = provisionado.status.toUpperCase();
  const { error } = await saveUazapiSession(admin, {
    organizationId: activeOrg.orgId,
    existingId: session.id,
    instanceId: provisionado.instanceId,
    instanceTokenEncrypted: tokenCifrado,
    webhookPathToken: pathToken,
    webhookSecretEncrypted: segredoCifrado,
    phoneNumber: null,
    displayName: session.display_name ?? UAZAPI_CHANNEL_LABEL,
    status: nextStatus,
  });
  if (error) return fail("internal_error", error, 500, { requestId });

  void audit({
    action: "channel.reconnected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { provider: "uazapi", force },
  });

  return ok({ id, status: nextStatus, force }, { requestId });
}
