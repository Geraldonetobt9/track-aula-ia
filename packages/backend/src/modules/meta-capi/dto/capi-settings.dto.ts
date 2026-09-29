import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { TRACKING_PARAMS } from '../meta-capi.service';

export class CapiWorkspaceQueryDto {
  @IsUUID()
  workspace_id!: string;
}

/**
 * Campos omitidos não mudam. String vazia apaga (volta ao padrão).
 * O token nunca volta na leitura: só se escreve.
 */
export class UpdateCapiSettingsDto {
  @IsUUID()
  workspace_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tracking_platform?: string;

  @IsOptional()
  @IsIn(TRACKING_PARAMS as unknown as string[])
  tracking_param?: string;

  /** Só o host: track.loja.com.br. */
  @IsOptional()
  @Matches(/^$|^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, {
    message: 'Subdominio invalido. Use so o endereco, como track.seusite.com.br',
  })
  tracking_domain?: string;

  @IsOptional()
  @Matches(/^$|^\d{6,20}$/, { message: 'O ID do pixel tem so numeros' })
  meta_pixel_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  meta_capi_token?: string;

  @IsOptional()
  @Matches(/^$|^[A-Za-z0-9]{1,40}$/, { message: 'Codigo de teste invalido' })
  meta_test_event_code?: string;

  @IsOptional()
  @IsBoolean()
  meta_mirror_browser?: boolean;
}
