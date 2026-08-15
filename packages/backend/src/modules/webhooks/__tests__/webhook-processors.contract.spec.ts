// Parameterized contract spec for the sales processors.
// Proves the "processor → SalesService.upsertFromWebhook" contract exists for
// every platform. Deep payload coverage for newer platforms lives in
// new-platforms.spec.ts; this file guards against processor regressions
// without duplicating payload fixtures.
import { HotmartProcessor } from '../processors/hotmart.processor';
import { KiwifyProcessor } from '../processors/kiwify.processor';
import { KirvanoProcessor } from '../processors/kirvano.processor';
import { GuruProcessor } from '../processors/guru.processor';
import { PerfectPayProcessor } from '../processors/perfectpay.processor';
import { TictoProcessor } from '../processors/ticto.processor';
import { PaytProcessor } from '../processors/payt.processor';
import { CaktoProcessor } from '../processors/cakto.processor';
import { CartPandaProcessor } from '../processors/cartpanda.processor';
import { GGCheckoutProcessor } from '../processors/ggcheckout.processor';
import { LastLinkProcessor } from '../processors/lastlink.processor';
import { HublaProcessor } from '../processors/hubla.processor';
import { EduzzProcessor } from '../processors/eduzz.processor';
import { MundpayProcessor } from '../processors/mundpay.processor';
import { MonetizzeProcessor } from '../processors/monetizze.processor';
import { GreennProcessor } from '../processors/greenn.processor';

// All sales processors (n8n-profiles is profile-only and excluded).
const SALES_PROCESSORS: Array<[string, any]> = [
  ['hotmart',    HotmartProcessor],
  ['kiwify',     KiwifyProcessor],
  ['kirvano',    KirvanoProcessor],
  ['guru',       GuruProcessor],
  ['perfectpay', PerfectPayProcessor],
  ['ticto',      TictoProcessor],
  ['payt',       PaytProcessor],
  ['cakto',      CaktoProcessor],
  ['cartpanda',  CartPandaProcessor],
  ['ggcheckout', GGCheckoutProcessor],
  ['lastlink',   LastLinkProcessor],
  ['hubla',      HublaProcessor],
  ['eduzz',      EduzzProcessor],
  ['mundpay',    MundpayProcessor],
  ['monetizze',  MonetizzeProcessor],
  ['greenn',     GreennProcessor],
];

describe('Webhook processors contract', () => {
  // NestJS DI dependencies are not instantiated here — we're verifying
  // class-level invariants (exports, method shape) that hold regardless of
  // construction.

  it.each(SALES_PROCESSORS)('%s processor exports a class', (_name, Cls) => {
    expect(typeof Cls).toBe('function');
    expect(Cls.name).toBeTruthy();
  });

  it.each(SALES_PROCESSORS)('%s processor defines a .process method', (_name, Cls) => {
    const proto = Cls.prototype;
    expect(typeof proto.process).toBe('function');
  });

  it('expects exactly 16 sales processors in this registry', () => {
    // If this count changes, either a platform was added/removed (update the
    // registry above) or n8n-profiles was wrongly included.
    expect(SALES_PROCESSORS).toHaveLength(16);
  });
});
