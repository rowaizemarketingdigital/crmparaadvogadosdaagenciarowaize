/**
 * Conexão do canal não oficial (UAZAPI) — do lado de dentro do seam.
 *
 * ─── Por que este canal NÃO segue o molde de `zernio/connect` (colar conta +
 * chave) ───────────────────────────────────────────────────────────────────
 *
 * O zernio é BSP: o operador já tem conta lá fora e cola credencial própria.
 * A UAZAPI, no modelo real que a agência já opera (Studio CRM), é o OPOSTO:
 * existe UM token de administrador da instalação inteira
 * (`UAZAPI_ADMIN_TOKEN`), e é ESTA instalação que cria uma instância nova por
 * organização — o operador nunca vê nem cola chave nenhuma, só escaneia o QR
 * que volta. Mais perto do WAHA (QR na tela) do que do zernio (colar
 * credencial), mesmo a persistência (sessão por credencial cifrada,
 * `webhook_path_token`) seguindo o mesmo desenho dos dois.
 *
 * ─── Fonte: `uazapi-connect/index.ts` do Studio CRM, conferido linha a linha
 * ────────────────────────────────────────────────────────────────────────────
 * `POST /instance/init` (header `adminToken`) cria a instância e devolve o
 * `token` dela; `POST /instance/updateWebhook` (header `token` da instância)
 * aponta a UAZAPI pro nosso webhook; `POST /instance/connect` (mesmo header)
 * devolve `{instance:{qrcode,status}}` — o QR já pronto pra `<img src>`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { CHANNEL_PROVIDER_UAZAPI } from "../capabilities";
import { uazapiBaseUrl } from "./credentials";
import type { ChannelProvider } from "../types";

export const UAZAPI_CHANNEL_PROVIDER: ChannelProvider = CHANNEL_PROVIDER_UAZAPI;

/** Nome comercial pra tela — mesmo motivo do `PARTNER_CHANNEL_LABEL`: o
 * lint:channels cobra que o literal fique aqui, não na rota. */
export const UAZAPI_CHANNEL_LABEL = "WhatsApp (UAZAPI)";

function uazapiAdminToken(): string | null {
  return process.env.UAZAPI_ADMIN_TOKEN?.trim() || null;
}

export type UazapiProvisionResult =
  | {
      ok: true;
      instanceId: string;
      instanceToken: string;
      qr: string | null;
      status: string;
    }
  | { ok: false; reason: string };

/**
 * Cria (ou reaproveita, se já houver token) a instância na UAZAPI, registra o
 * webhook desta instalação nela, e pede o QR. As TRÊS chamadas são as mesmas
 * três do `uazapi-connect` do Studio CRM, na mesma ordem — inclusive o motivo
 * de registrar o webhook ANTES de pedir o QR: se a instância já conectar
 * entre as duas chamadas (raro, mas visto na referência), o webhook já está
 * de pé pra não perder o evento de conexão.
 */
export async function provisionUazapiInstance(input: {
  webhookUrl: string;
  webhookSecret: string;
  /** Token já existente, se esta é uma reconexão — evita recriar instância. */
  existingInstanceToken?: string | null;
  /** Nome pedido à UAZAPI para identificar a instância no painel dela. */
  displayName: string;
}): Promise<UazapiProvisionResult> {
  const baseUrl = uazapiBaseUrl();
  const adminToken = uazapiAdminToken();
  if (!baseUrl || !adminToken) {
    return { ok: false, reason: "uazapi_not_configured_at_installation_level" };
  }

  let instanceToken = input.existingInstanceToken ?? null;
  let instanceId = "";

  if (!instanceToken) {
    let initRes: Response;
    try {
      initRes = await fetch(`${baseUrl}/instance/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json", adminToken },
        body: JSON.stringify({ name: input.displayName, systemName: "deskcomm-crm" }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "erro_desconhecido";
      return { ok: false, reason: `uazapi_init_network_failed: ${detail.slice(0, 200)}` };
    }
    const initJson = (await initRes.json().catch(() => null)) as {
      instance?: { token?: string; id?: string };
      token?: string;
      error?: string;
      message?: string;
    } | null;
    instanceToken = initJson?.instance?.token ?? initJson?.token ?? null;
    instanceId = initJson?.instance?.id ?? "";
    if (!initRes.ok || !instanceToken) {
      const bruto = initJson?.error ?? initJson?.message ?? initRes.statusText;
      const isLimit = /limit|limite|quota|slot|plan/i.test(String(bruto));
      return {
        ok: false,
        reason: isLimit
          ? "uazapi_instance_limit_reached"
          : `uazapi_init_failed: ${initRes.status} ${String(bruto).slice(0, 200)}`,
      };
    }
  }

  // Idempotente por natureza (a UAZAPI reaproveita a config quando já é a
  // mesma) — seguro chamar em toda tentativa de conexão, não só na primeira.
  try {
    await fetch(`${baseUrl}/instance/updateWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: instanceToken },
      body: JSON.stringify({
        url: input.webhookUrl,
        enabled: true,
        events: ["messages", "messages_update", "chats", "connection"],
        addUrlEvents: false,
        excludeMessages: [],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Best-effort, como no Studio CRM: falha aqui não impede pedir o QR — só
    // significa que o webhook pode precisar ser registrado de novo depois.
    // Não é silencioso pro operador: se o webhook nunca pegar, a checagem de
    // saúde (checkHealth) eventualmente mostra a instância sem tráfego.
  }

  let connectRes: Response;
  try {
    connectRes = await fetch(`${baseUrl}/instance/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: instanceToken },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "erro_desconhecido";
    return { ok: false, reason: `uazapi_connect_network_failed: ${detail.slice(0, 200)}` };
  }
  const connectJson = (await connectRes.json().catch(() => null)) as {
    instance?: { qrcode?: string; status?: string; id?: string };
    qrcode?: string;
    qr?: string;
    error?: string;
    message?: string;
  } | null;
  const qr = connectJson?.instance?.qrcode ?? connectJson?.qrcode ?? connectJson?.qr ?? null;
  const status = connectJson?.instance?.status ?? "connecting";
  if (!instanceId && connectJson?.instance?.id) instanceId = connectJson.instance.id;

  if (!connectRes.ok || (!qr && status !== "connected")) {
    const bruto = connectJson?.error ?? connectJson?.message ?? connectRes.statusText;
    return { ok: false, reason: `uazapi_connect_failed: ${connectRes.status} ${String(bruto).slice(0, 200)}` };
  }

  // Sem id próprio devolvido pela UAZAPI em nenhuma das duas chamadas: o
  // token da instância É o identificador estável (é ele que autentica todo
  // envio futuro), então serve como sessionRef na ausência de um id dedicado.
  return { ok: true, instanceId: instanceId || instanceToken, instanceToken, qr, status };
}

export interface UazapiSession {
  id: string;
  instanceId: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  status: string | null;
  webhookPathToken: string | null;
  hasInstanceToken: boolean;
  archivedAt: string | null;
}

const COLUNAS =
  "id, uazapi_instance_id, phone_number, display_name, status, webhook_path_token, uazapi_token_encrypted";

function toUazapiSession(row: Record<string, unknown> | null): UazapiSession | null {
  if (!row) return null;
  return {
    id: row.id as string,
    instanceId: (row.uazapi_instance_id as string) ?? null,
    phoneNumber: (row.phone_number as string) ?? null,
    displayName: (row.display_name as string) ?? null,
    status: (row.status as string) ?? null,
    webhookPathToken: (row.webhook_path_token as string) ?? null,
    hasInstanceToken: !!row.uazapi_token_encrypted,
    archivedAt: (row.archived_at as string) ?? null,
  };
}

export async function findUazapiSession(
  admin: SupabaseClient,
  organizationId: string,
): Promise<UazapiSession | null> {
  const buscar = (colunas: string) =>
    admin
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", organizationId)
      .eq("provider", UAZAPI_CHANNEL_PROVIDER)
      .maybeSingle();

  const { data } = await queryTolerantToMissingArchived(
    () => buscar(`${COLUNAS}, ${ARCHIVED_AT}`),
    () => buscar(COLUNAS),
  );
  return toUazapiSession(data as Record<string, unknown> | null);
}

/**
 * Grava (ou ressuscita) a sessão. Mesma regra do zernio: `archived_at: null`
 * sempre, pra reconectar por cima de um canal excluído trazê-lo de volta.
 */
export async function saveUazapiSession(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    existingId: string | null;
    instanceId: string;
    instanceTokenEncrypted: string;
    webhookPathToken: string;
    webhookSecretEncrypted: string;
    phoneNumber: string | null;
    displayName: string;
    status: string;
  },
): Promise<{ error: string | null }> {
  const linha = {
    organization_id: input.organizationId,
    provider: UAZAPI_CHANNEL_PROVIDER,
    uazapi_instance_id: input.instanceId,
    uazapi_token_encrypted: input.instanceTokenEncrypted,
    webhook_path_token: input.webhookPathToken,
    webhook_secret_encrypted: input.webhookSecretEncrypted,
    phone_number: input.phoneNumber,
    display_name: input.displayName,
    status: input.status,
    archived_at: null,
  };

  const { error } = input.existingId
    ? await admin.from("channel_sessions").update(linha).eq("id", input.existingId)
    : await admin
        .from("channel_sessions")
        .insert({ ...linha, metadata: metadataInicialDoCanal() });

  return { error: error?.message ?? null };
}
