import { Body, Controller, HttpCode, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountService } from './account.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateTaxIdDto } from './dto/update-tax-id.dto';
import { UpdateEmailDto } from './dto/update-email.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';

@Controller('me')
@UseGuards(AuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Patch('profile')
  @HttpCode(200)
  async updateProfile(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ name: string }> {
    return this.account.updateProfile(userId, userEmail, dto);
  }

  @Patch('tax-id')
  @HttpCode(200)
  async updateTaxId(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: UpdateTaxIdDto,
  ): Promise<{ type: 'cpf' | 'cnpj'; value: string; stripeSynced: boolean }> {
    return this.account.updateTaxId(userId, userEmail, dto);
  }

  @Patch('email')
  @HttpCode(200)
  async updateEmail(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: UpdateEmailDto,
  ): Promise<{ email: string; stripeSynced: boolean }> {
    return this.account.updateEmail(userId, userEmail, dto);
  }

  @Patch('password')
  @HttpCode(200)
  async updatePassword(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: UpdatePasswordDto,
  ): Promise<{ ok: true }> {
    return this.account.updatePassword(userId, userEmail, dto);
  }
}
