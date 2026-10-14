import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AbTest } from '@/hooks/useAbTests';

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-foreground/10 bg-foreground/5 p-3 pr-12 font-mono text-xs text-foreground">
        {code}
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 h-7 w-7"
        aria-label="Copiar"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

/** Passo a passo para pôr o teste no ar. Não há código novo: é o mesmo snippet de rastreio. */
export function AbTestSetupGuide({ test }: { test: AbTest }) {
  const others = test.variants.filter((v) => !v.isControl);
  const elementsExample = [
    '<!-- Original: aparece para quem caiu na A -->',
    '<h1 data-stl-ab="A">Aprenda a investir do zero</h1>',
    '',
    ...others.map(
      (v) => `<!-- ${v.name}: comece escondido (hidden); o código mostra para quem caiu na ${v.key} -->\n<h1 data-stl-ab="${v.key}" hidden>…</h1>`,
    ),
  ].join('\n');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Como pôr no ar</CardTitle>
        <CardDescription>
          Usa o mesmo código de rastreio da página: ele sorteia a variante e marca o link do checkout com o indexador.
          Nada novo para instalar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            O código de rastreio precisa estar{' '}
            {test.mode === 'redirect' ? (
              <strong className="text-foreground">em todas as páginas do teste</strong>
            ) : (
              <strong className="text-foreground">na página do teste</strong>
            )}
            , de preferência no <code className="font-mono text-foreground">&lt;head&gt;</code>: quanto antes ele carrega,
            {test.mode === 'redirect' ? ' mais rápido o visitante chega à variante.' : ' menos o visitante vê a troca.'}{' '}
            <Link to="/integrations#rastreio" className="text-accent-readable underline-offset-2 hover:underline">
              Pegar o código
            </Link>
          </li>

          {test.mode === 'redirect' ? (
            <li>
              Quem abre <span className="font-mono text-foreground">{test.pageUrl.replace(/^https?:\/\//, '')}</span> é
              sorteado e, se cair noutra variante, vai para a página dela na hora — com as UTMs e o fbclid da chegada.
              Quem entra direto na página de uma variante também é sorteado, para o teste não ficar torto. Anúncios e
              links continuam apontando para a página original.
            </li>
          ) : (
            <li className="space-y-2">
              <p>
                Marque os blocos de cada variante com <code className="font-mono text-foreground">data-stl-ab</code>. Os
                das variantes desafiantes começam com <code className="font-mono text-foreground">hidden</code>: se o
                código não carregar (bloqueador, Do Not Track), o visitante vê o original, e não as duas versões.
              </p>
              <CodeBlock code={elementsExample} />
              <p>
                Mudanças que não cabem em blocos (preço num script, por exemplo) podem ler a variante sorteada:{' '}
                <code className="font-mono text-foreground">sentinel('ab', function (v) {'{ … }'})</code> recebe{' '}
                <code className="font-mono text-foreground">{`{ "${test.id.slice(0, 8)}…": "B" }`}</code>.
              </p>
            </li>
          )}

          <li>
            Inicie o teste. Em até 5 minutos as páginas passam a sortear: o código fica em cache no navegador por esse
            tempo. Pausar ou encerrar leva o mesmo prazo para valer.
          </li>
          <li>
            Cada visitante fica sempre na mesma variante (o sorteio é fixo pelo cookie dele). A compra entra na variante
            quando o webhook devolve o indexador <code className="font-mono text-foreground">stl_…</code>, que liga a
            venda à visita.
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
