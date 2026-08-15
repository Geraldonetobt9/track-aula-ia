import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateSyncScheduleDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  interval_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
