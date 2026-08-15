import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import { SaveCheckoutDto } from './dto/save-checkout.dto';
import { ToggleCheckoutDto } from './dto/toggle-checkout.dto';
import { AddCompanyCostDto } from './dto/add-company-cost.dto';
import { CreateSyncScheduleDto } from './dto/create-sync-schedule.dto';
import { UpdateSyncScheduleDto } from './dto/update-sync-schedule.dto';
import { SyncLogsQueryDto } from './dto/sync-logs-query.dto';

@Controller('integrations')
@UseGuards(AuthGuard)
export class IntegrationsController {
  constructor(private integrations: IntegrationsService) {}

  @Get('checkout')
  listCheckout(@CurrentUser('id') userId: string, @Query('workspace_id') workspaceId?: string) {
    return this.integrations.listCheckoutIntegrations(userId, workspaceId);
  }

  @Post('checkout')
  saveCheckout(@CurrentUser('id') userId: string, @Body() body: SaveCheckoutDto) {
    return this.integrations.saveCheckoutIntegration(userId, body);
  }

  @Patch('checkout/:id/toggle')
  toggleCheckout(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ToggleCheckoutDto,
  ) {
    return this.integrations.toggleCheckoutIntegration(userId, id, body.is_active);
  }

  @Delete('checkout/:id')
  deleteCheckout(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.integrations.deleteCheckoutIntegration(userId, id);
  }

  @Get('company-costs')
  listCosts(@CurrentUser('id') userId: string, @Query('workspace_id') workspaceId?: string) {
    return this.integrations.listCompanyCosts(userId, workspaceId);
  }

  @Post('company-costs')
  addCost(@CurrentUser('id') userId: string, @Body() body: AddCompanyCostDto) {
    return this.integrations.addCompanyCost(userId, body);
  }

  @Delete('company-costs/:id')
  removeCost(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.integrations.removeCompanyCost(userId, id);
  }

  @Get('sync-schedules')
  getSyncSchedules(@CurrentUser('id') userId: string, @Query('workspace_id') workspaceId?: string) {
    return this.integrations.getSyncSchedules(userId, workspaceId);
  }

  @Post('sync-schedules')
  createSyncSchedule(@CurrentUser('id') userId: string, @Body() body: CreateSyncScheduleDto) {
    return this.integrations.createSyncSchedule(userId, body);
  }

  @Patch('sync-schedules/:id')
  updateSyncSchedule(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSyncScheduleDto,
  ) {
    return this.integrations.updateSyncSchedule(userId, id, body);
  }

  @Get('sync-logs')
  getSyncLogs(
    @CurrentUser('id') userId: string,
    @Query() query: SyncLogsQueryDto,
    @Query('workspace_id') workspaceId?: string,
  ) {
    return this.integrations.getSyncLogs(userId, query.limit ? parseInt(query.limit) : 20, workspaceId);
  }
}
