// packages/backend/src/modules/plan-limits/plan-limit-exceeded.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export type PlanLimitResource =
  | 'workspace'
  | 'ad_account'
  | 'integration'
  | 'active_rule';

export interface PlanLimitExceededDetail {
  resource: PlanLimitResource;
  current: number;
  limit: number;
  plan: string;
}

export class PlanLimitExceededException extends HttpException {
  constructor(public readonly detail: PlanLimitExceededDetail) {
    super(
      { message: 'Plan limit exceeded', ...detail },
      HttpStatus.PAYMENT_REQUIRED, // 402
    );
  }
}
