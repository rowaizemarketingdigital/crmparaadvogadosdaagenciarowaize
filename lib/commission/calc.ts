/**
 * Motor de cálculo do ganho mensal do vendedor — porte fiel de
 * `src/modules/comercial-v2/utils/commission.ts` (Studio CRM), generalizado
 * pra nível/faixa virarem configuração (organization_id), não constante.
 *
 * FÓRMULA (idêntica à origem):
 *   ganho = salário-base do nível
 *         + (contagem de atividade qualificada × bônus por unidade)
 *         + (receita influenciada do mês × taxa da faixa atingida)
 *
 * A faixa é em DEGRAU, não marginal — a MAIOR faixa cujo `minAtingimentoPct`
 * a pessoa atingiu vale sobre a receita INTEIRA do mês, não só o excedente
 * acima do corte. É assim no sistema de origem (comment em commission.ts:6-9)
 * e replicado aqui sem suavizar: mudar isso pra marginal seria uma decisão de
 * produto nova, não uma correção.
 *
 * Sem meta de receita cadastrada (`revenueGoalCents` nulo/0), não há comissão
 * de receita — só base + bônus de atividade. Mesmo comportamento da origem
 * (commission.ts:112-114): meta é pré-requisito pra taxa existir.
 */

export interface CommissionTier {
  /** Fração da meta atingida (0 = 0%, 1 = 100%, 1.2 = 120%). */
  minAtingimentoPct: number;
  /** Fração da receita que essa faixa paga (0.01 = 1%). */
  ratePct: number;
}

export interface CommissionLevelConfig {
  baseSalaryCents: number;
  activityBonusCents: number;
  tiers: readonly CommissionTier[];
}

export interface MonthlyEarningsInput {
  level: CommissionLevelConfig;
  activityCount: number;
  influencedRevenueCents: number;
  /** Nulo/0 = sem meta cadastrada — nunca gera comissão de receita, só base + bônus. */
  revenueGoalCents: number | null;
}

export interface MonthlyEarningsResult {
  baseSalaryCents: number;
  activityBonusCents: number;
  /** Fração da meta atingida, ou null se não há meta cadastrada. */
  atingimentoPct: number | null;
  /** Taxa aplicada (a maior faixa atingida), ou null se não há meta cadastrada. */
  appliedRatePct: number | null;
  revenueCommissionCents: number;
  totalCents: number;
}

/**
 * A maior faixa cujo corte foi atingido — em degrau, não a soma das faixas.
 * Faixas fora de ordem não quebram (comparação por valor, não por posição no
 * array), mas o chamador deve fornecer `minAtingimentoPct` únicos por nível
 * (garantido pela unique da migration 0236).
 */
export function commissionRateFor(tiers: readonly CommissionTier[], atingimentoPct: number): number {
  const atingidas = tiers.filter((t) => atingimentoPct >= t.minAtingimentoPct);
  if (atingidas.length === 0) return 0;
  return atingidas.reduce((maior, t) => (t.minAtingimentoPct > maior.minAtingimentoPct ? t : maior)).ratePct;
}

export function calcMonthlyEarnings(input: MonthlyEarningsInput): MonthlyEarningsResult {
  const { level, activityCount, influencedRevenueCents, revenueGoalCents } = input;
  const activityBonusCents = Math.round(activityCount * level.activityBonusCents);

  if (!revenueGoalCents || revenueGoalCents <= 0) {
    return {
      baseSalaryCents: level.baseSalaryCents,
      activityBonusCents,
      atingimentoPct: null,
      appliedRatePct: null,
      revenueCommissionCents: 0,
      totalCents: level.baseSalaryCents + activityBonusCents,
    };
  }

  const atingimentoPct = influencedRevenueCents / revenueGoalCents;
  const appliedRatePct = commissionRateFor(level.tiers, atingimentoPct);
  const revenueCommissionCents = Math.round(influencedRevenueCents * appliedRatePct);

  return {
    baseSalaryCents: level.baseSalaryCents,
    activityBonusCents,
    atingimentoPct,
    appliedRatePct,
    revenueCommissionCents,
    totalCents: level.baseSalaryCents + activityBonusCents + revenueCommissionCents,
  };
}
