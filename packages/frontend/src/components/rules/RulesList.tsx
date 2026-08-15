import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RuleCard } from './RuleCard';
import { RuleHistoryDrawer } from './RuleHistoryDrawer';
import { RuleFormModal } from './RuleFormModal';
import { useAutomationRules } from '@/hooks/useAutomationRules';
import { useFacebookConnection } from '@/hooks/useFacebookConnection';
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import type { AutomationRule } from '@/hooks/useAutomationRules';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RulesList() {
  const { rules, loading, error, activeCount, createRule, updateRule, deleteRule, toggleRule, isCreating, isUpdating } =
    useAutomationRules();
  const { connections } = useFacebookConnection({ activeOnly: true, minimal: true });
  const { usage, isAtLimit } = usePlanUsage();
  const { activeWorkspaceId } = useWorkspaceContext();

  const [formOpen, setFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | undefined>(undefined);

  const [historyRule, setHistoryRule] = useState<AutomationRule | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // --------------------------
  // Handlers
  // --------------------------

  function handleNewRule() {
    setEditingRule(undefined);
    setFormOpen(true);
  }

  function handleEdit(rule: AutomationRule) {
    setEditingRule(rule);
    setFormOpen(true);
  }

  function handleHistory(rule: AutomationRule) {
    setHistoryRule(rule);
    setHistoryOpen(true);
  }

  function handleDeleteRequest(id: string) {
    setDeleteId(id);
    setDeleteDialogOpen(true);
  }

  async function handleDeleteConfirm() {
    if (!deleteId) return;
    await deleteRule(deleteId);
    setDeleteDialogOpen(false);
    setDeleteId(null);
  }

  async function handleSave(data: any) {
    if (editingRule) {
      await updateRule(editingRule.id, data);
    } else {
      await createRule({ ...data, workspace_id: activeWorkspaceId ?? '' });
    }
    setFormOpen(false);
  }

  // --------------------------
  // Plan label
  // --------------------------

  const planLabel = usage?.plan
    ? usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1)
    : '';

  const ruleLimitReached = isAtLimit('rule');
  const newRuleTooltip = ruleLimitReached
    ? `Limite de regras ativas atingido (${usage?.activeRules.used}/${usage?.activeRules.limit}). Faça upgrade.`
    : undefined;

  const totalRules = rules.length;

  // --------------------------
  // Render
  // --------------------------

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Regras Automatizadas</h1>
          <p className="text-sm text-muted-foreground">
            {activeCount} de {totalRules} regras ativas (Plano {planLabel})
          </p>
        </div>
        <Button
          onClick={handleNewRule}
          className="shrink-0"
          disabled={ruleLimitReached}
          title={newRuleTooltip}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova Regra
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <p className="text-sm text-destructive">Erro ao carregar regras: {error}</p>
      )}

      {/* Empty state */}
      {!loading && !error && rules.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">Nenhuma regra criada</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie sua primeira regra de automação para começar.
          </p>
          <Button variant="outline" className="mt-4" onClick={handleNewRule}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Regra
          </Button>
        </div>
      )}

      {/* Rules list */}
      {!loading && rules.length > 0 && (
        <div className="space-y-3">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={toggleRule}
              onEdit={handleEdit}
              onHistory={handleHistory}
              onDelete={handleDeleteRequest}
              ruleLimitReached={ruleLimitReached}
            />
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      <RuleFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        rule={editingRule}
        onSave={handleSave}
        isSaving={isCreating || isUpdating}
        connections={connections}
      />

      {/* History drawer */}
      <RuleHistoryDrawer
        rule={historyRule}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir regra</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A regra será removida permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
