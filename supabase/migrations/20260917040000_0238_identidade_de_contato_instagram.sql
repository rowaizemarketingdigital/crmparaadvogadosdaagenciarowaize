-- 0238 — identidade de contato do Instagram, no MESMO cadastro único.
--
-- ═══ A DECISÃO (Fase 3, seção 12 da auditoria) ═══
--
-- Contato do Instagram entra na MESMA tabela `contacts` — não numa tabela
-- separada. É o invariante "um cadastro só por cliente" que a Fase 1 já
-- fixou (seção 1.5 da auditoria): todo módulo que precisar de "cliente"
-- resolve pelo MESMO registro, nunca cria um segundo sistema de identidade.
--
-- A diferença real do WhatsApp: aqui NÃO HÁ TELEFONE conhecido no primeiro
-- contato. Instagram não expõe o número de quem comenta/manda DM — só o
-- `ig_user_id` (IGSID, opaco) e, às vezes, o `username`. Por isso
-- `instagram_id` é uma coluna de identidade PRÓPRIA, não uma variação de
-- `phone_number` — mesmo padrão que `wa_lid` já usa (0122): identidade
-- gerada/opaca ganha coluna própria, não é forçada dentro de um campo que
-- assume outra forma.
--
-- `phone_number` fica NULL nesses contatos até (se algum dia acontecer) a
-- pessoa informar o telefone dela numa DM e alguém linkar manualmente — o
-- mecanismo de merge já existe (`lib/contacts/duplicados.ts`, `merge_queue`)
-- e é reaproveitado, não reinventado.

alter table public.contacts
  add column if not exists instagram_id text;

-- Só pra exibição/referência (pode mudar, ninguém busca por ele) — não é
-- identidade, é o @handle no momento do último evento visto.
alter table public.contacts
  add column if not exists instagram_username text;

create unique index if not exists uniq_contacts_org_instagram_id
  on public.contacts (organization_id, instagram_id)
  where instagram_id is not null and is_merged_into is null;

comment on column public.contacts.instagram_id is
  'ig_user_id (IGSID) — identidade opaca do Instagram, mesmo papel que wa_lid tem pro WhatsApp. Espelhado em lib/channels/instagram/ingest.ts.';

-- A RPC reencontra pelo instagram_id e GRAVA/atualiza — mesma forma de
-- `fn_upsert_wa_contact` (0198), sem a parte de telefone (não existe aqui).
create or replace function public.fn_upsert_instagram_contact(
  p_org uuid, p_instagram_id text, p_username text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_ig text := nullif(p_instagram_id, '');
  v_username text := nullif(p_username, '');
begin
  if v_ig is null then
    raise exception 'instagram_id_obrigatorio' using errcode = '22004';
  end if;

  select id into v_id from public.contacts
   where organization_id = p_org and instagram_id = v_ig and is_merged_into is null
   limit 1;

  if v_id is not null then
    update public.contacts set
      instagram_username = coalesce(v_username, instagram_username),
      -- Nome de exibição: só preenche se ainda não há nenhum — o cadastro
      -- pode já ter nome de verdade vindo de outro canal (a mesma pessoa
      -- que já é cliente por WhatsApp e agora também comenta no Instagram,
      -- uma vez que um humano fizer o merge). Nunca sobrescreve o que já
      -- existe com um @handle.
      display_name = coalesce(display_name, v_username),
      source_metadata = source_metadata
        || jsonb_build_object('instagram_username', v_username),
      updated_at = now()
    where id = v_id;
    return v_id;
  end if;

  begin
    insert into public.contacts (organization_id, instagram_id, instagram_username, source, display_name, source_metadata)
    values (p_org, v_ig, v_username, 'instagram', v_username, jsonb_build_object('instagram_username', v_username))
    returning id into v_id;
    return v_id;
  exception when unique_violation then
    -- Corrida: outro evento do mesmo IGSID inseriu entre o select e o
    -- insert. Mesmo caminho de recuperação do fn_upsert_wa_contact.
    select id into v_id from public.contacts
     where organization_id = p_org and instagram_id = v_ig and is_merged_into is null
     limit 1;
    return v_id;
  end;
end;
$$;
revoke all on function public.fn_upsert_instagram_contact(uuid, text, text) from public, anon;
grant execute on function public.fn_upsert_instagram_contact(uuid, text, text) to authenticated, service_role;
