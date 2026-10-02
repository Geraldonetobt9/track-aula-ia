import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { TrackingPlatform } from '@/lib/trackingPlatforms';

/**
 * O padrão de UTM que o painel espera — passo 5 do card Checkout e rastreio.
 *
 * O que importa aqui é o `|`: a leitura da venda quebra cada parâmetro nesse
 * caractere e procura o pedaço que é só número. É assim que o nome do anúncio
 * e o ID cabem no mesmo parâmetro sem atrapalhar a atribuição.
 *
 * Nas plataformas em que o indexador vai no utm_term, o padrão não leva
 * utm_term: o código da página o ocupa com o indexador.
 */
const UTM_BASE =
  'utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}';
const UTM_TERM = '&utm_term={{placement}}';

const PARAMETROS = [
  { chave: 'utm_campaign', leva: 'Nome e ID da campanha' },
  { chave: 'utm_medium', leva: 'Nome e ID do conjunto' },
  { chave: 'utm_content', leva: 'Nome e ID do anúncio — é daqui que sai a atribuição' },
  { chave: 'utm_term', leva: 'Posicionamento (feed, stories, reels)' },
];

export function UtmPatternStep({ platform }: { platform: TrackingPlatform | null }) {
  const [copied, setCopied] = useState(false);
  const termIsIndexer = platform?.param === 'utm_term';
  const pattern = termIsIndexer ? UTM_BASE : UTM_BASE + UTM_TERM;
  const parametros = termIsIndexer ? PARAMETROS.filter((p) => p.chave !== 'utm_term') : PARAMETROS;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(pattern);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Cole no campo <span className="text-foreground">Parâmetros de URL</span> de cada anúncio, no Gerenciador de
        Anúncios. É o que liga a venda ao anúncio que a trouxe.
      </p>
      <div className="flex items-start gap-2">
        <code className="flex-1 break-all rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
          {pattern}
        </code>
        <Button variant="outline" size="icon" onClick={copiar} aria-label="Copiar padrão de UTM" className="shrink-0">
          {copied ? <Check className="h-4 w-4 text-accent-readable" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      {copied && <p className="text-xs text-accent-readable">Copiado.</p>}

      <div className="space-y-2 rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-3">
        {parametros.map((p) => (
          <div key={p.chave} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <code className="font-mono text-foreground">{p.chave}</code>
            <span className="text-muted-foreground">{p.leva}</span>
          </div>
        ))}
      </div>

      {termIsIndexer && (
        <p className="text-xs text-muted-foreground">
          Sem <code className="font-mono text-foreground">utm_term</code>: na {platform?.name} ele leva o indexador da
          visita, que o código da página preenche.
        </p>
      )}
      {platform?.id === 'hotmart' && (
        <p className="text-xs text-muted-foreground">
          A Hotmart não devolve as UTMs no webhook. O código da página copia as UTMs para o{' '}
          <code className="font-mono text-foreground">xcod</code> do link do checkout, e é de lá que o painel lê o
          anúncio da venda.
        </p>
      )}

      <p className="text-xs text-muted-foreground/70">
        Vale para anúncios novos e antigos: o padrão precisa estar no anúncio antes do clique, então vendas anteriores
        à mudança continuam com o que foi gravado na época.
      </p>
    </>
  );
}
