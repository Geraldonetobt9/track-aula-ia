import { IsOptional, IsString } from 'class-validator';

export class AdsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  ad_set_id?: string;

  @IsOptional()
  @IsString()
  ad_set_ids?: string;

  @IsOptional()
  @IsString()
  campaign_ids?: string;

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
  workspace_id?: string;
}
