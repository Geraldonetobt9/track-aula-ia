import { loadStripe, Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      throw new Error('VITE_STRIPE_PUBLISHABLE_KEY não configurada');
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}
