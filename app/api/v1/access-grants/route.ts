/**
 * GET /api/v1/access-grants — lista concessões ativas da organização.
 * POST /api/v1/access-grants — cria/reativa uma concessão (upsert).
 *
 * Acesso granular por usuário × módulo × recurso, seção 8.7 da auditoria
 * Rowaize OS (migration 0235). Leitura é manager+ (mesma trava da tela de
 * Team, spec 13 §4 nota 7 — ver app/api/v1/team/route.ts); escrita também é
 * manager+, espelhando a policy RLS `user_resource_grants_manager_write`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";
import { requireRole } from "@/lib/auth/require-role";
import { grantAccessSchema, validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface GrantRow {
  id: string;
  user_id: string;
  module_key: string;
  resource_id: string | null;
  granted_by: string | null;
  granted_at: string;
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "access-grants" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_resource_grants")
    .select("id, user_id, module_key, resource_id, granted_by, granted_at")
    .eq("organization_id", activeOrg.orgId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });

  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok((data ?? []) as GrantRow[], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "access-grants" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(grantAccessSchema, req);
  } catch (e) {
    if (e instanceof ApiError) return fail(e.code, e.message, e.status, { requestId, details: e.details });
    return fail("internal_error", "unexpected", 500, { requestId });
  }

  // O alvo da concessão precisa ser membro ativo desta organização — sem essa
  // checagem, um user_id de fora entraria na tabela e nunca bateria com
  // fn_user_org_ids() de ninguém, uma concessão morta que só engana quem olha.
  const supabase = await createClient();
  const { data: membro } = await supabase
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", activeOrg.orgId)
    .eq("user_id", input.user_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!membro) return fail("not_found", "Usuário não é membro ativo desta organização.", 404, { requestId });

  // Upsert manual, não `ON CONFLICT`: as duas unique da 0235 são parciais
  // (`where resource_id is null`/`where resource_id is not null`, ambas
  // `and revoked_at is null`), e a inferência de índice parcial do Postgres
  // exige o mesmo WHERE no próprio ON CONFLICT — a API `.upsert()` do
  // supabase-js não expõe isso, então bater com `onConflict: "col,col"` sem
  // predicado simplesmente não casaria com o índice e falharia em silêncio
  // na primeira reconcessão depois de uma revogação.
  const admin = createAdminClient();
  let existingQuery = admin
    .from("user_resource_grants")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("user_id", input.user_id)
    .eq("module_key", input.module_key);
  existingQuery =
    input.resource_id != null
      ? existingQuery.eq("resource_id", input.resource_id)
      : existingQuery.is("resource_id", null);
  const { data: existing } = await existingQuery.maybeSingle();

  const payload = {
    organization_id: activeOrg.orgId,
    user_id: input.user_id,
    module_key: input.module_key,
    resource_id: input.resource_id ?? null,
    granted_by: authUser.id,
    granted_at: new Date().toISOString(),
    revoked_at: null,
    revoked_by: null,
  };

  const query = existing
    ? admin.from("user_resource_grants").update(payload as never).eq("id", existing.id)
    : admin.from("user_resource_grants").insert(payload as never);

  const { data, error } = await query
    .select("id, user_id, module_key, resource_id, granted_by, granted_at")
    .single();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data as GrantRow, { requestId, status: existing ? 200 : 201 });
}
