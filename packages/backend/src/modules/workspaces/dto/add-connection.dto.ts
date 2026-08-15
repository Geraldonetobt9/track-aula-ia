import { IsUUID } from 'class-validator';

export class AddConnectionDto {
  @IsUUID()
  facebook_connection_id!: string;
}
