"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { ModuleKey } from "@/lib/access-control/modules";
import { RESOURCE_GRANTS_KEY, type ResourceGrant } from "./useResourceGrants";

export interface GrantAccessArgs {
  user_id: string;
  module_key: ModuleKey;
  resource_id?: string;
}

export function useGrantAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: GrantAccessArgs) =>
      apiClient.post<{ data: ResourceGrant }>("/api/v1/access-grants", args),
    onError: showApiError,
    onSuccess: () => {
      toast.success("Acesso concedido.");
      qc.invalidateQueries({ queryKey: RESOURCE_GRANTS_KEY });
    },
  });
}
