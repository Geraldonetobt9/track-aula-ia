import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @HttpCode(201)
  @SkipThrottle({ default: false })
  async signup(@Body() dto: SignupDto): Promise<{ userId: string; email: string }> {
    return this.authService.signup(dto);
  }
}
