"use server";
/**
 * Server Action da tela de Autonomia dos agentes. Mesmo padrão de
 * `app/app/ai/agents/_actions.ts` (guard de role + admin client), mas o teto
 * aqui é manager, não admin — mudar o nível de autonomia de um agente é
 * configuração de conta (seção 11 da auditoria), não desenvolvimento de
 * produto, e a RLS da migration 0234 já reflete esse teto.
 */
import { revalidatePath } from "next/cache";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAgentKey, type AutonomyLevel } from "@/lib/agent-engine/autonomy/defaults";

type ActionResult = { ok: true } | { ok: false; error: string; message?: string };

async function ensureManager(): Promise<
  | { kind: "ok"; orgId: string; userId: string }
  | { kind: "fail"; result: ActionResult }
> {
  const authUser = await loadAuthUser();
  if (!authUser) return { kind: "fail", result: { ok: false, error: "unauthenticated" } };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { kind: "fail", result: { ok: false, error: "forbidden_tenant" } };
  const role = activeOrg.role as Role;
  if (ROLE_RANK[role] < ROLE_RANK.manager) {
    return { kind: "fail", result: { ok: false, error: "forbidden_role" } };
  }
  return { kind: "ok", orgId: activeOrg.orgId, userId: authUser.id };
}

export async function setAutonomyLevelAction(agentKey: string, level: number): Promise<ActionResult> {
  if (!isAgentKey(agentKey)) return { ok: false, error: "invalid_request", message: "agente desconhecido" };
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return { ok: false, error: "invalid_request", message: "nível precisa ser 1-5" };
  }

  const guard = await ensureManager();
  if (guard.kind === "fail") return guard.result;
  const { orgId, userId } = guard;

  const admin = createAdminClient();
  const { error } = await admin
    .from("agent_autonomy_levels")
    .upsert(
      {
        organization_id: orgId,
        agent_key: agentKey,
        action_category: "default",
        level: level as AutonomyLevel,
        updated_by: userId,
      } as never,
      { onConflict: "organization_id,agent_key,action_category" },
    );

  if (error) return { ok: false, error: "db_error", message: error.message };

  revalidatePath("/app/settings/autonomia");
  return { ok: true };
}
