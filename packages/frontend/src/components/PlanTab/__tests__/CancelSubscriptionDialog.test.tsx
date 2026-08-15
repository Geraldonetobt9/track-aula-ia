import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CancelSubscriptionDialog } from '../CancelSubscriptionDialog';

const cancelMutate = vi.fn();

vi.mock('@/hooks/useStripeCancel', () => ({
  useStripeCancel: () => ({
    mutateAsync: cancelMutate,
    isPending: false,
  }),
}));

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('CancelSubscriptionDialog', () => {
  beforeEach(() => cancelMutate.mockReset());

  it('mostra a data de fim formatada', () => {
    renderWithProviders(
      <CancelSubscriptionDialog
        open
        onOpenChange={() => {}}
        endsAtIso="2026-06-15T00:00:00Z"
        planName="pro"
      />,
    );
    expect(screen.getByText(/de junho de 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/pro/i)).toBeInTheDocument();
  });

  it('chama mutation ao confirmar', async () => {
    cancelMutate.mockResolvedValue({});
    renderWithProviders(
      <CancelSubscriptionDialog
        open
        onOpenChange={() => {}}
        endsAtIso="2026-06-15T00:00:00Z"
        planName="pro"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sim, cancelar/i }));
    await waitFor(() => expect(cancelMutate).toHaveBeenCalled());
  });
});
