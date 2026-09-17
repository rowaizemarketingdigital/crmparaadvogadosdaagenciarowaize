/**
 * Semântica e defaults dos níveis de autonomia (1-5) — auditoria Rowaize OS,
 * seções 5 e 8 (17/set). FONTE ÚNICA: o nível padrão de cada agente mora aqui,
 * não espalhado em handler nenhum — a migration 0234 só guarda o OVERRIDE por
 * organização; quando não há linha em `agent_autonomy_levels`, quem responde
 * é este arquivo.
 *
 * Regra dura da seção 5 da auditoria: ação com impacto financeiro, publicação
 * externa ou exclusão de dado nunca nasce no nível 5, mesmo que alguém
 * configure isso na tabela — `MAX_LEVEL_BY_RISK` é o teto que `resolve.ts`
 * aplica por cima do valor configurado, não uma sugestão de UI.
 */

export type AutonomyLevel = 1 | 2 | 3 | 4 | 5;

export type AgentKey =
  | "atendimento"
  | "qualificacao_comercial"
  | "gestao_crm"
  | "coordenacao_tarefas"
  | "briefings_alinhamentos"
  | "metricas_gargalos"
  | "trafego_campanhas"
  | "automacao_instagram"
  | "financeiro_operacional"
  | "suporte_sucesso_cliente"
  | "revisao_tecnica"
  | "manutencao_plataforma";

/** Mesmo vocabulário fechado do CHECK da migration 0234 — repetido aqui de propósito (banco e código dizendo a mesma coisa, mesma lição do #236 citado em credenciais-de-leitura.ts). */
export const AGENT_KEYS: readonly AgentKey[] = [
  "atendimento",
  "qualificacao_comercial",
  "gestao_crm",
  "coordenacao_tarefas",
  "briefings_alinhamentos",
  "metricas_gargalos",
  "trafego_campanhas",
  "automacao_instagram",
  "financeiro_operacional",
  "suporte_sucesso_cliente",
  "revisao_tecnica",
  "manutencao_plataforma",
] as const;

export interface AutonomyLevelSemantics {
  level: AutonomyLevel;
  nome: string;
  descricao: string;
}

/** Os 5 níveis, exatamente como descritos na seção 5 da auditoria. */
export const AUTONOMY_LEVELS: readonly AutonomyLevelSemantics[] = [
  { level: 1, nome: "Observar", descricao: "Agente só lê e registra — nenhuma ação, nenhuma sugestão visível ao humano ainda." },
  { level: 2, nome: "Sugerir", descricao: "Agente propõe; humano decide do zero. Nada é pré-preenchido para aceitar com um clique." },
  { level: 3, nome: "Preparar revisão", descricao: "Agente prepara o trabalho pronto para aprovar (rascunho, patch de campo); humano só confirma ou edita." },
  { level: 4, nome: "Executar com aprovação", descricao: "Agente executa, mas a ação fica pendente até aprovação humana antes de valer de fato." },
  { level: 5, nome: "Executar sozinho", descricao: "Agente executa e a ação já vale — sem passo humano no caminho. Nunca para financeiro/publicação externa/exclusão." },
];

/**
 * Teto duro por categoria de risco (seção 5). `resolve.ts` faz
 * `Math.min(configurado, teto)` — nunca o contrário.
 */
export const MAX_LEVEL_BY_RISK: Record<"financeiro" | "publicacao_externa" | "exclusao" | "padrao", AutonomyLevel> = {
  financeiro: 4,
  publicacao_externa: 4,
  exclusao: 4,
  padrao: 5,
};

/**
 * Nível padrão por agente — coluna "Nível padrão" da tabela da seção 8 da
 * auditoria, 17/set. Usado quando a organização não tem override em
 * `agent_autonomy_levels` (instalação nova, ou agente ainda não configurado).
 */
export const DEFAULT_AUTONOMY_LEVEL: Record<AgentKey, AutonomyLevel> = {
  atendimento: 4,
  qualificacao_comercial: 4,
  gestao_crm: 3,
  coordenacao_tarefas: 4,
  briefings_alinhamentos: 2,
  metricas_gargalos: 2,
  trafego_campanhas: 3,
  automacao_instagram: 5,
  financeiro_operacional: 2,
  suporte_sucesso_cliente: 3,
  revisao_tecnica: 3,
  manutencao_plataforma: 4,
};

export function isAgentKey(value: string): value is AgentKey {
  return (AGENT_KEYS as readonly string[]).includes(value);
}

/** Nome em pt-BR de cada agente — coluna "Agente" da tabela da seção 8 da auditoria. */
export const AGENT_LABELS: Record<AgentKey, string> = {
  atendimento: "Atendimento",
  qualificacao_comercial: "Qualificação comercial",
  gestao_crm: "Gestão do CRM",
  coordenacao_tarefas: "Coordenação de tarefas/prazos",
  briefings_alinhamentos: "Briefings e alinhamentos",
  metricas_gargalos: "Métricas e gargalos",
  trafego_campanhas: "Tráfego e campanhas",
  automacao_instagram: "Automação Instagram",
  financeiro_operacional: "Financeiro operacional",
  suporte_sucesso_cliente: "Suporte e sucesso do cliente",
  revisao_tecnica: "Revisão técnica/PRs",
  manutencao_plataforma: "Manutenção da plataforma",
};
