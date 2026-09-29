import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../shared/services/supabase.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { MetaCapiService } from './meta-capi.service';
import { CapiWorkspaceQueryDto, UpdateCapiSettingsDto } from './dto/capi-settings.dto';

const emptyToNull = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);

/** Configuração da CAPI e do snippet, e o registro dos envios. */
@Controller('capi')
@UseGuards(AuthGuard)
export class MetaCapiController {
  constructor(
    private readonly capi: MetaCapiService,
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
  ) {}

  @Get('settings')
  async getSettings(@CurrentUser('id') userId: string, @Query() query: CapiWorkspaceQueryDto) {
    await this.capi.assertOwner(userId, query.workspace_id);
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select(
        'tracking_platform, tracking_param, tracking_domain, meta_pixel_id, meta_capi_token, meta_test_event_code, meta_mirror_browser',
      )
      .eq('id', query.workspace_id)
      .single();
    if (error) throw new Error(error.message);

    const { meta_capi_token, ...rest } = data;
    return { ...rest, has_capi_token: !!meta_capi_token };
  }

  @Patch('settings')
  async updateSettings(@CurrentUser('id') userId: string, @Body() body: UpdateCapiSettingsDto) {
    await this.capi.assertOwner(userId, body.workspace_id);

    const update: Record<string, unknown> = {};
    const platform = emptyToNull(body.tracking_platform);
    if (platform !== undefined) update.tracking_platform = platform;
    if (body.tracking_param !== undefined) update.tracking_param = body.tracking_param;
    const domain = emptyToNull(body.tracking_domain);
    if (domain !== undefined) update.tracking_domain = domain?.toLowerCase() ?? null;
    const pixel = emptyToNull(body.meta_pixel_id);
    if (pixel !== undefined) update.meta_pixel_id = pixel;
    const token = emptyToNull(body.meta_capi_token);
    if (token !== undefined) update.meta_capi_token = token ? this.encryption.encrypt(token) : null;
    const testCode = emptyToNull(body.meta_test_event_code);
    if (testCode !== undefined) update.meta_test_event_code = testCode;
    if (body.meta_mirror_browser !== undefined) update.meta_mirror_browser = body.meta_mirror_browser;

    if (Object.keys(update).length > 0) {
      const { error } = await this.supabase
        .getClient()
        .from('workspaces')
        .update(update)
        .eq('id', body.workspace_id);
      if (error) throw new Error(error.message);
      this.capi.invalidateConfig(body.workspace_id);
    }
    return this.getSettings(userId, { workspace_id: body.workspace_id });
  }

  @Get('events')
  listEvents(@CurrentUser('id') userId: string, @Query() query: CapiWorkspaceQueryDto) {
    return this.capi.listEvents(userId, query.workspace_id);
  }

  @Get('events/:id')
  getEvent(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CapiWorkspaceQueryDto,
  ) {
    return this.capi.getEvent(userId, query.workspace_id, id);
  }

  @Post('retry')
  async retry(@CurrentUser('id') userId: string, @Body() body: CapiWorkspaceQueryDto) {
    await this.capi.assertOwner(userId, body.workspace_id);
    return this.capi.retryFailed(body.workspace_id);
  }
}

/**
 * Reenvio agendado pela Vercel Cron (vercel.json). A Vercel chama com
 * GET e `Authorization: Bearer $CRON_SECRET`. Sem a variável, a rota fica
 * fechada.
 */
@SkipThrottle()
@Controller('capi')
export class MetaCapiCronController {
  constructor(
    private readonly capi: MetaCapiService,
    private readonly config: ConfigService,
  ) {}

  @Get('retry-cron')
  async retryCron(@Headers('authorization') authorization: string | undefined) {
    const secret = this.config.get<string>('CRON_SECRET');
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const got = Buffer.from(authorization ?? '');
    if (!secret || got.length !== expected.length || !timingSafeEqual(got, expected)) {
      throw new UnauthorizedException();
    }
    return this.capi.retryFailed();
  }
}
