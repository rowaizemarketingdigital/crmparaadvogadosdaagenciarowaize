/**
 * A porta de entrada do seam. Feature nenhuma importa `lib/uazapi/*` ou
 * `lib/waha/*` direto — pede o adapter do provider da conversa e o descritor
 * de capabilities.
 *
 * `lib/waha/*` e `adapters/waha.ts` continuam no repo (código morto, sem
 * custo de manter) — não registrados aqui porque `"waha"` saiu de
 * `ChannelProvider`. Ver decisão em `ARCHITECTURE.md`/histórico do PR: canal
 * não-oficial trocado pelo UAZAPI, que é o que a agência já opera em produção
 * no sistema irmão (Studio CRM).
 */
import { metaCloudAdapter } from "./adapters/meta-cloud";
import { uazapiAdapter } from "./adapters/uazapi";
import { zernioAdapter } from "./adapters/zernio";
import type { ChannelAdapter, ChannelProvider } from "./types";

const ADAPTERS: Record<ChannelProvider, ChannelAdapter | null> = {
  uazapi: uazapiAdapter,
  meta_cloud: metaCloudAdapter,
  zernio: zernioAdapter,
};

/**
 * Fail-closed: provider sem adapter (ou fora da matriz) lança em vez de cair no
 * WAHA por default. Enviar pelo canal errado é pior que não enviar.
 */
export function getAdapter(provider: ChannelProvider): ChannelAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`unknown_channel_provider: ${provider}`);
  return adapter;
}

export { capabilitiesOf, CHANNEL_CAPABILITIES, DEFAULT_CHANNEL_PROVIDER } from "./capabilities";
export { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef } from "./session-ref";
export type { ChannelSessionRef } from "./session-ref";
export type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelProvider,
  OutboundEnvelope,
  OutboundKind,
  OutboundMedia,
  RecipientInput,
} from "./types";
