import { useEffect, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Loader2 } from 'lucide-react';
import { getStripePromise } from '@/lib/stripe';
import { useStripeSetupIntent } from '@/hooks/useStripeSetupIntent';
import { useAttachPaymentMethod } from '@/hooks/useAttachPaymentMethod';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSuccess?: () => void;
};

export function AddCardDialog({ open, onOpenChange, onSuccess }: Props) {
  const setupIntent = useStripeSetupIntent();
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  useEffect(() => {
    if (open && !clientSecret && !setupIntent.isPending) {
      setupIntent
        .mutateAsync()
        .then((data) => setClientSecret(data.clientSecret))
        .catch(() => {});
    }
    if (!open) {
      setClientSecret(null);
      setupIntent.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar cartão</DialogTitle>
          <DialogDescription>
            Os dados do seu cartão são processados diretamente pela Stripe.
            Não armazenamos dados do cartão.
          </DialogDescription>
        </DialogHeader>

        {!clientSecret ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Preparando formulário...
          </div>
        ) : (
          <Elements
            stripe={getStripePromise()}
            options={{
              clientSecret,
              appearance: { theme: 'night' },
              locale: 'pt-BR',
            }}
          >
            <CardForm
              onSuccess={() => {
                onSuccess?.();
                onOpenChange(false);
              }}
            />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const attach = useAttachPaymentMethod();
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!stripe || !elements) return;
    setError(null);
    setSubmitting(true);

    const submitResult = await elements.submit();
    if (submitResult.error) {
      setError(submitResult.error.message ?? 'Erro ao validar cartão');
      setSubmitting(false);
      return;
    }

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message ?? 'Erro ao confirmar cartão');
      setSubmitting(false);
      return;
    }

    const paymentMethodId =
      typeof setupIntent?.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id ?? null;

    if (!paymentMethodId) {
      setError('Stripe não retornou método de pagamento');
      setSubmitting(false);
      return;
    }

    try {
      await attach.mutateAsync({ paymentMethodId, setAsDefault });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar cartão');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement options={{ terms: { card: 'never' } }} />
      <p className="text-xs text-muted-foreground/70">
        Pagamentos processados com segurança por Stripe.
      </p>
      <label className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-muted px-4 py-3 text-sm text-foreground cursor-pointer">
        <span>Definir como cartão padrão</span>
        <Switch
          checked={setAsDefault}
          onCheckedChange={(c) => setSetAsDefault(c === true)}
          className="data-[state=unchecked]:bg-foreground/25"
        />
      </label>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={submitting || !stripe || !elements}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            'Salvar cartão'
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}
