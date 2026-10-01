import { useState } from 'react';
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { useStripePortal } from '@/hooks/useStripePortal';
import { useStripeReactivate } from '@/hooks/useStripeReactivate';
import { Button } from '@/components/ui/button';
import { CancelSubscriptionDialog } from '@/components/PlanTab/CancelSubscriptionDialog';
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
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const PLAN_BASE_PRICE: Record<string, string> = {
  free:       'Grátis',
  pro:        'R$ 59,90 / mês',
  starter:    'R$ 119,90 / mês',
  enterprise: 'R$ 199,90 / mês',
  unlimited:  'Sob consulta',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function StatusChip({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'danger' }) {
  const dot =
    tone === 'ok'
      ? 'bg-primary shadow-[0_0_8px_hsl(var(--primary))]'
      : tone === 'warn'
      ? 'bg-warning'
      : 'bg-destructive';
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label}</span>
    </span>
  );
}

export function CurrentPlanCard() {
  const { usage } = usePlanUsage();
  const portal = useStripePortal();
  const reactivate = useStripeReactivate();
  const [cancelOpen, setCancelOpen] = useState(false);

  const { data: rules = [] } = useQuery<Array<{ plan: string; overage_price_cents: number }>>({
    queryKey: ['plan-rules-list'],
    queryFn: () => api.get<Array<{ plan: string; overage_price_cents: number }>>('/plans/rules'),
    staleTime: 5 * 60 * 1000,
  });

  if (!usage) return null;

  const basePrice = PLAN_BASE_PRICE[usage.plan] ?? '—';
  const currentRule = rules.find((r) => r.plan === usage.plan);
  const overageText =
    currentRule && currentRule.overage_price_cents > 0
      ? `+ R$ ${(currentRule.overage_price_cents / 100).toFixed(2).replace('.', ',')} por venda extra`
      : null;
  const isPaid = !!usage.subscription.status;
  const isCanceling = usage.subscription.cancel_at_period_end;
  const cancelEndsOn = usage.subscription.next_billing_date
    ? formatDate(usage.subscription.next_billing_date)
    : '—';

  const statusTone: 'ok' | 'warn' | 'danger' = isCanceling
    ? 'warn'
    : usage.subscription.status === 'past_due'
    ? 'danger'
    : 'ok';
  const statusLabel = isCanceling
    ? 'Cancelamento agendado'
    : usage.subscription.status === 'past_due'
    ? 'Pagamento pendente'
    : isPaid
    ? 'Ativa'
    : 'Plano gratuito';

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-7">

      <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-readable">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Plano atual
          </span>
          <h3 className="mt-2 text-3xl font-semibold capitalize tracking-tight text-foreground">
            {usage.plan}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {basePrice}
            {overageText ? ` · ${overageText}` : ''}
          </p>
        </div>

        {usage.plan !== 'unlimited' && (
          <div className="flex flex-col items-stretch gap-2 md:items-end">
            {isCanceling ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    className="!bg-success !text-success-foreground hover:!bg-success/90"
                    disabled={reactivate.isPending}
                  >
                    {reactivate.isPending ? 'Reativando...' : 'Reativar assinatura'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reativar assinatura?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O cancelamento agendado para {cancelEndsOn} será descartado e a sua
                      assinatura continuará ativa normalmente, com renovação automática.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      className="!bg-success !text-success-foreground hover:!bg-success/90"
                      onClick={() => reactivate.mutate()}
                    >
                      Sim, reativar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : isPaid ? (
              <>
                <Button onClick={() => portal.mutate()} disabled={portal.isPending} variant="outline">
                  {portal.isPending ? 'Redirecionando...' : 'Gerenciar assinatura'}
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setCancelOpen(true)}
                >
                  Cancelar assinatura
                </Button>
              </>
            ) : null}
          </div>
        )}
      </div>

      {(isPaid || isCanceling || usage.subscription.scheduled_plan) && (
        <div className="relative mt-6 flex flex-wrap gap-x-10 gap-y-3 border-t border-foreground/10 pt-4 text-sm">
          {usage.subscription.next_billing_date && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
                {isCanceling ? 'Encerra em' : 'Próxima cobrança'}
              </div>
              <div className="mt-0.5 font-medium text-foreground">
                {formatDate(usage.subscription.next_billing_date)}
              </div>
            </div>
          )}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70">Status</div>
            <div className="mt-0.5 font-medium text-foreground">
              <StatusChip label={statusLabel} tone={statusTone} />
            </div>
          </div>
          {usage.subscription.scheduled_plan && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
                Próximo plano
              </div>
              <div className="mt-0.5 font-medium capitalize text-foreground">
                {usage.subscription.scheduled_plan.slug} em{' '}
                {formatDate(usage.subscription.scheduled_plan.changes_at)}
              </div>
            </div>
          )}
        </div>
      )}

      {usage.plan === 'unlimited' && (
        <p className="relative mt-5 text-sm text-muted-foreground">
          Plano Unlimited — gerenciado pelo suporte. Entre em contato para ajustes.
        </p>
      )}

      {usage.subscription.next_billing_date && (
        <CancelSubscriptionDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          endsAtIso={usage.subscription.next_billing_date}
          planName={usage.plan}
        />
      )}
    </div>
  );
}
