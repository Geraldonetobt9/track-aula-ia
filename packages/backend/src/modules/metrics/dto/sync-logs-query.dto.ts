import { IsNumberString, IsOptional, IsString } from 'class-validator';

export class SyncLogsQueryDto {
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  workspace_id?: string;
}
