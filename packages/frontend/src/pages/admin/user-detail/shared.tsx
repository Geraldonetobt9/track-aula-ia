import { useState, type ComponentType } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useCheckoutCredentials } from '@/hooks/useCheckoutCredentials';
import type {
  AdminUserDetail,
  AdminUserDetailCheckout,
  AdminUserDetailRule,
  AdminUserDetailSubscription,
} from '@/types/admin';

// -------------------------------------------------------------------------------------------------
// Plan limits (espelham supabase/migrations/20260417100007_seed_plan_rules_values.sql).
// -1 = ilimitado. Endpoint admin com uso real virá em iteração futura — para o protótipo de layout
// usamos os contadores que já vêm no payload de admin_user_detail.
// -------------------------------------------------------------------------------------------------
export type PlanSlug = 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited';

export interface PlanLimits {
  max_sales_monthly: number;
  max_active_ad_accounts: number;
  max_checkout_integrations: number;
  max_workspaces: number;
  max_active_rules: number;
}

export const PLAN_LIMITS: Record<PlanSlug, PlanLimits> = {
  free:       { max_sales_monthly: 30,   max_active_ad_accounts: 1,  max_checkout_integrations: 1,  max_workspaces: 1,  max_active_rules: 0 },
  pro:        { max_sales_monthly: 1000, max_active_ad_accounts: 3,  max_checkout_integrations: 3,  max_workspaces: 3,  max_active_rules: 3 },
  starter:    { max_sales_monthly: 2500, max_active_ad_accounts: 7,  max_checkout_integrations: 7,  max_workspaces: 7,  max_active_rules: 7 },
  enterprise: { max_sales_monthly: 5000, max_active_ad_accounts: -1, max_checkout_integrations: -1, max_workspaces: -1, max_active_rules: -1 },
  unlimited:  { max_sales_monthly: -1,   max_active_ad_accounts: -1, max_checkout_integrations: -1, max_workspaces: -1, max_active_rules: -1 },
};

export const PLAN_LABEL: Record<PlanSlug, string> = {
  free: 'Free',
  pro: 'Pro',
  starter: 'Starter',
  enterprise: 'Enterprise',
  unlimited: 'Unlimited',
};

export interface UsageItem {
  key: string;
  label: string;
  used: number;
  limit: number; // -1 = ilimitado
  hint?: string;
}

export function buildUsageItems(detail: AdminUserDetail): UsageItem[] {
  const plan = (detail.profile.plan ?? 'free') as PlanSlug;
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const activeFb = detail.facebook.connections.filter((c) => c.is_active).length;
  const activeCheckouts = detail.checkouts.filter((c) => c.is_active).length;
  const activeRules = detail.automation_rules.filter((r) => r.is_active).length;

  return [
    {
      key: 'sales',
      label: 'Vendas aprovadas',
      used: detail.health.sales_count,
      limit: limits.max_sales_monthly,
      hint: 'total acumulado',
    },
    {
      key: 'fb',
      label: 'Contas de anúncio ativas',
      used: activeFb,
      limit: limits.max_active_ad_accounts,
    },
    {
      key: 'checkouts',
      label: 'Checkouts ativos',
      used: activeCheckouts,
      limit: limits.max_checkout_integrations,
    },
    {
      key: 'rules',
      label: 'Regras de automação ativas',
      used: activeRules,
      limit: limits.max_active_rules,
    },
  ];
}

// -------------------------------------------------------------------------------------------------
// Formatadores
// -------------------------------------------------------------------------------------------------
export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export const formatNumber = (value: number) => value.toLocaleString('pt-BR');

// Aplica máscara em CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00) com base
// na quantidade de dígitos. Strings com tamanho fora do esperado retornam o
// valor original — preferível a quebrar o documento em telas de Suporte.
export function formatTaxId(value: string | null | undefined): {
  label: 'CPF' | 'CNPJ' | 'Documento';
  formatted: string;
} | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) {
    return {
      label: 'CPF',
      formatted: digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'),
    };
  }
  if (digits.length === 14) {
    return {
      label: 'CNPJ',
      formatted: digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
    };
  }
  return { label: 'Documento', formatted: value };
}

export const formatDateBR = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : '—';

export const formatShortDate = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), 'dd/MM/yyyy') : '—';

export const formatRelative = (iso: string | null | undefined) =>
  iso ? formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR }) : null;

// Linguagem humana para account_status do Facebook.
const FB_ACCOUNT_STATUS_HUMAN: Record<number, { label: string; tone: Tone }> = {
  1:   { label: 'Ativa',                 tone: 'success' },
  2:   { label: 'Desativada',            tone: 'danger' },
  3:   { label: 'Não liquidada',         tone: 'warning' },
  7:   { label: 'Em revisão',            tone: 'warning' },
  8:   { label: 'Pendente liquidação',   tone: 'warning' },
  9:   { label: 'Período de tolerância', tone: 'warning' },
  100: { label: 'Pendente encerramento', tone: 'warning' },
  101: { label: 'Encerrada',             tone: 'danger' },
};

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export function fbAccountStatusHuman(status: number | null | undefined): { label: string; tone: Tone } {
  if (status == null) return { label: 'Sem informação', tone: 'neutral' };
  return FB_ACCOUNT_STATUS_HUMAN[status] ?? { label: `Status ${status}`, tone: 'neutral' };
}

export const SUBSCRIPTION_STATUS_HUMAN: Record<
  AdminUserDetailSubscription['status'],
  { label: string; tone: Tone }
> = {
  active:    { label: 'Ativa',              tone: 'success' },
  trialing:  { label: 'Em teste grátis',    tone: 'info' },
  past_due:  { label: 'Pagamento atrasado', tone: 'danger' },
  canceled:  { label: 'Cancelada',          tone: 'danger' },
  paused:    { label: 'Pausada',            tone: 'warning' },
};

const RULE_ACTION_LABEL: Record<string, string> = {
  activate: 'Ativar',
  pause: 'Pausar',
  increase_budget: 'Aumentar budget',
  decrease_budget: 'Diminuir budget',
};

const RULE_PERIOD_LABEL: Record<string, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  custom: 'Período customizado',
};

const RULE_TARGET_LABEL: Record<string, string> = {
  campaign: 'Campanha',
  adset: 'Conjunto',
  ad: 'Anúncio',
};

export function ruleActionLabel(action: string) {
  return RULE_ACTION_LABEL[action] ?? action;
}

export function rulePeriodLabel(period: string) {
  return RULE_PERIOD_LABEL[period] ?? period;
}

export function ruleTargetLabel(entity: string) {
  return RULE_TARGET_LABEL[entity] ?? entity;
}

export const PLATFORM_LABEL: Record<string, string> = {
  hotmart: 'Hotmart',
  kiwify: 'Kiwify',
  kirvano: 'Kirvano',
  guru: 'Guru',
  perfectpay: 'Perfect Pay',
  ticto: 'Ticto',
  payt: 'PayT',
  cakto: 'Cakto',
  hubla: 'Hubla',
  cartpanda: 'CartPanda',
  ggcheckout: 'GG Checkout',
  lastlink: 'LastLink',
  eduzz: 'Eduzz',
  mundpay: 'Mundpay',
  monetizze: 'Monetizze',
  greenn: 'Greenn',
};

// Mantido em paralelo com src/components/integrations/CheckoutIntegrationsSection.tsx
export const PLATFORM_LOGO: Record<string, { src: string; alt: string }> = {
  hotmart:    { src: '/hotmart-logo.png',    alt: 'Hotmart' },
  kiwify:     { src: '/kiwify-logo.jpg',     alt: 'Kiwify' },
  kirvano:    { src: '/kirvano-logo.png',    alt: 'Kirvano' },
  guru:       { src: '/guru-logo.jpg',       alt: 'Guru Digital' },
  perfectpay: { src: '/perfectpay-logo.png', alt: 'Perfect Pay' },
  ticto:      { src: '/ticto-logo.png',      alt: 'Ticto' },
  payt:       { src: '/payt-logo.png',       alt: 'PayT' },
  cakto:      { src: '/cakto-logo.jpg',      alt: 'Cakto' },
  hubla:      { src: '/hubla-logo.svg',      alt: 'Hubla' },
  cartpanda:  { src: '/cartpanda-logo.avif', alt: 'CartPanda' },
  ggcheckout: { src: '/ggcheckout-logo.png', alt: 'GG Checkout' },
  lastlink:   { src: '/lastlink-logo.ico',   alt: 'LastLink' },
  eduzz:      { src: '/eduzz-logo.png',      alt: 'Eduzz' },
  mundpay:    { src: '/mundpay-logo.svg',    alt: 'Mundpay' },
  monetizze:  { src: '/monetizze-logo.svg',  alt: 'Monetizze' },
  greenn:     { src: '/greenn-logo.webp',    alt: 'Greenn' },
};

export function platformLogo(p: string) {
  return PLATFORM_LOGO[p.toLowerCase()] ?? null;
}

export function platformLabel(p: string) {
  return PLATFORM_LABEL[p.toLowerCase()] ?? p;
}

// -------------------------------------------------------------------------------------------------
// Componentes utilitários compartilhados pelas 3 variantes.
// -------------------------------------------------------------------------------------------------

export function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const styles: Record<Tone, string> = {
    success: 'bg-success/10 text-success border-success/20',
    info:    'bg-sky-500/10 text-sky-300 border-sky-500/20',
    warning: 'bg-warning/10 text-amber-300 border-warning/20',
    danger:  'bg-destructive/10 text-destructive border-destructive/20',
    neutral: 'bg-foreground/5 text-muted-foreground border-foreground/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>
      {children}
    </span>
  );
}

export function UsageBar({ item }: { item: UsageItem }) {
  const isUnlimited = item.limit === -1;
  const pct = isUnlimited ? 0 : item.limit === 0 ? 0 : Math.min(100, (item.used / item.limit) * 100);
  const tone: Tone = isUnlimited
    ? 'info'
    : pct >= 100
      ? 'danger'
      : pct >= 80
        ? 'warning'
        : 'success';
  const barColor: Record<Tone, string> = {
    success: '[&>div]:bg-success',
    info:    '[&>div]:bg-sky-500',
    warning: '[&>div]:bg-warning',
    danger:  '[&>div]:bg-destructive',
    neutral: '[&>div]:bg-foreground/30',
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{item.label}</span>
        <span className="text-foreground tabular-nums">
          {formatNumber(item.used)}
          {isUnlimited ? (
            <span className="text-muted-foreground/70"> de ilimitado</span>
          ) : (
            <span className="text-muted-foreground/70"> de {formatNumber(item.limit)}</span>
          )}
        </span>
      </div>
      <Progress value={pct} className={`h-2 bg-foreground/5 ${barColor[tone]}`} />
      {item.hint && <p className="text-[11px] text-muted-foreground/60">{item.hint}</p>}
    </div>
  );
}

export function FactRow({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3 text-sm">
      <span className="text-muted-foreground/70">{label}</span>
      <div className="text-foreground">
        <div className={mono ? 'font-mono text-xs break-all' : ''}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground/60 mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({
  icon: Icon,
  title,
  description,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <div className="rounded-lg bg-foreground/5 p-2 mt-0.5">
          <Icon className="h-4 w-4 text-accent-readable" />
        </div>
      )}
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground/70 mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------
// Card de credenciais com toggle (compartilhado pelas 3 variantes).
// -------------------------------------------------------------------------------------------------

export function CheckoutCredentialsBlock({
  userId,
  checkout,
}: {
  userId: string;
  checkout: AdminUserDetailCheckout;
}) {
  const [revealed, setRevealed] = useState(false);
  const credentials = useCheckoutCredentials(userId, checkout.id);

  const handleToggle = async () => {
    if (!revealed) {
      await credentials.refetch();
      setRevealed(true);
    } else {
      setRevealed(false);
    }
  };

  const value = (real?: string | null, masked?: string | null, has?: boolean) => {
    if (!has) return 'não cadastrado';
    if (revealed && real) return real;
    return masked ?? '—';
  };

  const hasAnySecret = checkout.has_webhook_secret || checkout.has_api_token;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/60">Credenciais</span>
        {hasAnySecret && (
          <Button size="sm" variant="outline" onClick={handleToggle} disabled={credentials.isFetching}>
            {credentials.isFetching ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : revealed ? (
              <EyeOff className="mr-1.5 h-3 w-3" />
            ) : (
              <Eye className="mr-1.5 h-3 w-3" />
            )}
            {revealed ? 'Ocultar' : 'Conferir'}
          </Button>
        )}
      </div>

      <div className="space-y-2 text-xs">
        <CredField label="URL do webhook" value={value(credentials.data?.webhook_url, checkout.webhook_url, true)} mono />
        <CredField
          label="Senha do webhook"
          value={value(credentials.data?.webhook_secret, checkout.webhook_secret_masked, checkout.has_webhook_secret)}
          mono={checkout.has_webhook_secret}
        />
        <CredField
          label="Token de API"
          value={value(credentials.data?.api_token, checkout.api_token_masked, checkout.has_api_token)}
          mono={checkout.has_api_token}
        />
      </div>

      {credentials.error && (
        <p className="text-destructive text-xs">
          Não foi possível carregar as credenciais: {(credentials.error as Error).message}
        </p>
      )}
    </div>
  );
}

function CredField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-[11px] text-muted-foreground/60">{label}</span>
      <code className={`mt-0.5 block break-all rounded bg-foreground/[0.03] px-2 py-1.5 ${mono ? 'font-mono' : ''}`}>
        {value}
      </code>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------
// Bloco humano para uma regra de automação — usado pelas 3 variantes.
// -------------------------------------------------------------------------------------------------

export function AutomationRuleSummary({ rule }: { rule: AdminUserDetailRule }) {
  const last = rule.last_execution;
  const lastTone: Tone = !last ? 'neutral' : last.status === 'success' ? 'success' : 'danger';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{rule.name}</span>
        <ToneBadge tone={rule.is_active ? 'success' : 'neutral'}>
          {rule.is_active ? 'Ativa' : 'Inativa'}
        </ToneBadge>
        <span className="text-xs text-muted-foreground/70">área {rule.workspace_name}</span>
      </div>

      <p className="text-sm text-muted-foreground">
        <span className="text-foreground">{ruleActionLabel(rule.action_type)}</span>{' '}
        <span>{ruleTargetLabel(rule.target_entity).toLowerCase()}s {rule.target_status}</span>{' '}
        com base em {rule.conditions_count} condição{rule.conditions_count === 1 ? '' : 'ões'}, avaliando{' '}
        {rulePeriodLabel(rule.evaluation_period).toLowerCase()} a cada {rule.frequency_minutes} min.
      </p>

      <div className="flex items-center gap-2 text-xs">
        <ToneBadge tone={lastTone}>
          {!last ? 'Nunca executou' : last.status === 'success' ? 'Última execução: sucesso' : 'Última execução: erro'}
        </ToneBadge>
        {last && (
          <span className="text-muted-foreground/70">
            {formatRelative(last.executed_at)} · {last.action_taken}
            {last.entity_name ? ` em "${last.entity_name}"` : ''}
          </span>
        )}
      </div>

      {last?.error_message && (
        <p className="text-xs text-destructive break-words">Erro: {last.error_message}</p>
      )}
    </div>
  );
}
