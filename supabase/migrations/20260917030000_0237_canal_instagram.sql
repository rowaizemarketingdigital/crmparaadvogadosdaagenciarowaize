-- 0237 — canal Instagram nativo (Fase 3, seção 12 da auditoria).
--
-- Mesmo padrão da 0233 (UAZAPI) e da 0131 (zernio): vocabulário antes do
-- transporte. Coluna nova + CHECK + matriz de capabilities nascem juntos; o
-- adapter (lib/channels/adapters/instagram.ts) chega encontrando o schema
-- pronto.
--
-- `instagram_business_id` é o id da conta Instagram Business/Creator
-- conectada (`ig_user_id`, o que os webhooks da Graph API endereçam em
-- `entry[].id`) — é o `sessionRef` deste canal, papel equivalente ao
-- `uazapi_instance_id`. NÃO é `meta_phone_number_id` (WhatsApp) nem
-- `zernio_account_id` — espaço de identificador próprio do produto
-- Instagram Login (graph.instagram.com), confirmado contra o sistema de
-- automação de Instagram real (Robson/Rowaize) que já opera em produção.
--
-- Idempotente e auto-curativa (doutrina de migrations): coluna nasce
-- nullable; os dois CHECKs são RECRIADOS porque precisam mudar de forma.

alter table public.channel_sessions
  add column if not exists instagram_business_id text;

-- Token de acesso de longa duração (Instagram Login — `ig_exchange_token`),
-- cifrado com a mesma RPC do resto do repo (`fn_encrypt_oauth`/
-- `fn_decrypt_oauth`, lib/webhooks/secrets.ts). Renovação (`ig_refresh_token`)
-- fica pra quando o cron de manutenção do canal for construído — não
-- inventado nesta migration sem um caso real de expiração pra validar contra.
alter table public.channel_sessions
  add column if not exists instagram_access_token_encrypted text;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['uazapi'::text, 'meta_cloud'::text, 'zernio'::text, 'instagram'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'uazapi'     and uazapi_instance_id  is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider = 'zernio'     and zernio_account_id    is not null) or
    (provider = 'instagram'  and instagram_business_id is not null)
  );

-- Default de provider CONTINUA 'uazapi' (WhatsApp é o canal padrão da
-- instalação) — Instagram é sempre uma escolha explícita, nunca herdada.

create unique index if not exists channel_sessions_instagram_business_id_ativo_unique
  on public.channel_sessions (instagram_business_id)
  where archived_at is null and instagram_business_id is not null;

comment on column public.channel_sessions.instagram_business_id is
  'Id da conta Instagram Business/Creator conectada (ig_user_id) — é o sessionRef deste canal. Espelhado em lib/channels/session-ref.ts.';
