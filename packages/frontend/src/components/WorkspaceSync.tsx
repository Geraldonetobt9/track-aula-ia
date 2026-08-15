import { useEffect, useRef } from 'react';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';

/**
 * Invisible component that syncs workspace data from the hook
 * into the WorkspaceContext. Place inside authenticated layouts.
 */
export function WorkspaceSync() {
  const { workspaces } = useWorkspaces();
  const { setWorkspaces } = useWorkspaceContext();
  const prevJsonRef = useRef('');

  useEffect(() => {
    const json = JSON.stringify(workspaces);
    if (json !== prevJsonRef.current) {
      prevJsonRef.current = json;
      setWorkspaces(workspaces);
    }
  }, [workspaces, setWorkspaces]);

  return null;
}
