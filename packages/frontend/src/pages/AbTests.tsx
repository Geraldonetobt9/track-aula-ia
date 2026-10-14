import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FlaskConical, Plus, Trophy } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AbTestFormDialog } from '@/components/ab-tests/AbTestFormDialog';
import { AbStatusBadge } from '@/components/ab-tests/AbStatusBadge';
import {
  GOAL_LABELS,
  goalValue,
  MODE_LABELS,
  useAbTestMutations,
  useAbTests,
  type AbTest,
} from '@/hooks/useAbTests';

const VERDICT_TEXT: Record<AbTest['summary']['verdict'], string> = {
  draft: 'Rascunho, ainda não sorteia',
  collecting: 'Coletando dados',
  winner: 'Vencedora encontrada',
  control: 'O original vence',
  inconclusive: 'Sem diferença clara ainda',
};

function TestRow({ test }: { test: AbTest }) {
  const leader = test.variants.find((v) => v.key === test.summary.leader);
  return (
    <Link to={`/ab-tests/${test.id}`} className="block">
      <Card className="transition-colors hover:bg-foreground/[0.03]">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium text-foreground">{test.name}</p>
              <AbStatusBadge status={test.status} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {test.pageUrl.replace(/^https?:\/\//, '')} · {MODE_LABELS[test.mode]} · {GOAL_LABELS[test.goal]}
            </p>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <div className="text-right">
              <p className="tabular-nums text-foreground">{test.summary.totalVisitors.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">visitantes</p>
            </div>
            <div className="hidden gap-3 md:flex">
              {test.variants.map((v) => (
                <div key={v.id} className="text-right">
                  <p className="tabular-nums text-foreground">{goalValue(test.goal, v)}</p>
                  <p className="text-xs text-muted-foreground">{v.key}</p>
                </div>
              ))}
            </div>
            <div className="w-40 text-right">
              <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                {(test.summary.verdict === 'winner' || test.summary.verdict === 'control') && (
                  <Trophy className="h-3.5 w-3.5 text-success" aria-hidden />
                )}
                {VERDICT_TEXT[test.summary.verdict]}
              </p>
              {leader && <p className="truncate text-xs font-medium text-foreground">{leader.key} · {leader.name}</p>}
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function AbTests() {
  const { tests, loading, error } = useAbTests();
  const { create } = useAbTestMutations();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);

  const running = tests.filter((t) => t.status === 'running').length;

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-sentinel-in">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Testes A/B</h1>
            <p className="mt-1 text-sm text-muted-foreground/80">
              Compare versões da página de vendas pela venda que cada uma trouxe
              {tests.length > 0 && ` · ${running} rodando`}
            </p>
          </div>
          <Button onClick={() => setFormOpen(true)} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            Novo teste
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Não foi possível carregar os testes: {error}
            </CardContent>
          </Card>
        ) : tests.length === 0 ? (
          <Card className="border-dashed border-foreground/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <FlaskConical className="h-7 w-7 text-accent-readable" />
              </div>
              <h2 className="mb-1 text-lg font-semibold text-foreground">Nenhum teste ainda</h2>
              <p className="mb-5 max-w-md text-sm text-muted-foreground/70">
                Duas páginas, ou duas versões de um bloco, disputando o mesmo tráfego. O código de rastreio sorteia cada
                visitante e o indexador do checkout diz qual versão vendeu mais.
              </p>
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Criar o primeiro teste
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {tests.map((t) => (
              <TestRow key={t.id} test={t} />
            ))}
          </div>
        )}
      </div>

      <AbTestFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        saving={create.isPending}
        onSave={async (input) => {
          const test = await create.mutateAsync(input);
          navigate(`/ab-tests/${test.id}`);
        }}
      />
    </DashboardLayout>
  );
}
