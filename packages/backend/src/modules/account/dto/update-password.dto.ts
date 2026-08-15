import { IsString, MinLength } from 'class-validator';

export class UpdatePasswordDto {
  @IsString()
  @MinLength(8, { message: 'Senha precisa ter no mínimo 8 caracteres' })
  password!: string;
}
