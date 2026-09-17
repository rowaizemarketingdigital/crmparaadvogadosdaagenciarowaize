/**
 * Valores REAIS do sistema de origem (Studio CRM, Clínica Acas —
 * src/modules/comercial-v2/utils/commission.ts), guardados aqui como
 * SUGESTÃO de template (Estética), nunca escritos direto no schema. Uma
 * organização nova não herda nada disto automaticamente — quem aplica o
 * template Estética é que grava estes valores nas tabelas da 0236, editáveis
 * depois. Mesma lógica do `vocabulary` de pipeline: default de template,
 * não constante de produto.
 */
import type { CommissionLevelConfig } from "./calc";

export const ATIVIDADE_BONUS_CENTS_PADRAO = 2_500; // R$25,00 por atividade qualificada

export interface NivelComissaoPadrao {
  key: string;
  label: string;
  baseSalaryCents: number;
  suggestedGoalCents: number;
  tiers: CommissionLevelConfig["tiers"];
}

/** Réplica exata de LEVEL_BASE_SALARY / LEVEL_SUGGESTED_GOAL / RATE_TABLE da origem. */
export const NIVEIS_COMISSAO_ESTETICA_PADRAO: readonly NivelComissaoPadrao[] = [
  {
    key: "junior",
    label: "Júnior",
    baseSalaryCents: 170_000,
    suggestedGoalCents: 3_000_000,
    tiers: [
      { minAtingimentoPct: 0, ratePct: 0 },
      { minAtingimentoPct: 0.7, ratePct: 0.005 },
      { minAtingimentoPct: 1.0, ratePct: 0.01 },
      { minAtingimentoPct: 1.2, ratePct: 0.015 },
    ],
  },
  {
    key: "pleno",
    label: "Pleno",
    baseSalaryCents: 210_000,
    suggestedGoalCents: 4_000_000,
    tiers: [
      { minAtingimentoPct: 0, ratePct: 0 },
      { minAtingimentoPct: 0.7, ratePct: 0.01 },
      { minAtingimentoPct: 1.0, ratePct: 0.015 },
      { minAtingimentoPct: 1.2, ratePct: 0.02 },
    ],
  },
  {
    key: "senior",
    label: "Sênior",
    baseSalaryCents: 260_000,
    suggestedGoalCents: 5_000_000,
    tiers: [
      { minAtingimentoPct: 0, ratePct: 0 },
      { minAtingimentoPct: 0.7, ratePct: 0.012 },
      { minAtingimentoPct: 1.0, ratePct: 0.015 },
      { minAtingimentoPct: 1.2, ratePct: 0.025 },
    ],
  },
];
