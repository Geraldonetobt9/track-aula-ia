import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronDown, MousePointerClick, ShoppingBag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { CustomerJourney, JourneyCreative, JourneyTouch, JourneyTouchRole } from '@/hooks/useTracking';
import { brl } from './format';

const PAGE = 20;

const dayTime = (iso: string) => format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
const weekday = (iso: string) => format(new Date(iso), 'EEEE', { locale: ptBR });

const ROLE: Record<JourneyTouchRole, { label: string; className: string }> = {
  last_click: { label: 'Levou à compra', className: 'bg-primary text-primary-foreground hover:bg-primary' },
  assist: { label: 'Ajudou', className: 'bg-primary/15 text-accent-readable hover:bg-primary/15' },
  repeat: { label: 'Já tinha visto', className: 'bg-foreground/10 text-foreground hover:bg-foreground/10' },
  none: { label: 'Sem criativo', className: 'bg-foreground/5 text-muted-foreground hover:bg-foreground/5' },
};

const MATCH: Record<string, string> = {
  sck: 'indexador',
  order: 'indexador (mesmo pedido)',
  fbclid: 'clique do Facebook',
  utm_exact: 'UTMs (provável)',
};

function shortPath(url: string | null) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

function device(d: string | null) {
  return d === 'mobile' ? 'celular' : d === 'tablet' ? 'tablet' : d === 'desktop' ? 'computador' : null;
}

function timeToPurchase(hours: number | null) {
  if (hours == null) return null;
  if (hours < 1) return 'menos de 1 hora';
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} dias`;
}

function labelFor(key: string, journey: CustomerJourney, creatives: Map<string, JourneyCreative>) {
  return (
    creatives.get(key)?.name ??
    journey.touches.find((t) => t.creativeKey === key)?.creativeName ??
    key
  );
}

function TouchItem({
  touch,
  creative,
}: {
  touch: JourneyTouch;
  creative: JourneyCreative | undefined;
}) {
  const role = ROLE[touch.role];
  const dev = device(touch.deviceType);
  return (
    <li className="relative pb-4 last:pb-0">
      <span
        className={cn(
          'absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background',
          touch.role === 'last_click' ? 'bg-primary' : touch.role === 'none' ? 'bg-foreground/25' : 'bg-primary/50',
        )}
        aria-hidden
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm tabular-nums font-medium">{dayTime(touch.startedAt)}</span>
        <span className="text-xs text-muted-foreground capitalize">{weekday(touch.startedAt)}</span>
        <Badge className={cn('border-transparent text-[11px] font-medium', role.className)}>{role.label}</Badge>
      </div>
      <p className="mt-1 text-sm">
        {touch.creativeName ? (
          <>
            <span className="font-medium">{touch.creativeName}</span>
            {touch.campaignName && <span className="text-muted-foreground"> · {touch.campaignName}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">{touch.source}</span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {touch.creativeName && `${touch.source} · `}
        {shortPath(touch.landingPage)}
        {dev && ` · ${dev}`}
        {touch.hadCheckoutClick && (
          <span className="ml-1 inline-flex items-center gap-1 text-foreground">
            · <MousePointerClick className="h-3 w-3" /> clicou no checkout
          </span>
        )}
      </p>
      {creative && (
        <p className="mt-1 text-xs text-muted-foreground">
          Este criativo no período: vendeu{' '}
          <span className="text-foreground tabular-nums">
            {creative.lastClickSales} ({brl(creative.lastClickRevenue)})
          </span>{' '}
          por last click e ajudou em{' '}
          <span className="text-foreground tabular-nums">
            {creative.assistedSales} ({brl(creative.assistedRevenue)})
          </span>{' '}
          vendas de outros criativos.
        </p>
      )}
    </li>
  );
}

function JourneyRow({
  journey,
  creatives,
}: {
  journey: CustomerJourney;
  creatives: Map<string, JourneyCreative>;
}) {
  const [open, setOpen] = useState(false);
  const bought = journey.lastClickCreative ? creatives.get(journey.lastClickCreative) : undefined;
  const boughtName = journey.lastClickCreative ? labelFor(journey.lastClickCreative, journey, creatives) : null;
  const ttp = timeToPurchase(journey.hoursToPurchase);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-foreground/10">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{journey.customerName || 'Comprador sem nome'}</span>
              <span className="text-xs text-muted-foreground">comprou em {dayTime(journey.soldAt)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {journey.productName ?? 'Produto'}
              {journey.items > 1 && ` + ${journey.items - 1} item(ns)`}
              {' · '}
              {journey.touches.length} {journey.touches.length === 1 ? 'acesso' : 'acessos'}
              {ttp && ` · ${ttp} do primeiro acesso à compra`}
              {journey.customerEmail && ` · ${journey.customerEmail}`}
            </p>
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              {journey.creatives.length === 0 ? (
                <span className="text-xs text-muted-foreground">Nenhum criativo identificado</span>
              ) : (
                journey.creatives.map((key, i) => (
                  <span key={key} className="flex items-center gap-1">
                    {i > 0 && <span className="text-xs text-muted-foreground/60">→</span>}
                    <span
                      className={cn(
                        'max-w-[220px] truncate rounded-md px-1.5 py-0.5 text-[11px]',
                        key === journey.lastClickCreative
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-primary/15 text-accent-readable',
                      )}
                      title={labelFor(key, journey, creatives)}
                    >
                      {labelFor(key, journey, creatives)}
                    </span>
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-medium tabular-nums">{brl(journey.amount)}</p>
            {boughtName && <p className="max-w-[160px] truncate text-xs text-muted-foreground">via {boughtName}</p>}
          </div>
          <ChevronDown
            className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-foreground/10 px-4 py-4">
          <ol className="relative ml-1 border-l border-foreground/10 pl-4">
            {journey.touches.map((t) => (
              <TouchItem
                key={t.sessionId}
                touch={t}
                creative={t.creativeKey ? creatives.get(t.creativeKey) : undefined}
              />
            ))}
            <li className="relative">
              <span className="absolute -left-[23px] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary" aria-hidden>
                <ShoppingBag className="h-2 w-2 text-primary-foreground" />
              </span>
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="text-sm font-medium tabular-nums">{dayTime(journey.soldAt)}</span>
                <span className="text-xs capitalize text-muted-foreground">{weekday(journey.soldAt)}</span>
              </div>
              <p className="mt-1 text-sm">
                Comprou <span className="font-medium tabular-nums">{brl(journey.amount)}</span>
                {boughtName && (
                  <span className="text-muted-foreground"> — venda creditada a {bought?.name ?? boughtName} (last click)</span>
                )}
              </p>
              {journey.bumps.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Order bump à parte:{' '}
                  {journey.bumps
                    .map((b) => `${b.productName ?? 'item'} ${brl(b.amount)}`)
                    .join(', ')}
                  . Não entra no valor creditado.
                </p>
              )}
              {journey.matchMethod && (
                <p className="text-xs text-muted-foreground">
                  Pessoa identificada por: {MATCH[journey.matchMethod] ?? journey.matchMethod}
                </p>
              )}
            </li>
          </ol>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function JourneyList({
  journeys,
  creatives,
  loading,
}: {
  journeys: CustomerJourney[];
  creatives: Map<string, JourneyCreative>;
  loading: boolean;
}) {
  const [shown, setShown] = useState(PAGE);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full bg-foreground/5" />
        ))}
      </div>
    );
  }

  if (journeys.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground/70">Nenhuma jornada no período.</p>;
  }

  return (
    <div className="space-y-2">
      {journeys.slice(0, shown).map((j) => (
        <JourneyRow key={j.orderKey} journey={j} creatives={creatives} />
      ))}
      {journeys.length > shown && (
        <div className="pt-2 text-center">
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            Mostrar mais ({journeys.length - shown} restantes)
          </Button>
        </div>
      )}
    </div>
  );
}
