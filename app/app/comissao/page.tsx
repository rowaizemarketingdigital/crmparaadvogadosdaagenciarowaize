import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcMonthlyEarnings, type CommissionTier } from "@/lib/commission/calc";
import { getInfluencedRevenueCents } from "@/lib/commission/aggregate";
import { ComissaoClient, type LinhaVendedor, type NivelOption } from "./_client";

export const dynamic = "force-dynamic";

interface LevelRow {
  id: string;
  key: string;
  label: string;
  base_salary_cents: number;
  activity_bonus_cents: number;
}
interface TierRow {
  level_id: string;
  min_atingimento_pct: number;
  rate_pct: number;
}
interface AssignmentRow {
  user_id: string;
  level_id: string;
}
interface GoalRow {
  user_id: string;
  activity_count: number;
  revenue_goal_cents: number | null;
}
interface MembershipRow {
  user_id: string;
  role: string;
}

export default async function ComissaoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeEditar = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const supabase = await createClient();
  const { data: levelsData } = await supabase
    .from("commission_levels")
    .select("id, key, label, base_salary_cents, activity_bonus_cents")
    .eq("organization_id", activeOrg.orgId)
    .order("base_salary_cents", { ascending: true });
  const levels = (levelsData ?? []) as LevelRow[];

  if (levels.length === 0) {
    return (
      <div className="flex h-full flex-col gap-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Comissão")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Nenhum nível de comissão configurado ainda nesta organização.")}
          </p>
        </header>
        <ComissaoClient agentesVazio podeEditar={podeEditar} niveis={[]} linhas={[]} mesReferencia={{ month, year }} />
      </div>
    );
  }

  const { data: tiersData } = await supabase
    .from("commission_rate_tiers")
    .select("level_id, min_atingimento_pct, rate_pct")
    .eq("organization_id", activeOrg.orgId);
  const tiers = (tiersData ?? []) as TierRow[];

  const tiersPorNivel = new Map<string, CommissionTier[]>();
  for (const tr of tiers) {
    const lista = tiersPorNivel.get(tr.level_id) ?? [];
    lista.push({ minAtingimentoPct: Number(tr.min_atingimento_pct), ratePct: Number(tr.rate_pct) });
    tiersPorNivel.set(tr.level_id, lista);
  }

  const niveis: NivelOption[] = levels.map((l) => ({ id: l.id, key: l.key, label: l.label }));

  // Quem pode aparecer nesta tela: membros ativos, restrito a si mesmo quando
  // não é manager+ — mesma regra do sistema de origem (useCommercialAccess).
  const admin = createAdminClient();
  const { data: membershipData } = await supabase
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", activeOrg.orgId)
    .is("revoked_at", null);
  const memberships = (membershipData ?? []) as MembershipRow[];
  const membrosVisiveis = podeEditar ? memberships : memberships.filter((m) => m.user_id === user.id);

  const { data: assignmentsData } = await supabase
    .from("commission_seller_assignments")
    .select("user_id, level_id")
    .eq("organization_id", activeOrg.orgId);
  const assignments = new Map(((assignmentsData ?? []) as AssignmentRow[]).map((a) => [a.user_id, a.level_id]));

  const { data: goalsData } = await supabase
    .from("commission_monthly_goals")
    .select("user_id, activity_count, revenue_goal_cents")
    .eq("organization_id", activeOrg.orgId)
    .eq("month", month)
    .eq("year", year);
  const goals = new Map(((goalsData ?? []) as GoalRow[]).map((g) => [g.user_id, g]));

  const linhas: LinhaVendedor[] = await Promise.all(
    membrosVisiveis.map(async (m) => {
      const { data: userRes } = await admin.auth.admin.getUserById(m.user_id);
      const nome = (userRes?.user?.user_metadata?.full_name as string | undefined) || userRes?.user?.email || m.user_id;

      const levelId = assignments.get(m.user_id) ?? null;
      const goal = goals.get(m.user_id) ?? { activity_count: 0, revenue_goal_cents: null };
      const level = levels.find((l) => l.id === levelId);

      let ganho = null as ReturnType<typeof calcMonthlyEarnings> | null;
      if (level) {
        const influencedRevenueCents = await getInfluencedRevenueCents({
          organizationId: activeOrg.orgId,
          userId: m.user_id,
          month,
          year,
        });
        ganho = calcMonthlyEarnings({
          level: {
            baseSalaryCents: level.base_salary_cents,
            activityBonusCents: level.activity_bonus_cents,
            tiers: tiersPorNivel.get(level.id) ?? [],
          },
          activityCount: goal.activity_count,
          influencedRevenueCents,
          revenueGoalCents: goal.revenue_goal_cents,
        });
      }

      return {
        userId: m.user_id,
        nome,
        levelId,
        activityCount: goal.activity_count,
        revenueGoalCents: goal.revenue_goal_cents,
        ganho,
      };
    }),
  );

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Comissão")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(`Ganho mensal por vendedor — ${String(month).padStart(2, "0")}/${year}. Base + bônus de atividade + comissão por faixa sobre a receita influenciada (leads ganhos no mês).`)}
        </p>
      </header>
      <ComissaoClient
        agentesVazio={false}
        podeEditar={podeEditar}
        niveis={niveis}
        linhas={linhas}
        mesReferencia={{ month, year }}
      />
    </div>
  );
}
