import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { hasModuleAccess } from "./resolve";

function fixture(result: boolean) {
  return {
    rpc(_name: string, _args: unknown) {
      return Promise.resolve({ data: result, error: null });
    },
  } as unknown as SupabaseClient;
}

describe("hasModuleAccess", () => {
  it("repassa true quando a função do banco autoriza", async () => {
    const ok = await hasModuleAccess({
      organizationId: "org1",
      userId: "user1",
      moduleKey: "financeiro",
      client: fixture(true),
    });
    expect(ok).toBe(true);
  });

  it("repassa false quando a função do banco nega", async () => {
    const ok = await hasModuleAccess({
      organizationId: "org1",
      userId: "user1",
      moduleKey: "financeiro",
      client: fixture(false),
    });
    expect(ok).toBe(false);
  });

  it("propaga erro do RPC em vez de engolir", async () => {
    const client = {
      rpc() {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      },
    } as unknown as SupabaseClient;
    await expect(
      hasModuleAccess({ organizationId: "org1", userId: "user1", moduleKey: "pipeline", client }),
    ).rejects.toThrow("module_access_check_failed");
  });
});
