import { loadOnboardingChannel } from "@/lib/channels/onboarding-session";
import { uazapiBaseUrl } from "@/lib/channels/uazapi/credentials";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { NextResponse } from "next/server";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";

/**
 * Mesmo proxy de sempre — a tela (`_client.tsx`) continua pedindo
 * `<img src="/api/v1/onboarding/whatsapp/qr?t=...">` sem saber que o motor
 * trocou. Antes fazia proxy de bytes de imagem que o WAHA já devolvia pronta;
 * a UAZAPI devolve o QR dentro de um JSON (`POST /instance/connect`), como
 * data URI OU base64 cru (confirmado nos dois formatos no front do Studio
 * CRM, `QRCodeModal.tsx::normalizeQr`) — então esta rota decodifica pra bytes
 * de PNG antes de servir, pra manter o mesmo contrato de imagem.
 *
 * Recarrega o QR a cada chamada (a tela já invalida via `?t=${qrTick}` a cada
 * novo código) — não guarda estado entre chamadas, só pede de novo à UAZAPI
 * com o token da instância já provisionada.
 */
function qrParaPng(bruto: string): Buffer | null {
  if (bruto.startsWith("data:image")) {
    const virgula = bruto.indexOf(",");
    if (virgula === -1) return null;
    try {
      return Buffer.from(bruto.slice(virgula + 1), "base64");
    } catch {
      return null;
    }
  }
  if (/^[A-Za-z0-9+/=]+$/.test(bruto.slice(0, 32))) {
    try {
      return Buffer.from(bruto, "base64");
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET() {
  const user = await loadAuthUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return new NextResponse(null, { status: 404 });

  const baseUrl = uazapiBaseUrl();
  if (!baseUrl) return new NextResponse(null, { status: 503 });

  const channel = await loadOnboardingChannel(await createClient(), activeOrg.orgId);
  if (!channel || channel.archived_at) return new NextResponse(null, { status: 404 });
  if (!channel.uazapi_token_encrypted) return new NextResponse(null, { status: 404 });

  const admin = createAdminClient();
  const token = await decryptWebhookSecret(admin, channel.uazapi_token_encrypted);
  if (!token) return new NextResponse(null, { status: 503 });

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/instance/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status, headers: { "x-uazapi-status": String(upstream.status) } });
  }

  const json = (await upstream.json().catch(() => null)) as {
    instance?: { qrcode?: string };
    qrcode?: string;
    qr?: string;
  } | null;
  const bruto = json?.instance?.qrcode ?? json?.qrcode ?? json?.qr ?? null;
  const png = bruto ? qrParaPng(bruto) : null;
  if (!png) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "no-store, max-age=0" },
  });
}
