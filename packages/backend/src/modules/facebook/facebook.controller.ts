import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../shared/services/supabase.service';
import { FacebookService } from './facebook.service';
import { FacebookTokenService } from './facebook-token.service';
import { InsightsService } from './insights.service';
import { SaleMatcherService } from './sale-matcher.service';
import { ConfigService } from '@nestjs/config';

@Controller('facebook')
export class FacebookController {
  private readonly logger = new Logger(FacebookController.name);

  constructor(
    private readonly facebook: FacebookService,
    private readonly tokens: FacebookTokenService,
    private readonly insights: InsightsService,
    private readonly saleMatcher: SaleMatcherService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  // ============================================
  // Conexao por token colado
  // ============================================

  /**
   * POST /api/facebook/connect  { access_token }
   *
   * Conectar = colar o token. Valida no Meta, descobre quem e o dono e
   * reaproveita saveOAuthConnection, que ja cifra o token e cria uma conexao
   * por conta de anuncio encontrada.
   */
  @Post('connect')
  @UseGuards(AuthGuard)
  async connect(
    @CurrentUser('id') userId: string,
    @Body() body: { access_token?: string },
  ) {
    const token = (body?.access_token ?? '').trim();
    const info = await this.tokens.inspect(token);

    const result = await this.facebook.saveOAuthConnection(
      userId,
      token,
      info.facebookUserId,
      info.facebookUserName,
      info.expiresAt,
    );

    return {
      facebook_user_name: info.facebookUserName,
      expires_at: info.expiresAt?.toISOString() ?? null,
      accounts_found: result.savedCount,
    };
  }

  // ============================================
  // Connection endpoints (AuthGuard protected)
  // ============================================

  @Get('connections')
  @UseGuards(AuthGuard)
  async getConnections(
    @CurrentUser('id') userId: string,
    @Query('workspace_id') workspaceId?: string,
    @Query('active_only') activeOnly?: string,
    @Query('minimal') minimal?: string,
  ) {
    return this.facebook.getConnections(userId, workspaceId, {
      activeOnly: activeOnly === 'true',
      minimal: minimal === 'true',
    });
  }

  @Delete('connections/profile/:facebookUserId')
  @UseGuards(AuthGuard)
  async deleteConnectionsByProfile(
    @CurrentUser('id') userId: string,
    @Param('facebookUserId') facebookUserId: string,
  ) {
    return this.facebook.deleteConnectionsByProfile(userId, facebookUserId);
  }

  @Post('connections/profile/:facebookUserId/refresh')
  @UseGuards(AuthGuard)
  async refreshProfileAdAccounts(
    @CurrentUser('id') userId: string,
    @Param('facebookUserId') facebookUserId: string,
  ) {
    return this.facebook.refreshProfileAdAccounts(userId, facebookUserId);
  }

  // ============================================
  // Insights endpoints
  // ============================================

  @Post('insights/validate')
  @UseGuards(AuthGuard)
  async validateInsights(
    @CurrentUser('id') userId: string,
    @Body() body: { connection_id?: string },
  ) {
    return this.insights.validate(userId, body.connection_id);
  }

  @Post('insights/sync')
  @UseGuards(AuthGuard)
  async startSync(
    @CurrentUser('id') userId: string,
    @Body() body: { connection_id?: string; period?: string; since?: string; until?: string },
  ) {
    return this.insights.startSync(userId, body.connection_id, {
      period: body.period,
      since: body.since,
      until: body.until,
    });
  }

  @Get('insights/job/:jobId')
  @UseGuards(AuthGuard)
  async checkJob(
    @CurrentUser('id') userId: string,
    @Param('jobId') jobId: string,
  ) {
    return this.insights.checkJob(jobId, userId);
  }

  // ============================================
  // Budget & status endpoints
  // ============================================

  @Patch('budget')
  @UseGuards(AuthGuard)
  async updateBudget(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.updateBudget(userId, body);
  }

  @Patch('campaigns/status')
  @UseGuards(AuthGuard)
  async updateStatus(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.updateStatus(userId, body);
  }

  // ============================================
  // Duplicate endpoint
  // ============================================

  @Post('duplicate')
  @UseGuards(AuthGuard)
  async duplicate(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.duplicateObject(userId, body);
  }

  // ============================================
  // Rematch endpoint
  // ============================================

  @Post('rematch')
  @UseGuards(AuthGuard)
  async rematchSales(@CurrentUser('id') userId: string) {
    return this.saleMatcher.rematchSales(userId);
  }

  // ============================================
  // Toggle active status
  // ============================================

  @Patch('connections/:id/active')
  @UseGuards(AuthGuard)
  async toggleActive(
    @CurrentUser('id') userId: string,
    @Param('id') connectionId: string,
    @Body() body: { is_active: boolean },
  ) {
    return this.facebook.toggleActive(userId, connectionId, body.is_active);
  }
}
