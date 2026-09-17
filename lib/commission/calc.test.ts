import { describe, expect, it } from "vitest";

import { calcMonthlyEarnings, commissionRateFor } from "./calc";
import { NIVEIS_COMISSAO_ESTETICA_PADRAO } from "./defaults";

const pleno = NIVEIS_COMISSAO_ESTETICA_PADRAO.find((n) => n.key === "pleno")!;
const junior = NIVEIS_COMISSAO_ESTETICA_PADRAO.find((n) => n.key === "junior")!;
const senior = NIVEIS_COMISSAO_ESTETICA_PADRAO.find((n) => n.key === "senior")!;

describe("commissionRateFor — faixa em degrau, réplica da origem", () => {
  it("abaixo de 70% da meta, taxa é 0", () => {
    expect(commissionRateFor(pleno.tiers, 0.5)).toBe(0);
  });
  it("exatamente em 70%, já vale a taxa daquela faixa", () => {
    expect(commissionRateFor(pleno.tiers, 0.7)).toBeCloseTo(0.01);
  });
  it("em 99%, ainda é a faixa de 70%", () => {
    expect(commissionRateFor(pleno.tiers, 0.99)).toBeCloseTo(0.01);
  });
  it("em 100%, sobe pra faixa de 100%", () => {
    expect(commissionRateFor(pleno.tiers, 1.0)).toBeCloseTo(0.015);
  });
  it("em 150% (acima da maior faixa), fica na faixa de 120%", () => {
    expect(commissionRateFor(pleno.tiers, 1.5)).toBeCloseTo(0.02);
  });
});

describe("calcMonthlyEarnings — worked examples da origem (CommissionReferenceCard)", () => {
  it("pleno, sem meta cadastrada: só base + bônus de atividade, sem comissão de receita", () => {
    const r = calcMonthlyEarnings({
      level: { baseSalaryCents: pleno.baseSalaryCents, activityBonusCents: 2_500, tiers: pleno.tiers },
      activityCount: 10,
      influencedRevenueCents: 999_999_999,
      revenueGoalCents: null,
    });
    expect(r.baseSalaryCents).toBe(210_000);
    expect(r.activityBonusCents).toBe(25_000);
    expect(r.atingimentoPct).toBeNull();
    expect(r.revenueCommissionCents).toBe(0);
    expect(r.totalCents).toBe(235_000);
  });

  it("pleno, atinge exatamente 100% da meta sugerida: 1,5% sobre a receita inteira", () => {
    const r = calcMonthlyEarnings({
      level: { baseSalaryCents: pleno.baseSalaryCents, activityBonusCents: 2_500, tiers: pleno.tiers },
      activityCount: 0,
      influencedRevenueCents: pleno.suggestedGoalCents, // R$40.000,00 = 100% de 40k
      revenueGoalCents: pleno.suggestedGoalCents,
    });
    expect(r.atingimentoPct).toBeCloseTo(1.0);
    expect(r.appliedRatePct).toBeCloseTo(0.015);
    expect(r.revenueCommissionCents).toBe(Math.round(pleno.suggestedGoalCents * 0.015));
    expect(r.totalCents).toBe(pleno.baseSalaryCents + r.revenueCommissionCents);
  });

  it("junior a 120% da meta: taxa de 1,5% sobre TODA a receita, não só o excedente (degrau, não marginal)", () => {
    const receita = Math.round(junior.suggestedGoalCents * 1.2);
    const r = calcMonthlyEarnings({
      level: { baseSalaryCents: junior.baseSalaryCents, activityBonusCents: 2_500, tiers: junior.tiers },
      activityCount: 0,
      influencedRevenueCents: receita,
      revenueGoalCents: junior.suggestedGoalCents,
    });
    expect(r.appliedRatePct).toBeCloseTo(0.015);
    // Prova que a taxa aplica sobre a receita INTEIRA, não só a fatia acima de 100%.
    expect(r.revenueCommissionCents).toBe(Math.round(receita * 0.015));
  });

  it("senior, atividade + receita juntos somam no total", () => {
    const r = calcMonthlyEarnings({
      level: { baseSalaryCents: senior.baseSalaryCents, activityBonusCents: 2_500, tiers: senior.tiers },
      activityCount: 20,
      influencedRevenueCents: senior.suggestedGoalCents,
      revenueGoalCents: senior.suggestedGoalCents,
    });
    const bonus = 20 * 2_500;
    const comissao = Math.round(senior.suggestedGoalCents * 0.015);
    expect(r.totalCents).toBe(senior.baseSalaryCents + bonus + comissao);
  });
});
