/**
 * Acesso granular por usuário × módulo × recurso (seção 8.7 da auditoria
 * Rowaize OS, migration 0235). Vocabulário de módulo mantido em
 * `lib/access-control/modules.ts` — mesma lista fechada do CHECK do banco.
 */
import { z } from "zod";

import { MODULE_KEYS } from "@/lib/access-control/modules";

export const grantAccessSchema = z.object({
  user_id: z.string().uuid(),
  module_key: z.enum(MODULE_KEYS as [string, ...string[]]),
  // Vazio/ausente = concessão cobre o módulo inteiro.
  resource_id: z.string().min(1).max(200).optional(),
});
export type GrantAccessInput = z.infer<typeof grantAccessSchema>;
