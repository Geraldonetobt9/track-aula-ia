import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class SetProductsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(0)
  product_names!: string[];
}
