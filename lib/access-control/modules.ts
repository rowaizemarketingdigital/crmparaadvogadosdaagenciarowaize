/**
 * Vocabulário dos módulos do Rowaize OS — mapa de navegação final, seção 6.5
 * da auditoria (17/set). Mesmo vocabulário fechado do CHECK da migration
 * 0235: banco e código dizendo a mesma coisa, mesma lição do #236 citado em
 * credenciais-de-leitura.ts.
 */

export type ModuleGrupo = "operacao" | "redes" | "marketing" | "gestao" | "solucoes_ia";

export type ModuleKey =
  | "pipeline"
  | "atendimento"
  | "contatos"
  | "automacoes"
  | "financeiro"
  | "conexoes"
  | "planejador_social"
  | "metricas"
  | "campanhas"
  | "equipe_acessos"
  | "clientes_contratos_tarefas"
  | "catalogo_formularios"
  | "mentor_ai"
  | "central_reunioes"
  | "formacoes_academy";

export interface ModuleInfo {
  key: ModuleKey;
  label: string;
  grupo: ModuleGrupo;
}

/** Ordem e nomes exatamente como a tabela da seção 6.5 do documento de auditoria. */
export const MODULES: readonly ModuleInfo[] = [
  { key: "pipeline", label: "Pipeline", grupo: "operacao" },
  { key: "atendimento", label: "Atendimento", grupo: "operacao" },
  { key: "contatos", label: "Contatos", grupo: "operacao" },
  { key: "automacoes", label: "Automações", grupo: "operacao" },
  { key: "financeiro", label: "Financeiro", grupo: "operacao" },
  { key: "conexoes", label: "Conexões", grupo: "redes" },
  { key: "planejador_social", label: "Planejador Social", grupo: "marketing" },
  { key: "metricas", label: "Métricas", grupo: "marketing" },
  { key: "campanhas", label: "Campanhas", grupo: "marketing" },
  { key: "equipe_acessos", label: "Equipe & acessos", grupo: "gestao" },
  { key: "clientes_contratos_tarefas", label: "Clientes / Contratos / Tarefas", grupo: "gestao" },
  { key: "catalogo_formularios", label: "Catálogo / Formulários", grupo: "gestao" },
  { key: "mentor_ai", label: "Mentor AI", grupo: "solucoes_ia" },
  { key: "central_reunioes", label: "Central de Reuniões", grupo: "solucoes_ia" },
  { key: "formacoes_academy", label: "Formações / Academy", grupo: "solucoes_ia" },
];

export const MODULE_KEYS: readonly ModuleKey[] = MODULES.map((m) => m.key);

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}
