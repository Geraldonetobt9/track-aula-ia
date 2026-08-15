import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdatePlanDto {
  @IsOptional() @IsInt() @Min(-1)
  max_sales_monthly?: number;

  @IsOptional() @IsInt() @Min(-1)
  max_active_ad_accounts?: number;

  @IsOptional() @IsInt() @Min(-1)
  max_checkout_integrations?: number;

  @IsOptional() @IsInt() @Min(-1)
  max_workspaces?: number;

  @IsOptional() @IsInt() @Min(-1)
  max_active_rules?: number;

  @IsOptional() @IsInt() @Min(0)
  overage_price_cents?: number;
}
