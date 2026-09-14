/**
 * De onde sai o identificador da sessão/número no provider.
 *
 * Esta é a pergunta que NÃO pode viver numa feature: com três providers o
 * `sessionRef` vem de `uazapi_instance_id`, de `meta_phone_number_id` **ou**
 * de `zernio_account_id`, e quem escolher isso fora daqui vira o
 * `if (provider === ...)` que o invariante 1 da doutrina existe para proibir.
 * O chamador pede o ref; a coluna é detalhe.
 *
 * O tipo é a tagged union que a migration `channel_sessions_provider_ref_check`
 * enforça no banco: a coluna do provider da vez é NOT NULL, as outras são
 * NULL. Por isso o retorno é `string`, não `string | null` — a garantia é do
 * CHECK, não de otimismo.
 */
export type ChannelSessionRef =
  | { provider: "uazapi"; uazapi_instance_id: string }
  | { provider: "meta_cloud"; meta_phone_number_id: string }
  | { provider: "zernio"; zernio_account_id: string };

/**
 * Colunas que um `select` do PostgREST precisa trazer para `resolveSessionRef`
 * funcionar. Fica aqui pelo mesmo motivo da função: a string do `select` também
 * nomeia coluna de provider, e ela some da feature junto com a decisão.
 */
export const CHANNEL_SESSION_REF_COLUMNS =
  "provider, uazapi_instance_id, meta_phone_number_id, zernio_account_id";

export function resolveSessionRef(session: ChannelSessionRef): string {
  switch (session.provider) {
    case "meta_cloud":
      return session.meta_phone_number_id;
    case "uazapi":
      return session.uazapi_instance_id;
    // O `accountId` que o provider devolve ao conectar a WABA. NÃO é o
    // phone_number_id da Meta: quem intermedeia guarda o número por dentro e
    // endereça pelo id dele. Mandar o id da Meta aqui responde 404.
    case "zernio":
      return session.zernio_account_id;
  }
}
