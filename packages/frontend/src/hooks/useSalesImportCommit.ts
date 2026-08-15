import { useState } from 'react';
import { api } from '@/lib/api';

export interface ImportCommitResponse {
  imported: number;
  skipped_duplicates: number;
  skipped_non_approved: number;
  skipped_invalid: number;
  invalid_samples: Array<{ row: number; reason: string }>;
}

export function useSalesImportCommit() {
  const [data, setData] = useState<ImportCommitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = async (file: File, workspaceId: string, integrationId: string) => {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('platform', 'hotmart');
      fd.append('workspace_id', workspaceId);
      fd.append('integration_id', integrationId);
      const result = await api.postMultipart<ImportCommitResponse>('/sales/import', fd);
      setData(result);
      return result;
    } catch (err: any) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setData(null);
    setError(null);
  };

  return { data, loading, error, run, reset };
}
