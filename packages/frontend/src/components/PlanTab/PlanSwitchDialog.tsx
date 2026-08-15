import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type PlanChangePreview = {
  kind: 'upgrade' | 'downgrade' | 'same';
  currentPlan: string;
  targetPlan: string;
  chargeNowCents: number;
  nextChargeCents: number;
  effectiveDate: string;
  currency: string;
};

type Props = {
  planId: string;
  targetPlanName: string;
  buttonLabel: string;
  buttonDisabled?: boolean;
  onConfirm: () => void;
  confirmLabel: string;
};

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function PlanSwitchDialog({
  planId, targetPlanName, buttonLabel, buttonDisabled, onConfirm, confirmLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const preview = useMutation<PlanChangePreview, Error>({
    mutationFn: () => api.post<PlanChangePreview>('/stripe/preview-change', { planId }),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !preview.data && !preview.isPending) preview.mutate();
    if (!next) preview.reset();
  }

  const data = preview.data;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button className="w-full" disabled={buttonDisabled}>
          {buttonLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="capitalize">
            Trocar para o plano {targetPlanName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {data?.kind === 'downgrade' ? (
              <>A troca é agendada — você continua no plano atual até a data de renovação.</>
            ) : (
              <>A troca é imediata. Você paga a diferença do plano agora e mantém sua data de cobrança.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-lg border border-foreground/10 bg-card p-4 text-sm">
          {preview.isPending ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculando...
            </div>
          ) : preview.isError ? (
            <p className="text-destructive">Erro ao calcular: {preview.error.message}</p>
          ) : data && data.kind === 'upgrade' ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Diferença a pagar agora</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(data.chargeNowCents, data.currency)}
                </span>
              </div>
              <div className="h-px bg-foreground/10" />
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">
                  Próxima cobrança · {formatDate(data.effectiveDate)}
                </span>
                <span className="font-semibold text-foreground">
                  {formatCurrency(data.nextChargeCents, data.currency)}
                </span>
              </div>
            </div>
          ) : data && data.kind === 'downgrade' ? (
            <div className="space-y-2">
              <p className="text-foreground">
                Vai virar plano <span className="capitalize font-semibold">{data.targetPlan}</span>{' '}
                em {formatDate(data.effectiveDate)}.
              </p>
              <p className="text-muted-foreground">
                Sem cobrança extra agora. A próxima fatura sai por{' '}
                {formatCurrency(data.nextChargeCents, data.currency)}.
              </p>
            </div>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={preview.isPending || preview.isError}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
