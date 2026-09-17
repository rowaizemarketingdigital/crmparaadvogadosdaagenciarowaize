"use server";
/**
 * Server Actions da tela de Comissão. Mesmo padrão de
 * `app/app/settings/autonomia/_actions.ts` — teto manager, admin client nas
 * escritas, RLS da migration 0236 como segunda trava.
 */
import { revalidatePath } from "next/cache";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { NIVEIS_COMISSAO_ESTETICA_PADRAO } from "@/lib/commission/defaults";

type ActionResult = { ok: true } | { ok: false; error: string; message?: string };

async function ensureManager(): Promise<
  { kind: "ok"; orgId: string; userId: string } | { kind: "fail"; result: ActionResult }
> {
  const authUser = await loadAuthUser();
  if (!authUser) return { kind: "fail", result: { ok: false, error: "unauthenticated" } };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { kind: "fail", result: { ok: false, error: "forbidden_tenant" } };
  const role = activeOrg.role as Role;
  if (ROLE_RANK[role] < ROLE_RANK.manager) return { kind: "fail", result: { ok: false, error: "forbidden_role" } };
  return { kind: "ok", orgId: activeOrg.orgId, userId: authUser.id };
}

/** Semeia os 3 níveis + faixas reais da Clínica Acas como PONTO DE PARTIDA editável — não trava a organização nesses valores. */
export async function seedNiveisEsteticaAction(): Promise<ActionResult> {
  const guard = await ensureManager();
  if (guard.kind === "fail") return guard.result;
  const { orgId } = guard;

  const admin = createAdminClient();
  const { data: jaTem } = await admin
    .from("commission_levels")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1);
  if ((jaTem ?? []).length > 0) return { ok: false, error: "already_seeded", message: "já existem níveis configurados" };

  for (const nivel of NIVEIS_COMISSAO_ESTETICA_PADRAO) {
    const { data: levelRow, error: levelErr } = await admin
      .from("commission_levels")
      .insert({
        organization_id: orgId,
        key: nivel.key,
        label: nivel.label,
        base_salary_cents: nivel.baseSalaryCents,
        suggested_goal_cents: nivel.suggestedGoalCents,
        activity_bonus_cents: 2_500,
      } as never)
      .select("id")
      .single();
    if (levelErr || !levelRow) return { ok: false, error: "db_error", message: levelErr?.message };

    const tiersPayload = nivel.tiers.map((t) => ({
      organization_id: orgId,
      level_id: (levelRow as { id: string }).id,
      min_atingimento_pct: t.minAtingimentoPct,
      rate_pct: t.ratePct,
    }));
    const { error: tiersErr } = await admin.from("commission_rate_tiers").insert(tiersPayload as never);
    if (tiersErr) return { ok: false, error: "db_error", message: tiersErr.message };
  }

  revalidatePath("/app/comissao");
  return { ok: true };
}

export async function setSellerLevelAction(userId: string, levelId: string): Promise<ActionResult> {
  const guard = await ensureManager();
  if (guard.kind === "fail") return guard.result;
  const { orgId, userId: assignedBy } = guard;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("commission_seller_assignments")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  const payload = { organization_id: orgId, user_id: userId, level_id: levelId, assigned_by: assignedBy, assigned_at: new Date().toISOString() };
  const { error } = existing
    ? await admin.from("commission_seller_assignments").update(payload as never).eq("id", existing.id)
    : await admin.from("commission_seller_assignments").insert(payload as never);
  if (error) return { ok: false, error: "db_error", message: error.message };

  revalidatePath("/app/comissao");
  return { ok: true };
}

export async function setMonthlyGoalAction(
  userId: string,
  month: number,
  year: number,
  activityCount: number,
  revenueGoalCents: number | null,
): Promise<ActionResult> {
  const guard = await ensureManager();
  if (guard.kind === "fail") return guard.result;
  const { orgId, userId: updatedBy } = guard;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("commission_monthly_goals")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("month", month)
    .eq("year", year)
    .maybeSingle();

  const payload = {
    organization_id: orgId,
    user_id: userId,
    month,
    year,
    activity_count: activityCount,
    revenue_goal_cents: revenueGoalCents,
    updated_by: updatedBy,
  };
  const { error } = existing
    ? await admin.from("commission_monthly_goals").update(payload as never).eq("id", existing.id)
    : await admin.from("commission_monthly_goals").insert(payload as never);
  if (error) return { ok: false, error: "db_error", message: error.message };

  revalidatePath("/app/comissao");
  return { ok: true };
}
