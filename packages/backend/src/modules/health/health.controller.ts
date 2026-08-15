import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SupabaseService } from '../../shared/services/supabase.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async check() {
    const start = Date.now();
    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .limit(1);

    return {
      status: error ? 'degraded' : 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db_latency_ms: Date.now() - start,
    };
  }
}
