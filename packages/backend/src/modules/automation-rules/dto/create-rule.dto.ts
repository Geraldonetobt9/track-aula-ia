import {
  IsString,
  IsBoolean,
  IsOptional,
  IsUUID,
  IsIn,
  IsInt,
  IsArray,
  ValidateNested,
  IsNumber,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ConditionDto {
  @IsIn(['spend', 'cpa', 'roi', 'roas', 'profit', 'profit_margin', 'cpc', 'ctr', 'cpm', 'impressions', 'clicks', 'conversions'])
  metric!: string;

  @IsIn(['gt', 'lt', 'gte', 'lte'])
  operator!: string;

  @IsNumber()
  value!: number;
}

export class BudgetAdjustmentDto {
  @IsIn(['percentage', 'fixed'])
  mode!: string;

  @IsNumber()
  value!: number;

  @IsIn(['daily', 'lifetime'])
  budget_type!: string;

  @IsOptional()
  @IsNumber()
  min_budget?: number;

  @IsOptional()
  @IsNumber()
  max_budget?: number;
}

export class CreateRuleDto {
  @IsUUID()
  workspace_id!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsUUID()
  connection_id?: string;

  @IsIn(['campaign', 'adset', 'ad'])
  target_entity!: string;

  @IsIn(['active', 'paused', 'any'])
  target_status!: string;

  @IsOptional()
  @IsString()
  name_filter?: string;

  @IsIn(['activate', 'pause', 'increase_budget', 'decrease_budget'])
  action_type!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetAdjustmentDto)
  budget_adjustment?: BudgetAdjustmentDto;

  @IsIn(['today', 'yesterday', 'last_7d', 'last_30d', 'custom'])
  evaluation_period!: string;

  @IsOptional()
  @IsDateString()
  custom_start_date?: string;

  @IsInt()
  @IsIn([10, 15, 30, 60, 120, 180, 360, 1440])
  frequency_minutes!: number;

  @IsOptional()
  @IsString()
  daily_run_time?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionDto)
  conditions!: ConditionDto[];
}
