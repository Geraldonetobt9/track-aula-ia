import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VturbService } from './vturb.service';
import { VturbApiError } from './vturb-api.client';
import {
  VturbRangeQueryDto,
  VturbTokenBodyDto,
  VturbWorkspaceQueryDto,
} from './dto/vturb-query.dto';

/** Falls back to the last 30 days, the window VTurb's own dashboard opens on. */
const DEFAULT_RANGE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

@Controller('vturb')
@UseGuards(AuthGuard)
export class VturbController {
  constructor(private readonly vturb: VturbService) {}

  @Get('status')
  async getStatus(
    @CurrentUser('id') userId: string,
    @Query() query: VturbWorkspaceQueryDto,
  ): Promise<{ configured: boolean }> {
    return { configured: await this.vturb.isConfigured(userId, query.workspace_id) };
  }

  @Post('token')
  async saveToken(@CurrentUser('id') userId: string, @Body() body: VturbTokenBodyDto) {
    await this.vturb.saveToken(userId, body.workspace_id, body.token);
    // Proves the key works before the user walks away thinking it is set up.
    return this.run(() => this.vturb.testToken(userId, body.workspace_id));
  }

  @Delete('token')
  async removeToken(@CurrentUser('id') userId: string, @Query() query: VturbWorkspaceQueryDto) {
    await this.vturb.removeToken(userId, query.workspace_id);
    return { configured: false };
  }

  @Get('overview')
  getOverview(@CurrentUser('id') userId: string, @Query() query: VturbRangeQueryDto) {
    return this.run(() =>
      this.vturb.getOverview(userId, query.workspace_id, this.resolveRange(query)),
    );
  }

  @Get('videos/:playerId')
  getVideo(
    @CurrentUser('id') userId: string,
    @Param('playerId') playerId: string,
    @Query() query: VturbRangeQueryDto,
  ) {
    return this.run(() =>
      this.vturb.getVideoDetail(userId, query.workspace_id, playerId, this.resolveRange(query)),
    );
  }

  /**
   * Turns a VturbApiError into the status VTurb itself gave us.
   *
   * Without this every upstream problem would surface as a 500, and the screen
   * could not tell "no key configured" (428) from "quota spent" (429) from
   * "VTurb is down" (502) — three situations with three different answers for
   * the user.
   */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof VturbApiError) {
        throw new HttpException(
          { error: error.message, quotaExceeded: error.quotaExceeded },
          error.status,
        );
      }
      throw error;
    }
  }

  private resolveRange(query: VturbRangeQueryDto): { from: string; to: string } {
    const today = new Date();
    const to = query.to || this.toYmd(today);
    const from =
      query.from || this.toYmd(new Date(today.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY));
    return { from, to };
  }

  private toYmd(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
