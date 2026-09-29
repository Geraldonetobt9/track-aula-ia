import { Module } from '@nestjs/common';
import { MetaCapiService } from './meta-capi.service';
import { MetaCapiController, MetaCapiCronController } from './meta-capi.controller';

/**
 * Meta Conversions API: PageView e InitiateCheckout a partir do snippet,
 * Purchase a partir do webhook. Faz o papel que as tags do Facebook e o Stape
 * Store faziam nos containers do sGTM.
 */
@Module({
  controllers: [MetaCapiController, MetaCapiCronController],
  providers: [MetaCapiService],
  exports: [MetaCapiService],
})
export class MetaCapiModule {}
