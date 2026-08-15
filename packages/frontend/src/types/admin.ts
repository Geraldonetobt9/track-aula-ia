export interface AdminStats {
  total_users: number;
  active_users_30d: number;
  new_users_7d: number;
  facebook_connections_active: number;
  total_campaigns: number;
  total_sales: number;
  total_revenue: number;
  checkout_integrations_active: number;
  users_by_plan: Record<string, number>;
  new_users_by_day: { date: string; count: number }[];
  recent_users: AdminDashboardRecentUser[];
  users_with_sync_errors: SyncErrorUser[];
}

export interface AdminDashboardRecentUser {
  id: string;
  user_id: string;
  name: string | null;
  email: string | null;
  plan: 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited' | null;
  created_at: string;
  facebook_connected: boolean | null;
}

export interface AdminUser {
  id: string;
  user_id: string;
  name: string;
  email: string;
  cpf: string | null;
  plan: 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited';
  avatar_url: string | null;
  role: 'admin' | 'user';
  facebook_connected: boolean | null;
  campaigns_count: number;
  sales_count: number;
  total_revenue: number;
  last_sign_in_at: string | null;
  subscription_start: string | null;
  subscription_end: string | null;
}

export interface SyncErrorUser {
  user_id: string;
  name: string;
  email: string;
  last_sync_error: string;
  last_sync_at: string;
}

export interface AdminUserDetailProfile {
  user_id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  cpf: string | null;
  cnpj: string | null;
  subscription_start: string | null;
  subscription_end: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  role: 'admin' | 'user';
  plan: 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited' | null;
}

export interface AdminUserDetailSubscription {
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  scheduled_plan: string | null;
  scheduled_changes_at: string | null;
}

export interface AdminUserDetailFbConnection {
  id: string;
  workspace_id: string | null;
  ad_account_id: string;
  account_name: string | null;
  account_status: number | null;
  is_valid: boolean;
  is_active: boolean;
  facebook_user_id: string | null;
  facebook_user_name: string | null;
  last_validated_at: string | null;
  token_expires_at: string | null;
  created_at: string;
}

export interface AdminUserDetailSync {
  is_active: boolean;
  interval_minutes: number;
  last_sync_at: string | null;
  last_sync_status: 'success' | 'error' | 'pending' | null;
  last_sync_error: string | null;
}

export interface AdminUserDetailCheckout {
  id: string;
  workspace_id: string | null;
  platform: string;
  name: string;
  is_active: boolean;
  use_commission_value: boolean;
  last_webhook_at: string | null;
  created_at: string;
  webhook_url: string | null;
  webhook_secret_masked: string | null;
  api_token_masked: string | null;
  has_webhook_secret: boolean;
  has_api_token: boolean;
}

export interface AdminUserDetailRuleExecution {
  executed_at: string;
  status: 'success' | 'error';
  action_taken: string;
  entity_name: string | null;
  error_message: string | null;
}

export interface AdminUserDetailRule {
  id: string;
  workspace_id: string;
  workspace_name: string;
  name: string;
  is_active: boolean;
  target_entity: 'campaign' | 'adset' | 'ad';
  target_status: string;
  action_type: string;
  evaluation_period: string;
  frequency_minutes: number;
  conditions_count: number;
  last_executed_at: string | null;
  last_execution: AdminUserDetailRuleExecution | null;
}

export interface AdminUserDetailWorkspace {
  id: string;
  name: string;
  archived_at: string | null;
  archived_by_system: boolean;
  created_at: string;
}

export interface AdminUserDetail {
  profile: AdminUserDetailProfile;
  subscription: AdminUserDetailSubscription | null;
  health: {
    sales_count: number;
    total_revenue: number;
  };
  workspaces: AdminUserDetailWorkspace[];
  facebook: {
    connections_count: number;
    connections: AdminUserDetailFbConnection[];
    sync: AdminUserDetailSync | null;
  };
  checkouts: AdminUserDetailCheckout[];
  automation_rules: AdminUserDetailRule[];
}

export interface CheckoutCredentialsResponse {
  webhook_url: string | null;
  webhook_secret: string | null;
  api_token: string | null;
}

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
  cpf?: string;
  plan: 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited';
  role: 'admin' | 'user';
  subscription_start?: string;
  subscription_end?: string;
}

export interface UpdateUserData {
  name?: string;
  cpf?: string;
  plan?: 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited';
  role?: 'admin' | 'user';
  subscription_start?: string;
  subscription_end?: string;
}

export interface AdminUsersListResponse {
  users: AdminUser[];
  total_count: number;
  page: number;
  total_pages: number;
}

export interface PlanRules {
  id: string;
  plan: 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited';
  max_sales_monthly: number;
  max_active_ad_accounts: number;
  max_checkout_integrations: number;
  max_workspaces: number;
  max_active_rules: number;
  overage_price_cents: number;
  created_at: string;
  updated_at: string;
}
