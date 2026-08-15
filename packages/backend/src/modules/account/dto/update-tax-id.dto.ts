import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class UpdateTaxIdDto {
  @IsIn(['cpf', 'cnpj'], { message: 'Tipo de documento inválido' })
  type!: 'cpf' | 'cnpj';

  @IsString()
  @IsNotEmpty()
  value!: string;
}
