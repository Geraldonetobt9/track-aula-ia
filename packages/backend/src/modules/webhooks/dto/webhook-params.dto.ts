import { IsString } from 'class-validator';

export class WebhookParamsDto {
  @IsString()
  platform!: string;
}
