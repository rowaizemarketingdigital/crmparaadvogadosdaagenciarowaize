"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { RESOURCE_GRANTS_KEY } from "./useResourceGrants";

export function useRevokeAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete<{ data: { id: string } }>(`/api/v1/access-grants/${id}`),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RESOURCE_GRANTS_KEY });
    },
  });
}
