import { Global, Module } from '@nestjs/common';
import { AdSpendSyncService } from './ad-spend-sync.service';

/**
 * Global para a jornada e o cron da CAPI usarem o mesmo refresh sem um
 * ciclo de imports entre TrackingModule e MetaCapiModule.
 */
@Global()
@Module({
  providers: [AdSpendSyncService],
  exports: [AdSpendSyncService],
})
export class AdSpendSyncModule {}
