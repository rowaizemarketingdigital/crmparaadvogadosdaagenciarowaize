/**
 * Resolve o nível de autonomia (1-5) efetivo de um agente para uma organização.
 *
 * Ordem: linha em `agent_autonomy_levels` com `action_category` específica >
 * linha com `action_category='default'` > default de `defaults.ts`. Depois,
 * sempre `Math.min(resolvido, MAX_LEVEL_BY_RISK[categoriaDeRisco])` — o teto de
 * risco da seção 5 da auditoria nunca é contornável por configuração.
 *
 * Não decide sozinho o que fazer com o nível (executar / enfileirar / só
 * sugerir) — isso é responsabilidade de cada domínio quando ele ganhar sua
 * própria fila de proposta (mesma forma de `contact_field_proposals`/
 * `ai_reply_drafts`, ver comentário da migration 0234). Esta função só
 * responde "qual é o nível hoje", nada mais.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  type AgentKey,
  type AutonomyLevel,
  DEFAULT_AUTONOMY_LEVEL,
  MAX_LEVEL_BY_RISK,
} from "./defaults";

export type RiscoDeAcao = keyof typeof MAX_LEVEL_BY_RISK;

export interface ResolveAutonomyLevelInput {
  organizationId: string;
  agentKey: AgentKey;
  actionCategory?: string;
  risco?: RiscoDeAcao;
  /** Injeção de client para teste — produção usa o admin client (a tabela não tem policy de select por anon). */
  client?: SupabaseClient;
}

export interface ResolvedAutonomyLevel {
  level: AutonomyLevel;
  /** Nível antes de aplicar o teto de risco — para a UI explicar "configurado como 5, mas limitado a 4 porque é ação financeira". */
  levelConfigurado: AutonomyLevel;
  origem: "override_especifico" | "override_default_categoria" | "default_de_agente";
}

export async function resolveAutonomyLevel(
  input: ResolveAutonomyLevelInput,
): Promise<ResolvedAutonomyLevel> {
  const supabase = input.client ?? createAdminClient();
  const actionCategory = input.actionCategory ?? "default";

  const { data, error } = await supabase
    .from("agent_autonomy_levels")
    .select("action_category, level")
    .eq("organization_id", input.organizationId)
    .eq("agent_key", input.agentKey)
    .in("action_category", actionCategory === "default" ? ["default"] : [actionCategory, "default"]);

  if (error) {
    throw new Error(`autonomy_level_lookup_failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ action_category: string; level: number }>;
  const especifico = actionCategory !== "default" ? rows.find((r) => r.action_category === actionCategory) : undefined;
  const porDefault = rows.find((r) => r.action_category === "default");

  let levelConfigurado: AutonomyLevel;
  let origem: ResolvedAutonomyLevel["origem"];
  if (especifico) {
    levelConfigurado = especifico.level as AutonomyLevel;
    origem = "override_especifico";
  } else if (porDefault) {
    levelConfigurado = porDefault.level as AutonomyLevel;
    origem = "override_default_categoria";
  } else {
    levelConfigurado = DEFAULT_AUTONOMY_LEVEL[input.agentKey];
    origem = "default_de_agente";
  }

  const teto = MAX_LEVEL_BY_RISK[input.risco ?? "padrao"];
  const level = Math.min(levelConfigurado, teto) as AutonomyLevel;

  return { level, levelConfigurado, origem };
}
