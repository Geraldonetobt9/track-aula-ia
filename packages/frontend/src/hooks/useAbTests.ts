import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useRefetch } from '@/contexts/RefetchContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';

// ---------------------------------------------------------------------------
// Tipos — espelham o que AbTestsService devolve
// ---------------------------------------------------------------------------

export type AbMode = 'redirect' | 'elements';
export type AbGoal = 'sale' | 'checkout' | 'revenue';
export type AbStatus = 'draft' | 'running' | 'paused' | 'finished';
export type AbVerdict = 'draft' | 'collecting' | 'winner' | 'control' | 'inconclusive';

export interface AbVariant {
  id: string;
  key: string;
  name: string;
  url: string | null;
  weight: number;
  isControl: boolean;
  visitors: number;
  checkoutVisitors: number;
  buyers: number;
  orders: number;
  /** Pedidos ligados à visita pelo indexador (sck). */
  ordersIndexed: number;
  revenue: number;
  /** 0 a 100. */
  checkoutRate: number;
  conversionRate: number;
  revenuePerVisitor: number;
  comparison: {
    lift: number | null;
    pValue: number | null;
    /** 0 a 1. */
    chanceToBeat: number | null;
    significant: boolean;
  } | null;
}

export interface AbTest {
  id: string;
  workspaceId: string;
  name: string;
  hypothesis: string | null;
  mode: AbMode;
  pageUrl: string;
  goal: AbGoal;
  status: AbStatus;
  startedAt: string | null;
  endedAt: string | null;
  winnerVariantId: string | null;
  createdAt: string;
  updatedAt: string;
  variants: AbVariant[];
  summary: {
    verdict: AbVerdict;
    leader: string | null;
    alpha: number;
    totalVisitors: number;
    totalOrders: number;
    ordersIndexed: number;
    unmatchedSales: number;
    samplePerVariant: number | null;
    /** 0 a 100. */
    progress: number | null;
  };
  daily: { date: string; values: Record<string, { visitors: number; buyers: number; rate: number }> }[];
}

export interface AbVariantInput {
  name: string;
  url?: string;
  weight: number;
}

export interface AbTestInput {
  name: string;
  hypothesis?: string;
  mode: AbMode;
  page_url: string;
  goal: AbGoal;
  variants: AbVariantInput[];
}

// ---------------------------------------------------------------------------
// Rótulos compartilhados
// ---------------------------------------------------------------------------

export const GOAL_LABELS: Record<AbGoal, string> = {
  sale: 'Conversão em venda',
  checkout: 'Clique no checkout',
  revenue: 'Receita por visitante',
};

export const MODE_LABELS: Record<AbMode, string> = {
  redirect: 'Páginas diferentes',
  elements: 'Blocos na mesma página',
};

export const STATUS_LABELS: Record<AbStatus, string> = {
  draft: 'Rascunho',
  running: 'Rodando',
  paused: 'Pausado',
  finished: 'Encerrado',
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Os testes da área, já com o resultado de cada um. */
export function useAbTests() {
  const { activeWorkspaceId } = useWorkspaceContext();
  const { refetchSignal } = useRefetch();

  const query = useQuery<AbTest[], Error>({
    queryKey: ['ab-tests', activeWorkspaceId, refetchSignal],
    enabled: !!activeWorkspaceId,
    staleTime: 30_000,
    // Sem a migration aplicada a rota falha; não vale insistir.
    retry: false,
    queryFn: () => api.get<AbTest[]>(`/ab-tests?workspace_id=${activeWorkspaceId}`),
  });

  return { tests: query.data ?? [], loading: query.isLoading, error: query.error?.message ?? null };
}

/** Um teste. Rodando, atualiza sozinho a cada minuto. */
export function useAbTest(id: string | undefined) {
  const { refetchSignal } = useRefetch();

  const query = useQuery<AbTest, Error>({
    queryKey: ['ab-test', id, refetchSignal],
    enabled: !!id,
    staleTime: 30_000,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 60_000 : false),
    queryFn: () => api.get<AbTest>(`/ab-tests/${id}`),
  });

  return { test: query.data ?? null, loading: query.isLoading, error: query.error?.message ?? null };
}

export function useAbTestMutations() {
  const queryClient = useQueryClient();
  const { activeWorkspaceId } = useWorkspaceContext();

  const refresh = (test?: AbTest) => {
    queryClient.invalidateQueries({ queryKey: ['ab-tests'] });
    if (test) queryClient.invalidateQueries({ queryKey: ['ab-test', test.id] });
  };
  const fail = (what: string) => (err: Error) => toast.error(`${what}: ${err.message}`);

  const create = useMutation({
    mutationFn: (input: AbTestInput) => api.post<AbTest>('/ab-tests', { ...input, workspace_id: activeWorkspaceId }),
    onSuccess: (test) => {
      refresh(test);
      toast.success('Teste criado. Confira e inicie quando estiver pronto.');
    },
    onError: fail('Não foi possível criar o teste'),
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<AbTestInput> }) =>
      api.patch<AbTest>(`/ab-tests/${id}`, input),
    onSuccess: (test) => {
      refresh(test);
      toast.success('Teste salvo');
    },
    onError: fail('Não foi possível salvar'),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, action, winnerVariantId }: { id: string; action: 'start' | 'pause' | 'finish'; winnerVariantId?: string }) =>
      api.post<AbTest>(`/ab-tests/${id}/status`, {
        action,
        ...(winnerVariantId ? { winner_variant_id: winnerVariantId } : {}),
      }),
    onSuccess: (test) => {
      refresh(test);
      const messages: Record<AbStatus, string> = {
        running: 'Teste no ar. As páginas passam a sortear em até 5 minutos.',
        paused: 'Teste pausado. Os visitantes param de ser sorteados.',
        finished: 'Teste encerrado.',
        draft: 'Teste salvo.',
      };
      toast.success(messages[test.status]);
    },
    onError: fail('Não foi possível mudar o teste'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/ab-tests/${id}`),
    onSuccess: () => {
      refresh();
      toast.success('Teste excluído');
    },
    onError: fail('Não foi possível excluir'),
  });

  return { create, update, setStatus, remove };
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

export function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatRate(value: number): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/** Métrica do objetivo, formatada. */
export function goalValue(goal: AbGoal, v: AbVariant): string {
  if (goal === 'revenue') return formatMoney(v.revenuePerVisitor);
  return formatRate(goal === 'checkout' ? v.checkoutRate : v.conversionRate);
}
