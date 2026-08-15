import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { OperatorGuard } from '../../common/guards/operator.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GtmEventsService } from './gtm-events.service';
import { ListGtmEventsQueryDto } from './dto/list-gtm-events-query.dto';
import { GtmVisitorsQueryDto } from './dto/gtm-visitors-query.dto';
import { GtmWorkspaceBodyDto } from './dto/gtm-workspace-body.dto';

/**
 * Read side of the GTM events feature.
 *
 * OperatorGuard is what actually restricts the feature — hiding the route in
 * the frontend would leave these responses reachable by any authenticated user.
 */
@Controller('gtm')
@UseGuards(AuthGuard, OperatorGuard)
export class GtmEventsController {
  constructor(private readonly gtmEvents: GtmEventsService) {}

  @Get('events')
  list(@CurrentUser('id') userId: string, @Query() query: ListGtmEventsQueryDto) {
    return this.gtmEvents.list(userId, query.workspace_id, {
      before: query.before,
      eventName: query.event_name,
      limit: query.limit,
      from: query.from,
      to: query.to,
    });
  }

  @Get('visitors')
  topVisitors(@CurrentUser('id') userId: string, @Query() query: GtmVisitorsQueryDto) {
    return this.gtmEvents.topVisitors(userId, query.workspace_id, {
      from: query.from,
      to: query.to,
      limit: query.limit,
    });
  }

  @Get('token')
  getToken(
    @CurrentUser('id') userId: string,
    @Query('workspace_id', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.gtmEvents
      .getToken(userId, workspaceId)
      .then((token) => ({ token }));
  }

  @Post('token')
  rotateToken(@CurrentUser('id') userId: string, @Body() body: GtmWorkspaceBodyDto) {
    return this.gtmEvents
      .rotateToken(userId, body.workspace_id)
      .then((token) => ({ token }));
  }

  @Get('events/:id/raw')
  getRaw(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('workspace_id', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.gtmEvents.getRaw(userId, workspaceId, id);
  }
}
