import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Layers, Plus, X, Trash2, Pencil, Check, Lock } from 'lucide-react';

interface WorkspaceSwitcherProps {
  collapsed?: boolean;
  /** "sidebar" = vertical compact (default), "inline" = horizontal for dashboard header */
  variant?: 'sidebar' | 'inline';
}

export function WorkspaceSwitcher({ collapsed, variant = 'sidebar' }: WorkspaceSwitcherProps) {
  const { activeWorkspaceId, workspaces, setActiveWorkspace } = useWorkspaceContext();
  const { createWorkspace, updateWorkspace, deleteWorkspace } = useWorkspaces();
  const { canCreate: canCreateWorkspace, isAtLimit, usage } = usePlanUsage();

  const { data: archivedWorkspaces = [] } = useQuery<{ id: string; name: string; archived_at: string }[]>({
    queryKey: ['workspaces-archived'],
    queryFn: () => api.get('/workspaces/archived'),
    staleTime: 60_000,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const canCreate = canCreateWorkspace('workspace');
  const workspaceLimitTooltip = isAtLimit('workspace')
    ? `Limite de workspaces atingido (${usage?.workspaces.used}/${usage?.workspaces.limit}). Faça upgrade.`
    : undefined;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const ws = await createWorkspace(newName.trim());
    if (ws) {
      setActiveWorkspace(ws.id);
      setNewName('');
      setShowCreate(false);
    }
    setCreating(false);
  };

  const handleDelete = async () => {
    if (!activeWorkspaceId) return;
    setDeleting(true);
    await deleteWorkspace(activeWorkspaceId);
    setShowDeleteConfirm(false);
    setDeleting(false);
  };

  const handleRename = async () => {
    if (!activeWorkspaceId || !editName.trim()) return;
    setSaving(true);
    const ok = await updateWorkspace(activeWorkspaceId, editName.trim());
    if (ok) setEditingName(false);
    setSaving(false);
  };

  const activeWorkspaceName = workspaces.find(w => w.id === activeWorkspaceId)?.name || '';

  const startEditing = () => {
    setEditName(activeWorkspaceName);
    setEditingName(true);
  };

  // Collapsed sidebar icon
  if (collapsed && variant === 'sidebar') {
    return (
      <div className="px-3 py-2">
        <div className="flex items-center justify-center">
          <Layers className="h-4 w-4 text-accent-readable" />
        </div>
      </div>
    );
  }

  // Inline variant for Dashboard header
  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-accent-readable shrink-0" />

        {editingName ? (
          <div className="flex items-center gap-1">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-9 w-[160px] text-xs bg-foreground/[0.03] border-foreground/10 text-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setEditingName(false);
              }}
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-accent-readable hover:bg-foreground/5"
              onClick={handleRename}
              disabled={saving || !editName.trim()}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-muted-foreground/40 hover:bg-foreground/5"
              onClick={() => setEditingName(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <>
            {workspaces.length > 0 ? (
              <Select value={activeWorkspaceId || ''} onValueChange={setActiveWorkspace}>
                <SelectTrigger className="h-9 w-[180px] text-xs bg-foreground/[0.03] border-foreground/10 text-muted-foreground">
                  <SelectValue placeholder="Selecionar área" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id} className="text-xs">
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {activeWorkspaceId && workspaces.length > 0 && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 text-muted-foreground/40 hover:text-accent-readable hover:bg-foreground/5"
                  onClick={startEditing}
                  title="Renomear área"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 text-muted-foreground/40 hover:text-destructive hover:bg-foreground/5"
                  onClick={() => setShowDeleteConfirm(true)}
                  title="Excluir área"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </>
        )}

        {showCreate ? (
          <div className="flex items-center gap-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da área"
              className="h-9 w-[160px] text-xs bg-foreground/[0.03] border-foreground/10 text-foreground"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-accent-readable hover:bg-foreground/5"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-muted-foreground/40 hover:bg-foreground/5"
              onClick={() => { setShowCreate(false); setNewName(''); }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-muted-foreground/50 hover:text-accent-readable hover:bg-foreground/5 gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => canCreate && setShowCreate(true)}
            disabled={!canCreate}
            title={workspaceLimitTooltip}
          >
            <Plus className="h-3.5 w-3.5" /> Nova área
          </Button>
        )}

        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir área "{activeWorkspaceName}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Todas as conexões associadas a esta área serão removidas. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              >
                {deleting ? 'Excluindo...' : 'Excluir'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Default sidebar variant
  return (
    <div className="px-3 py-2 border-b border-foreground/5">
      <p className="mb-1.5 px-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
        Área
      </p>

      {workspaces.length > 0 ? (
        <Select value={activeWorkspaceId || ''} onValueChange={setActiveWorkspace}>
          <SelectTrigger className="h-8 text-xs bg-foreground/[0.03] border-foreground/10 text-muted-foreground">
            <SelectValue placeholder="Selecionar área" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((ws) => (
              <SelectItem key={ws.id} value={ws.id} className="text-xs">
                {ws.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-[10px] text-muted-foreground/40 px-1">Nenhuma área criada</p>
      )}

      {showCreate ? (
        <div className="mt-2 flex gap-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome da área"
            className="h-7 text-xs bg-foreground/[0.03] border-foreground/10 text-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-accent-readable hover:bg-foreground/5"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground/40 hover:bg-foreground/5"
            onClick={() => { setShowCreate(false); setNewName(''); }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1.5 w-full h-7 text-[10px] text-muted-foreground/50 hover:text-accent-readable hover:bg-foreground/5 justify-start gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => canCreate && setShowCreate(true)}
          disabled={!canCreate}
          title={workspaceLimitTooltip}
        >
          <Plus className="h-3 w-3" /> Nova área
        </Button>
      )}

      {archivedWorkspaces.length > 0 && (
        <div className="mt-2 pt-2 border-t border-foreground/5">
          <p className="mb-1 px-1 text-[10px] uppercase tracking-wider text-muted-foreground/30 font-medium">
            Arquivados
          </p>
          {archivedWorkspaces.map((ws) => (
            <div
              key={ws.id}
              className="flex items-center gap-1.5 px-1 py-1 text-[10px] text-muted-foreground/40 cursor-not-allowed opacity-60"
              title="Workspace arquivado por downgrade. Faça upgrade para reativar."
            >
              <Lock className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{ws.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
