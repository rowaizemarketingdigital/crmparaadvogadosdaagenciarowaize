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
import type { calcMonthlyEarnings } from "@/lib/commission/calc";
import { seedNiveisEsteticaAction, setMonthlyGoalAction, setSellerLevelAction } from "./_actions";

export interface NivelOption {
  id: string;
  key: string;
  label: string;
}

export interface LinhaVendedor {
  userId: string;
  nome: string;
  levelId: string | null;
  activityCount: number;
  revenueGoalCents: number | null;
  ganho: ReturnType<typeof calcMonthlyEarnings> | null;
}

interface Props {
  agentesVazio: boolean;
  podeEditar: boolean;
  niveis: NivelOption[];
  linhas: LinhaVendedor[];
  mesReferencia: { month: number; year: number };
}

function reais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ComissaoClient({ agentesVazio, podeEditar, niveis, linhas, mesReferencia }: Props) {
  const [semeando, setSemeando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  if (agentesVazio) {
    return (
      <Card className="flex flex-col items-center gap-4 p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum nível de comissão configurado. Você pode começar do zero, ou usar os valores reais
          da Clínica Acas (Júnior/Pleno/Sênior) como ponto de partida — tudo editável depois.
        </p>
        {podeEditar ? (
          <Button
            disabled={semeando}
            onClick={async () => {
              setSemeando(true);
              setErro(null);
              const r = await seedNiveisEsteticaAction();
              setSemeando(false);
              if (!r.ok) setErro(r.message ?? r.error);
              else window.location.reload();
            }}
          >
            Usar valores do template Estética
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Peça a um manager pra configurar.</p>
        )}
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vendedor</TableHead>
            <TableHead>Nível</TableHead>
            <TableHead>Atividade no mês</TableHead>
            <TableHead>Meta de receita</TableHead>
            <TableHead>Atingimento</TableHead>
            <TableHead>Ganho mensal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l) => (
            <LinhaEditavel key={l.userId} linha={l} niveis={niveis} podeEditar={podeEditar} mesReferencia={mesReferencia} />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function LinhaEditavel({
  linha,
  niveis,
  podeEditar,
  mesReferencia,
}: {
  linha: LinhaVendedor;
  niveis: NivelOption[];
  podeEditar: boolean;
  mesReferencia: { month: number; year: number };
}) {
  const [activityCount, setActivityCount] = React.useState(String(linha.activityCount));
  const [revenueGoal, setRevenueGoal] = React.useState(
    linha.revenueGoalCents != null ? String(linha.revenueGoalCents / 100) : "",
  );
  const [salvando, setSalvando] = React.useState(false);

  async function salvarMeta() {
    setSalvando(true);
    const goalCents = revenueGoal.trim() ? Math.round(Number(revenueGoal.replace(",", ".")) * 100) : null;
    await setMonthlyGoalAction(linha.userId, mesReferencia.month, mesReferencia.year, Number(activityCount) || 0, goalCents);
    setSalvando(false);
    window.location.reload();
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{linha.nome}</TableCell>
      <TableCell>
        <Select
          value={linha.levelId ?? ""}
          disabled={!podeEditar}
          onValueChange={async (v) => {
            await setSellerLevelAction(linha.userId, v);
            window.location.reload();
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Sem nível" />
          </SelectTrigger>
          <SelectContent>
            {niveis.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          className="w-20"
          type="number"
          min={0}
          value={activityCount}
          disabled={!podeEditar}
          onChange={(e) => setActivityCount(e.target.value)}
          onBlur={salvarMeta}
        />
      </TableCell>
      <TableCell>
        <Input
          className="w-32"
          placeholder="R$"
          value={revenueGoal}
          disabled={!podeEditar}
          onChange={(e) => setRevenueGoal(e.target.value)}
          onBlur={salvarMeta}
        />
      </TableCell>
      <TableCell>
        {linha.ganho?.atingimentoPct != null ? (
          <Badge variant={linha.ganho.atingimentoPct >= 1 ? "success" : "neutral"}>
            {(linha.ganho.atingimentoPct * 100).toFixed(0)}%
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">sem meta</span>
        )}
      </TableCell>
      <TableCell className="font-semibold">
        {linha.ganho ? reais(linha.ganho.totalCents) : "—"}
        {salvando && <span className="ml-2 text-xs text-muted-foreground">salvando…</span>}
      </TableCell>
    </TableRow>
  );
}
