import { IsBoolean } from 'class-validator';

export class ToggleCheckoutDto {
  @IsBoolean()
  is_active!: boolean;
}
