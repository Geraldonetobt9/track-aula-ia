import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AutomationRulesService } from './automation-rules.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { SupabaseService } from '../../shared/services/supabase.service';

@Controller('automation-rules')
@UseGuards(AuthGuard)
export class AutomationRulesController {
  constructor(
    private readonly rulesService: AutomationRulesService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get()
  async getRules(@CurrentUser('id') userId: string, @Query('workspace_id') workspaceId: string) {
    return this.rulesService.getRules(userId, workspaceId);
  }

  @Post()
  async createRule(@CurrentUser('id') userId: string, @Body() dto: CreateRuleDto) {
    return this.rulesService.createRule(userId, dto);
  }

  @Patch(':id')
  async updateRule(@CurrentUser('id') userId: string, @Param('id') ruleId: string, @Body() dto: UpdateRuleDto) {
    return this.rulesService.updateRule(userId, ruleId, dto);
  }

  @Delete(':id')
  async deleteRule(@CurrentUser('id') userId: string, @Param('id') ruleId: string) {
    return this.rulesService.deleteRule(userId, ruleId);
  }

  @Patch(':id/toggle')
  async toggleRule(@CurrentUser('id') userId: string, @Param('id') ruleId: string) {
    return this.rulesService.toggleRule(userId, ruleId);
  }

  @Get(':id/history')
  async getHistory(
    @CurrentUser('id') userId: string,
    @Param('id') ruleId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const client = this.supabase.getClient();
    const pageSize = Math.min(parseInt(limit || '20', 10), 100);

    // Verify user owns the rule's workspace
    const { data: rule, error: ruleError } = await client
      .from('automation_rules')
      .select('id, workspace_id')
      .eq('id', ruleId)
      .single();
    if (ruleError || !rule) throw new NotFoundException('Rule not found');

    const { data: workspace } = await client
      .from('workspaces')
      .select('id')
      .eq('id', rule.workspace_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!workspace) throw new ForbiddenException('Access denied');

    let query = client
      .from('automation_rule_executions')
      .select('id, entity_facebook_id, entity_name, action_taken, metrics_snapshot, status, error_message, executed_at')
      .eq('rule_id', ruleId)
      .order('executed_at', { ascending: false })
      .limit(pageSize);
    if (cursor) query = query.lt('executed_at', cursor);
    const { data, error } = await query;
    if (error) throw error;
    const items = data || [];
    const nextCursor = items.length === pageSize ? items[items.length - 1].executed_at : null;
    return { items, nextCursor };
  }
}
