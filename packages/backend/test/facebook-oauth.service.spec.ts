import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FacebookOAuthService } from '../src/modules/facebook/facebook-oauth.service';

describe('FacebookOAuthService', () => {
  let service: FacebookOAuthService;
  const mockConfig = {
    getOrThrow: jest.fn((key: string) => {
      const map: Record<string, string> = {
        FACEBOOK_APP_ID: '000000000000000',
        FACEBOOK_APP_SECRET: 'test_app_secret_123',
        FACEBOOK_REDIRECT_URI: 'http://localhost:3001/api/facebook/auth/callback',
        ENCRYPTION_KEY: 'test-encryption-key-for-hmac-signing',
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookOAuthService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<FacebookOAuthService>(FacebookOAuthService);
  });

  describe('buildAuthorizationUrl', () => {
    it('should generate a valid Facebook OAuth URL with correct params', () => {
      const url = service.buildAuthorizationUrl('user-uuid-123');
      const parsed = new URL(url);

      expect(parsed.origin).toBe('https://www.facebook.com');
      expect(parsed.pathname).toBe('/v22.0/dialog/oauth');
      expect(parsed.searchParams.get('client_id')).toBe('000000000000000');
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3001/api/facebook/auth/callback',
      );
      expect(parsed.searchParams.get('scope')).toBe(
        'ads_read,ads_management,read_insights,business_management,public_profile',
      );
      expect(parsed.searchParams.get('state')).toBeTruthy();
      expect(parsed.searchParams.get('auth_type')).toBe('rerequest');
    });

    it('should include userId in the state that can be verified later', () => {
      const url = service.buildAuthorizationUrl('user-uuid-123');
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;

      const userId = service.verifyState(state);
      expect(userId).toBe('user-uuid-123');
    });
  });

  describe('verifyState', () => {
    it('should return null for tampered state', () => {
      const url = service.buildAuthorizationUrl('user-uuid-123');
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;

      // Tamper with the state
      const tampered = 'tampered.' + state.split('.').slice(1).join('.');
      expect(service.verifyState(tampered)).toBeNull();
    });

    it('should return null for empty or malformed state', () => {
      expect(service.verifyState('')).toBeNull();
      expect(service.verifyState('no-dots-here')).toBeNull();
    });

    it('should return null for expired state (older than 10 minutes)', () => {
      // Generate a valid state
      const url = service.buildAuthorizationUrl('user-uuid-123');
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;

      // Fast-forward time by 11 minutes
      const elevenMinutesMs = 11 * 60 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + elevenMinutesMs);

      expect(service.verifyState(state)).toBeNull();

      jest.restoreAllMocks();
    });
  });
});
