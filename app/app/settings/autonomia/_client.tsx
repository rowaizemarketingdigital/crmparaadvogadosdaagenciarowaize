"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
import type { AgentKey, AutonomyLevelSemantics } from "@/lib/agent-engine/autonomy/defaults";
import { setAutonomyLevelAction } from "./_actions";

export interface AgenteLinha {
  key: AgentKey;
  nome: string;
  level: 1 | 2 | 3 | 4 | 5;
  isOverride: boolean;
}

interface Props {
  agentes: AgenteLinha[];
  niveis: readonly AutonomyLevelSemantics[];
  podeEditar: boolean;
}

export function AutonomiaClient({ agentes: agentesIniciais, niveis, podeEditar }: Props) {
  const [agentes, setAgentes] = React.useState(agentesIniciais);
  const [salvandoKey, setSalvandoKey] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const nivelPorNumero = React.useMemo(
    () => new Map(niveis.map((n) => [n.level, n])),
    [niveis],
  );

  async function onChange(key: AgentKey, novoLevel: number) {
    setErro(null);
    setSalvandoKey(key);
    const anterior = agentes;
    setAgentes((prev) => prev.map((a) => (a.key === key ? { ...a, level: novoLevel as 1 | 2 | 3 | 4 | 5, isOverride: true } : a)));
    const result = await setAutonomyLevelAction(key, novoLevel);
    setSalvandoKey(null);
    if (!result.ok) {
      setAgentes(anterior);
      setErro(result.message ?? result.error);
    }
  }

  return (
    <Card className="p-0">
      {erro && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agente</TableHead>
            <TableHead>Nível de autonomia</TableHead>
            <TableHead>O que esse nível significa</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {agentes.map((a) => {
            const semantica = nivelPorNumero.get(a.level);
            return (
              <TableRow key={a.key}>
                <TableCell className="font-medium">{a.nome}</TableCell>
                <TableCell>
                  <Select
                    value={String(a.level)}
                    disabled={!podeEditar || salvandoKey === a.key}
                    onValueChange={(v) => onChange(a.key, Number(v))}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {niveis.map((n) => (
                        <SelectItem key={n.level} value={String(n.level)}>
                          {n.level} · {n.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="max-w-md text-sm text-muted-foreground">
                  {semantica?.descricao}
                </TableCell>
                <TableCell>
                  {a.isOverride ? (
                    <Badge variant="secondary">personalizado</Badge>
                  ) : (
                    <Badge variant="outline">padrão</Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
