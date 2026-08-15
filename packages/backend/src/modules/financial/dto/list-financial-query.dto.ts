import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListFinancialQueryDto {
  @IsUUID()
  workspace_id!: string;

  @IsOptional()
  @IsString()
  reference_month?: string;

  /** Inclusive reference_month lower bound (YYYY-MM-DD). Takes precedence over reference_month. */
  @IsOptional()
  @IsString()
  from?: string;

  /** Inclusive reference_month upper bound (YYYY-MM-DD). Takes precedence over reference_month. */
  @IsOptional()
  @IsString()
  to?: string;
}
