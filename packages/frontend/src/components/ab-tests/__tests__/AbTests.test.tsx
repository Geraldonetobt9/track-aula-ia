import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AbTestResults } from '../AbTestResults';
import { AbTestFormDialog } from '../AbTestFormDialog';
import { AbTestSetupGuide } from '../AbTestSetupGuide';
import type { AbTest, AbVariant } from '@/hooks/useAbTests';

// Os componentes só formatam: o cliente da API (que exige o Supabase) não entra.
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/contexts/RefetchContext', () => ({ useRefetch: () => ({ refetchSignal: 0 }) }));
vi.mock('@/contexts/WorkspaceContext', () => ({ useWorkspaceContext: () => ({ activeWorkspaceId: 'w' }) }));

// O recharts mede o container; no jsdom ele tem 0×0 e não desenha nada.
vi.mock('recharts', async (orig) => {
  const mod = await orig<typeof import('recharts')>();
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

function variant(over: Partial<AbVariant>): AbVariant {
  return {
    id: 'v', key: 'A', name: 'Original', url: null, weight: 50, isControl: true,
    visitors: 2000, checkoutVisitors: 300, buyers: 100, orders: 100, ordersIndexed: 90,
    revenue: 19700, checkoutRate: 15, conversionRate: 5, revenuePerVisitor: 9.85, comparison: null,
    ...over,
  };
}

function testFixture(over: Partial<AbTest> = {}): AbTest {
  return {
    id: 'abababab-0000-4000-8000-000000000001',
    workspaceId: 'w', name: 'Headline', hypothesis: null, mode: 'redirect',
    pageUrl: 'https://www.loja.com.br/oferta', goal: 'sale', status: 'running',
    startedAt: '2026-10-01T12:00:00Z', endedAt: null, winnerVariantId: null,
    createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z',
    variants: [
      variant({ id: 'va', url: 'https://www.loja.com.br/oferta' }),
      variant({
        id: 'vb', key: 'B', name: 'Prova social', isControl: false, url: 'https://www.loja.com.br/oferta-b',
        buyers: 150, orders: 150, conversionRate: 7.5,
        comparison: { lift: 50, pValue: 0.0012, chanceToBeat: 0.999, significant: true },
      }),
    ],
    summary: {
      verdict: 'winner', leader: 'B', alpha: 0.05, totalVisitors: 4000, totalOrders: 250,
      ordersIndexed: 180, unmatchedSales: 4, samplePerVariant: 7000, progress: 29,
    },
    daily: [
      { date: '2026-10-01', values: { A: { visitors: 100, buyers: 4, rate: 4 }, B: { visitors: 100, buyers: 6, rate: 6 } } },
      { date: '2026-10-02', values: { A: { visitors: 200, buyers: 10, rate: 5 }, B: { visitors: 200, buyers: 15, rate: 7.5 } } },
    ],
    ...over,
  };
}

const wrap = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>,
  );

describe('AbTestResults', () => {
  it('mostra a vencedora, a variacao e o quanto veio pelo indexador', () => {
    wrap(<AbTestResults test={testFixture()} />);
    expect(screen.getByText(/Variante B vence — Prova social/)).toBeInTheDocument();
    expect(screen.getByText('+50%')).toBeInTheDocument();
    expect(screen.getByText('Significativo')).toBeInTheDocument();
    expect(screen.getByText(/180 de 250 pedidos/)).toBeInTheDocument();
    expect(screen.getByText(/4 vendas aprovadas/)).toBeInTheDocument();
    expect(screen.getByText('Conversão acumulada em venda')).toBeInTheDocument();
  });

  it('coletando: avisa para nao encerrar ainda', () => {
    const t = testFixture();
    wrap(<AbTestResults test={{ ...t, summary: { ...t.summary, verdict: 'collecting', leader: null } }} />);
    expect(screen.getByText('Coletando dados')).toBeInTheDocument();
    expect(screen.getByText(/Não encerre agora/)).toBeInTheDocument();
  });
});

describe('AbTestSetupGuide', () => {
  it('modo elements: mostra o HTML com data-stl-ab e hidden nas desafiantes', () => {
    wrap(<AbTestSetupGuide test={testFixture({ mode: 'elements' })} />);
    const code = document.querySelector('pre')!.textContent!;
    expect(code).toContain('data-stl-ab="A"');
    expect(code).toContain('data-stl-ab="B" hidden');
  });
});

describe('AbTestFormDialog', () => {
  it('monta o pedido com as letras na ordem e a URL so nas desafiantes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    wrap(<AbTestFormDialog open onOpenChange={() => {}} onSave={onSave} saving={false} />);

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Headline' } });
    fireEvent.change(screen.getByLabelText('Página original (A)'), { target: { value: 'https://loja.com/oferta' } });
    fireEvent.change(screen.getByLabelText('Página da variante B'), { target: { value: 'https://loja.com/b' } });
    fireEvent.click(screen.getByText('Criar teste'));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual({
      name: 'Headline',
      hypothesis: '',
      mode: 'redirect',
      page_url: 'https://loja.com/oferta',
      goal: 'sale',
      variants: [
        { name: 'Original', weight: 50 },
        { name: 'Variante B', url: 'https://loja.com/b', weight: 50 },
      ],
    });
  });

  it('sem a pagina da variante, nao envia', async () => {
    const onSave = vi.fn();
    wrap(<AbTestFormDialog open onOpenChange={() => {}} onSave={onSave} saving={false} />);
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Headline' } });
    fireEvent.change(screen.getByLabelText('Página original (A)'), { target: { value: 'https://loja.com/oferta' } });
    fireEvent.click(screen.getByText('Criar teste'));
    expect(await screen.findByText(/Variante B: informe a página dela/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('teste rodando: so manda nome e hipotese', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    wrap(<AbTestFormDialog open onOpenChange={() => {}} test={testFixture()} onSave={onSave} saving={false} />);
    expect(screen.getByText(/só nome e hipótese mudam/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: 'Headline', hypothesis: '' }));
  });
});
