import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Check, CircleCheck, CircleDashed, Code2, Copy, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { errorMessage } from '@/lib/utils';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { absoluteApiUrl } from '@/lib/apiUrl';
import { useTrackingStatus } from '@/hooks/useTracking';
import { useCapiSettings } from '@/hooks/useCapi';
import { findTrackingPlatform, TRACKING_PLATFORMS } from '@/lib/trackingPlatforms';
import { UtmPatternStep } from './UtmPatternStep';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * O loader que o cliente cola na página de vendas. Cria a fila sentinel.q
 * para chamadas feitas antes de o tracker.js baixar, e carrega o script de
 * forma assíncrona — não trava a renderização da página.
 */
function buildSnippet(scriptUrl: string, workspaceId: string) {
  return `<script>
(function(s,e,n,t,i){s[n]=s[n]||function(){(s[n].q=s[n].q||[]).push(arguments)};
var js=e.createElement('script');js.async=1;js.src=t+'?tid='+i;
e.head.appendChild(js)})(window,document,'sentinel','${scriptUrl}','${workspaceId}');
</script>`;
}

type DomainCheck = 'idle' | 'checking' | 'ok' | 'fail';

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[11px] text-accent-readable">
          {n}
        </span>
        {title}
      </p>
      <div className="pl-7 space-y-2">{children}</div>
    </div>
  );
}

/**
 * Checkout e rastreio numa sequência só: 1) escolha do checkout, 2) domínio
 * first-party, 3) código da página, 4) webhook, 5) padrão de UTM. O passo 4 vem de
 * CheckoutIntegrationsSection (`webhooks`), que recebe o checkout escolhido
 * no passo 1 para criar o webhook dele direto.
 */
export function TrackingSnippetCard({
  webhooks,
}: {
  webhooks: (platformId: string | null) => React.ReactNode;
}) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const { status, loading } = useTrackingStatus();
  const { settings, save, saving } = useCapiSettings();
  const [copied, setCopied] = useState(false);
  const [domain, setDomain] = useState('');
  const [check, setCheck] = useState<DomainCheck>('idle');
  const [showOther, setShowOther] = useState(false);

  useEffect(() => {
    setDomain(settings?.tracking_domain ?? '');
  }, [settings?.tracking_domain]);

  const currentPlatform = settings?.tracking_platform ?? null;

  // A página de Eventos manda para /integrations#rastreio; o React Router
  // não rola até âncora sozinho.
  useEffect(() => {
    if (activeWorkspaceId && window.location.hash === '#rastreio') {
      document.getElementById('rastreio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeWorkspaceId]);

  if (!activeWorkspaceId) return null;

  const platform = findTrackingPlatform(settings?.tracking_platform);
  const savedDomain = settings?.tracking_domain ?? null;
  // Quem abre o painel pelo próprio domínio (painel.loja.com.br) já tem o
  // subdomínio first-party: o snippet usa esse mesmo endereço, sem configurar
  // nada. O campo só existe para apontar outro subdomínio.
  const host = window.location.hostname;
  const panelOnOwnDomain = !/(^localhost$|^127\.|\.vercel\.app$)/.test(host);
  const trackingDomain = savedDomain ?? (panelOnOwnDomain ? host : null);
  const scriptBase = trackingDomain ? `https://${trackingDomain}/api` : absoluteApiUrl();
  const snippet = buildSnippet(`${scriptBase}/t/tracker.js`, activeWorkspaceId);
  const lastEvent = status?.lastEventAt ? new Date(status.lastEventAt) : null;
  const active = !!lastEvent && Date.now() - lastEvent.getTime() < DAY_MS;
  const rootDomain = trackingDomain?.split('.').slice(1).join('.') || 'seusite.com.br';
  const showField = !!savedDomain || showOther || !trackingDomain;

  const escolherPlataforma = async (id: string) => {
    const p = findTrackingPlatform(id);
    if (!p) return;
    try {
      await save({ tracking_platform: p.id, tracking_param: p.param });
    } catch (e) {
      toast({ title: 'Não foi possível salvar', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const salvarDominio = async () => {
    const value = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    try {
      await save({ tracking_domain: value });
      setDomain(value);
      setCheck('idle');
    } catch (e) {
      toast({ title: 'Subdomínio inválido', description: errorMessage(e), variant: 'destructive' });
    }
  };

  // Busca o /ping direto pelo subdomínio: se responder, o CNAME aponta para
  // este projeto na Vercel e o certificado já foi emitido.
  const verificar = async () => {
    if (!trackingDomain) return;
    setCheck('checking');
    try {
      const res = await fetch(`https://${trackingDomain}/api/t/ping`, { cache: 'no-store' });
      const body = await res.json();
      setCheck(res.ok && body?.service === 'sentinela-tracking' ? 'ok' : 'fail');
    } catch {
      setCheck('fail');
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  return (
    <Card id="rastreio">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-accent-readable" strokeWidth={1.5} />
            <CardTitle>Checkout e rastreio</CardTitle>
          </div>
          {!loading && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              {active ? (
                <>
                  <CircleCheck className="h-3.5 w-3.5 text-green-500" aria-hidden />
                  <span className="text-foreground">Rastreio ativo</span>
                </>
              ) : (
                <>
                  <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">Nenhum evento nas últimas 24h</span>
                </>
              )}
            </span>
          )}
        </div>
        <CardDescription>
          O webhook traz as vendas do checkout; o código na página de vendas registra cada visita e leva um indexador
          até o checkout. A plataforma devolve o indexador no webhook, e é ele que junta a visita (fbp, fbc, IP,
          navegador, cidade) com a compra.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">

        <Step n={1} title="Escolha seu checkout">
          <Select value={currentPlatform ?? undefined} onValueChange={escolherPlataforma} disabled={saving}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Plataforma de checkout">
              <SelectValue placeholder="Escolha a plataforma" />
            </SelectTrigger>
            <SelectContent>
              {TRACKING_PLATFORMS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {platform && (
            <p className="text-xs text-muted-foreground">
              O indexador vai no parâmetro <code className="font-mono text-foreground">{platform.param}</code> da URL.
              {platform.param === 'utm_term' && (
                <> Essa plataforma só devolve UTMs, então o <code className="font-mono">utm_term</code> do anúncio é substituído pelo indexador.</>
              )}
            </p>
          )}
          {platform && !platform.sales && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
              O painel ainda não recebe o webhook de {platform.name}: PageView e InitiateCheckout funcionam, mas a venda
              não é gravada e o Purchase não sai.
            </p>
          )}
        </Step>

        <Step n={2} title="Domínio first-party">
          {trackingDomain && !savedDomain ? (
            <p className="flex items-start gap-1.5 text-xs text-foreground">
              <CircleCheck className="h-3.5 w-3.5 shrink-0 mt-px text-green-500" aria-hidden />
              <span>
                Usando <code className="font-mono">{trackingDomain}</code>, o domínio por onde você abriu o painel. Nada a
                configurar.{' '}
                {!showOther && (
                  <button
                    type="button"
                    className="text-muted-foreground underline underline-offset-2"
                    onClick={() => setShowOther(true)}
                  >
                    Usar outro subdomínio
                  </button>
                )}
              </span>
            </p>
          ) : !trackingDomain ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px text-amber-500" aria-hidden />
              <span>
                O painel está aberto pelo endereço da Vercel. Aponte um subdomínio seu para o projeto (Vercel → Settings →
                Domains, e um <code className="font-mono text-foreground">CNAME</code> para{' '}
                <code className="font-mono text-foreground">cname.vercel-dns.com</code> no DNS) e abra o painel por ele —
                ou informe o subdomínio abaixo. Sem isso, o rastreio fica sujeito a bloqueadores de anúncio.
              </span>
            </p>
          ) : null}

          {showField && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="tracking-domain" className="text-xs">Subdomínio de rastreio</Label>
                <Input
                  id="tracking-domain"
                  placeholder={`track.${rootDomain}`}
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
              <Button variant="outline" onClick={salvarDominio} disabled={saving || domain.trim() === (savedDomain ?? '')}>
                Salvar
              </Button>
            </div>
          )}

          {trackingDomain && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={verificar} disabled={check === 'checking'}>
                {check === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : `Verificar ${trackingDomain}`}
              </Button>
              {check === 'ok' && (
                <span className="flex items-center gap-1.5 text-xs text-foreground">
                  <CircleCheck className="h-3.5 w-3.5 text-green-500" aria-hidden /> Respondendo.
                </span>
              )}
            </div>
          )}
          {check === 'fail' && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px text-amber-500" aria-hidden />
              {trackingDomain} ainda não responde. O DNS pode levar alguns minutos; confira também se o domínio foi
              adicionado na Vercel.
            </p>
          )}
          <p className="text-xs text-muted-foreground/70">
            O domínio precisa ser do mesmo site da página de vendas (painel.loja.com.br para uma página em loja.com.br),
            senão os cookies não valem para ela.
          </p>
        </Step>

        <Step n={3} title="Código da página">
          <p className="text-xs text-muted-foreground">
            Cole antes do <code className="font-mono text-foreground">&lt;/body&gt;</code> da página de vendas.
          </p>
          <div className="flex items-start gap-2">
            <pre className="flex-1 overflow-x-auto rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
              {snippet}
            </pre>
            <Button variant="outline" size="icon" onClick={copiar} aria-label="Copiar código" className="shrink-0">
              {copied ? <Check className="h-4 w-4 text-accent-readable" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          {copied && <p className="text-xs text-accent-readable">Copiado.</p>}
          {savedDomain && check !== 'ok' && (
            <p className="text-xs text-muted-foreground/70">
              O código já usa {savedDomain}. Só publique depois de o subdomínio responder em "Verificar".
            </p>
          )}
        </Step>

        <Step n={4} title="Criar o webhook">
          <p className="text-xs text-muted-foreground">
            É por ele que as vendas chegam ao painel — e com elas o indexador que liga cada venda à visita.
          </p>
          {webhooks(platform?.id ?? null)}
        </Step>

        <Step n={5} title="Padrão de UTM nos anúncios">
          <UtmPatternStep platform={platform} />
        </Step>

        <div className="grid grid-cols-2 gap-3 rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-3 text-xs">
          <div>
            <p className="text-muted-foreground">Eventos hoje</p>
            <p className="text-sm font-medium tabular-nums text-foreground">
              {loading ? '—' : (status?.eventsToday ?? 0).toLocaleString('pt-BR')}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Último evento</p>
            <p className="text-sm font-medium text-foreground">
              {lastEvent ? formatDistanceToNow(lastEvent, { addSuffix: true, locale: ptBR }) : '—'}
            </p>
          </div>
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>
            O PageView sai quando a página carrega. O InitiateCheckout sai quando a visita vai para o checkout — por
            link, formulário, botão com a URL no <code className="font-mono text-foreground">onclick</code> ou
            redirecionamento. Todos os parâmetros da URL de chegada e o indexador vão junto para o checkout. Botão para
            um domínio fora da lista de plataformas? Marque com{' '}
            <code className="font-mono text-foreground">data-sentinel-checkout</code>. Redirecionamento feito pelo seu
            próprio script? Troque o <code className="font-mono text-foreground">location.href = url</code> por{' '}
            <code className="font-mono text-foreground">sentinel('checkout', url)</code>.
          </p>
          <p className="text-muted-foreground/70">
            Não coleta nome nem e-mail na página, e respeita o Do Not Track do navegador. O IP fica 90 dias, para a
            API de Conversões.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
