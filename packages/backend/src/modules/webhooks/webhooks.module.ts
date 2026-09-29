import { Module, forwardRef } from '@nestjs/common';
import { SharedModule } from '../../shared/shared.module';
import { SalesModule } from '../sales/sales.module';
import { MetaCapiModule } from '../meta-capi/meta-capi.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookQueueService } from './webhook-queue.service';
import { KirvanoProcessor } from './processors/kirvano.processor';
import { HotmartProcessor } from './processors/hotmart.processor';
import { GuruProcessor } from './processors/guru.processor';
import { PerfectPayProcessor } from './processors/perfectpay.processor';
import { KiwifyProcessor } from './processors/kiwify.processor';
import { TictoProcessor } from './processors/ticto.processor';
import { CaktoProcessor } from './processors/cakto.processor';
import { PaytProcessor } from './processors/payt.processor';
import { N8nProfilesProcessor } from './processors/n8n-profiles.processor';
import { HublaProcessor } from './processors/hubla.processor';
import { CartPandaProcessor } from './processors/cartpanda.processor';
import { GGCheckoutProcessor } from './processors/ggcheckout.processor';
import { LastLinkProcessor } from './processors/lastlink.processor';
import { EduzzProcessor } from './processors/eduzz.processor';
import { MundpayProcessor } from './processors/mundpay.processor';
import { MonetizzeProcessor } from './processors/monetizze.processor';
import { GreennProcessor } from './processors/greenn.processor';
import { GenericCheckoutProcessor } from './processors/generic/generic-checkout.processor';

@Module({
  imports: [SharedModule, MetaCapiModule, forwardRef(() => SalesModule)],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookQueueService,
    KirvanoProcessor,
    HotmartProcessor,
    GuruProcessor,
    PerfectPayProcessor,
    KiwifyProcessor,
    TictoProcessor,
    CaktoProcessor,
    PaytProcessor,
    N8nProfilesProcessor,
    HublaProcessor,
    CartPandaProcessor,
    GGCheckoutProcessor,
    LastLinkProcessor,
    EduzzProcessor,
    MundpayProcessor,
    MonetizzeProcessor,
    GreennProcessor,
    GenericCheckoutProcessor,
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
