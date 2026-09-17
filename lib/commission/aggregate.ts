/**
 * Receita influenciada do mês, somada direto de `crm_leads` nativo — não
 * porta o schema de venda/pagamento do Studio CRM (`commercial_sales`), que a
 * auditoria de código já mostrou ser redundante com o Kanban que o
 * DeskcommCRM já tem. "Ganho" aqui é sempre negócio com `status='won'`
 * fechado dentro do mês (`closed_at`), somando `value_cents`.
 *
 * Diferente do sistema de origem (que soma o valor do CONTRATO mesmo em venda
 * parcialmente paga — ver achado da auditoria), aqui não existe status
 * intermediário: `crm_leads.status` é só open/won/lost, então esse caso nem
 * se aplica — decisão que a própria auditoria já registrou como não-herdada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export interface InfluencedRevenueInput {
  organizationId: string;
  userId: string;
  month: number; // 1-12
  year: number;
  client?: SupabaseClient;
}

export function monthRangeUtc(month: number, year: number): { start: string; end: string } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function getInfluencedRevenueCents(input: InfluencedRevenueInput): Promise<number> {
  const supabase = input.client ?? createAdminClient();
  const { start, end } = monthRangeUtc(input.month, input.year);

  const { data, error } = await supabase
    .from("crm_leads")
    .select("value_cents")
    .eq("organization_id", input.organizationId)
    .eq("owner_user_id", input.userId)
    .eq("status", "won")
    .gte("closed_at", start)
    .lt("closed_at", end);

  if (error) throw new Error(`influenced_revenue_lookup_failed: ${error.message}`);

  return ((data ?? []) as Array<{ value_cents: number | null }>).reduce(
    (soma, row) => soma + (row.value_cents ?? 0),
    0,
  );
}
