import { Test, TestingModule } from '@nestjs/testing';
import { VturbService } from '../vturb.service';
import { VturbApiClient } from '../vturb-api.client';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { CacheService } from '../../../shared/services/cache.service';

const USER_ID = 'user-1';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const RANGE = { from: '2026-07-14', to: '2026-08-13' };

/**
 * Covers what gets sent to `/sessions/stats`.
 *
 * A video with real audience once ranked into the top 5 and then reported all
 * zeros, because VTurb's own duration lookup came back empty and the endpoint
 * answered zeros rather than failing. Passing the value we already have avoids
 * depending on that lookup.
 */
describe('VturbService — parametros do /sessions/stats', () => {
  let service: VturbService;
  let post: jest.Mock;

  const build = async (player: Record<string, unknown>) => {
    post = jest.fn().mockImplementation((_token, path) =>
      Promise.resolve(path === '/sessions/stats' ? { total_viewed: 10 } : []),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VturbService,
        CacheService,
        {
          provide: VturbApiClient,
          useValue: { get: jest.fn().mockResolvedValue([player]), post },
        },
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
  };

  const statsBody = () => post.mock.calls.find((call) => call[1] === '/sessions/stats')![2];

  it('sends the duration it already knows instead of letting VTurb look it up', async () => {
    await build({ id: 'p1', name: 'vsl', pitch_time: 0, duration: 764, created_at: '' });
    await service.getOverview(USER_ID, WORKSPACE_ID, RANGE);

    expect(statsBody().video_duration).toBe(764);
  });

  it('omits pitch_time when the player has none', async () => {
    await build({ id: 'p1', name: 'vsl', pitch_time: 0, duration: 764, created_at: '' });
    await service.getOverview(USER_ID, WORKSPACE_ID, RANGE);

    // Sending 0 would assert "the pitch is at second zero", not "unknown".
    expect(statsBody()).not.toHaveProperty('pitch_time');
  });

  it('sends pitch_time when the player has one', async () => {
    await build({ id: 'p1', name: 'map', pitch_time: 600, duration: 697, created_at: '' });
    await service.getOverview(USER_ID, WORKSPACE_ID, RANGE);

    expect(statsBody().pitch_time).toBe(600);
  });

  it('omits video_duration when the player has none, rather than sending zero', async () => {
    await build({ id: 'p1', name: 'vsl', pitch_time: 0, duration: 0, created_at: '' });
    await service.getOverview(USER_ID, WORKSPACE_ID, RANGE);

    expect(statsBody()).not.toHaveProperty('video_duration');
  });
});
