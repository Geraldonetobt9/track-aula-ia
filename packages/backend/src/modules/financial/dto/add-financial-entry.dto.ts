import { IsIn, IsNumber, IsString, IsUUID, Min } from 'class-validator';

export class AddFinancialEntryDto {
  @IsUUID()
  workspace_id!: string;

  @IsString()
  @IsIn(['expense', 'revenue', 'tax'])
  type!: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  reference_month!: string;
}
