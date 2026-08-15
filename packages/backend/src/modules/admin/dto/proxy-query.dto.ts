import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

const ALLOWED_TABLES = [
  'sales',
  'campaigns',
  'ad_sets',
  'ads',
  'daily_ad_spend',
  'checkout_integrations',
  'facebook_connections',
  'sync_schedules',
  'sync_logs',
  'workspace_connections',
  'workspace_checkout_integrations',
  'workspace_products',
  'workspaces',
  'financial_entries',
] as const;

const ALLOWED_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'is',
  'like',
  'ilike',
  'not_is',
] as const;

class ProxyFilterDto {
  @IsString()
  column!: string;

  @IsIn([...ALLOWED_OPS])
  op!: string;

  @Allow()
  value: any;
}

class ProxyOrderDto {
  @IsString()
  column!: string;

  @IsOptional()
  ascending?: boolean;
}

class ProxyRangeDto {
  @IsNumber()
  from!: number;

  @IsNumber()
  to!: number;
}

export class ProxyQueryItemDto {
  @IsString()
  key!: string;

  @IsIn([...ALLOWED_TABLES])
  table!: string;

  @IsOptional()
  @IsString()
  select?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProxyFilterDto)
  filters?: ProxyFilterDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProxyOrderDto)
  order?: ProxyOrderDto;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProxyRangeDto)
  range?: ProxyRangeDto;
}

export class ProxyQueryDto {
  @IsUUID()
  user_id!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProxyQueryItemDto)
  queries!: ProxyQueryItemDto[];
}
