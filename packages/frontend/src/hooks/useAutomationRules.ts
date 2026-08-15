import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuleCondition {
  id: string;
  rule_id: string;
  metric: string;
  operator: string;
  value: number;
}

export interface BudgetAdjustment {
  mode: 'percentage' | 'fixed';
  value: number;
  budget_type: 'daily' | 'lifetime';
  min_budget?: number;
  max_budget?: number;
}

export interface AutomationRule {
  id: string;
  name: string;
  is_active: boolean;
  connection_id: string | null;
  target_entity: 'campaign' | 'adset' | 'ad';
  target_status: 'active' | 'paused' | 'any';
  name_filter: string | null;
  action_type: 'activate' | 'pause' | 'increase_budget' | 'decrease_budget';
  budget_adjustment: BudgetAdjustment | null;
  evaluation_period: 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'custom';
  custom_start_date: string | null;
  frequency_minutes: number;
  daily_run_time: string | null;
  last_executed_at: string | null;
  conditions: RuleCondition[];
}

export interface CreateRulePayload {
  workspace_id: string;
  name: string;
  connection_id?: string;
  target_entity: string;
  target_status: string;
  name_filter?: string;
  action_type: string;
  budget_adjustment?: BudgetAdjustment;
  evaluation_period: string;
  custom_start_date?: string;
  frequency_minutes: number;
  daily_run_time?: string;
  conditions: Array<{ metric: string; operator: string; value: number }>;
}

export type UpdateRulePayload = Partial<Omit<CreateRulePayload, 'workspace_id'>>;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const STALE_TIME = 30_000;

export function useAutomationRules() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { getEffectiveUserId } = useImpersonation();
  const { activeWorkspaceId } = useWorkspaceContext();

  const effectiveId = getEffectiveUserId(user?.id);

  const queryKey = ['automation-rules', effectiveId, activeWorkspaceId] as const;

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  const { data: rules = [], isLoading: loading, error: queryError } = useQuery<AutomationRule[]>({
    queryKey,
    queryFn: async () => {
      if (!activeWorkspaceId) return [];
      const params = new URLSearchParams({ workspace_id: activeWorkspaceId });
      return api.get<AutomationRule[]>(`/automation-rules?${params}`);
    },
    enabled: !!effectiveId && !!activeWorkspaceId,
    staleTime: STALE_TIME,
  });

  const error = queryError ? (queryError as Error).message : null;
  const activeCount = rules.filter((r) => r.is_active).length;

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: (payload: CreateRulePayload) =>
      api.post<AutomationRule>('/automation-rules', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Regra criada com sucesso!');
    },
    onError: (err: Error) => {
      toast.error(`Erro ao criar regra: ${err.message}`);
    },
  });

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateRulePayload }) =>
      api.patch<AutomationRule>(`/automation-rules/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Regra atualizada com sucesso!');
    },
    onError: (err: Error) => {
      toast.error(`Erro ao atualizar regra: ${err.message}`);
    },
  });

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/automation-rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Regra excluída.');
    },
    onError: (err: Error) => {
      toast.error(`Erro ao excluir regra: ${err.message}`);
    },
  });

  // -------------------------------------------------------------------------
  // Toggle
  // -------------------------------------------------------------------------

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch<AutomationRule>(`/automation-rules/${id}/toggle`),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey });
      const label = updated.is_active ? 'ativada' : 'pausada';
      toast.success(`Regra ${label}.`);
    },
    onError: (err: Error) => {
      toast.error(`Erro ao alterar status da regra: ${err.message}`);
    },
  });

  // -------------------------------------------------------------------------
  // Stable action callbacks
  // -------------------------------------------------------------------------

  const createRule = (payload: CreateRulePayload) => createMutation.mutateAsync(payload);
  const updateRule = (id: string, payload: UpdateRulePayload) =>
    updateMutation.mutateAsync({ id, payload });
  const deleteRule = (id: string) => deleteMutation.mutateAsync(id);
  const toggleRule = (id: string) => toggleMutation.mutateAsync(id);

  return {
    rules,
    loading,
    error,
    activeCount,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}
