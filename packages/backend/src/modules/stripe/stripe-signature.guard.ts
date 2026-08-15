import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { StripeService } from './stripe.service';

@Injectable()
export class StripeSignatureGuard implements CanActivate {
  constructor(private readonly stripe: StripeService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest();
    const signature = request.headers['stripe-signature'];
    const rawBody = request.rawBody;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature) throw new UnauthorizedException('Missing stripe-signature header');
    if (!rawBody) throw new UnauthorizedException('Missing raw body');
    if (!secret) throw new UnauthorizedException('STRIPE_WEBHOOK_SECRET not configured');

    try {
      request.stripeEvent = this.stripe.getClient().webhooks.constructEvent(
        rawBody as string | Buffer,
        signature as string,
        secret,
      );
      return true;
    } catch {
      throw new UnauthorizedException('Invalid Stripe signature');
    }
  }
}
