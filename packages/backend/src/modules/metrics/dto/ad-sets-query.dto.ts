import { IsOptional, IsString } from 'class-validator';

export class AdSetsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  campaign_id?: string;

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
  workspace_id?: string;
}
