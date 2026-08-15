import { IsOptional, IsString, IsUUID } from 'class-validator';

export class FinancialSummaryQueryDto {
  @IsUUID()
  workspace_id!: string;

  @IsOptional()
  @IsString()
  reference_month?: string;

  /** Inclusive start date (YYYY-MM-DD). Takes precedence over reference_month. */
  @IsOptional()
  @IsString()
  from?: string;

  /** Inclusive end date (YYYY-MM-DD). Takes precedence over reference_month. */
  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  target_user_id?: string;
}
