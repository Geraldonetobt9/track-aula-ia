import { Module } from '@nestjs/common';
import { UtilsController } from './utils.controller';
import { GenderizeService } from './genderize.service';
import { EmailService } from './email.service';

@Module({
  controllers: [UtilsController],
  providers: [GenderizeService, EmailService],
  exports: [GenderizeService, EmailService],
})
export class UtilsModule {}
