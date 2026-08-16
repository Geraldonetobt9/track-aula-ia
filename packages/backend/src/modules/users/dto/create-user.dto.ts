import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  email!: string;

  // Oito caracteres e' o minimo do Supabase Auth em projetos novos. Validar
  // aqui devolve uma mensagem em portugues em vez do erro cru da API.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
