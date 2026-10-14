import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  GOAL_LABELS,
  MODE_LABELS,
  type AbGoal,
  type AbMode,
  type AbTest,
  type AbTestInput,
} from '@/hooks/useAbTests';

const KEYS = ['A', 'B', 'C', 'D', 'E'];
const MAX_VARIANTS = KEYS.length;

interface VariantDraft {
  name: string;
  url: string;
  weight: string;
}

const GOAL_HINTS: Record<AbGoal, string> = {
  sale: 'Quem comprou, entre os visitantes de cada variante. A venda chega pelo indexador.',
  checkout: 'Quem clicou para ir ao checkout. Decide mais rápido, mas não garante venda.',
  revenue: 'Receita aprovada dividida pelos visitantes. Bom quando as variantes mudam preço ou oferta.',
};

const MODE_HINTS: Record<AbMode, string> = {
  redirect: 'Cada variante é uma página. O código leva o visitante para a página sorteada.',
  elements: 'Uma página só. Você marca os blocos de cada variante e o código mostra os da sorteada.',
};

function evenWeights(n: number): string[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => String(i === 0 ? 100 - base * (n - 1) : base));
}

function blankVariants(): VariantDraft[] {
  return [
    { name: 'Original', url: '', weight: '50' },
    { name: 'Variante B', url: '', weight: '50' },
  ];
}

export function AbTestFormDialog({
  open,
  onOpenChange,
  test,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editando: só nome e hipótese mudam fora do rascunho. */
  test?: AbTest | null;
  onSave: (input: AbTestInput) => Promise<unknown>;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [mode, setMode] = useState<AbMode>('redirect');
  const [pageUrl, setPageUrl] = useState('');
  const [goal, setGoal] = useState<AbGoal>('sale');
  const [variants, setVariants] = useState<VariantDraft[]>(blankVariants);
  const [error, setError] = useState<string | null>(null);

  const locked = !!test && test.status !== 'draft';

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (test) {
      setName(test.name);
      setHypothesis(test.hypothesis ?? '');
      setMode(test.mode);
      setPageUrl(test.pageUrl);
      setGoal(test.goal);
      setVariants(test.variants.map((v) => ({ name: v.name, url: v.url ?? '', weight: String(v.weight) })));
    } else {
      setName('');
      setHypothesis('');
      setMode('redirect');
      setPageUrl('');
      setGoal('sale');
      setVariants(blankVariants());
    }
  }, [open, test]);

  const patchVariant = (i: number, patch: Partial<VariantDraft>) =>
    setVariants((list) => list.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const addVariant = () =>
    setVariants((list) => {
      const weights = evenWeights(list.length + 1);
      return [
        ...list.map((v, i) => ({ ...v, weight: weights[i] })),
        { name: `Variante ${KEYS[list.length]}`, url: '', weight: weights[list.length] },
      ];
    });

  const removeVariant = (i: number) =>
    setVariants((list) => {
      const next = list.filter((_, j) => j !== i);
      const weights = evenWeights(next.length);
      return next.map((v, j) => ({ ...v, weight: weights[j] }));
    });

  const totalWeight = variants.reduce((s, v) => s + (Number(v.weight) || 0), 0);

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('Dê um nome ao teste.');
    if (!locked) {
      if (!pageUrl.trim()) return setError('Informe a página onde o teste roda.');
      for (let i = 0; i < variants.length; i++) {
        const w = Number(variants[i].weight);
        if (!Number.isInteger(w) || w < 1 || w > 100) return setError(`Variante ${KEYS[i]}: peso de 1 a 100.`);
        if (mode === 'redirect' && i > 0 && !variants[i].url.trim()) {
          return setError(`Variante ${KEYS[i]}: informe a página dela.`);
        }
      }
    }

    const input: AbTestInput = locked
      ? ({ name: name.trim(), hypothesis: hypothesis.trim() } as AbTestInput)
      : {
          name: name.trim(),
          hypothesis: hypothesis.trim(),
          mode,
          page_url: pageUrl.trim(),
          goal,
          variants: variants.map((v, i) => ({
            name: v.name.trim() || `Variante ${KEYS[i]}`,
            ...(mode === 'redirect' && i > 0 ? { url: v.url.trim() } : {}),
            weight: Number(v.weight),
          })),
        };

    try {
      await onSave(input);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{test ? 'Editar teste A/B' : 'Novo teste A/B'}</DialogTitle>
          <DialogDescription>
            O código de rastreio que já está na página faz o sorteio. A venda volta para a variante certa pelo
            indexador do checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ab-name">Nome</Label>
              <Input
                id="ab-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder="Headline com prova social"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ab-hypothesis">Hipótese (opcional)</Label>
              <Textarea
                id="ab-hypothesis"
                value={hypothesis}
                maxLength={1000}
                rows={2}
                onChange={(e) => setHypothesis(e.target.value)}
                placeholder="Se a headline mostrar quantos alunos já compraram, mais visitantes vão comprar, porque..."
              />
            </div>
          </div>

          {locked && (
            <p className="rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
              Com o teste {test?.status === 'finished' ? 'encerrado' : 'em andamento'}, só nome e hipótese mudam.
              Mudar a página ou as variantes misturaria dois experimentos no mesmo resultado.
            </p>
          )}

          <fieldset disabled={locked} className={cn('space-y-5', locked && 'opacity-60')}>
            <div className="space-y-2">
              <Label>Como as variantes diferem</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as AbMode)}
                className="grid gap-2 sm:grid-cols-2"
              >
                {(Object.keys(MODE_LABELS) as AbMode[]).map((m) => (
                  <label
                    key={m}
                    htmlFor={`ab-mode-${m}`}
                    className={cn(
                      'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
                      mode === m ? 'border-primary bg-primary/5' : 'border-foreground/10 hover:bg-foreground/5',
                    )}
                  >
                    <RadioGroupItem id={`ab-mode-${m}`} value={m} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium text-foreground">{MODE_LABELS[m]}</span>
                      <span className="block text-xs text-muted-foreground">{MODE_HINTS[m]}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ab-page">{mode === 'redirect' ? 'Página original (A)' : 'Página do teste'}</Label>
                <Input
                  id="ab-page"
                  value={pageUrl}
                  onChange={(e) => setPageUrl(e.target.value)}
                  placeholder="https://www.seusite.com.br/oferta"
                  inputMode="url"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Objetivo</Label>
                <Select value={goal} onValueChange={(v) => setGoal(v as AbGoal)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(GOAL_LABELS) as AbGoal[]).map((g) => (
                      <SelectItem key={g} value={g}>
                        {GOAL_LABELS[g]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{GOAL_HINTS[goal]}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Variantes</Label>
                <span className="text-xs text-muted-foreground">
                  Pesos relativos · soma {totalWeight}
                </span>
              </div>

              <div className="space-y-2">
                {variants.map((v, i) => {
                  const share = totalWeight > 0 ? Math.round(((Number(v.weight) || 0) / totalWeight) * 100) : 0;
                  return (
                    <div key={i} className="rounded-lg border border-foreground/10 p-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground/8 text-sm font-semibold text-foreground">
                          {KEYS[i]}
                        </span>
                        <Input
                          aria-label={`Nome da variante ${KEYS[i]}`}
                          value={v.name}
                          maxLength={80}
                          onChange={(e) => patchVariant(i, { name: e.target.value })}
                          className="h-8"
                        />
                        <div className="flex shrink-0 items-center gap-1">
                          <Input
                            aria-label={`Peso da variante ${KEYS[i]}`}
                            value={v.weight}
                            inputMode="numeric"
                            onChange={(e) => patchVariant(i, { weight: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                            className="h-8 w-14 text-right"
                          />
                          <span className="w-10 text-xs tabular-nums text-muted-foreground">{share}%</span>
                        </div>
                        {variants.length > 2 && i > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => removeVariant(i)}
                            aria-label={`Remover variante ${KEYS[i]}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="w-8 shrink-0" />
                        )}
                      </div>
                      {mode === 'redirect' && (
                        <div className="mt-2 pl-9">
                          {i === 0 ? (
                            <p className="truncate text-xs text-muted-foreground">
                              Controle: a página original{pageUrl ? ` (${pageUrl})` : ''}
                            </p>
                          ) : (
                            <Input
                              aria-label={`Página da variante ${KEYS[i]}`}
                              value={v.url}
                              onChange={(e) => patchVariant(i, { url: e.target.value })}
                              placeholder="https://www.seusite.com.br/oferta-b"
                              inputMode="url"
                              className="h-8"
                            />
                          )}
                        </div>
                      )}
                      {mode === 'elements' && (
                        <p className="mt-2 pl-9 text-xs text-muted-foreground">
                          Blocos marcados com <code className="font-mono text-foreground">data-stl-ab="{KEYS[i]}"</code>
                          {i === 0 ? ' (o conteúdo original)' : ''}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {variants.length < MAX_VARIANTS && (
                <Button type="button" variant="outline" size="sm" onClick={addVariant}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Adicionar variante
                </Button>
              )}
              {variants.length > 2 && (
                <p className="text-xs text-muted-foreground">
                  Com mais de uma variante desafiante, o teste exige mais certeza de cada uma e leva mais tempo.
                </p>
              )}
            </div>
          </fieldset>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {test ? 'Salvar' : 'Criar teste'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
