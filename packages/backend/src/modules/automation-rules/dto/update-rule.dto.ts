import {
  IsString,
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
import { ConditionDto, BudgetAdjustmentDto } from './create-rule.dto';

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  connection_id?: string | null;

  @IsOptional()
  @IsIn(['campaign', 'adset', 'ad'])
  target_entity?: string;

  @IsOptional()
  @IsIn(['active', 'paused', 'any'])
  target_status?: string;

  @IsOptional()
  @IsString()
  name_filter?: string | null;

  @IsOptional()
  @IsIn(['activate', 'pause', 'increase_budget', 'decrease_budget'])
  action_type?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetAdjustmentDto)
  budget_adjustment?: BudgetAdjustmentDto | null;

  @IsOptional()
  @IsIn(['today', 'yesterday', 'last_7d', 'last_30d', 'custom'])
  evaluation_period?: string;

  @IsOptional()
  @IsDateString()
  custom_start_date?: string | null;

  @IsOptional()
  @IsInt()
  @IsIn([10, 15, 30, 60, 120, 180, 360, 1440])
  frequency_minutes?: number;

  @IsOptional()
  @IsString()
  daily_run_time?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionDto)
  conditions?: ConditionDto[];
}
