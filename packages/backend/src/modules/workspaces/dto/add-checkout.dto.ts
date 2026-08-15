import { IsUUID } from 'class-validator';

export class AddCheckoutDto {
  @IsUUID()
  checkout_integration_id!: string;
}
