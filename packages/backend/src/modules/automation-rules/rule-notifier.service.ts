import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';

interface ExecutionResult {
  entityId: string;
  entityName: string;
  actionTaken: string;
  status: 'success' | 'error';
  errorMessage?: string;
}

@Injectable()
export class RuleNotifierService {
  private readonly logger = new Logger(RuleNotifierService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly discordLogger: DiscordLoggerService,
  ) {}

  async notify(
    ruleId: string,
    ruleName: string,
    workspaceId: string,
    results: ExecutionResult[],
    metricsSnapshots: Map<string, Record<string, number>>,
    ruleMetadata?: {
      targetEntity?: string;
      targetStatus?: string;
      evaluationPeriod?: string;
    },
  ): Promise<void> {
    await Promise.allSettled([
      this.saveExecutionLogs(ruleId, workspaceId, results, metricsSnapshots),
      this.sendDiscordNotification(
        ruleName,
        workspaceId,
        results,
        metricsSnapshots,
        ruleMetadata,
      ),
    ]);
  }

  private async saveExecutionLogs(
    ruleId: string, workspaceId: string,
    results: ExecutionResult[],
    metricsSnapshots: Map<string, Record<string, number>>,
  ): Promise<void> {
    if (results.length === 0) return;
    const rows = results.map((r) => ({
      rule_id: ruleId,
      workspace_id: workspaceId,
      entity_facebook_id: r.entityId,
      entity_name: r.entityName,
      action_taken: r.actionTaken,
      metrics_snapshot: metricsSnapshots.get(r.entityId) || {},
      status: r.status,
      error_message: r.errorMessage || null,
    }));
    const client = this.supabase.getClient();
    const { error } = await client.from('automation_rule_executions').insert(rows);
    if (error) this.logger.error(`Failed to save execution logs for rule ${ruleId}: ${error.message}`);
  }

  private async sendDiscordNotification(
    ruleName: string,
    workspaceId: string,
    results: ExecutionResult[],
    metricsSnapshots: Map<string, Record<string, number>>,
    ruleMetadata?: {
      targetEntity?: string;
      targetStatus?: string;
      evaluationPeriod?: string;
    },
  ): Promise<void> {
    try {
      // Fetch workspace + user info for Discord log
      const client = this.supabase.getClient();
      const { data: workspace } = await client
        .from('workspaces')
        .select('name, user_id')
        .eq('id', workspaceId)
        .maybeSingle();

      let userEmail: string | null = null;
      if (workspace?.user_id) {
        const { data: profile } = await client
          .from('profiles')
          .select('email')
          .eq('id', workspace.user_id)
          .maybeSingle();
        userEmail = profile?.email || null;
      }

      const entities = results.map((r) => ({
        entityName: r.entityName,
        actionTaken: r.actionTaken,
        status: r.status as 'success' | 'error',
        errorMessage: r.errorMessage,
        metrics: metricsSnapshots.get(r.entityId),
      }));

      this.discordLogger.logRuleExecution({
        ruleName,
        userEmail,
        workspaceName: workspace?.name || null,
        targetEntity: ruleMetadata?.targetEntity || 'campaign',
        targetStatus: ruleMetadata?.targetStatus,
        evaluationPeriod: ruleMetadata?.evaluationPeriod,
        entities,
      });
    } catch (err: any) {
      this.logger.warn(`Discord notification failed: ${err.message}`);
    }
  }
}
