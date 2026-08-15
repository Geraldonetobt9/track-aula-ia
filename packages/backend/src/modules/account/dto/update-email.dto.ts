import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class UpdateEmailDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;
}
