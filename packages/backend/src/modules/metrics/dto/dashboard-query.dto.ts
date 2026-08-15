import { IsOptional, IsString } from 'class-validator';

export class DashboardQueryDto {
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
  checkout_ids?: string;

  @IsOptional()
  @IsString()
  product_names?: string;

  @IsOptional()
  @IsString()
  target_user_id?: string;

  @IsOptional()
  @IsString()
  workspace_id?: string;

  /**
   * `'all'` for "todo período". The start is resolved server-side rather than
   * sent as a date, so revenue and ad spend cannot drift onto different windows.
   */
  @IsOptional()
  @IsString()
  period?: string;
}
