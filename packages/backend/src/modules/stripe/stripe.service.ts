import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      this.logger.warn('STRIPE_SECRET_KEY not set — Stripe features will fail until configured');
    }
    this.client = new Stripe(key ?? 'sk_placeholder', {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    });
  }

  getClient(): Stripe {
    return this.client;
  }
}
