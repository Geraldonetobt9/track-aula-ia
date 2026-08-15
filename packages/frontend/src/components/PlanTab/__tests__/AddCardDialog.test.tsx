import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddCardDialog } from '../AddCardDialog';

const setupIntentMutate = vi.fn();
const attachMutate = vi.fn();
const confirmSetup = vi.fn();
const elementsSubmit = vi.fn().mockResolvedValue({ error: undefined });

vi.mock('@/hooks/useStripeSetupIntent', () => ({
  useStripeSetupIntent: () => ({
    mutateAsync: setupIntentMutate,
    isPending: false,
    reset: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAttachPaymentMethod', () => ({
  useAttachPaymentMethod: () => ({
    mutateAsync: attachMutate,
    isPending: false,
  }),
}));

vi.mock('@/lib/stripe', () => ({
  getStripePromise: () => Promise.resolve({}),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div data-testid="elements">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useElements: () => ({ submit: elementsSubmit }),
  useStripe: () => ({
    confirmSetup,
  }),
}));

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('AddCardDialog', () => {
  beforeEach(() => {
    setupIntentMutate.mockReset();
    attachMutate.mockReset();
    confirmSetup.mockReset();
    elementsSubmit.mockClear();
  });

  it('chama setup-intent ao abrir e renderiza Elements quando recebe clientSecret', async () => {
    setupIntentMutate.mockResolvedValue({ clientSecret: 'seti_1_secret' });
    renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(setupIntentMutate).toHaveBeenCalled();
      expect(screen.getByTestId('elements')).toBeInTheDocument();
      expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    });
  });

  it('confirma setup e chama attach com paymentMethodId', async () => {
    setupIntentMutate.mockResolvedValue({ clientSecret: 'seti_1_secret' });
    confirmSetup.mockResolvedValue({
      setupIntent: { payment_method: 'pm_new' },
      error: undefined,
    });
    attachMutate.mockResolvedValue({ success: true, is_default: true });
    renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />);
    await waitFor(() => screen.getByTestId('payment-element'));
    fireEvent.click(screen.getByRole('button', { name: /salvar cartão/i }));
    await waitFor(() => {
      expect(attachMutate).toHaveBeenCalledWith({
        paymentMethodId: 'pm_new',
        setAsDefault: false,
      });
    });
  });

  it('exibe erro inline quando confirmSetup falha', async () => {
    setupIntentMutate.mockResolvedValue({ clientSecret: 'seti_1_secret' });
    confirmSetup.mockResolvedValue({
      error: { message: 'Cartão recusado' },
    });
    renderWithProviders(<AddCardDialog open onOpenChange={() => {}} />);
    await waitFor(() => screen.getByTestId('payment-element'));
    fireEvent.click(screen.getByRole('button', { name: /salvar cartão/i }));
    await waitFor(() => {
      expect(screen.getByText(/cartão recusado/i)).toBeInTheDocument();
      expect(attachMutate).not.toHaveBeenCalled();
    });
  });
});
