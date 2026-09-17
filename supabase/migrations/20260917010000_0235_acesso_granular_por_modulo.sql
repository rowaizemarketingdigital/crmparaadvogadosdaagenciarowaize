-- 0235 — acesso granular por usuário × módulo × recurso ("pasta")
--
-- ═══ A DECISÃO (auditoria Rowaize OS, seção 8.7, 17/set) ═══
--
-- Pedido do Robson, referência explícita ao ClickUp: atribuir manualmente um
-- usuário a um módulo específico e, dentro dele, a um recurso específico
-- ("pasta" — o que isso significa varia por módulo, ver vocabulário fechado
-- abaixo). Objetivo declarado: ninguém perde tempo vendo módulo que não é da
-- função dele.
--
-- ═══ ADITIVO, NÃO TRAVADO POR PADRÃO ═══
--
-- Sem NENHUMA linha em user_resource_grants para (org, usuário, módulo), o
-- usuário continua vendo tudo que o papel dele (viewer/agent/manager/admin em
-- user_organizations) já permite hoje — nada quebra em nenhum módulo
-- existente. A partir da 1ª concessão configurada NAQUELE módulo pra AQUELE
-- usuário, a visão dele nesse módulo estreita pra só o que foi concedido —
-- módulo inteiro (resource_id null) ou um recurso específico dentro dele.
-- fn_user_has_module_access() abaixo é a fonte única dessa regra: qualquer
-- policy/handler futuro de um módulo específico chama ela, nunca reimplementa
-- a lógica aditiva.
--
-- ═══ "PASTA" NÃO É UMA ÁRVORE ÚNICA ═══
--
-- Cada módulo tem sua própria hierarquia de recurso (um pipeline específico
-- dentro de Pipeline, um projeto específico dentro de Central de Reuniões).
-- Por isso `resource_id` é texto livre, cujo significado quem define é o
-- módulo dono — esta tabela só registra QUE foi concedido, não o que o id
-- aponta. Mapeado módulo por módulo conforme cada um for construído (Fase 2+),
-- não inventado de uma vez agora.

create table if not exists public.user_resource_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Vocabulário FECHADO — os 15 itens da seção 6.5 da auditoria (mapa de
  -- navegação final). Mesmo motivo do agent_key em 0234: campo livre deixaria
  -- qualquer string virar "módulo", sem relação com o que existe de verdade.
  module_key text not null check (module_key in (
    'pipeline',
    'atendimento',
    'contatos',
    'automacoes',
    'financeiro',
    'conexoes',
    'planejador_social',
    'metricas',
    'campanhas',
    'equipe_acessos',
    'clientes_contratos_tarefas',
    'catalogo_formularios',
    'mentor_ai',
    'central_reunioes',
    'formacoes_academy'
  )),

  -- NULL = concessão cobre o módulo inteiro. Preenchido = escopo a um recurso
  -- específico dentro do módulo (a "pasta"). Formato e significado são do
  -- módulo dono, não desta tabela.
  resource_id text,

  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  -- Revogação é soft-delete (revoked_at), não DELETE — mesmo padrão de
  -- user_organizations/platform_admins/api_tokens neste schema: quem revogou,
  -- quando, fica no histórico em vez de desaparecer.
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,

  updated_at timestamptz not null default now()
);

-- Duas unique parciais em vez de uma unique com NULL: Postgres trata NULL como
-- distinto de NULL, então uma unique comum jamais barraria duas concessões
-- "módulo inteiro" duplicadas para o mesmo usuário — o buraco que estas duas
-- fecham, cada uma para o caso que lhe cabe.
create unique index if not exists user_resource_grants_modulo_inteiro
  on public.user_resource_grants(organization_id, user_id, module_key)
  where resource_id is null and revoked_at is null;

create unique index if not exists user_resource_grants_recurso_especifico
  on public.user_resource_grants(organization_id, user_id, module_key, resource_id)
  where resource_id is not null and revoked_at is null;

create index if not exists user_resource_grants_org_user on public.user_resource_grants(organization_id, user_id);

alter table public.user_resource_grants enable row level security;
revoke all on public.user_resource_grants from anon, authenticated;
grant select on public.user_resource_grants to authenticated;
grant all on public.user_resource_grants to service_role;

-- Leitura: qualquer membro da organização. Escrita: só manager+ — atribuir ou
-- remover acesso de outra pessoa é configuração de conta (seção 11 da
-- auditoria, "3 classes de permissão"), não operação do dia a dia.
drop policy if exists user_resource_grants_tenant_select on public.user_resource_grants;
create policy user_resource_grants_tenant_select on public.user_resource_grants for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists user_resource_grants_manager_write on public.user_resource_grants;
create policy user_resource_grants_manager_write on public.user_resource_grants for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));

drop trigger if exists trg_user_resource_grants_updated_at on public.user_resource_grants;
create trigger trg_user_resource_grants_updated_at before update on public.user_resource_grants
  for each row execute function public.fn_set_updated_at();

-- fn_user_has_module_access — FONTE ÚNICA da regra aditiva descrita no
-- cabeçalho. p_resource null = "este usuário pode ver o módulo (ou um recurso
-- específico dentro dele, à escolha de quem chama)"; p_resource preenchido =
-- "este usuário pode ver ESTE recurso".
create or replace function public.fn_user_has_module_access(
  p_org uuid,
  p_user uuid,
  p_module text,
  p_resource text default null
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    -- Sem concessão nenhuma pro módulo: comportamento de hoje, acesso pleno.
    not exists (
      select 1 from public.user_resource_grants g
      where g.organization_id = p_org and g.user_id = p_user
        and g.module_key = p_module and g.revoked_at is null
    )
    or exists (
      select 1 from public.user_resource_grants g
      where g.organization_id = p_org and g.user_id = p_user
        and g.module_key = p_module and g.revoked_at is null
        -- módulo inteiro concedido, OU o recurso específico pedido bate
        and (g.resource_id is null or g.resource_id = p_resource)
    );
$$;
revoke all on function public.fn_user_has_module_access(uuid, uuid, text, text) from public, anon;
grant execute on function public.fn_user_has_module_access(uuid, uuid, text, text) to authenticated, service_role;
