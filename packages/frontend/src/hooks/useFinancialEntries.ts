import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { FinancialRange } from '@/lib/financialPeriod';

export interface FinancialEntry {
  id: string;
  type: 'expense' | 'revenue' | 'tax';
  name: string;
  amount: number;
  reference_month: string;
}

export function useFinancialEntries(range: FinancialRange) {
  const { supabaseUser } = useAuth();
  const { activeWorkspaceId } = useWorkspaceContext();
  const { toast } = useToast();
  const [entries, setEntries] = useState<FinancialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const hasFetchedRef = useRef<string | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!supabaseUser || !activeWorkspaceId) {
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({ workspace_id: activeWorkspaceId });
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      const data = await api.get<FinancialEntry[]>(`/financial?${params}`);
      setEntries((data || []).map((e) => ({ ...e, amount: Number(e.amount) })));
    } catch (error) {
      console.error('Error fetching financial entries:', error);
    }
    setLoading(false);
  }, [supabaseUser, activeWorkspaceId, range.from, range.to]);

  const fetchKey = `${supabaseUser?.id}-${activeWorkspaceId}-${range.from ?? ''}-${range.to ?? ''}`;

  useEffect(() => {
    if (hasFetchedRef.current === fetchKey) return;
    hasFetchedRef.current = fetchKey;
    fetchEntries();
  }, [fetchEntries, fetchKey]);

  const addEntry = async (
    type: 'expense' | 'revenue' | 'tax',
    name: string,
    amount: number,
    refMonth: string
  ) => {
    if (!supabaseUser || !activeWorkspaceId) return;

    try {
      await api.post('/financial', {
        workspace_id: activeWorkspaceId,
        type,
        name,
        amount,
        reference_month: refMonth,
      });
      toast({ title: 'Adicionado!' });
      fetchEntries();
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível adicionar.', variant: 'destructive' });
    }
  };

  const updateEntry = async (id: string, updates: { name?: string; amount?: number }) => {
    if (!activeWorkspaceId) return;

    try {
      await api.patch(`/financial/${id}`, {
        workspace_id: activeWorkspaceId,
        ...updates,
      });
      toast({ title: 'Atualizado!' });
      fetchEntries();
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível atualizar.', variant: 'destructive' });
    }
  };

  const removeEntry = async (id: string) => {
    if (!activeWorkspaceId) return;

    try {
      await api.delete(`/financial/${id}?workspace_id=${activeWorkspaceId}`);
      toast({ title: 'Removido!' });
      fetchEntries();
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível remover.', variant: 'destructive' });
    }
  };

  const importFromMonth = async (sourceMonth: string, targetMonth: string) => {
    if (!activeWorkspaceId) return;

    try {
      const data = await api.post<{ data: FinancialEntry[]; message?: string }>('/financial/import', {
        workspace_id: activeWorkspaceId,
        source_month: sourceMonth,
        target_month: targetMonth,
      });
      if (data?.data?.length === 0) {
        toast({ title: 'Aviso', description: data?.message || 'Nenhum lançamento encontrado no mês de origem.' });
      } else {
        toast({ title: 'Importado!', description: `${data?.data?.length} lançamentos importados.` });
        fetchEntries();
      }
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível importar.', variant: 'destructive' });
    }
  };

  return { entries, loading, addEntry, updateEntry, removeEntry, importFromMonth, refetch: fetchEntries };
}
