import { useMemo, useState } from 'react';
import { Check, Infinity as InfinityIcon, Loader2, PencilLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EditPlanRulesDialog } from '@/components/admin/EditPlanRulesDialog';
import { useAdminPlans } from '@/hooks/useAdminPlans';
import { PlanRules } from '@/types/admin';

type PlanSlug = PlanRules['plan'];

type PlanDisplay = {
  name: string;
  tagline: string;
  priceLabel: string;
  badge?: { label: string; tone: 'highlight' | 'custom' };
};

const PLAN_DISPLAY: Record<PlanSlug, PlanDisplay> = {
  free:       { name: 'Free',       tagline: 'Para começar',            priceLabel: 'Grátis' },
  pro:        { name: 'Pro',        tagline: 'Operação em crescimento', priceLabel: 'R$ 59,90 / mês' },
  starter:    { name: 'Starter',    tagline: 'Times que escalam',       priceLabel: 'R$ 119,90 / mês', badge: { label: 'Mais popular', tone: 'highlight' } },
  enterprise: { name: 'Enterprise', tagline: 'Volume sem limite',       priceLabel: 'R$ 199,90 / mês' },
  unlimited:  { name: 'Unlimited',  tagline: 'Sob medida pelo suporte', priceLabel: 'Sob consulta',    badge: { label: 'Custom',       tone: 'custom' } },
};

const PLAN_ORDER: PlanSlug[] = ['free', 'pro', 'starter', 'enterprise', 'unlimited'];

function formatLimit(value: number): string {
  if (value === -1) return 'Ilimitado';
  return value.toLocaleString('pt-BR');
}

function formatOverage(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function buildFeatures(rule: PlanRules): Array<{ label: string; unlimited: boolean }> {
  return [
    {
      label: `${formatLimit(rule.max_sales_monthly)} vendas aprovadas/mês`,
      unlimited: rule.max_sales_monthly === -1,
    },
    {
      label: `${formatLimit(rule.max_active_ad_accounts)} ${
        rule.max_active_ad_accounts === 1 ? 'conta de anúncio ativa' : 'contas de anúncio ativas'
      }`,
      unlimited: rule.max_active_ad_accounts === -1,
    },
    {
      label: `${formatLimit(rule.max_checkout_integrations)} ${
        rule.max_checkout_integrations === 1 ? 'integração de checkout' : 'integrações de checkout'
      }`,
      unlimited: rule.max_checkout_integrations === -1,
    },
    {
      label: `${formatLimit(rule.max_workspaces)} ${
        rule.max_workspaces === 1 ? 'workspace' : 'workspaces'
      }`,
      unlimited: rule.max_workspaces === -1,
    },
    {
      label:
        rule.max_active_rules === 0
          ? 'Sem regras automatizadas ativas'
          : `${formatLimit(rule.max_active_rules)} ${
              rule.max_active_rules === 1
                ? 'regra automatizada ativa'
                : 'regras automatizadas ativas'
            }`,
      unlimited: rule.max_active_rules === -1,
    },
  ];
}

export default function AdminPlans() {
  const { planRules, isLoading } = useAdminPlans();
  const [editingPlan, setEditingPlan] = useState<PlanSlug | null>(null);

  const rulesBySlug = useMemo(() => {
    const map = new Map<PlanSlug, PlanRules>();
    (planRules ?? []).forEach((rule) => map.set(rule.plan, rule));
    return map;
  }, [planRules]);

  const editingRule = editingPlan ? rulesBySlug.get(editingPlan) ?? null : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-sentinel-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Regras dos Planos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visualize os planos da plataforma e ajuste limites e overage com revisão antes de salvar.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PLAN_ORDER.map((slug) => {
          const rule = rulesBySlug.get(slug);
          const display = PLAN_DISPLAY[slug];
          if (!rule) return null;

          const features = buildFeatures(rule);
          const borderClass = display.badge ? 'border-foreground/20' : 'border-foreground/10';

          return (
            <div
              key={slug}
              className={`group relative flex flex-col rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-foreground/30 ${borderClass}`}
            >
              {display.badge && (
                <Badge
                  className={`absolute -top-2.5 left-5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    display.badge.tone === 'highlight'
                      ? 'bg-foreground text-background'
                      : 'bg-amber-400 text-background'
                  }`}
                >
                  {display.badge.label}
                </Badge>
              )}

              <div>
                <h4 className="text-base font-semibold text-foreground">{display.name}</h4>
                <p className="mt-0.5 text-xs text-muted-foreground/70">{display.tagline}</p>
              </div>

              <div className="mt-5">
                <p className="text-3xl font-semibold tracking-tight text-foreground">
                  {display.priceLabel}
                </p>
                {rule.overage_price_cents > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    + {formatOverage(rule.overage_price_cents)} por venda extra
                  </p>
                ) : slug === 'free' ? (
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    Vendas excedentes não são processadas
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground/70">Sem cobrança de excedentes</p>
                )}
              </div>

              <div className="my-5 h-px bg-foreground/10" />

              <ul className="flex-1 space-y-2.5 text-[13px] text-muted-foreground">
                {features.map((feature) => (
                  <li key={feature.label} className="flex items-start gap-2.5">
                    {feature.unlimited ? (
                      <InfinityIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    )}
                    <span>{feature.label}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant="outline"
                size="sm"
                className="mt-6 w-full"
                onClick={() => setEditingPlan(slug)}
              >
                <PencilLine className="mr-2 h-3.5 w-3.5" />
                Editar regras
              </Button>
            </div>
          );
        })}
      </div>

      <EditPlanRulesDialog
        open={!!editingRule}
        rule={editingRule}
        onClose={() => setEditingPlan(null)}
      />
    </div>
  );
}
