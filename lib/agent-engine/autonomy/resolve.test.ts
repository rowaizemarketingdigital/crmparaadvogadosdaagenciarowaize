import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { resolveAutonomyLevel } from "./resolve";

function fixture(rows: Array<{ action_category: string; level: number }>) {
  const db = {
    from() {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        in() {
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return db;
}

describe("resolveAutonomyLevel", () => {
  it("cai no default do agente quando não há override configurado", async () => {
    const r = await resolveAutonomyLevel({
      organizationId: "org1",
      agentKey: "gestao_crm",
      client: fixture([]),
    });
    expect(r.origem).toBe("default_de_agente");
    expect(r.level).toBe(3);
    expect(r.levelConfigurado).toBe(3);
  });

  it("usa o override 'default' da organização quando existe", async () => {
    const r = await resolveAutonomyLevel({
      organizationId: "org1",
      agentKey: "gestao_crm",
      client: fixture([{ action_category: "default", level: 5 }]),
    });
    expect(r.origem).toBe("override_default_categoria");
    expect(r.levelConfigurado).toBe(5);
  });

  it("linha de action_category específica vence a 'default' da mesma organização", async () => {
    const r = await resolveAutonomyLevel({
      organizationId: "org1",
      agentKey: "gestao_crm",
      actionCategory: "dedupe_contato",
      client: fixture([
        { action_category: "default", level: 2 },
        { action_category: "dedupe_contato", level: 4 },
      ]),
    });
    expect(r.origem).toBe("override_especifico");
    expect(r.levelConfigurado).toBe(4);
    expect(r.level).toBe(4);
  });

  it("nunca deixa passar do teto de risco, mesmo configurado em 5", async () => {
    const r = await resolveAutonomyLevel({
      organizationId: "org1",
      agentKey: "financeiro_operacional",
      risco: "financeiro",
      client: fixture([{ action_category: "default", level: 5 }]),
    });
    expect(r.levelConfigurado).toBe(5);
    expect(r.level).toBe(4);
  });

  it("risco padrão não limita nada abaixo de 5", async () => {
    const r = await resolveAutonomyLevel({
      organizationId: "org1",
      agentKey: "automacao_instagram",
      client: fixture([{ action_category: "default", level: 5 }]),
    });
    expect(r.level).toBe(5);
  });
});
