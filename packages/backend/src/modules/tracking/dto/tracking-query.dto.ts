import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class TrackingQueryDto {
  @IsUUID()
  workspace_id!: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  /** `'all'` para "todo período", como no Dashboard. */
  @IsOptional()
  @IsString()
  period?: string;
}

export class TrackingBreakdownQueryDto extends TrackingQueryDto {
  @IsIn(['page', 'source', 'campaign'])
  by!: 'page' | 'source' | 'campaign';
}

export class TrackingStatusQueryDto {
  @IsUUID()
  workspace_id!: string;
}
