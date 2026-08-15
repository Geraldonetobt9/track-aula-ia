import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

const FB_API_VERSION = 'v22.0';
const OAUTH_SCOPES = 'ads_read,ads_management,read_insights,business_management,public_profile';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class FacebookOAuthService {
  private readonly logger = new Logger(FacebookOAuthService.name);
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;
  private readonly signingKey: string;

  constructor(private readonly config: ConfigService) {
    this.appId = this.config.getOrThrow<string>('FACEBOOK_APP_ID');
    this.appSecret = this.config.getOrThrow<string>('FACEBOOK_APP_SECRET');
    this.redirectUri = this.config.getOrThrow<string>('FACEBOOK_REDIRECT_URI');
    this.signingKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  buildAuthorizationUrl(userId: string): string {
    const state = this.createState(userId);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      scope: OAUTH_SCOPES,
      response_type: 'code',
      state,
      auth_type: 'rerequest',
    });
    return `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  verifyState(state: string): string | null {
    try {
      const parts = state.split('.');
      if (parts.length !== 3) return null;

      const [payloadB64, timestampStr, signature] = parts;
      const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
      const timestamp = parseInt(timestampStr, 10);

      // Check expiry
      if (Date.now() - timestamp > STATE_TTL_MS) {
        this.logger.warn('OAuth state expired');
        return null;
      }

      // Verify signature
      const expectedSig = this.sign(`${payloadB64}.${timestampStr}`);
      const sigBuffer = Buffer.from(signature, 'base64url');
      const expectedBuffer = Buffer.from(expectedSig, 'base64url');

      if (sigBuffer.length !== expectedBuffer.length) return null;
      if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
        this.logger.warn('OAuth state signature mismatch');
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    });

    const url = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      this.logger.error(`Token exchange failed: ${JSON.stringify(data.error)}`);
      throw new BadRequestException(
        data.error.message || 'Failed to exchange authorization code',
      );
    }

    return data.access_token;
  }

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: shortLivedToken,
    });

    const url = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      this.logger.error(`Long-lived token exchange failed: ${JSON.stringify(data.error)}`);
      throw new BadRequestException(
        data.error.message || 'Failed to exchange for long-lived token',
      );
    }

    const expiresInSeconds = data.expires_in || 5184000; // default 60 days
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    return { accessToken: data.access_token, expiresAt };
  }

  async getFacebookUserId(accessToken: string): Promise<{ id: string; name: string }> {
    const url = `https://graph.facebook.com/${FB_API_VERSION}/me?fields=id,name&access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new BadRequestException(data.error.message || 'Failed to get Facebook user info');
    }

    return { id: data.id, name: data.name };
  }

  private createState(userId: string): string {
    const payloadB64 = Buffer.from(userId, 'utf8').toString('base64url');
    const timestamp = Date.now().toString();
    const signature = this.sign(`${payloadB64}.${timestamp}`);
    return `${payloadB64}.${timestamp}.${signature}`;
  }

  private sign(data: string): string {
    return createHmac('sha256', this.signingKey).update(data).digest('base64url');
  }
}
