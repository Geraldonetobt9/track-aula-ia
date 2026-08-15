import { Module } from '@nestjs/common';
import { VturbController } from './vturb.controller';
import { VturbService } from './vturb.service';
import { VturbApiClient } from './vturb-api.client';

@Module({
  controllers: [VturbController],
  providers: [VturbService, VturbApiClient],
})
export class VturbModule {}
