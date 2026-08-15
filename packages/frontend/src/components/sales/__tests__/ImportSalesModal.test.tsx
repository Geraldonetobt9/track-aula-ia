import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportSalesModal } from '../ImportSalesModal';

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspaceContext: () => ({ activeWorkspaceId: 'ws-1' }),
}));

const previewRun = vi.fn();
const previewReset = vi.fn();
const commitRun = vi.fn();
const commitReset = vi.fn();

const previewPayload = {
  total_rows: 1,
  to_import: 1,
  duplicates: 0,
  non_approved: 0,
  invalid: 0,
  invalid_samples: [],
  sample_preview: [
    {
      transaction: 'HP1',
      product_name: 'Produto',
      customer_email: 'a@b.com',
      amount_brl: 10,
      sold_at: '2026-04-20T20:00:00Z',
    },
  ],
  integrations: [{ id: 'int-1', name: 'Conta Principal' }],
};

let previewState: any = {
  data: null,
  loading: false,
  error: null,
  run: previewRun,
  reset: previewReset,
};
let commitState: any = {
  data: null,
  loading: false,
  error: null,
  run: commitRun,
  reset: commitReset,
};

vi.mock('@/hooks/useSalesImportPreview', () => ({
  useSalesImportPreview: () => previewState,
}));
vi.mock('@/hooks/useSalesImportCommit', () => ({
  useSalesImportCommit: () => commitState,
}));

describe('ImportSalesModal', () => {
  beforeEach(() => {
    previewRun.mockReset();
    previewReset.mockReset();
    commitRun.mockReset();
    commitReset.mockReset();
    previewState = {
      data: null,
      loading: false,
      error: null,
      run: previewRun,
      reset: previewReset,
    };
    commitState = {
      data: null,
      loading: false,
      error: null,
      run: commitRun,
      reset: commitReset,
    };
  });

  it('rejects .pdf without calling the API', async () => {
    render(<ImportSalesModal open onOpenChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['data'], 'bad.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });

    await waitFor(() => {
      expect(screen.getByText(/Formato não suportado/)).toBeInTheDocument();
    });
    expect(previewRun).not.toHaveBeenCalled();
  });

  it('blocks close during importing step', async () => {
    // Seed preview hook so that after handleFileChosen resolves, preview.data is truthy
    // and the modal advances to preview-ready.
    previewRun.mockResolvedValueOnce(previewPayload);
    previewState = { ...previewState, data: previewPayload };
    // Commit runs a never-resolving promise so we remain in the 'importing' step.
    commitRun.mockImplementation(() => new Promise(() => {}));

    const onOpenChange = vi.fn();
    render(<ImportSalesModal open onOpenChange={onOpenChange} />);

    // Drop a valid CSV file to trigger handleFileChosen → preview.run → step = 'preview-ready'
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const csv = new File(['a;b\n1;2'], 'x.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [csv] } });

    // Wait until preview-ready UI is rendered
    await waitFor(() => {
      expect(screen.getByText(/A serem importadas/)).toBeInTheDocument();
    });

    // Click the Confirmar button — this transitions to 'importing'
    const confirmButton = screen.getByRole('button', { name: /Confirmar/ });
    fireEvent.click(confirmButton);

    // Assert the importing UI is displayed
    await waitFor(() => {
      expect(screen.getByText(/Processando/)).toBeInTheDocument();
    });

    // Simulate ESC to trigger Radix Dialog's onOpenChange(false).
    // closeSafely should early-return because step === 'importing'.
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    // Give any async handlers a tick to run, then assert onOpenChange was never
    // called with false while in importing state.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
