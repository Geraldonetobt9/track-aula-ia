import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Senha precisa ter no minimo 8 caracteres' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Nome e obrigatorio' })
  name!: string;

  @IsIn(['cpf', 'cnpj'], { message: 'Tipo de documento invalido' })
  taxIdType!: 'cpf' | 'cnpj';

  @IsString()
  @IsNotEmpty()
  taxIdValue!: string;

  @IsBoolean()
  termsAccepted!: boolean;
}
