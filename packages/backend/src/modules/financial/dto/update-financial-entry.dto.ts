import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class UpdateFinancialEntryDto {
  @IsUUID()
  workspace_id!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;
}
