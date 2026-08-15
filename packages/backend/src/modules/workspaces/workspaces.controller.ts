import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateAdSpendTaxDto } from './dto/update-ad-spend-tax.dto';

@Controller('workspaces')
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query('target_user_id') targetUserId?: string,
  ) {
    return this.workspacesService.list(userId, targetUserId);
  }


  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspacesService.create(userId, dto.name);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspacesService.update(userId, id, dto.name);
  }

  @Patch(':id/ad-spend-tax')
  updateAdSpendTax(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdSpendTaxDto,
  ) {
    return this.workspacesService.updateAdSpendTax(userId, id, dto.percentage);
  }

  @Delete(':id')
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workspacesService.remove(userId, id);
  }

}
