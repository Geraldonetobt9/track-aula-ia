import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { GenderizeService } from './genderize.service';

@Controller('utils')
@UseGuards(AuthGuard)
export class UtilsController {
  constructor(private readonly genderizeService: GenderizeService) {}

  @Post('genderize')
  genderize(@Body('names') names: string[]) {
    return this.genderizeService.genderize(names);
  }
}
