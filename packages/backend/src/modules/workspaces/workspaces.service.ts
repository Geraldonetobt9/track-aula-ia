import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly supabase: SupabaseService,
  ) {}

  private async verifyOwnership(userId: string, workspaceId: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new ForbiddenException('Workspace not found or access denied');
  }

  async list(userId: string, targetUserId?: string) {
    const effectiveUserId = targetUserId ?? userId;

    if (targetUserId && targetUserId !== userId) {
      const isAdmin = await this.supabase.isAdmin(userId);
      if (!isAdmin) {
        throw new ForbiddenException('Admin access required');
      }
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id, user_id, name, ad_spend_tax_percentage, created_at, updated_at')
      .eq('user_id', effectiveUserId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data;
  }

  async create(userId: string, name: string) {
    if (!name) {
      throw new BadRequestException('name is required');
    }


    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .insert({ user_id: userId, name })
      .select()
      .single();

    if (error) throw error;


    return data;
  }

  async update(userId: string, workspaceId: string, name: string) {
    if (!workspaceId || !name) {
      throw new BadRequestException('workspace_id and name required');
    }

    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .update({ name })
      .eq('id', workspaceId)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  }

  async updateAdSpendTax(
    userId: string,
    workspaceId: string,
    percentage: number,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspace_id required');
    }
    if (percentage < 0 || percentage > 100) {
      throw new BadRequestException('percentage must be between 0 and 100');
    }

    await this.verifyOwnership(userId, workspaceId);

    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .update({ ad_spend_tax_percentage: percentage })
      .eq('id', workspaceId)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true, ad_spend_tax_percentage: percentage };
  }

  async remove(userId: string, workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspace_id required');
    }

    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .delete()
      .eq('id', workspaceId)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  }

}
