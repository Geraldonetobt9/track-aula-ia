import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { ListUsersDto } from './dto/list-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ProxyQueryDto } from './dto/proxy-query.dto';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('users')
  listUsers(@Query() dto: ListUsersDto) {
    return this.adminService.listUsers({
      page: dto.page ? parseInt(dto.page, 10) : undefined,
      limit: dto.limit ? parseInt(dto.limit, 10) : undefined,
      search: dto.search,
      plan: dto.plan,
      role: dto.role,
      facebook_status: dto.facebook_status,
    });
  }

  @Get('users/:id')
  getUserDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Get('users/:id/checkout-integrations/:integrationId/credentials')
  getCheckoutCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('integrationId', ParseUUIDPipe) integrationId: string,
  ) {
    return this.adminService.getCheckoutCredentials(id, integrationId);
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, dto);
  }

  @Delete('users/:id')
  deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') callerUserId: string,
  ) {
    return this.adminService.deleteUser(id, callerUserId);
  }

  @Post('users/:id/force-sync')
  forceSync(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.forceSync(id);
  }

  @Post('proxy')
  proxyQuery(@Body() dto: ProxyQueryDto) {
    return this.adminService.proxyQuery(dto.user_id, dto.queries);
  }
}
