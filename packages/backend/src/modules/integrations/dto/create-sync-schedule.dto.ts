import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSyncScheduleDto {
  @IsString()
  sync_type!: string;

  @IsNumber()
  @Min(1)
  interval_minutes!: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
