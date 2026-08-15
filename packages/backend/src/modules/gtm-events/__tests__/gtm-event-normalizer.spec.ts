/**
 * Covers the PII-stripping and normalization rules — the highest-risk code in
 * this feature, since it is the only thing standing between a sGTM payload and
 * customer data landing in the database.
 */
import { hashVisitor, normalizeGtmEvent, stripPii } from '../gtm-event-normalizer';

const context = {
  workspaceId: '00000000-0000-0000-0000-000000000001',
  userId: 'user-1',
  visitorSalt: 'test-salt',
};

describe('stripPii', () => {
  it('drops user_data and the cookies at any depth', () => {
    const result = stripPii({
      event_name: 'Purchase',
      fbp: 'fb.1.123.456',
      fbc: 'fb.1.123.789',
      user_data: { em: 'hash', ph: 'hash' },
      nested: { deeper: { email: 'a@b.com', keep: 'yes' } },
    }) as Record<string, any>;

    expect(result.event_name).toBe('Purchase');
    expect(result.fbp).toBeUndefined();
    expect(result.fbc).toBeUndefined();
    expect(result.user_data).toBeUndefined();
    expect(result.nested.deeper.email).toBeUndefined();
    expect(result.nested.deeper.keep).toBe('yes');
  });

  it('strips PII inside arrays', () => {
    const result = stripPii({
      contents: [{ id: 'sku-1', external_id: 'leak' }],
    }) as Record<string, any>;

    expect(result.contents[0].id).toBe('sku-1');
    expect(result.contents[0].external_id).toBeUndefined();
  });

  it('does not mutate the input', () => {
    const input = { fbp: 'fb.1.123', keep: 1 };
    stripPii(input);
    expect(input.fbp).toBe('fb.1.123');
  });
});

describe('hashVisitor', () => {
  it('is stable for the same cookie and salt', () => {
    expect(hashVisitor('fb.1.123', 'salt')).toBe(hashVisitor('fb.1.123', 'salt'));
  });

  it('changes when the salt changes', () => {
    expect(hashVisitor('fb.1.123', 'salt-a')).not.toBe(hashVisitor('fb.1.123', 'salt-b'));
  });

  it('never returns the cookie itself', () => {
    expect(hashVisitor('fb.1.123', 'salt')).not.toContain('fb.1.123');
  });
});

describe('normalizeGtmEvent', () => {
  it('maps a full payload and hashes the visitor', () => {
    const row = normalizeGtmEvent(
      {
        event_name: 'Purchase',
        event_id: 'evt-1',
        event_time: 1754300000,
        value: 197,
        currency: 'BRL',
        page_url: 'https://example.com/obrigado',
        fbp: 'fb.1.123.456',
        fbc: 'fb.1.123.789',
        fbclid: 'IwAR123',
      },
      context,
    );

    expect(row).not.toBeNull();
    expect(row!.event_name).toBe('Purchase');
    expect(row!.value).toBe(197);
    expect(row!.has_fbp).toBe(true);
    expect(row!.has_fbc).toBe(true);
    expect(row!.visitor_hash).toBe(hashVisitor('fb.1.123.456', context.visitorSalt));
    expect(row!.event_time).toBe(new Date(1754300000 * 1000).toISOString());
  });

  it('scopes the row to the workspace that owns the token', () => {
    const row = normalizeGtmEvent({ event_name: 'PageView' }, context);

    expect(row!.workspace_id).toBe(context.workspaceId);
    expect(row!.user_id).toBe(context.userId);
  });

  it('leaves visitor_hash null when _fbp is absent', () => {
    const row = normalizeGtmEvent({ event_name: 'PageView' }, context);

    expect(row!.visitor_hash).toBeNull();
    expect(row!.has_fbp).toBe(false);
  });

  it('keeps the raw cookie out of raw', () => {
    const row = normalizeGtmEvent({ event_name: 'PageView', fbp: 'fb.1.123.456' }, context);

    expect(JSON.stringify(row!.raw)).not.toContain('fb.1.123.456');
  });

  it('keeps the raw cookie out of the row entirely', () => {
    const row = normalizeGtmEvent({ event_name: 'PageView', fbp: 'fb.1.999' }, context);

    expect(JSON.stringify(row)).not.toContain('fb.1.999');
    expect(row!.visitor_hash).toEqual(expect.any(String));
  });

  it('rejects a payload without an event name', () => {
    expect(normalizeGtmEvent({ value: 10 }, context)).toBeNull();
    expect(normalizeGtmEvent({ event_name: '   ' }, context)).toBeNull();
  });

  it('accepts unix milliseconds and ISO timestamps', () => {
    const ms = normalizeGtmEvent({ event_name: 'PageView', event_time: 1754300000000 }, context);
    const iso = normalizeGtmEvent(
      { event_name: 'PageView', event_time: '2026-08-04T10:00:00.000Z' },
      context,
    );

    expect(ms!.event_time).toBe(new Date(1754300000000).toISOString());
    expect(iso!.event_time).toBe('2026-08-04T10:00:00.000Z');
  });

  it('falls back to now() on an unusable timestamp', () => {
    const row = normalizeGtmEvent({ event_name: 'PageView', event_time: 'not-a-date' }, context);

    expect(Number.isNaN(new Date(row!.event_time).getTime())).toBe(false);
  });

  it('promotes id_do_usuario to external_user_id', () => {
    const row = normalizeGtmEvent(
      { event_name: 'PageView', id_do_usuario: 'user-4821' },
      context,
    );

    expect(row!.external_user_id).toBe('user-4821');
  });

  it('accepts a numeric id_do_usuario', () => {
    const row = normalizeGtmEvent({ event_name: 'PageView', id_do_usuario: 4821 }, context);

    expect(row!.external_user_id).toBe('4821');
  });

  it('leaves external_user_id null when the id is absent or blank', () => {
    expect(normalizeGtmEvent({ event_name: 'PageView' }, context)!.external_user_id).toBeNull();
    expect(
      normalizeGtmEvent({ event_name: 'PageView', id_do_usuario: '  ' }, context)!
        .external_user_id,
    ).toBeNull();
  });

  it('keeps id_do_usuario in raw — it is the operator own identifier, not PII to strip', () => {
    const row = normalizeGtmEvent(
      { event_name: 'PageView', id_do_usuario: 'user-4821' },
      context,
    );

    expect((row!.raw as any).id_do_usuario).toBe('user-4821');
  });

  it('parses a comma decimal value', () => {
    const row = normalizeGtmEvent({ event_name: 'Purchase', value: '197,50' }, context);
    expect(row!.value).toBe(197.5);
  });
});
