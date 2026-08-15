import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetSalesQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  checkout_ids?: string;

  @IsOptional()
  @IsString()
  product_names?: string;

  @IsOptional()
  @IsString()
  campaign_ids?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  page_size?: number;

  @IsOptional()
  @IsString()
  target_user_id?: string;

  @IsOptional()
  @IsString()
  workspace_id?: string;
}
