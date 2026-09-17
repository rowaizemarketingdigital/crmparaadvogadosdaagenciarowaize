/**
 * Wrapper fino sobre `fn_user_has_module_access` (migration 0235). A regra
 * aditiva (sem concessão = acesso pleno; com concessão = só o concedido) mora
 * NO BANCO, não aqui — este arquivo não reimplementa a lógica, só chama a
 * função, porque policies RLS de módulos futuros também vão chamar a mesma
 * função, e uma segunda cópia em TS divergiria dela no primeiro conserto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

import type { ModuleKey } from "./modules";

export interface HasModuleAccessInput {
  organizationId: string;
  userId: string;
  moduleKey: ModuleKey;
  resourceId?: string | null;
  /** Injeção de client para teste. */
  client?: SupabaseClient;
}

export async function hasModuleAccess(input: HasModuleAccessInput): Promise<boolean> {
  const supabase = input.client ?? createAdminClient();
  const { data, error } = await supabase.rpc("fn_user_has_module_access", {
    p_org: input.organizationId,
    p_user: input.userId,
    p_module: input.moduleKey,
    p_resource: input.resourceId ?? null,
  });
  if (error) {
    throw new Error(`module_access_check_failed: ${error.message}`);
  }
  return data === true;
}
