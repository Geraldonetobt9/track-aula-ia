import { Test, TestingModule } from '@nestjs/testing';
import { VturbService } from '../vturb.service';
import { VturbApiClient } from '../vturb-api.client';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { CacheService } from '../../../shared/services/cache.service';

const USER_ID = 'user-1';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Both behaviours pinned here were found by calling the real API, and neither
 * is in VTurb's spec — the spec actively contradicts the first one. They would
 * be easy to "clean up" back into bugs.
 */
describe('VturbService', () => {
  let service: VturbService;
  let post: jest.Mock;
  let get: jest.Mock;

  const stats = {
    total_viewed: 11929,
    total_viewed_device_uniq: 6966,
    total_started: 2529,
    total_started_device_uniq: 2346,
    total_conversions: 59,
    overall_conversion_rate: 2.51,
    play_rate: 33.67,
    over_pitch_rate: 23.46,
    total_over_pitch: 570,
    engagement_rate: 31.11,
    total_clicked: 462,
    // Cents, as the API actually returns. The panel shows R$ 18.287,15.
    total_amount_brl: 1828715,
  };

  beforeEach(async () => {
    get = jest.fn().mockResolvedValue([
      { id: 'player-1', name: 'M.A.P', pitch_time: 600, duration: 697, created_at: '' },
    ]);
    post = jest.fn().mockImplementation((_token, path) => {
      if (path === '/sessions/stats') return Promise.resolve(stats);
      return Promise.resolve([]);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VturbService,
        CacheService,
        { provide: VturbApiClient, useValue: { get, post } },
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => ({
              from: () => ({
                select: () => ({
                  eq: () => ({
                    eq: () => ({ maybeSingle: async () => ({ data: { vturb_api_token: 'k' } }) }),
                  }),
                }),
              }),
            }),
          },
        },
        { provide: EncryptionService, useValue: { decryptIfNeeded: (v: string) => v } },
      ],
    }).compile();

    service = module.get(VturbService);
  });

  it('sends dates with hours, minutes and seconds', async () => {
    await service.getOverview(USER_ID, WORKSPACE_ID, { from: '2026-07-14', to: '2026-08-13' });

    const [, , body] = post.mock.calls.find((call) => call[1] === '/sessions/stats')!;
    // Date-only values are rejected: "Start date must be a valid datetime with
    // hours, minutes, and seconds" — despite the spec listing "2023-10-26".
    expect(body.start_date).toBe('2026-07-14 00:00:00');
  });

  it('ends the range at 23:59:59, because VTurb filters end_date with <=', async () => {
    await service.getOverview(USER_ID, WORKSPACE_ID, { from: '2026-07-14', to: '2026-08-13' });

    const [, , body] = post.mock.calls.find((call) => call[1] === '/sessions/stats')!;
    // Midnight here would silently drop the whole last day of every range.
    expect(body.end_date).toBe('2026-08-13 23:59:59');
  });

  it('converts revenue from cents', async () => {
    const overview = await service.getOverview(USER_ID, WORKSPACE_ID, {
      from: '2026-07-14',
      to: '2026-08-13',
    });

    expect(overview.revenue).toBeCloseTo(18287.15, 2);
    expect(overview.videos[0].revenue).toBeCloseTo(18287.15, 2);
  });

  it('converts revenue from cents on the video detail too', async () => {
    const detail = await service.getVideoDetail(USER_ID, WORKSPACE_ID, 'player-1', {
      from: '2026-07-14',
      to: '2026-08-13',
    });

    expect(detail.revenue).toBeCloseTo(18287.15, 2);
  });

  it('passes through the rates VTurb computes instead of recomputing them', async () => {
    const detail = await service.getVideoDetail(USER_ID, WORKSPACE_ID, 'player-1', {
      from: '2026-07-14',
      to: '2026-08-13',
    });

    expect(detail.playRate).toBe(33.67);
    expect(detail.pitchRetentionRate).toBe(23.46);
    expect(detail.engagementRate).toBe(31.11);
    expect(detail.conversionRate).toBe(2.51);
  });

  it('asks for the country field by its documented name', async () => {
    await service.getOverview(USER_ID, WORKSPACE_ID, { from: '2026-07-14', to: '2026-08-13' });

    const call = post.mock.calls.find((entry) => entry[1] === '/sessions/stats_by_field');
    // VTurb's own 400 lists the valid values, and 'country' is one of them.
    expect(call?.[2].field).toBe('country');
  });
});
