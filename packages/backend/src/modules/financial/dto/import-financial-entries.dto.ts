import { IsString, IsUUID } from 'class-validator';

export class ImportFinancialEntriesDto {
  @IsUUID()
  workspace_id!: string;

  @IsString()
  source_month!: string;

  @IsString()
  target_month!: string;
}
