import { describe, expect, it } from "vitest";

import { isModuleKey, MODULE_KEYS, MODULES } from "./modules";

describe("modules", () => {
  it("tem os 15 itens da seção 6.5 da auditoria, sem repetição", () => {
    expect(MODULES).toHaveLength(15);
    expect(new Set(MODULE_KEYS).size).toBe(15);
  });

  it("isModuleKey aceita só o vocabulário fechado", () => {
    expect(isModuleKey("pipeline")).toBe(true);
    expect(isModuleKey("financeiro")).toBe(true);
    expect(isModuleKey("modulo-que-nao-existe")).toBe(false);
  });
});
