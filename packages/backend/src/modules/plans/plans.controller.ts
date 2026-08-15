import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PlansService } from './plans.service';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get('rules')
  @UseGuards(AuthGuard)
  list() {
    return this.plansService.list();
  }

  @Get('rules/:plan')
  @UseGuards(AuthGuard)
  getByPlan(@Param('plan') plan: string) {
    return this.plansService.getRulesForPlan(plan);
  }

  @Patch('rules/:plan')
  @UseGuards(AuthGuard, AdminGuard)
  update(@Param('plan') plan: string, @Body() updates: UpdatePlanDto) {
    return this.plansService.update(plan, updates as Record<string, unknown>);
  }
}
