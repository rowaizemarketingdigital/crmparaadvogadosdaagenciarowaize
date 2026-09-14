import type { SupabaseClient } from "@supabase/supabase-js";
/**
 * O canal por QR do onboarding — mesma tela de sempre, motor trocado de WAHA
 * pra UAZAPI (ver migration `*_canal_uazapi_no_lugar_do_waha`). Nome da
 * função e formato de retorno preservados de propósito: os dois route
 * handlers que a chamam (`onboarding/whatsapp/session` e `.../qr`) não
 * precisam mudar de forma, só o que `loadOnboardingChannel` busca por baixo.
 *
 * Nunca autoriza acesso remoto — só localiza a linha da própria org.
 */
export async function loadOnboardingChannel(db: SupabaseClient, organizationId: string) {
  const { data, error } = await db.from("channel_sessions")
    .select("id, organization_id, uazapi_instance_id, uazapi_token_encrypted, status, archived_at")
    .eq("organization_id", organizationId).eq("provider", "uazapi")
    .order("created_at").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    id: string;
    organization_id: string;
    uazapi_instance_id: string | null;
    uazapi_token_encrypted: string | null;
    status: string;
    archived_at: string | null;
  } | null;
}
