/**
 * DELETE /api/v1/access-grants/[id] — revoga uma concessão (soft, revoked_at).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido", 400, { requestId });

  const authz = await requireRole("manager", { requestId, resource: "access-grants" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_resource_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: authUser.id } as never)
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Concessão não encontrada ou já revogada.", 404, { requestId });
  return ok({ id }, { requestId });
}
