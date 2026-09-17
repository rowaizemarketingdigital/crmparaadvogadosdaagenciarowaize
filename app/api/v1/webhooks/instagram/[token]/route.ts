/**
 * GET|POST /api/v1/webhooks/instagram/[token] — webhook do Instagram (Graph
 * API, produto Instagram Login). Rota DEDICADA, não o dispatcher genérico —
 * mesma decisão que `webhooks/meta/[token]` já tomou para o WhatsApp Cloud
 * (o dispatcher genérico só aceita UAZAPI/Zernio hoje, `lib/channels/inbound.ts`).
 *
 * `GET` é o handshake de verificação — mesmo protocolo do WhatsApp Cloud
 * (`hub.challenge` em texto puro). `POST` verifica HMAC SHA-256 com o App
 * Secret e arquiva o corpo cru em `webhook_events_log` (mesma tabela genérica
 * de todo canal, `lib/channels/arquivo-de-webhook.ts`) ANTES de interpretar —
 * corpo perdido é recuperável pelo arquivo; processamento perdido, não.
 *
 * ⚠️ ESCOPO DESTA FATIA: recebe, verifica, faz parse, arquiva e resolve o
 * CONTATO (migration 0238 — mesmo cadastro único, identidade própria por
 * `instagram_id`). NÃO cria conversa/mensagem nem dispara automação ainda —
 * essas são as próximas fatias, e dependem de contato já resolvido.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { abrirArquivoDoWebhook, fecharArquivoDoWebhook } from "@/lib/channels/arquivo-de-webhook";
import { CHANNEL_PROVIDER_INSTAGRAM } from "@/lib/channels/capabilities";
import { ingestInstagramInbound } from "@/lib/channels/instagram/ingest";
import { instagramSessionByWebhookToken } from "@/lib/channels/instagram/session";
import { parseInstagramWebhook, verificationChallenge, verifyMetaSignature } from "@/lib/channels/instagram/webhook";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { token } = await ctx.params;
  const session = await instagramSessionByWebhookToken(token);
  if (!session) return new NextResponse("not found", { status: 404 });

  const challenge = verificationChallenge(
    req.nextUrl.searchParams,
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ?? "",
  );
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });

  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;

  const session = await instagramSessionByWebhookToken(token);
  if (!session) return fail("not_found", "unknown webhook token", 404, { requestId });

  const rawBody = await req.text();
  const appSecret = process.env.INSTAGRAM_APP_SECRET ?? "";
  const assinaturaValida = verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret);

  const admin = createAdminClient();
  const arquivoId = await abrirArquivoDoWebhook(admin, {
    organizationId: session.organizationId,
    channelSessionId: session.id,
    provider: CHANNEL_PROVIDER_INSTAGRAM,
    rawBody,
    headers: req.headers,
  });

  if (!assinaturaValida) {
    await fecharArquivoDoWebhook(admin, arquivoId, { status: "error", validSignature: false, erro: "invalid_signature" });
    return fail("unauthorized", "invalid_signature", 401, { requestId });
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    await fecharArquivoDoWebhook(admin, arquivoId, { status: "error", validSignature: true, erro: "invalid_json" });
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }

  const eventos = parseInstagramWebhook(envelope).filter((e) => e.businessId === session.businessId);

  const desfechos: string[] = [];
  for (const evento of eventos) {
    const r = await ingestInstagramInbound(admin, evento, { organizationId: session.organizationId });
    desfechos.push(r.status);
    if (r.status === "failed") {
      logger.error("[instagram.ingest] contato não resolvido", {
        reason: r.reason,
        kind: evento.kind,
      });
    }
  }

  await fecharArquivoDoWebhook(admin, arquivoId, { status: "processed", validSignature: true });

  // 200 sempre que a assinatura confere, mesmo pra desfecho que falhou em
  // resolver contato — mesma razão do webhook do WhatsApp Cloud: reentrega em
  // backoff por horas é pior que uma falha pontual já registrada no log.
  return NextResponse.json({ received: eventos.length, outcomes: desfechos }, { status: 200 });
}
