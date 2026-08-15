import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException('User not authenticated');
    const isAdmin = await this.supabase.isAdmin(user.id);
    if (!isAdmin) throw new ForbiddenException('Admin access required');
    return true;
  }
}
