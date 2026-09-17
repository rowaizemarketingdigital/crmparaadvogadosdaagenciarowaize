"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ModuleKey } from "@/lib/access-control/modules";

export interface ResourceGrant {
  id: string;
  user_id: string;
  module_key: ModuleKey;
  resource_id: string | null;
  granted_by: string | null;
  granted_at: string;
}

export const RESOURCE_GRANTS_KEY = ["access-grants"] as const;

export function useResourceGrants(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: RESOURCE_GRANTS_KEY,
    queryFn: async () => apiClient.get<{ data: ResourceGrant[] }>("/api/v1/access-grants"),
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
  });
}
