import { Injectable } from '@nestjs/common';

/**
 * Limites de plano — versao sem plano.
 *
 * A cobranca saiu do produto, e com ela plan_rules, subscriptions e
 * usage_overage. Este servico continua existindo, com a mesma interface, mas
 * nao consulta mais nada e nunca barra nada.
 *
 * Por que manter em vez de arrancar: ele e injetado em seis modulos
 * (workspaces, integrations, facebook, automation-rules, sales, stripe).
 * Remover a dependencia de todos era uma cirurgia grande, com risco de
 * quebrar o que funciona, para o mesmo resultado — nenhuma restricao. Quando
 * os modulos de cobranca sairem de vez, este arquivo sai junto.
 *
 * Enquanto ele consultava plan_rules, cada acao protegida devolvia 500:
 * ativar conta de anuncio, criar integracao de checkout, criar area, ativar
 * regra. Era sempre o mesmo erro, aparecendo em telas diferentes.
 */

export type SaleDecision =
  | { allowed: true; blocked_by_limit: false; overage: false;
      subscriptionId: string; periodStart: string; periodEnd: string }
  | { allowed: true; blocked_by_limit: false; overage: true; pricePerSaleCents: number;
      subscriptionId: string; periodStart: string; periodEnd: string }
  | { allowed: true; blocked_by_limit: true; overage: false;
      subscriptionId: string; periodStart: string; periodEnd: string };

export interface UsageSnapshot {
  plan: string;
  period: { start: string; end: string };
  sales:        { used: number; limit: number; blocked: number };
  workspaces:   { used: number; limit: number };
  adAccounts:   { used: number; limit: number };
  integrations: { used: number; limit: number };
  activeRules:  { used: number; limit: number };
  overage:      { count: number; totalCents: number };
  subscription: {
    status: 'active' | 'past_due' | 'canceled' | null;
    next_billing_date: string | null;
    cancel_at_period_end: boolean;
    scheduled_plan: { slug: string; changes_at: string } | null;
    has_stripe_customer: boolean;
  };
}

@Injectable()
export class PlanLimitsService {
  async invalidate(_userId: string): Promise<void> {
    // Nao ha cache de limite para invalidar.
  }

  async assertCanCreateWorkspace(_userId: string): Promise<void> {}

  async assertCanCreateIntegration(_userId: string): Promise<void> {}

  async assertCanActivateAdAccount(_userId: string, _adAccountId: string): Promise<void> {}

  async assertCanActivateRule(_userId: string, _ruleId: string): Promise<void> {}

  /**
   * Toda venda entra. Sem plano nao ha teto mensal, entao nao ha excedente
   * nem venda bloqueada — os campos existem so para o chamador nao mudar.
   */
  async checkSaleAcceptance(_userId: string): Promise<SaleDecision> {
    return {
      allowed: true,
      blocked_by_limit: false,
      overage: false,
      subscriptionId: '',
      periodStart: '',
      periodEnd: '',
    };
  }

  /**
   * Uso, sem teto. limit = -1 e a convencao que o proprio schema usava para
   * ilimitado, entao a tela ja sabe interpretar.
   */
  async getUsageSnapshot(_userId: string): Promise<UsageSnapshot> {
    const agora = new Date().toISOString();
    const ilimitado = { used: 0, limit: -1 };

    return {
      plan: 'unlimited',
      period: { start: agora, end: agora },
      sales:        { used: 0, limit: -1, blocked: 0 },
      workspaces:   { ...ilimitado },
      adAccounts:   { ...ilimitado },
      integrations: { ...ilimitado },
      activeRules:  { ...ilimitado },
      overage:      { count: 0, totalCents: 0 },
      subscription: {
        status: 'active',
        next_billing_date: null,
        cancel_at_period_end: false,
        scheduled_plan: null,
        has_stripe_customer: false,
      },
    };
  }
}
