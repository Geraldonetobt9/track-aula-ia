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
import { FacebookOAuthService } from './facebook-oauth.service';
import { InsightsService } from './insights.service';
import { SaleMatcherService } from './sale-matcher.service';
import { ConfigService } from '@nestjs/config';

@Controller('facebook')
export class FacebookController {
  private readonly logger = new Logger(FacebookController.name);

  constructor(
    private readonly facebook: FacebookService,
    private readonly oauth: FacebookOAuthService,
    private readonly insights: InsightsService,
    private readonly saleMatcher: SaleMatcherService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  // ============================================
  // OAuth endpoints (no AuthGuard — redirect-based)
  // ============================================

  @Get('auth/connect')
  async authConnect(
    @Query('token') token: string,
    @Res() reply: FastifyReply,
  ) {
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    const user = await this.supabase.getUserFromToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const authUrl = this.oauth.buildAuthorizationUrl(user.id);
    return reply
      .header('Referrer-Policy', 'no-referrer')
      .redirect(302, authUrl);
  }

  @Get('auth/callback')
  async authCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') fbError: string,
    @Query('error_description') errorDescription: string,
    @Res() reply: FastifyReply,
  ) {
    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');

    // Handle Facebook authorization denial
    if (fbError) {
      this.logger.warn(`Facebook OAuth denied: ${fbError} — ${errorDescription}`);
      return reply.redirect(
        302,
        `${frontendUrl}/integrations?error=${encodeURIComponent(errorDescription || fbError)}`,
      );
    }

    if (!code || !state) {
      return reply.redirect(
        302,
        `${frontendUrl}/integrations?error=${encodeURIComponent('Parâmetros ausentes no callback')}`,
      );
    }

    // Validate state (CSRF protection)
    const userId = this.oauth.verifyState(state);
    if (!userId) {
      this.logger.warn('OAuth callback: invalid or expired state');
      return reply.redirect(
        302,
        `${frontendUrl}/integrations?error=${encodeURIComponent('Sessão expirada. Tente novamente.')}`,
      );
    }

    try {
      // Step 1: Exchange code for short-lived token
      const shortLivedToken = await this.oauth.exchangeCodeForToken(code);

      // Step 2: Exchange for long-lived token (60 days)
      const { accessToken, expiresAt } =
        await this.oauth.exchangeForLongLivedToken(shortLivedToken);

      // Step 3: Get Facebook user info
      const fbUser = await this.oauth.getFacebookUserId(accessToken);

      // Step 4: Discover all ad accounts and save to database
      const result = await this.facebook.saveOAuthConnection(
        userId,
        accessToken,
        fbUser.id,
        fbUser.name,
        expiresAt,
      );

      if (result.alreadyConnected) {
        this.logger.log(
          `OAuth: FB user ${fbUser.id} already connected for user ${userId}`,
        );
        return reply.redirect(
          302,
          `${frontendUrl}/integrations?error=${encodeURIComponent('Este perfil do Facebook já está conectado. Para reconectar, exclua o perfil e conecte novamente.')}`,
        );
      }

      this.logger.log(
        `OAuth: saved ${result.savedCount} ad accounts for user ${userId}, FB user ${fbUser.id}`,
      );

      return reply.redirect(
        302,
        `${frontendUrl}/integrations?connected=true`,
      );
    } catch (err: any) {
      this.logger.error(`OAuth callback error: ${err.message}`);
      return reply.redirect(
        302,
        `${frontendUrl}/integrations?error=${encodeURIComponent('Erro ao conectar com o Facebook. Tente novamente.')}`,
      );
    }
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
