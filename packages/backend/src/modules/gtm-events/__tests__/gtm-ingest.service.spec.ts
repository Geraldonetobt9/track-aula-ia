import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GtmIngestService } from '../gtm-ingest.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { CacheService } from '../../../shared/services/cache.service';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = 'user-1';
const VALID_TOKEN = 'stl_valid';

describe('GtmIngestService.ingest', () => {
  let service: GtmIngestService;
  let upsertMock: jest.Mock;
  let workspaceRow: { id: string; user_id: string } | null;

  beforeEach(async () => {
    workspaceRow = { id: WORKSPACE_ID, user_id: USER_ID };
    upsertMock = jest.fn().mockResolvedValue({ error: null });

    const makeBuilder = () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        maybeSingle: async () => ({ data: workspaceRow, error: null }),
        upsert: upsertMock,
      };
      return builder;
    };

    const supabaseMock: Partial<SupabaseService> = {
      getClient: () => ({ from: () => makeBuilder() }) as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GtmIngestService,
        CacheService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: ConfigService, useValue: { get: () => 'test-salt' } },
      ],
    }).compile();

    service = module.get(GtmIngestService);
  });

  it('stores nothing when the token is missing', async () => {
    expect(await service.ingest(undefined, { event_name: 'PageView' })).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('stores nothing when the token does not match a workspace', async () => {
    workspaceRow = null;
    expect(await service.ingest('stl_unknown', { event_name: 'PageView' })).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('stores a single event scoped to the token owner', async () => {
    const received = await service.ingest(VALID_TOKEN, { event_name: 'PageView' });

    expect(received).toBe(1);
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].workspace_id).toBe(WORKSPACE_ID);
    expect(rows[0].user_id).toBe(USER_ID);
  });

  it('keeps the valid items of a batch and drops the invalid ones', async () => {
    const received = await service.ingest(VALID_TOKEN, [
      { event_name: 'PageView' },
      { value: 10 },
      { event_name: 'Purchase', value: 197 },
    ]);

    expect(received).toBe(2);
    const [rows] = upsertMock.mock.calls[0];
    expect(rows.map((row: any) => row.event_name)).toEqual(['PageView', 'Purchase']);
  });

  it('caps an oversized batch at 200 items', async () => {
    const batch = Array.from({ length: 250 }, () => ({ event_name: 'PageView' }));

    expect(await service.ingest(VALID_TOKEN, batch)).toBe(200);
  });

  it('deduplicates on (workspace_id, event_id)', async () => {
    await service.ingest(VALID_TOKEN, { event_name: 'Purchase', event_id: 'evt-1' });

    const [, options] = upsertMock.mock.calls[0];
    expect(options).toEqual({ onConflict: 'workspace_id,event_id', ignoreDuplicates: true });
  });

  it('reports zero when the insert fails, without throwing', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'boom' } });

    await expect(service.ingest(VALID_TOKEN, { event_name: 'PageView' })).resolves.toBe(0);
  });

  it('never persists the raw _fbp cookie', async () => {
    await service.ingest(VALID_TOKEN, { event_name: 'PageView', fbp: 'fb.1.999' });

    const [rows] = upsertMock.mock.calls[0];
    expect(JSON.stringify(rows[0])).not.toContain('fb.1.999');
    expect(rows[0].visitor_hash).toEqual(expect.any(String));
  });
});
