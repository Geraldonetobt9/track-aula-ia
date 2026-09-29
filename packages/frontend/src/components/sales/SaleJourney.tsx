import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Footprints } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDuration, useSaleJourney } from '@/hooks/useTracking';

const MATCH_LABEL: Record<string, string> = {
  sck: 'vínculo exato pelo código da visita no link do checkout',
  order: 'mesmo pedido de outra linha já vinculada',
  fbclid: 'vínculo pelo clique do Facebook',
  utm_exact: 'vínculo provável: única visita com as mesmas UTMs que clicou no checkout antes da compra',
};

const time = (iso: string) => format(new Date(iso), 'HH:mm', { locale: ptBR });
const dayTime = (iso: string) => format(new Date(iso), "dd/MM 'às' HH:mm", { locale: ptBR });

function sourceLabel(s: { utm_source: string | null; referrer: string | null }) {
  const src = s.utm_source?.toLowerCase() ?? '';
  if (/^(fb|facebook|ig|instagram|meta)/.test(src)) return 'Facebook Ads';
  if (/^(google|gads|adwords)/.test(src)) return 'Google Ads';
  if (s.utm_source) return s.utm_source;
  if (s.referrer) {
    try {
      return new URL(s.referrer).hostname.replace(/^www\./, '');
    } catch {
      /* referrer ruim: cai no acesso direto */
    }
  }
  return 'acesso direto';
}

function path(url: string | null) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

/** A visita que levou à venda, em frases: chegou, ficou, clicou, comprou. */
export function SaleJourney({ saleId }: { saleId: string }) {
  const { journey, loading } = useSaleJourney(saleId);

  if (loading) return <Skeleton className="h-32 w-full bg-foreground/5" />;
  // Sem vínculo (ou rota indisponível): a seção simplesmente não aparece.
  if (!journey || !journey.matched) return null;

  const { session, visitor, events, soldAt, matchMethod } = journey;
  const steps: { at: string; text: string }[] = [];

  if (session) {
    const device = session.device_type === 'mobile' ? 'pelo celular' : session.device_type === 'tablet' ? 'pelo tablet' : session.device_type === 'desktop' ? 'pelo computador' : '';
    steps.push({
      at: session.started_at,
      text: `Chegou via ${sourceLabel(session)} em ${path(session.landing_page)} ${device}`.trim(),
    });
  }

  let pageviews = 0;
  for (const e of events) {
    if (e.event_type === 'pageview') {
      pageviews += 1;
      if (pageviews > 1) steps.push({ at: e.occurred_at, text: `Abriu ${path(e.url)}` });
    } else if (e.event_type === 'checkout_click') {
      steps.push({ at: e.occurred_at, text: 'Clicou no checkout' });
    } else if (e.event_type === 'custom' && e.event_name) {
      steps.push({ at: e.occurred_at, text: `Evento: ${e.event_name}` });
    }
  }
  steps.push({ at: soldAt, text: 'Comprou' });
  steps.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <Card className="border-foreground/10 bg-foreground/[0.03]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Footprints className="h-4 w-4 text-muted-foreground/70" />
          Jornada do comprador
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="relative space-y-3 border-l border-foreground/10 pl-4">
          {steps.map((step, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />
              <span className="tabular-nums text-muted-foreground mr-2">{time(step.at)}</span>
              {step.text}
            </li>
          ))}
        </ol>

        <div className="space-y-1 text-xs text-muted-foreground">
          {session?.duration_seconds != null && (
            <p>Ficou {formatDuration(session.duration_seconds)} na página.</p>
          )}
          {visitor && visitor.total_sessions > 1 && (
            // Total até hoje, não até a compra: o visitante pode ter voltado depois.
            <p>
              {visitor.total_sessions} visitas deste navegador até agora — a primeira em{' '}
              {dayTime(visitor.first_seen_at)}.
            </p>
          )}
          {!session && <p>Os detalhes da visita já saíram pela retenção.</p>}
          <p className="text-muted-foreground/70">{MATCH_LABEL[matchMethod] ?? matchMethod}</p>
        </div>
      </CardContent>
    </Card>
  );
}
