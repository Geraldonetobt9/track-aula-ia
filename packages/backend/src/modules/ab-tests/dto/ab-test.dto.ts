import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const AB_MODES = ['redirect', 'elements'] as const;
export const AB_GOALS = ['sale', 'checkout', 'revenue'] as const;
export const AB_ACTIONS = ['start', 'pause', 'finish'] as const;
export const MAX_VARIANTS = 5;

export type AbMode = (typeof AB_MODES)[number];
export type AbGoal = (typeof AB_GOALS)[number];
export type AbAction = (typeof AB_ACTIONS)[number];

/** Variantes vêm em ordem: a primeira é o controle (A). A letra é dada pelo servidor. */
export class AbVariantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** Só no modo redirect. Na primeira variante, ignorada: o controle é a própria página. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  url?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  weight!: number;
}

export class CreateAbTestDto {
  @IsUUID()
  workspace_id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hypothesis?: string;

  @IsIn(AB_MODES)
  mode!: AbMode;

  @IsString()
  @MaxLength(1000)
  page_url!: string;

  @IsIn(AB_GOALS)
  goal!: AbGoal;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_VARIANTS)
  @ValidateNested({ each: true })
  @Type(() => AbVariantDto)
  variants!: AbVariantDto[];
}

/** Nome e hipótese mudam sempre; o resto, só em rascunho. */
export class UpdateAbTestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hypothesis?: string;

  @IsOptional()
  @IsIn(AB_MODES)
  mode?: AbMode;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  page_url?: string;

  @IsOptional()
  @IsIn(AB_GOALS)
  goal?: AbGoal;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_VARIANTS)
  @ValidateNested({ each: true })
  @Type(() => AbVariantDto)
  variants?: AbVariantDto[];
}

export class AbTestStatusDto {
  @IsIn(AB_ACTIONS)
  action!: AbAction;

  /** Ao encerrar: a variante escolhida como vencedora (opcional). */
  @IsOptional()
  @IsUUID()
  winner_variant_id?: string;
}

export class AbTestListQueryDto {
  @IsUUID()
  workspace_id!: string;
}
