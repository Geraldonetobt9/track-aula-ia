import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Workspace } from '@/hooks/useWorkspaces';

interface WorkspaceContextType {
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  setActiveWorkspace: (id: string) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  activeWorkspaceId: null,
  activeWorkspace: null,
  workspaces: [],
  setActiveWorkspace: () => {},
  setWorkspaces: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspacesState] = useState<Workspace[]>([]);

  useEffect(() => {
    if (workspaces.length > 0 && !activeWorkspaceId) {
      const saved = localStorage.getItem('sentinel_active_workspace');
      if (saved && workspaces.find(w => w.id === saved)) {
        setActiveWorkspaceId(saved);
      } else {
        setActiveWorkspaceId(workspaces[0].id);
      }
    }
    if (activeWorkspaceId && workspaces.length > 0 && !workspaces.find(w => w.id === activeWorkspaceId)) {
      setActiveWorkspaceId(workspaces[0].id);
    }
    if (workspaces.length === 0) {
      setActiveWorkspaceId(null);
    }
  }, [workspaces]);

  const setActiveWorkspace = useCallback((id: string) => {
    setActiveWorkspaceId(id);
    localStorage.setItem('sentinel_active_workspace', id);
  }, []);

  const setWorkspaces = useCallback((ws: Workspace[]) => {
    setWorkspacesState(ws);
  }, []);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;

  return (
    <WorkspaceContext.Provider
      value={{
        activeWorkspaceId,
        activeWorkspace,
        workspaces,
        setActiveWorkspace,
        setWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext() {
  return useContext(WorkspaceContext);
}
