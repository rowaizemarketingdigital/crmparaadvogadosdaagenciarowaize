import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET /api/v1/channel-sessions/[id]/qr — proxy do QR de UM canal específico.
 *
 * Mesmo contrato de sempre (a tela `ConnectionsClient.tsx` continua pedindo
 * `<img src="...">`), motor trocado de WAHA pra UAZAPI — mesma decisão e
 * mesmo decodificador de `onboarding/whatsapp/qr/route.ts` (a UAZAPI devolve
 * o QR dentro de JSON, como data URI ou base64 cru; aqui vira bytes de PNG
 * antes de servir).
 *
 * Canal EXCLUÍDO (arquivado) é recusado aqui — mesma razão de sempre: quem
 * escaneia um QR de canal arquivado pareia o aparelho com uma linha que
 * continua fora da UI.
 *
 * Canal OFICIAL/outro provider não tem QR: 409 (`no-session`), não 404 — é a
 * mesma distinção que já existia pro WAHA.
 */
import { NextResponse } from "next/server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { uazapiBaseUrl } from "@/lib/channels/uazapi/credentials";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return new NextResponse(null, { status: 403 });

  const supabase = await createClient();
  const buscar = (colunas: string) =>
    supabase
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id)
      .maybeSingle();
  const { data: sessionRaw } = await queryTolerantToMissingArchived(
    () => buscar(`provider, uazapi_token_encrypted, ${ARCHIVED_AT}`),
    () => buscar("provider, uazapi_token_encrypted"),
  );
  const session = sessionRaw as {
    provider: string | null;
    uazapi_token_encrypted: string | null;
    archived_at?: string | null;
  } | null;
  if (!session) return new NextResponse(null, { status: 404 });
  if (session.archived_at) {
    return new NextResponse(null, { status: 409, headers: { "x-channel-state": "archived" } });
  }
  if (session.provider !== "uazapi" || !session.uazapi_token_encrypted) {
    return new NextResponse(null, { status: 409, headers: { "x-channel-state": "no-session" } });
  }

  const baseUrl = uazapiBaseUrl();
  if (!baseUrl) return new NextResponse(null, { status: 503 });

  const admin = createAdminClient();
  const token = await decryptWebhookSecret(admin, session.uazapi_token_encrypted);
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
