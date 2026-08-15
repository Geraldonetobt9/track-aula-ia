import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanSwitchDialog } from '../PlanSwitchDialog';

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...args: unknown[]) => apiPost(...args) },
}));

function renderDialog(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlanSwitchDialog
        planId="plan-target"
        targetPlanName="starter"
        buttonLabel="Trocar plano"
        confirmLabel="Confirmar troca"
        onConfirm={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('PlanSwitchDialog', () => {
  beforeEach(() => apiPost.mockReset());

  it('mostra "Diferença a pagar agora" em upgrade', async () => {
    apiPost.mockResolvedValue({
      kind: 'upgrade',
      currentPlan: 'pro',
      targetPlan: 'starter',
      chargeNowCents: 6000,
      nextChargeCents: 11990,
      effectiveDate: '2026-06-20T00:00:00Z',
      currency: 'brl',
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /trocar plano/i }));
    await waitFor(() => {
      expect(screen.getByText(/diferença a pagar agora/i)).toBeInTheDocument();
      expect(screen.getByText('R$ 60,00')).toBeInTheDocument();
      expect(screen.getByText(/próxima cobrança/i)).toBeInTheDocument();
      expect(screen.getByText('R$ 119,90')).toBeInTheDocument();
    });
  });

  it('mostra "Vai virar plano X em ..." em downgrade', async () => {
    apiPost.mockResolvedValue({
      kind: 'downgrade',
      currentPlan: 'starter',
      targetPlan: 'pro',
      chargeNowCents: 0,
      nextChargeCents: 5990,
      effectiveDate: '2026-06-20T00:00:00Z',
      currency: 'brl',
    });
    renderDialog({ targetPlanName: 'pro' });
    fireEvent.click(screen.getByRole('button', { name: /trocar plano/i }));
    await waitFor(() => {
      expect(screen.getByText(/vai virar plano/i)).toBeInTheDocument();
      expect(screen.queryByText(/diferença a pagar agora/i)).not.toBeInTheDocument();
    });
  });
});
