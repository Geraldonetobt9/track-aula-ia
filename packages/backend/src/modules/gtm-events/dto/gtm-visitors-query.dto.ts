import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class GtmVisitorsQueryDto {
  @IsUUID()
  workspace_id!: string;

  /** Inclusive start of the window (ISO 8601). */
  @IsOptional()
  @IsString()
  from?: string;

  /** Exclusive end of the window (ISO 8601). */
  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
