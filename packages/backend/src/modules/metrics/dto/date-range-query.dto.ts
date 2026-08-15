import { IsOptional, IsString } from 'class-validator';

export class DateRangeQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  connection_ids?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  target_user_id?: string;

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
  workspace_id?: string;
}
