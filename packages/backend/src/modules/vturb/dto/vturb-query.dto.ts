import { IsOptional, IsString, IsUUID } from 'class-validator';

export class VturbRangeQueryDto {
  @IsUUID()
  workspace_id!: string;

  /** Inclusive start (YYYY-MM-DD). VTurb filters with `>=`. */
  @IsOptional()
  @IsString()
  from?: string;

  /** Inclusive end (YYYY-MM-DD). VTurb filters with `<=` — do not make it exclusive. */
  @IsOptional()
  @IsString()
  to?: string;
}

export class VturbWorkspaceQueryDto {
  @IsUUID()
  workspace_id!: string;
}

export class VturbTokenBodyDto {
  @IsUUID()
  workspace_id!: string;

  @IsString()
  token!: string;
}

