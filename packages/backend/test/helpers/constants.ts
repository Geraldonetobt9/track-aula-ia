export const FREE_PLAN_MAX_SALES = 30;
export const PRO_PLAN_MAX_SALES = 1000;
export const STARTER_PLAN_MAX_SALES = 2500;
export const ENTERPRISE_PLAN_MAX_SALES = 5000;

export const FREE_OVERAGE_CENTS = 0;
export const PRO_OVERAGE_CENTS = 14;
export const STARTER_OVERAGE_CENTS = 12;
export const ENTERPRISE_OVERAGE_CENTS = 7;

export const UNLIMITED = -1;

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const ONE_HOUR_MS = 60 * 60 * 1000;

export const FREE_PLAN_ID = 'plan-free-id';
export const PRO_PLAN_ID = 'plan-pro-id';
export const STARTER_PLAN_ID = 'plan-starter-id';
export const ENTERPRISE_PLAN_ID = 'plan-enterprise-id';
export const UNLIMITED_PLAN_ID = 'plan-unlimited-id';

export const FIXED_NOW = new Date('2026-04-21T12:00:00.000Z');

export const FREE_PLAN_ROW = {
  id: FREE_PLAN_ID,
  plan: 'free',
  max_sales_monthly: FREE_PLAN_MAX_SALES,
  max_active_ad_accounts: 1,
  max_checkout_integrations: 1,
  max_workspaces: 1,
  max_active_rules: 0,
  overage_price_cents: FREE_OVERAGE_CENTS,
  stripe_price_id_base: null,
  stripe_price_id_metered: null,
  stripe_meter_event_name: null,
};

export const PRO_PLAN_ROW = {
  id: PRO_PLAN_ID,
  plan: 'pro',
  max_sales_monthly: PRO_PLAN_MAX_SALES,
  max_active_ad_accounts: 3,
  max_checkout_integrations: 3,
  max_workspaces: 3,
  max_active_rules: 3,
  overage_price_cents: PRO_OVERAGE_CENTS,
  stripe_price_id_base: 'price_base_pro',
  stripe_price_id_metered: 'price_metered_pro',
  stripe_meter_event_name: 'sentinela_approved_sales_pro',
};

export const STARTER_PLAN_ROW = {
  id: STARTER_PLAN_ID,
  plan: 'starter',
  max_sales_monthly: STARTER_PLAN_MAX_SALES,
  max_active_ad_accounts: 7,
  max_checkout_integrations: 7,
  max_workspaces: 7,
  max_active_rules: 7,
  overage_price_cents: STARTER_OVERAGE_CENTS,
  stripe_price_id_base: 'price_base_starter',
  stripe_price_id_metered: 'price_metered_starter',
  stripe_meter_event_name: 'sentinela_approved_sales_starter',
};

export const ENTERPRISE_PLAN_ROW = {
  id: ENTERPRISE_PLAN_ID,
  plan: 'enterprise',
  max_sales_monthly: ENTERPRISE_PLAN_MAX_SALES,
  max_active_ad_accounts: UNLIMITED,
  max_checkout_integrations: UNLIMITED,
  max_workspaces: UNLIMITED,
  max_active_rules: UNLIMITED,
  overage_price_cents: ENTERPRISE_OVERAGE_CENTS,
  stripe_price_id_base: 'price_base_enterprise',
  stripe_price_id_metered: 'price_metered_enterprise',
  stripe_meter_event_name: 'sentinela_approved_sales_enterprise',
};

export const UNLIMITED_PLAN_ROW = {
  id: UNLIMITED_PLAN_ID,
  plan: 'unlimited',
  max_sales_monthly: UNLIMITED,
  max_active_ad_accounts: UNLIMITED,
  max_checkout_integrations: UNLIMITED,
  max_workspaces: UNLIMITED,
  max_active_rules: UNLIMITED,
  overage_price_cents: 0,
  stripe_price_id_base: null,
  stripe_price_id_metered: null,
  stripe_meter_event_name: null,
};
