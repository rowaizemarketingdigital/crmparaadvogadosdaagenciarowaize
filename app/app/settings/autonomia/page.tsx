import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import {
  AGENT_KEYS,
  AGENT_LABELS,
  AUTONOMY_LEVELS,
  DEFAULT_AUTONOMY_LEVEL,
  type AutonomyLevel,
} from "@/lib/agent-engine/autonomy/defaults";
import { AutonomiaClient, type AgenteLinha } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Configuração dos níveis de autonomia (1-5) por agente — seção 5/8 da
 * auditoria Rowaize OS. Server component: lê o override já salvo (se houver)
 * e combina com o default de `defaults.ts` no servidor, pra primeira pintura
 * já sair correta.
 */
export default async function AutonomiaSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeEditar = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_autonomy_levels")
    .select("agent_key, level")
    .eq("organization_id", activeOrg.orgId)
    .eq("action_category", "default");

  const overrides = new Map<string, AutonomyLevel>(
    ((data ?? []) as Array<{ agent_key: string; level: AutonomyLevel }>).map((r) => [r.agent_key, r.level]),
  );

  const agentes: AgenteLinha[] = AGENT_KEYS.map((key) => ({
    key,
    nome: AGENT_LABELS[key],
    level: overrides.get(key) ?? DEFAULT_AUTONOMY_LEVEL[key],
    isOverride: overrides.has(key),
  }));

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Autonomia dos agentes")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Nível 1-5 por agente — quanto ele executa sozinho antes de precisar da sua aprovação. Ação financeira/publicação/exclusão nunca passa do nível 4.",
          )}
        </p>
      </header>
      <AutonomiaClient agentes={agentes} niveis={AUTONOMY_LEVELS} podeEditar={podeEditar} />
    </div>
  );
}
