import { useState } from 'react';
import { CreditCard, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  PaymentMethod,
  useDetachPaymentMethod,
  usePaymentMethods,
  useSetDefaultPaymentMethod,
} from '@/hooks/useStripeBilling';
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { AddCardDialog } from '@/components/PlanTab/AddCardDialog';

const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  elo: 'Elo',
  hipercard: 'Hipercard',
  unknown: 'Cartão',
};

function formatBrand(brand: string): string {
  return BRAND_LABEL[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

function formatExpiry(month: number, year: number): string {
  if (!month || !year) return '—';
  return `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
}

export function PaymentMethodsCard() {
  const { usage } = usePlanUsage();
  const hasStripeCustomer = !!usage?.subscription.has_stripe_customer;

  const { data, isLoading } = usePaymentMethods();
  const [addOpen, setAddOpen] = useState(false);
  const setDefault = useSetDefaultPaymentMethod();
  const detach = useDetachPaymentMethod();

  if (!hasStripeCustomer) return null;

  const methods = data?.payment_methods ?? [];
  const mutating = setDefault.isPending || detach.isPending;

  return (
    <div className="rounded-2xl border border-foreground/10 bg-card p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Métodos de pagamento</h3>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            Cartões usados para cobrar a sua assinatura mensal.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setAddOpen(true)}
          className="shrink-0"
        >
          <Plus className="mr-2 h-4 w-4" />
          Adicionar cartão
        </Button>
      </div>

      <div className="mt-5 space-y-2.5">
        {isLoading ? (
          <PaymentMethodSkeleton />
        ) : methods.length === 0 ? (
          <EmptyState />
        ) : (
          methods.map((pm) => (
            <PaymentMethodRow
              key={pm.id}
              pm={pm}
              disabled={mutating}
              onSetDefault={() => setDefault.mutate(pm.id)}
              onRemove={() => detach.mutate(pm.id)}
            />
          ))
        )}
      </div>

      <AddCardDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function PaymentMethodRow({
  pm,
  disabled,
  onSetDefault,
  onRemove,
}: {
  pm: PaymentMethod;
  disabled: boolean;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/5 bg-muted px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-card">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {formatBrand(pm.brand)} •••• {pm.last4}
            </span>
            {pm.is_default && (
              <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-readable">
                Padrão
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground/70">Expira em {formatExpiry(pm.exp_month, pm.exp_year)}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!pm.is_default && (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onSetDefault}
          >
            Definir como padrão
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled || pm.is_default}
              title={pm.is_default ? 'Defina outro cartão como padrão antes de remover' : 'Remover cartão'}
            >
              <Trash2 className="h-4 w-4 text-muted-foreground/70" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover este cartão?</AlertDialogTitle>
              <AlertDialogDescription>
                {formatBrand(pm.brand)} •••• {pm.last4} será desvinculado da sua conta.
                Você pode adicionar outro cartão a qualquer momento.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onRemove}>Sim, remover</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function PaymentMethodSkeleton() {
  return (
    <>
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-foreground/10 bg-muted px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">Nenhum cartão cadastrado.</p>
      <p className="mt-0.5 text-xs text-muted-foreground/70">
        Adicione um cartão para garantir que sua assinatura não seja interrompida.
      </p>
    </div>
  );
}
