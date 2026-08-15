import { IsNumber, Max, Min } from 'class-validator';

export class UpdateAdSpendTaxDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;
}
