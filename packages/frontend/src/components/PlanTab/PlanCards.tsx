import { useQuery } from '@tanstack/react-query';
import { Check, Infinity as InfinityIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useStripeCheckout } from '@/hooks/useStripeCheckout';
import { useStripePortal } from '@/hooks/useStripePortal';
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlanSwitchDialog } from '@/components/PlanTab/PlanSwitchDialog';

type PlanRule = {
  id: string;
  plan: string;
  max_sales_monthly: number;
  max_active_ad_accounts: number;
  max_checkout_integrations: number;
  max_workspaces: number;
  max_active_rules: number;
  overage_price_cents: number;
  stripe_price_id_base: string | null;
};

type PlanSlug = 'free' | 'starter' | 'pro' | 'enterprise';

type PlanDisplay = {
  slug: PlanSlug;
  name: string;
  tagline: string;
  priceCents: number | null;
  highlighted?: boolean;
};

const PLAN_DISPLAY: Record<PlanSlug, PlanDisplay> = {
  free:       { slug: 'free',       name: 'Free',       tagline: 'Para começar',            priceCents: 0 },
  pro:        { slug: 'pro',        name: 'Pro',        tagline: 'Operação em crescimento', priceCents: 5990 },
  starter:    { slug: 'starter',    name: 'Starter',    tagline: 'Times que escalam',       priceCents: 11990, highlighted: true },
  enterprise: { slug: 'enterprise', name: 'Enterprise', tagline: 'Volume sem limite',       priceCents: 19990 },
};

const PLAN_ORDER: PlanSlug[] = ['free', 'pro', 'starter', 'enterprise'];

const PLAN_RANK: Record<PlanSlug, number> = { free: 0, pro: 1, starter: 2, enterprise: 3 };

function formatBRL(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function formatLimit(value: number): string {
  if (value === -1) return 'Ilimitado';
  return value.toLocaleString('pt-BR');
}

function formatOverage(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function buildFeatures(rule: PlanRule): Array<{ label: string; unlimited: boolean }> {
  return [
    { label: `${formatLimit(rule.max_sales_monthly)} vendas aprovadas/mês`, unlimited: rule.max_sales_monthly === -1 },
    { label: `${formatLimit(rule.max_active_ad_accounts)} ${rule.max_active_ad_accounts === 1 ? 'conta de anúncio ativa' : 'contas de anúncio ativas'}`, unlimited: rule.max_active_ad_accounts === -1 },
    { label: `${formatLimit(rule.max_checkout_integrations)} ${rule.max_checkout_integrations === 1 ? 'integração de checkout' : 'integrações de checkout'}`, unlimited: rule.max_checkout_integrations === -1 },
    { label: `${formatLimit(rule.max_workspaces)} ${rule.max_workspaces === 1 ? 'workspace' : 'workspaces'}`, unlimited: rule.max_workspaces === -1 },
    { label: rule.max_active_rules === 0 ? 'Sem regras automatizadas ativas' : `${formatLimit(rule.max_active_rules)} ${rule.max_active_rules === 1 ? 'regra automatizada ativa' : 'regras automatizadas ativas'}`, unlimited: rule.max_active_rules === -1 },
  ];
}

export function PlanCards() {
  const { usage } = usePlanUsage();
  const checkout = useStripeCheckout();
  const portal = useStripePortal();

  const { data: rules = [], isLoading } = useQuery<PlanRule[]>({
    queryKey: ['plan-rules-list'],
    queryFn: () => api.get<PlanRule[]>('/plans/rules'),
    staleTime: 5 * 60 * 1000,
  });

  const currentSlug = (usage?.plan as PlanSlug | undefined) ?? 'free';
  const hasPaidSubscription = !!usage?.subscription.status;
  const scheduledSlug = usage?.subscription.scheduled_plan?.slug as PlanSlug | undefined;
  const anyPending = checkout.isPending || portal.isPending;

  const rulesBySlug = new Map(rules.map((r) => [r.plan as PlanSlug, r]));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Trocar de plano</h3>
        <p className="mt-1 text-sm text-muted-foreground/70">
          Escolha o plano que melhor atende seu volume de vendas.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_ORDER.map((slug) => {
          const rule = rulesBySlug.get(slug);
          const display = PLAN_DISPLAY[slug];
          const isCurrent = slug === currentSlug;
          const isScheduled = scheduledSlug === slug;
          const features = rule ? buildFeatures(rule) : [];

          const borderClass = isCurrent
            ? 'border-primary/60'
            : display.highlighted
            ? 'border-foreground/20'
            : 'border-foreground/10';

          return (
            <div
              key={slug}
              className={`group relative flex flex-col rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-foreground/20 ${borderClass}`}
            >
              {isCurrent ? (
                <Badge className="absolute -top-2.5 left-5 bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                  Plano atual
                </Badge>
              ) : display.highlighted ? (
                <Badge className="absolute -top-2.5 left-5 bg-foreground px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
                  Mais popular
                </Badge>
              ) : null}

              <div>
                <h4 className="text-base font-semibold text-foreground">{display.name}</h4>
                <p className="mt-0.5 text-xs text-muted-foreground/70">{display.tagline}</p>
              </div>

              <div className="mt-5">
                {display.priceCents === 0 ? (
                  <p className="text-3xl font-semibold tracking-tight text-foreground">Grátis</p>
                ) : display.priceCents !== null ? (
                  <p className="text-3xl font-semibold tracking-tight text-foreground">
                    R$ {formatBRL(display.priceCents)}
                    <span className="ml-1 text-sm font-normal text-muted-foreground/70">/mês</span>
                  </p>
                ) : (
                  <p className="text-3xl font-semibold tracking-tight text-foreground">Sob consulta</p>
                )}
                {rule && rule.overage_price_cents > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    + {formatOverage(rule.overage_price_cents)} por venda extra
                  </p>
                ) : slug === 'free' ? (
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    Vendas excedentes não são processadas
                  </p>
                ) : null}
              </div>

              <div className="my-5 h-px bg-foreground/10" />

              <ul className="flex-1 space-y-2.5 text-[13px] text-muted-foreground">
                {features.map((f) => (
                  <li key={f.label} className="flex items-start gap-2.5">
                    {f.unlimited ? (
                      <InfinityIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    )}
                    <span>{f.label}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {renderAction({
                  slug,
                  rule,
                  isCurrent,
                  isScheduled,
                  currentSlug,
                  hasPaidSubscription,
                  anyPending,
                  onCheckout: (planId) => checkout.mutate(planId),
                  onPortal: () => portal.mutate(),
                  isLoadingRules: isLoading,
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ActionArgs = {
  slug: PlanSlug;
  rule: PlanRule | undefined;
  isCurrent: boolean;
  isScheduled: boolean;
  currentSlug: PlanSlug;
  hasPaidSubscription: boolean;
  anyPending: boolean;
  onCheckout: (planId: string) => void;
  onPortal: () => void;
  isLoadingRules: boolean;
};

function renderAction(args: ActionArgs) {
  const {
    slug, rule, isCurrent, isScheduled, currentSlug,
    hasPaidSubscription, anyPending, onCheckout, onPortal, isLoadingRules,
  } = args;

  if (isCurrent) {
    return (
      <Button variant="outline" className="w-full" disabled>
        Plano atual
      </Button>
    );
  }

  if (isScheduled) {
    return (
      <Button variant="outline" className="w-full" disabled>
        Alteração agendada
      </Button>
    );
  }

  if (slug === 'free') {
    return (
      <Button variant="outline" className="w-full" disabled>
        Plano base
      </Button>
    );
  }

  if (!rule || !rule.stripe_price_id_base) {
    return (
      <Button className="w-full" disabled>
        {isLoadingRules ? 'Carregando...' : 'Indisponível'}
      </Button>
    );
  }

  const isUpgrade = PLAN_RANK[slug] > PLAN_RANK[currentSlug];

  if (hasPaidSubscription) {
    return (
      <PlanSwitchDialog
        planId={rule.id}
        targetPlanName={rule.plan}
        buttonLabel={anyPending ? 'Processando...' : 'Trocar plano'}
        buttonDisabled={anyPending}
        confirmLabel={anyPending ? 'Trocando...' : 'Confirmar troca'}
        onConfirm={() => onCheckout(rule.id)}
      />
    );
  }

  return (
    <Button
      className="w-full"
      disabled={anyPending}
      onClick={() => onCheckout(rule.id)}
    >
      {anyPending ? 'Redirecionando...' : isUpgrade ? 'Fazer upgrade' : 'Assinar'}
    </Button>
  );
}
