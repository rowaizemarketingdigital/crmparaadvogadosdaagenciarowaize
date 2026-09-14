-- 0233 — canal não oficial: UAZAPI no lugar do WAHA.
--
-- Mesmo padrão da 0131 (que introduziu o zernio): o VOCABULÁRIO antes do
-- transporte. A coluna nova, o CHECK e a matriz de capabilities (código)
-- nascem juntos; o adapter (`lib/channels/adapters/uazapi.ts`) chega
-- encontrando o schema pronto.
--
-- Por que uma coluna NOVA e não reusar `waha_session_name`: o identificador
-- deste canal é o `instance_id` que a UAZAPI atribui à instância conectada —
-- espaço de identificador diferente do nome de sessão do WAHA. Reusar a
-- coluna faria uma migração de dados que ninguém pediu; nasce nullable do
-- lado, sem tocar `waha_session_name`.
--
-- `waha_session_name` e o adapter WAHA continuam no schema/código (não
-- removidos) — só saem de `ChannelProvider` (TypeScript) e do CHECK de
-- provider válido (banco). Sem sessão 'waha' viva nesta instalação (fork
-- novo, sem instância em produção ainda), não há dado a migrar — só a
-- promessa de que 'waha' deixa de ser um valor aceito daqui pra frente.
--
-- Idempotente e auto-curativa (doutrina de migrations): coluna nasce
-- nullable; os dois CHECKs são RECRIADOS (drop + add) porque precisam MUDAR.

alter table public.channel_sessions
  add column if not exists uazapi_instance_id text;

-- O `instance_token` cifrado da instância — mesma cifra do resto do repo
-- (`fn_encrypt_oauth`/`fn_decrypt_oauth`, ver lib/webhooks/secrets.ts). Sem
-- esta coluna `lib/channels/uazapi/credentials.ts` não tem onde ler a
-- credencial gravada pela tela (cai sempre no fallback do `.env`).
alter table public.channel_sessions
  add column if not exists uazapi_token_encrypted text;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['uazapi'::text, 'meta_cloud'::text, 'zernio'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'uazapi'     and uazapi_instance_id  is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider = 'zernio'     and zernio_account_id    is not null)
  );

alter table public.channel_sessions
  alter column provider set default 'uazapi';

-- Mesmo recorte de índice único que a 0165 já usa para meta/zernio: um
-- identificador vive em UM canal ATIVO. Sem passo de deduplicação porque
-- esta coluna nasce agora — não há linha pré-existente para colidir.
create unique index if not exists channel_sessions_uazapi_instance_id_ativo_unique
  on public.channel_sessions (uazapi_instance_id)
  where archived_at is null and uazapi_instance_id is not null;

comment on column public.channel_sessions.uazapi_instance_id is
  'Id da instância conectada NA UAZAPI (instance_id) — não é waha_session_name nem zernio_account_id. É o sessionRef deste canal. Espelhado em lib/channels/session-ref.ts.';
