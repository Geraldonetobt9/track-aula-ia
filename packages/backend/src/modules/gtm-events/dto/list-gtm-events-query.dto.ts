import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListGtmEventsQueryDto {
  @IsUUID()
  workspace_id!: string;

  /** Keyset cursor: `created_at` of the last row already loaded (ISO 8601). */
  @IsOptional()
  @IsString()
  before?: string;

  @IsOptional()
  @IsString()
  event_name?: string;

  /** Inclusive start of the window (ISO 8601). Omitted means no lower bound. */
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
  @Max(200)
  limit?: number;
}
