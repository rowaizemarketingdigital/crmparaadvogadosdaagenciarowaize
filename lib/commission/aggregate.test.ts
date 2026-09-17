import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { getInfluencedRevenueCents, monthRangeUtc } from "./aggregate";

function fixture(rows: Array<{ value_cents: number | null }>) {
  const q = {
    select() {
      return q;
    },
    eq() {
      return q;
    },
    gte() {
      return q;
    },
    lt() {
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return { from: () => q } as unknown as SupabaseClient;
}

describe("monthRangeUtc", () => {
  it("cobre o mês inteiro, dezembro vira janeiro do ano seguinte", () => {
    const r = monthRangeUtc(12, 2026);
    expect(r.start).toBe("2026-12-01T00:00:00.000Z");
    expect(r.end).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("getInfluencedRevenueCents", () => {
  it("soma value_cents dos leads ganhos retornados", async () => {
    const total = await getInfluencedRevenueCents({
      organizationId: "org1",
      userId: "user1",
      month: 9,
      year: 2026,
      client: fixture([{ value_cents: 100_00 }, { value_cents: 250_00 }, { value_cents: null }]),
    });
    expect(total).toBe(350_00);
  });

  it("zero quando não há lead ganho no mês", async () => {
    const total = await getInfluencedRevenueCents({
      organizationId: "org1",
      userId: "user1",
      month: 9,
      year: 2026,
      client: fixture([]),
    });
    expect(total).toBe(0);
  });
});
