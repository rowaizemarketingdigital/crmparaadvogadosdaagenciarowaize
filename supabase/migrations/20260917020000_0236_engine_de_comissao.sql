-- 0236 — engine de comissão (Fase 2, backlog seção 12 da auditoria)
--
-- ═══ A FÓRMULA REAL (Studio CRM, src/modules/comercial-v2/utils/commission.ts) ═══
--
-- Não é comissão por venda — é o ganho mensal do vendedor:
--   ganho = salário-base do nível + (contagem de atividade qualificada × bônus
--   por unidade) + (receita influenciada do mês × taxa da faixa atingida).
-- A faixa é em DEGRAU, não marginal: uma vez atingido 100% da meta, a taxa daquela
-- faixa vale sobre a receita INTEIRA do mês, não só o excedente — replicado
-- fielmente em lib/commission/calc.ts, testado byte a byte contra os valores
-- reais (junior/pleno/senior) documentados no sistema de origem.
--
-- ═══ POR QUE GENÉRICO, NÃO TRAVADO EM JUNIOR/PLENO/SENIOR ═══
--
-- O sistema real tem 3 níveis fixos no código. Aqui os níveis e a tabela de
-- faixa são CONFIGURAÇÃO por organização — os valores reais da Clínica Acas
-- entram como sugestão padrão do template Estética (lib/commission/defaults.ts),
-- não como constante do schema. Mesmo padrão já usado pro `vocabulary` de
-- pipeline (crm_pipelines.vocabulary) e pros 12 agentes (0234).
--
-- ═══ O QUE NÃO ENTROU NESTA PRIMEIRA FATIA (decisão deliberada, não esquecimento) ═══
--
-- 1. Ganho passado NÃO é congelado — igual ao sistema de origem, recalculado
--    ao vivo a partir da meta/nível atuais. É comportamento herdado de propósito
--    (mesmo cálculo do sistema real), não um descuido; se algum dia precisar
--    de snapshot histórico, é uma tabela nova, não uma mudança nesta.
-- 2. O caso "venda inadimplente ainda conta pra meta" (achado real do sistema
--    de origem, provavelmente um bug lá) NÃO se aplica aqui: `crm_leads` do
--    DeskcommCRM só tem status open/won/lost — não existe status "inadimplente"
--    neste schema, então esse buraco específico não é herdado.
-- 3. O "bônus por atividade" (R$25/consulta no sistema real) fica com a
--    CONTAGEM alimentada de fora (não auto-derivada de crm_lead_activities
--    nesta fatia) — decidir o que conta como "atividade qualificada" por nicho
--    é trabalho de configuração futura, não uma constante a inventar agora.

create table if not exists public.commission_levels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  label text not null,
  base_salary_cents bigint not null default 0 check (base_salary_cents >= 0),
  -- Meta SUGERIDA (não obrigatória) de receita influenciada mensal — o sistema
  -- de origem documenta isso como default editável, não teto nem piso.
  suggested_goal_cents bigint check (suggested_goal_cents is null or suggested_goal_cents >= 0),
  -- Bônus por unidade de atividade qualificada (R$25/consulta no sistema real).
  activity_bonus_cents bigint not null default 0 check (activity_bonus_cents >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table if not exists public.commission_rate_tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  level_id uuid not null references public.commission_levels(id) on delete cascade,
  -- Fração da meta atingida a partir da qual esta taxa passa a valer — em
  -- DEGRAU: a maior faixa atingida vale sobre a receita inteira do mês, não só
  -- o excedente (mesma regra do sistema de origem, ver lib/commission/calc.ts).
  min_atingimento_pct numeric(6,4) not null check (min_atingimento_pct >= 0),
  rate_pct numeric(7,5) not null check (rate_pct >= 0),
  created_at timestamptz not null default now(),
  unique (level_id, min_atingimento_pct)
);

create table if not exists public.commission_seller_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  level_id uuid not null references public.commission_levels(id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.commission_monthly_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  month smallint not null check (month between 1 and 12),
  year smallint not null check (year between 2020 and 2100),
  -- Contagem de atividade qualificada do mês (ex.: consultas) — alimentada de
  -- fora nesta fatia, ver nota 3 do cabeçalho.
  activity_count integer not null default 0 check (activity_count >= 0),
  revenue_goal_cents bigint check (revenue_goal_cents is null or revenue_goal_cents >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, month, year)
);

create index if not exists commission_rate_tiers_level on public.commission_rate_tiers(organization_id, level_id);
create index if not exists commission_seller_assignments_org_user on public.commission_seller_assignments(organization_id, user_id);
create index if not exists commission_monthly_goals_org_user_period on public.commission_monthly_goals(organization_id, user_id, year, month);

alter table public.commission_levels enable row level security;
alter table public.commission_rate_tiers enable row level security;
alter table public.commission_seller_assignments enable row level security;
alter table public.commission_monthly_goals enable row level security;

revoke all on public.commission_levels from anon, authenticated;
revoke all on public.commission_rate_tiers from anon, authenticated;
revoke all on public.commission_seller_assignments from anon, authenticated;
revoke all on public.commission_monthly_goals from anon, authenticated;
grant select on public.commission_levels to authenticated;
grant select on public.commission_rate_tiers to authenticated;
grant select on public.commission_seller_assignments to authenticated;
grant select on public.commission_monthly_goals to authenticated;
grant all on public.commission_levels to service_role;
grant all on public.commission_rate_tiers to service_role;
grant all on public.commission_seller_assignments to service_role;
grant all on public.commission_monthly_goals to service_role;

-- Configuração (níveis/faixas/atribuição): leitura de todo mundo da org,
-- escrita manager+ — mesmo padrão da 0234/0235.
drop policy if exists commission_levels_tenant_select on public.commission_levels;
create policy commission_levels_tenant_select on public.commission_levels for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists commission_levels_manager_write on public.commission_levels;
create policy commission_levels_manager_write on public.commission_levels for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));

drop policy if exists commission_rate_tiers_tenant_select on public.commission_rate_tiers;
create policy commission_rate_tiers_tenant_select on public.commission_rate_tiers for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists commission_rate_tiers_manager_write on public.commission_rate_tiers;
create policy commission_rate_tiers_manager_write on public.commission_rate_tiers for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));

drop policy if exists commission_seller_assignments_manager_write on public.commission_seller_assignments;
create policy commission_seller_assignments_manager_write on public.commission_seller_assignments for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));

-- Achado real (Studio CRM, useCommercialAccess.ts): vendedor vê só a própria
-- atribuição/meta; manager+ vê de todo mundo. Réplica deliberada do modelo de
-- acesso real, não invenção — é exatamente o caso de uso "ver meu próprio
-- ganho, sem ver o dos colegas".
drop policy if exists commission_seller_assignments_self_select on public.commission_seller_assignments;
create policy commission_seller_assignments_self_select on public.commission_seller_assignments for select to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists commission_monthly_goals_manager_write on public.commission_monthly_goals;
create policy commission_monthly_goals_manager_write on public.commission_monthly_goals for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));

drop policy if exists commission_monthly_goals_self_select on public.commission_monthly_goals;
create policy commission_monthly_goals_self_select on public.commission_monthly_goals for select to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
  );

drop trigger if exists trg_commission_levels_updated_at on public.commission_levels;
create trigger trg_commission_levels_updated_at before update on public.commission_levels
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_commission_seller_assignments_updated_at on public.commission_seller_assignments;
create trigger trg_commission_seller_assignments_updated_at before update on public.commission_seller_assignments
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_commission_monthly_goals_updated_at on public.commission_monthly_goals;
create trigger trg_commission_monthly_goals_updated_at before update on public.commission_monthly_goals
  for each row execute function public.fn_set_updated_at();
