import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAdminPlans } from '@/hooks/useAdminPlans';
import { PlanRules } from '@/types/admin';

const PLAN_LABEL: Record<PlanRules['plan'], string> = {
  free: 'Free',
  pro: 'Pro',
  starter: 'Starter',
  enterprise: 'Enterprise',
  unlimited: 'Unlimited',
};

type LimitField = {
  key: keyof FormState;
  label: string;
  helper: string;
};

const LIMIT_FIELDS: LimitField[] = [
  {
    key: 'max_sales_monthly',
    label: 'Vendas aprovadas por ciclo',
    helper: 'Vendas aprovadas contabilizadas dentro do ciclo de faturamento.',
  },
  {
    key: 'max_active_ad_accounts',
    label: 'Ad accounts ativas',
    helper: 'Quantas contas de anúncio podem ficar conectadas ao mesmo tempo.',
  },
  {
    key: 'max_checkout_integrations',
    label: 'Integrações de checkout',
    helper: 'Plataformas de checkout que podem permanecer ativas simultaneamente.',
  },
  {
    key: 'max_workspaces',
    label: 'Workspaces',
    helper: 'Workspaces simultâneos disponíveis no plano.',
  },
  {
    key: 'max_active_rules',
    label: 'Regras automatizadas ativas',
    helper: 'Regras de automação que podem ficar ativas ao mesmo tempo.',
  },
];

type FormState = {
  max_sales_monthly: number;
  max_active_ad_accounts: number;
  max_checkout_integrations: number;
  max_workspaces: number;
  max_active_rules: number;
  overage_price_cents: number;
};

type Props = {
  open: boolean;
  rule: PlanRules | null;
  onClose: () => void;
};

function ruleToForm(rule: PlanRules): FormState {
  return {
    max_sales_monthly: rule.max_sales_monthly,
    max_active_ad_accounts: rule.max_active_ad_accounts,
    max_checkout_integrations: rule.max_checkout_integrations,
    max_workspaces: rule.max_workspaces,
    max_active_rules: rule.max_active_rules,
    overage_price_cents: rule.overage_price_cents,
  };
}

function diffKeys(a: FormState, b: FormState): Array<keyof FormState> {
  return (Object.keys(a) as Array<keyof FormState>).filter((key) => a[key] !== b[key]);
}

function formatLimit(value: number): string {
  if (value === -1) return 'Ilimitado';
  return value.toLocaleString('pt-BR');
}

function formatBRL(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export function EditPlanRulesDialog({ open, rule, onClose }: Props) {
  const { updatePlanRules, isUpdating } = useAdminPlans();
  const [form, setForm] = useState<FormState | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    if (open && rule) {
      setForm(ruleToForm(rule));
      return;
    }
    if (!open) {
      setForm(null);
      setShowCancelConfirm(false);
    }
  }, [open, rule]);

  const original = useMemo(() => (rule ? ruleToForm(rule) : null), [rule]);
  const changedKeys = useMemo(
    () => (form && original ? diffKeys(form, original) : []),
    [form, original],
  );
  const hasChanges = changedKeys.length > 0;

  if (!rule || !form || !original) {
    return (
      <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent />
      </Dialog>
    );
  }

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleLimitInput = (key: keyof FormState, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setField(key, 0 as FormState[typeof key]);
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed) || parsed < 0) return;
    setField(key, parsed as FormState[typeof key]);
  };

  const handleUnlimitedToggle = (key: keyof FormState, unlimited: boolean) => {
    setField(key, (unlimited ? -1 : 0) as FormState[typeof key]);
  };

  const handleOverageChange = (raw: string) => {
    const clean = raw.replace(/[^0-9,]/g, '').replace(',', '.');
    const cents = Math.round((parseFloat(clean) || 0) * 100);
    setField('overage_price_cents', cents);
  };

  const handleClose = () => {
    if (hasChanges) {
      setShowCancelConfirm(true);
      return;
    }
    onClose();
  };

  const handleSave = async () => {
    if (!hasChanges) return;
    const payload: Partial<FormState> = {};
    changedKeys.forEach((key) => {
      (payload as Record<string, number>)[key] = form[key];
    });
    try {
      await updatePlanRules(rule.plan, payload);
      toast.success(`Plano ${PLAN_LABEL[rule.plan]} atualizado`);
      onClose();
    } catch {
      toast.error('Erro ao salvar regras');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar plano {PLAN_LABEL[rule.plan]}</DialogTitle>
            <DialogDescription>
              Ajuste os limites do plano. Use a chave "Ilimitado" para liberar o uso sem teto.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {LIMIT_FIELDS.map(({ key, label, helper }) => {
              const current = form[key];
              const initial = original[key];
              const isUnlimited = current === -1;
              const changed = current !== initial;

              return (
                <div
                  key={key}
                  className={`rounded-lg border p-4 transition-colors ${
                    changed
                      ? 'border-warning/30 bg-warning/[0.03]'
                      : 'border-foreground/10 bg-foreground/[0.02]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <Label className="text-sm font-medium">{label}</Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">{helper}</p>
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <Label className="text-xs text-muted-foreground">Ilimitado</Label>
                      <Switch
                        checked={isUnlimited}
                        onCheckedChange={(checked) => handleUnlimitedToggle(key, checked)}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <Input
                      type="number"
                      min={0}
                      value={isUnlimited ? '' : current}
                      placeholder={isUnlimited ? 'Ilimitado' : '0'}
                      disabled={isUnlimited}
                      onChange={(e) => handleLimitInput(key, e.target.value)}
                      className="h-9"
                    />
                    {changed && (
                      <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-warning">
                        <span className="text-muted-foreground line-through">{formatLimit(initial)}</span>
                        <ArrowRight className="h-3 w-3" />
                        <span className="font-medium">{formatLimit(current)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <div
              className={`rounded-lg border p-4 transition-colors ${
                form.overage_price_cents !== original.overage_price_cents
                  ? 'border-warning/30 bg-warning/[0.03]'
                  : 'border-foreground/10 bg-foreground/[0.02]'
              }`}
            >
              <Label className="text-sm font-medium">Preço por venda extra</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Cobrado por venda excedente quando o limite mensal é ultrapassado.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    R$
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={(form.overage_price_cents / 100).toFixed(2).replace('.', ',')}
                    onChange={(e) => handleOverageChange(e.target.value)}
                    className="h-9 pl-9"
                  />
                </div>
                {form.overage_price_cents !== original.overage_price_cents && (
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-warning">
                    <span className="text-muted-foreground line-through">{formatBRL(original.overage_price_cents)}</span>
                    <ArrowRight className="h-3 w-3" />
                    <span className="font-medium">{formatBRL(form.overage_price_cents)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs">
              {hasChanges ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 font-medium text-warning">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                  {changedKeys.length}{' '}
                  {changedKeys.length === 1 ? 'alteração não salva' : 'alterações não salvas'}
                </span>
              ) : (
                <span className="text-muted-foreground">Sem alterações</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} disabled={isUpdating}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={!hasChanges || isUpdating}>
                {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar alterações
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem {changedKeys.length}{' '}
              {changedKeys.length === 1 ? 'alteração não salva' : 'alterações não salvas'} no
              plano {PLAN_LABEL[rule.plan]}. Se sair agora, elas serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-foreground hover:bg-destructive/90"
              onClick={() => {
                setShowCancelConfirm(false);
                onClose();
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
