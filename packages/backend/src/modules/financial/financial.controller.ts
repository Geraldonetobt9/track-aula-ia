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
import { FinancialService } from './financial.service';
import { ListFinancialQueryDto } from './dto/list-financial-query.dto';
import { AddFinancialEntryDto } from './dto/add-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { ImportFinancialEntriesDto } from './dto/import-financial-entries.dto';
import { FinancialSummaryQueryDto } from './dto/financial-summary-query.dto';

@Controller('financial')
@UseGuards(AuthGuard)
export class FinancialController {
  constructor(private readonly financialService: FinancialService) {}

  @Get('summary')
  getSummary(
    @CurrentUser('id') userId: string,
    @Query() query: FinancialSummaryQueryDto,
  ) {
    const effectiveUserId = query.target_user_id ?? userId;
    return this.financialService.getSummary(effectiveUserId, query.workspace_id, {
      referenceMonth: query.reference_month,
      from: query.from,
      to: query.to,
    });
  }

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListFinancialQueryDto,
  ) {
    return this.financialService.list(userId, query.workspace_id, {
      referenceMonth: query.reference_month,
      from: query.from,
      to: query.to,
    });
  }

  @Post()
  add(@CurrentUser('id') userId: string, @Body() body: AddFinancialEntryDto) {
    return this.financialService.add(userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateFinancialEntryDto,
  ) {
    return this.financialService.update(userId, id, body.workspace_id, {
      name: body.name,
      amount: body.amount,
    });
  }

  @Post('import')
  importEntries(
    @CurrentUser('id') userId: string,
    @Body() body: ImportFinancialEntriesDto,
  ) {
    return this.financialService.importEntries(
      userId,
      body.workspace_id,
      body.source_month,
      body.target_month,
    );
  }

  @Delete(':id')
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('workspace_id', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.financialService.remove(userId, id, workspaceId);
  }
}
