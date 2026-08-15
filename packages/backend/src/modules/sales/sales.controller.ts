import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SalesService, SalesFilters } from './sales.service';
import { GetSalesQueryDto } from './dto/get-sales-query.dto';

function buildFilters(query: GetSalesQueryDto): SalesFilters {
  return {
    from: query.from,
    to: query.to,
    statuses: query.status ? query.status.split(',').filter(Boolean) : undefined,
    workspace_id: query.workspace_id,
    checkout_ids: query.checkout_ids ? query.checkout_ids.split(',').filter(Boolean) : undefined,
    product_names: query.product_names ? query.product_names.split(',').filter(Boolean) : undefined,
    campaign_ids: query.campaign_ids ? query.campaign_ids.split(',').filter(Boolean) : undefined,
    q: query.q,
    page: query.page,
    page_size: query.page_size,
  };
}

function decorate(sale: any) {
  const { campaigns, ad_sets, ads, checkout_integrations, checkout_source, ...rest } = sale;
  return {
    ...rest,
    campaign_name: campaigns?.name ?? null,
    ad_set_name: ad_sets?.name ?? null,
    ad_name: ads?.name ?? null,
    checkout_platform: checkout_integrations?.platform ?? checkout_source ?? null,
    type: sale.campaign_id ? 'paid' : 'organic',
  };
}

@Controller('sales')
@UseGuards(AuthGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  async getSales(
    @CurrentUser('id') userId: string,
    @Query() query: GetSalesQueryDto,
  ) {
    const result = await this.salesService.getSalesWithDetails(userId, buildFilters(query));
    return {
      data: result.data.map(decorate),
      total: result.total,
      page: result.page,
      page_size: result.page_size,
    };
  }

  @Get('summary')
  async getSummary(
    @CurrentUser('id') userId: string,
    @Query() query: GetSalesQueryDto,
  ) {
    return this.salesService.getSalesSummary(userId, buildFilters(query));
  }

  @Get('products')
  async getProducts(
    @CurrentUser('id') userId: string,
    @Query('workspace_id') workspaceId?: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspace_id is required');
    }
    return this.salesService.getDistinctProductNames(userId, workspaceId);
  }
}
