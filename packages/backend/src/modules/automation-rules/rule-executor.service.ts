import { Injectable, Logger } from '@nestjs/common';
import { FacebookService } from '../facebook/facebook.service';

interface MatchedEntity {
  id: string;
  name: string;
  ad_account_id?: string;
  metricsSnapshot: Record<string, number>;
}

interface BudgetAdjustment {
  mode: 'percentage' | 'fixed';
  value: number;
  budget_type: 'daily' | 'lifetime';
  min_budget?: number;
  max_budget?: number;
}

interface ExecutionResult {
  entityId: string;
  entityName: string;
  actionTaken: string;
  status: 'success' | 'error';
  errorMessage?: string;
}

@Injectable()
export class RuleExecutorService {
  private readonly logger = new Logger(RuleExecutorService.name);

  constructor(private readonly facebook: FacebookService) {}

  async execute(
    userId: string,
    actionType: string,
    targetEntity: string,
    entities: MatchedEntity[],
    budgetAdjustment: BudgetAdjustment | null,
  ): Promise<ExecutionResult[]> {
    const results = await Promise.allSettled(
      entities.map((entity) =>
        this.executeOnEntity(userId, actionType, targetEntity, entity, budgetAdjustment),
      ),
    );

    return results.map((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      return {
        entityId: entities[i].id,
        entityName: entities[i].name,
        actionTaken: actionType,
        status: 'error' as const,
        errorMessage: result.reason?.message || 'Unknown error',
      };
    });
  }

  private async executeOnEntity(
    userId: string,
    actionType: string,
    targetEntity: string,
    entity: MatchedEntity,
    budgetAdjustment: BudgetAdjustment | null,
  ): Promise<ExecutionResult> {
    const fbType = targetEntity === 'adset' ? 'adset' : targetEntity;

    switch (actionType) {
      case 'activate':
        await this.facebook.updateStatus(userId, {
          facebook_id: entity.id,
          status: 'ACTIVE',
          type: fbType,
          ad_account_id: entity.ad_account_id,
        });
        return {
          entityId: entity.id,
          entityName: entity.name,
          actionTaken: 'activated',
          status: 'success',
        };

      case 'pause':
        await this.facebook.updateStatus(userId, {
          facebook_id: entity.id,
          status: 'PAUSED',
          type: fbType,
          ad_account_id: entity.ad_account_id,
        });
        return {
          entityId: entity.id,
          entityName: entity.name,
          actionTaken: 'paused',
          status: 'success',
        };

      case 'increase_budget':
      case 'decrease_budget': {
        const amount = this.calculateBudgetAmount(
          actionType,
          entity.metricsSnapshot,
          budgetAdjustment!,
        );
        const actionDesc = this.describeBudgetAction(actionType, budgetAdjustment!, amount);
        await this.facebook.updateBudget(userId, {
          type: fbType,
          facebook_id: entity.id,
          budget_type: budgetAdjustment!.budget_type,
          amount: Math.round(amount * 100),
          ad_account_id: entity.ad_account_id,
        });
        return {
          entityId: entity.id,
          entityName: entity.name,
          actionTaken: actionDesc,
          status: 'success',
        };
      }

      default:
        return {
          entityId: entity.id,
          entityName: entity.name,
          actionTaken: actionType,
          status: 'error',
          errorMessage: `Unknown action: ${actionType}`,
        };
    }
  }

  private calculateBudgetAmount(
    actionType: string,
    metrics: Record<string, number>,
    adjustment: BudgetAdjustment,
  ): number {
    let newAmount: number;

    if (adjustment.mode === 'fixed') {
      newAmount = adjustment.value;
    } else {
      const budgetKey =
        adjustment.budget_type === 'daily' ? 'daily_budget' : 'lifetime_budget';
      const currentBudget = metrics[budgetKey] || 0;
      const change = currentBudget * (adjustment.value / 100);
      newAmount =
        actionType === 'increase_budget'
          ? currentBudget + change
          : currentBudget - change;
    }

    if (adjustment.min_budget !== undefined && adjustment.min_budget !== null) {
      newAmount = Math.max(newAmount, adjustment.min_budget);
    }
    if (adjustment.max_budget !== undefined && adjustment.max_budget !== null) {
      newAmount = Math.min(newAmount, adjustment.max_budget);
    }

    return Math.max(newAmount, 1);
  }

  private describeBudgetAction(
    actionType: string,
    adjustment: BudgetAdjustment,
    finalAmount: number,
  ): string {
    const direction = actionType === 'increase_budget' ? 'increased' : 'decreased';
    if (adjustment.mode === 'percentage') {
      return `budget_${direction}_${adjustment.value}%_to_${finalAmount.toFixed(2)}`;
    }
    return `budget_set_to_${finalAmount.toFixed(2)}`;
  }
}
