"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { useResourceGrants } from "@/hooks/access-grants/useResourceGrants";
import { useGrantAccess } from "@/hooks/access-grants/useGrantAccess";
import { useRevokeAccess } from "@/hooks/access-grants/useRevokeAccess";
import { MODULES, type ModuleKey } from "@/lib/access-control/modules";

export function AcessosClient() {
  const membros = useTeamMembers();
  const grants = useResourceGrants();
  const conceder = useGrantAccess();
  const revogar = useRevokeAccess();

  const [userId, setUserId] = React.useState<string>("");
  const [moduleKey, setModuleKey] = React.useState<ModuleKey | "">("");
  const [resourceId, setResourceId] = React.useState("");

  const membroPorId = React.useMemo(() => {
    const m = new Map<string, { email: string | null; full_name: string | null }>();
    for (const row of membros.data?.data ?? []) m.set(row.user_id, row);
    return m;
  }, [membros.data]);

  const moduloPorKey = React.useMemo(() => new Map(MODULES.map((m) => [m.key, m.label])), []);

  function nomeDoMembro(id: string): string {
    const m = membroPorId.get(id);
    return m?.full_name || m?.email || id;
  }

  function submeter() {
    if (!userId || !moduleKey) return;
    conceder.mutate(
      { user_id: userId, module_key: moduleKey, resource_id: resourceId.trim() || undefined },
      { onSuccess: () => setResourceId("") },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Pessoa" />
            </SelectTrigger>
            <SelectContent>
              {(membros.data?.data ?? []).map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name || m.email || m.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={moduleKey} onValueChange={(v) => setModuleKey(v as ModuleKey)}>
            <SelectTrigger>
              <SelectValue placeholder="Módulo" />
            </SelectTrigger>
            <SelectContent>
              {MODULES.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Recurso específico (opcional — vazio = módulo inteiro)"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
          />

          <Button onClick={submeter} disabled={!userId || !moduleKey || conceder.isPending}>
            Conceder
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead>Módulo</TableHead>
              <TableHead>Recurso</TableHead>
              <TableHead>Concedido em</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(grants.data?.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  Nenhuma concessão configurada — todo mundo continua vendo o que o papel já permite.
                </TableCell>
              </TableRow>
            ) : (
              (grants.data?.data ?? []).map((g) => (
                <TableRow key={g.id}>
                  <TableCell>{nomeDoMembro(g.user_id)}</TableCell>
                  <TableCell>{moduloPorKey.get(g.module_key) ?? g.module_key}</TableCell>
                  <TableCell>
                    {g.resource_id ? (
                      <code className="text-xs">{g.resource_id}</code>
                    ) : (
                      <Badge variant="outline">módulo inteiro</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(g.granted_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revogar.isPending}
                      onClick={() => revogar.mutate(g.id)}
                    >
                      Revogar
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
