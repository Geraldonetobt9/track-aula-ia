import { useState } from 'react';
import { api } from '@/lib/api';

export interface ImportPreviewResponse {
  total_rows: number;
  to_import: number;
  duplicates: number;
  non_approved: number;
  invalid: number;
  invalid_samples: Array<{ row: number; reason: string }>;
  sample_preview: Array<{
    transaction: string;
    product_name: string | null;
    customer_email: string | null;
    amount_brl: number;
    sold_at: string;
  }>;
  integrations: Array<{ id: string; name: string }>;
}

export function useSalesImportPreview() {
  const [data, setData] = useState<ImportPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = async (file: File, workspaceId: string) => {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('platform', 'hotmart');
      fd.append('workspace_id', workspaceId);
      const result = await api.postMultipart<ImportPreviewResponse>('/sales/import/preview', fd);
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
