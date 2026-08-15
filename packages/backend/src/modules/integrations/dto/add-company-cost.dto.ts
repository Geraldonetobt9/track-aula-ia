import { IsNumber, IsString, Min } from 'class-validator';

export class AddCompanyCostDto {
  @IsString()
  name!: string;

  @IsString()
  type!: string;

  @IsNumber()
  @Min(0)
  value!: number;
}
