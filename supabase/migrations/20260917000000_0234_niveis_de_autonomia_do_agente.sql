-- 0234 — nível de autonomia (1-5) por agente/ação, config nova do Rowaize OS
--
-- ═══ A DECISÃO (auditoria Rowaize OS, seção 5/8, 17/set) ═══
--
-- Cada papel de agente (seção 8 da auditoria) tem um nível padrão 1-5:
-- observar / sugerir / preparar-revisão / executar-com-aprovação /
-- executar-sozinho. Esta tabela é só a CONFIGURAÇÃO desse nível por
-- organização — o teto sobe ou desce por tenant sem precisar de deploy.
--
-- ═══ O QUE ESTA MIGRATION NÃO FAZ ═══
--
-- Não cria uma fila de aprovação genérica. O padrão já existe no schema, três
-- vezes, na mesma forma (`crm_lead_reactivations`, `contact_field_proposals`
-- 0123, `ai_reply_drafts` 0227): proposta com origem, valor anterior/proposto,
-- decisor e prazo, uma tabela por domínio de dado. Inventar uma quarta tabela
-- genérica aqui contrariaria esse padrão já rodando em produção — cada domínio
-- novo (financeiro, campanha, etc.) ganha a SUA fila, na mesma forma, quando
-- esse domínio for construído (Fase 2+), não uma fila compartilhada agora.
--
-- Esta migration também não toca `ai_agents.operation_mode` nem o motor de
-- revisão/CAS de `ai_reply_drafts` (0227) — aquele mecanismo já roda em
-- produção e é delicado (staleness, revisão, boundary). Ligar o nível
-- configurado aqui a ele é trabalho de uma fase futura, feito com o mesmo
-- cuidado, não uma mudança de um migration lateral.

create table if not exists public.agent_autonomy_levels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Vocabulário FECHADO — os 12 papéis da seção 8 da auditoria. Fechado pelo
  -- mesmo motivo do `campo` em contact_field_proposals (0123): campo livre
  -- deixaria qualquer string virar "agente", sem relação com o que existe.
  agent_key text not null check (agent_key in (
    'atendimento',
    'qualificacao_comercial',
    'gestao_crm',
    'coordenacao_tarefas',
    'briefings_alinhamentos',
    'metricas_gargalos',
    'trafego_campanhas',
    'automacao_instagram',
    'financeiro_operacional',
    'suporte_sucesso_cliente',
    'revisao_tecnica',
    'manutencao_plataforma'
  )),

  -- 'default' cobre o agente inteiro. Uma ação específica dentro do mesmo
  -- agente pode ganhar linha própria depois (nunca union — mais específico
  -- vence, resolvido em código, não em SQL) sem migration nova de schema.
  action_category text not null default 'default',

  level smallint not null check (level between 1 and 5),

  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, agent_key, action_category)
);

alter table public.agent_autonomy_levels enable row level security;
revoke all on public.agent_autonomy_levels from anon, authenticated;
grant select on public.agent_autonomy_levels to authenticated;
grant all on public.agent_autonomy_levels to service_role;

-- Leitura: qualquer membro da organização (a UI de configuração decide quem
-- mostra o formulário). Escrita: só manager+ — mudar o teto de autonomia de
-- um agente é ação de configuração de conta, não operação do dia a dia (seção
-- 11 da auditoria, "3 classes de permissão").
drop policy if exists agent_autonomy_levels_tenant_select on public.agent_autonomy_levels;
create policy agent_autonomy_levels_tenant_select on public.agent_autonomy_levels for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists agent_autonomy_levels_manager_write on public.agent_autonomy_levels;
create policy agent_autonomy_levels_manager_write on public.agent_autonomy_levels for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));

create index if not exists agent_autonomy_levels_org_agent on public.agent_autonomy_levels(organization_id, agent_key);

drop trigger if exists trg_agent_autonomy_levels_updated_at on public.agent_autonomy_levels;
create trigger trg_agent_autonomy_levels_updated_at before update on public.agent_autonomy_levels
  for each row execute function public.fn_set_updated_at();
