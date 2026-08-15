import { IsUUID } from 'class-validator';

export class GtmWorkspaceBodyDto {
  @IsUUID()
  workspace_id!: string;
}
