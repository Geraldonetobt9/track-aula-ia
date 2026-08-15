import { IsIn, IsString, IsUUID } from 'class-validator';

export class ImportPreviewDto {
  @IsString()
  @IsIn(['hotmart'])
  platform!: 'hotmart';

  @IsUUID()
  workspace_id!: string;
}

export class ImportCommitDto extends ImportPreviewDto {
  @IsUUID()
  integration_id!: string;
}
