import { IsNumberString, IsOptional } from 'class-validator';

export class SyncLogsQueryDto {
  @IsOptional()
  @IsNumberString()
  limit?: string;
}
