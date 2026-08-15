import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useToast } from '@/hooks/use-toast';

export interface CompanyCost {
  id: string;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
}

export function useCompanyCosts() {
  const { supabaseUser } = useAuth();
  const { activeWorkspaceId } = useWorkspaceContext();
  const { toast } = useToast();
  const [costs, setCosts] = useState<CompanyCost[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCosts = useCallback(async () => {
    if (!supabaseUser || !activeWorkspaceId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('workspace_id', activeWorkspaceId);
      const data = await api.get<CompanyCost[]>(`/integrations/company-costs?${params}`);
      setCosts(
        (data || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          type: c.type as 'percentage' | 'fixed',
          value: Number(c.value),
        }))
      );
    } catch (error) {
      console.error('Error fetching costs:', error);
    }
    setLoading(false);
  }, [supabaseUser, activeWorkspaceId]);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  const addCost = async (name: string, type: 'percentage' | 'fixed', value: number) => {
    if (!supabaseUser) return;
    try {
      await api.post('/integrations/company-costs', { name, type, value, workspace_id: activeWorkspaceId });
      toast({ title: 'Custo adicionado!', description: `${name} foi adicionado com sucesso.` });
      fetchCosts();
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível adicionar o custo.', variant: 'destructive' });
    }
  };

  const removeCost = async (id: string) => {
    try {
      await api.delete(`/integrations/company-costs/${id}`);
      toast({ title: 'Custo removido', description: 'O custo foi removido com sucesso.' });
      fetchCosts();
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível remover o custo.', variant: 'destructive' });
    }
  };

  return { costs, loading, addCost, removeCost };
}
