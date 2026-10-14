import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Flag, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AbTestFormDialog } from '@/components/ab-tests/AbTestFormDialog';
import { AbTestResults } from '@/components/ab-tests/AbTestResults';
import { AbTestSetupGuide } from '@/components/ab-tests/AbTestSetupGuide';
import { AbStatusBadge } from '@/components/ab-tests/AbStatusBadge';
import { usePrivacyMode } from '@/hooks/usePrivacyMode';
import { GOAL_LABELS, MODE_LABELS, useAbTest, useAbTestMutations } from '@/hooks/useAbTests';

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function daysBetween(from: string, to: string | null) {
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

const NO_WINNER = 'none';

export default function AbTestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { test, loading, error } = useAbTest(id);
  const { update, setStatus, remove } = useAbTestMutations();
  const { isHidden, toggle } = usePrivacyMode();

  const [editOpen, setEditOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [winner, setWinner] = useState<string>(NO_WINNER);

  // Ao abrir o encerramento, sugere a líder estatística (ou nenhuma).
  useEffect(() => {
    if (!finishOpen || !test) return;
    const leader = test.variants.find((v) => v.key === test.summary.leader);
    setWinner(leader?.id ?? NO_WINNER);
  }, [finishOpen, test]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !test) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
            <p>Não foi possível carregar o teste{error ? `: ${error}` : '.'}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/ab-tests">Voltar aos testes</Link>
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const busy = setStatus.isPending;
  const act = (action: 'start' | 'pause' | 'finish', winnerVariantId?: string) =>
    setStatus.mutateAsync({ id: test.id, action, winnerVariantId }).catch(() => undefined);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-sentinel-in">
        <div className="space-y-3">
          <Link to="/ab-tests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Testes A/B
          </Link>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground">{test.name}</h1>
                <AbStatusBadge status={test.status} />
              </div>
              <p className="text-sm text-muted-foreground/80">
                {MODE_LABELS[test.mode]} · {GOAL_LABELS[test.goal]}
                {test.startedAt && (
                  <>
                    {' '}· desde {formatDate(test.startedAt)} ({daysBetween(test.startedAt, test.endedAt)} dias)
                  </>
                )}
                {test.endedAt && <> · encerrado em {formatDate(test.endedAt)}</>}
              </p>
              {test.hypothesis && (
                <p className="max-w-3xl pt-1 text-sm text-foreground/90">
                  <span className="text-muted-foreground">Hipótese: </span>
                  {test.hypothesis}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={toggle}
                aria-label={isHidden ? 'Mostrar dados' : 'Ocultar dados'}
                aria-pressed={isHidden}
                className="px-3"
              >
                {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Editar
              </Button>
              {(test.status === 'draft' || test.status === 'paused') && (
                <Button size="sm" onClick={() => act('start')} disabled={busy}>
                  <Play className="mr-1.5 h-4 w-4" />
                  {test.status === 'draft' ? 'Iniciar teste' : 'Retomar'}
                </Button>
              )}
              {test.status === 'running' && (
                <Button variant="outline" size="sm" onClick={() => act('pause')} disabled={busy}>
                  <Pause className="mr-1.5 h-4 w-4" />
                  Pausar
                </Button>
              )}
              {(test.status === 'running' || test.status === 'paused') && (
                <Button variant="outline" size="sm" onClick={() => setFinishOpen(true)} disabled={busy}>
                  <Flag className="mr-1.5 h-4 w-4" />
                  Encerrar
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
                aria-label="Excluir teste"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <AbTestResults test={test} blurValues={isHidden} />
        {test.status !== 'finished' && <AbTestSetupGuide test={test} />}
      </div>

      <AbTestFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        test={test}
        saving={update.isPending}
        onSave={(input) => update.mutateAsync({ id: test.id, input })}
      />

      <AlertDialog open={finishOpen} onOpenChange={setFinishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar o teste</AlertDialogTitle>
            <AlertDialogDescription>
              Os visitantes deixam de ser sorteados em até 5 minutos. Vendas de quem já foi sorteado ainda contam por 7
              dias (boleto e pix aprovam depois). Depois, deixe no ar só a versão escolhida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>Vencedora</Label>
            <RadioGroup value={winner} onValueChange={setWinner} className="space-y-1">
              {test.variants.map((v) => (
                <label key={v.id} htmlFor={`win-${v.id}`} className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem id={`win-${v.id}`} value={v.id} />
                  <span className="font-medium text-foreground">{v.key}</span>
                  <span className="truncate text-muted-foreground">{v.name}</span>
                  {v.key === test.summary.leader && <span className="text-xs text-success">líder estatística</span>}
                </label>
              ))}
              <label htmlFor="win-none" className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem id="win-none" value={NO_WINNER} />
                <span className="text-muted-foreground">Sem vencedora</span>
              </label>
            </RadioGroup>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => act('finish', winner === NO_WINNER ? undefined : winner)}>
              Encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o teste</AlertDialogTitle>
            <AlertDialogDescription>
              Some o teste, as variantes e os sorteios. Visitas e vendas continuam no painel. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate(test.id, { onSuccess: () => navigate('/ab-tests') })}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
