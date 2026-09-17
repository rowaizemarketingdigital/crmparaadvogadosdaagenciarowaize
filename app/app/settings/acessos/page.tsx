import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { AcessosClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Acesso granular por usuário × módulo × recurso — seção 8.7 da auditoria.
 * Sem concessão nenhuma pro módulo, o membro vê tudo que o papel dele já
 * permite (comportamento de hoje); a partir da 1ª concessão, a visão dele
 * naquele módulo estreita pro que foi concedido. Manual por enquanto.
 */
export default async function AcessosSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Acesso por módulo")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Sem nenhuma concessão aqui, cada pessoa continua vendo tudo que o papel dela já permite. Conceda acesso a um módulo (ou a um recurso específico dentro dele) pra restringir a visão de alguém só ao que é da função dela.",
          )}
        </p>
      </header>
      <AcessosClient />
    </div>
  );
}
