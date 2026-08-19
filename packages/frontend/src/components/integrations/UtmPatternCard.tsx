import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Copy, Tag } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

/**
 * O padrão de UTM que o painel espera.
 *
 * O que importa aqui é o `|`: a leitura da venda quebra cada parâmetro nesse
 * caractere e procura o pedaço que é só número. É assim que o nome do anúncio
 * e o ID cabem no mesmo parâmetro sem atrapalhar a atribuição.
 */
const UTM_PATTERN =
  'utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}';

const PARAMETROS = [
  { chave: 'utm_campaign', leva: 'Nome e ID da campanha' },
  { chave: 'utm_medium', leva: 'Nome e ID do conjunto' },
  { chave: 'utm_content', leva: 'Nome e ID do anúncio — é daqui que sai a atribuição' },
  { chave: 'utm_term', leva: 'Posicionamento (feed, stories, reels)' },
];

export function UtmPatternCard() {
  const [copied, setCopied] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(UTM_PATTERN);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-accent-readable" strokeWidth={1.5} />
          <CardTitle>Padrão de UTM</CardTitle>
        </div>
        <CardDescription>
          Cole no campo <span className="text-foreground">Parâmetros de URL</span> do anúncio, no
          Gerenciador de Anúncios. É o que liga a venda ao anúncio que a trouxe.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <code className="flex-1 break-all rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
              {UTM_PATTERN}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={copiar}
              aria-label="Copiar padrão de UTM"
              className="shrink-0"
            >
              {copied ? <Check className="h-4 w-4 text-accent-readable" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          {copied && <p className="text-xs text-accent-readable">Copiado.</p>}
        </div>

        <div className="space-y-2 rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-3">
          {PARAMETROS.map((p) => (
            <div key={p.chave} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
              <code className="font-mono text-foreground">{p.chave}</code>
              <span className="text-muted-foreground">{p.leva}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground/70">
          Vale para anúncios novos e antigos: o padrão precisa estar no anúncio antes do clique,
          então vendas anteriores à mudança continuam com o que foi gravado na época.
        </p>
      </CardContent>
    </Card>
  );
}
