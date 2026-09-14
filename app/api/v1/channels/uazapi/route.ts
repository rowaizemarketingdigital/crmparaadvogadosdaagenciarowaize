import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/channels/uazapi — estado da conexão desta organização.
 * POST /api/v1/channels/uazapi — provisiona (ou reconecta) a instância e
 *                                  devolve o QR pra escanear.
 *
 * Mesmo espírito de `channels/partner/route.ts`: o caminho e o corpo não
 * citam o provider por nome de coluna (isso mora em `lib/channels/uazapi/
 * connect.ts`), mas aqui não há credencial pra colar — a instalação já tem UM
 * token de administrador da UAZAPI (`UAZAPI_ADMIN_TOKEN`) e é ELA que cria a
 * instância, uma por organização. O operador só vê o QR.
 *
 * O segredo do webhook vai EMBUTIDO NA URL que a UAZAPI recebe em
 * `instance/updateWebhook` — não existe header custom nem assinatura de
 * corpo do lado dela (confirmado contra `uazapi-connect` do Studio CRM: o
 * payload de `updateWebhook` só aceita `url/enabled/events`). Por isso a URL
 * nunca é mostrada na tela — só usada aqui, e a chave decifrada não volta
 * nunca (nem no GET, nem no POST).
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  UAZAPI_CHANNEL_LABEL,
  findUazapiSession,
  provisionUazapiInstance,
  saveUazapiSession,
} from "@/lib/channels/uazapi/connect";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret, decryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Mesma lógica de `channels/partner/route.ts::urlDoWebhook` — ver o
 * comentário lá sobre por que `env.*` e não `process.env` direto. */
function baseUrlDaInstalacao(req: NextRequest): string {
  const configurada = env.NEXT_PUBLIC_APP_URL;
  const usavel = configurada && !configurada.includes("placeholder.invalid") ? configurada : null;
  return (
    usavel ??
    req.headers.get("origin") ??
    `${req.nextUrl.protocol}//${req.nextUrl.host}`
  ).replace(/\/+$/, "");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_uazapi" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const sessao = await findUazapiSession(createAdminClient(), orgId);
  const conectado = !!sessao && !sessao.archivedAt;

  return ok(
    {
      label: UAZAPI_CHANNEL_LABEL,
      connected: conectado,
      channel_session_id: conectado ? sessao.id : null,
      phone_number: conectado ? sessao.phoneNumber : null,
      display_name: conectado ? sessao.displayName : null,
      status: conectado ? sessao.status : null,
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  // Mesma régua do canal parceiro: conectar move dinheiro (é a linha por onde
  // o negócio conversa com o cliente) e é decisão de dono, não de atendente.
  const authz = await requireRole("admin", { requestId, resource: "channels_uazapi" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  const existente = await findUazapiSession(admin, orgId);

  // Token do webhook (identidade da URL): preservado numa reconexão, pra não
  // invalidar o que a UAZAPI já tem registrado — mesma regra do zernio.
  const pathToken = existente?.webhookPathToken ?? randomBytes(16).toString("hex");
  // Segredo do webhook: NOVO a cada tentativa de conexão, porque ele viaja na
  // URL que vamos re-registrar agora mesmo (não há custo em rotacionar).
  const segredoWebhook = randomBytes(32).toString("hex");
  const segredoCifrado = await encryptWebhookSecret(admin, segredoWebhook);
  if (!segredoCifrado) {
    return fail(
      "invalid_request",
      "cifra indisponível nesta instalação — a chave não foi gravada",
      422,
      { requestId },
    );
  }

  const webhookUrl =
    `${baseUrlDaInstalacao(req)}/api/v1/webhooks/channel/${pathToken}` +
    `?secret=${encodeURIComponent(segredoWebhook)}`;

  // Instância existente: decifra o token pra reaproveitar em vez de criar
  // outra na UAZAPI (o self-host paga por instância contratada).
  let tokenExistente: string | null = null;
  if (existente?.hasInstanceToken) {
    const { data: row } = await admin
      .from("channel_sessions")
      .select("uazapi_token_encrypted")
      .eq("id", existente.id)
      .maybeSingle();
    const cifrado = (row as { uazapi_token_encrypted?: string } | null)?.uazapi_token_encrypted;
    tokenExistente = cifrado ? await decryptWebhookSecret(admin, cifrado) : null;
  }

  const provisionado = await provisionUazapiInstance({
    webhookUrl,
    webhookSecret: segredoWebhook,
    existingInstanceToken: tokenExistente,
    displayName: UAZAPI_CHANNEL_LABEL,
  });
  if (!provisionado.ok) {
    return fail("invalid_request", provisionado.reason, 422, { requestId });
  }

  const tokenCifrado = await encryptWebhookSecret(admin, provisionado.instanceToken);
  if (!tokenCifrado) {
    return fail(
      "invalid_request",
      "cifra indisponível nesta instalação — a instância não foi gravada",
      422,
      { requestId },
    );
  }

  const { error } = await saveUazapiSession(admin, {
    organizationId: orgId,
    existingId: existente?.id ?? null,
    instanceId: provisionado.instanceId,
    instanceTokenEncrypted: tokenCifrado,
    webhookPathToken: pathToken,
    webhookSecretEncrypted: segredoCifrado,
    phoneNumber: existente?.phoneNumber ?? null,
    displayName: existente?.displayName ?? UAZAPI_CHANNEL_LABEL,
    status: provisionado.status.toUpperCase(),
  });
  if (error) return fail("internal_error", error, 500, { requestId });

  return ok(
    {
      connected: provisionado.status === "connected",
      status: provisionado.status,
      // Pronto pra <img src="...">: a UAZAPI já devolve como data URI
      // (confirmado no Studio CRM — `connectData?.instance?.qrcode`, usado
      // direto no <img> sem decodificar).
      qr: provisionado.qr,
    },
    { requestId },
  );
}
