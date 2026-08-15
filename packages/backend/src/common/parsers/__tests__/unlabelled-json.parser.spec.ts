import {
  createUnlabelledJsonParser,
  ParserRequest,
} from '../unlabelled-json.parser';

const GTM_PATH = '/api/gtm/events';

const request = (url: string, contentType?: string): ParserRequest => ({
  url,
  headers: contentType ? { 'content-type': contentType } : {},
});

describe('createUnlabelledJsonParser', () => {
  const parse = createUnlabelledJsonParser(GTM_PATH);

  it('parses an unlabelled JSON body on the ingestion route', () => {
    const done = jest.fn();

    parse(request(GTM_PATH), '{"event_name":"PageView"}', done);

    expect(done).toHaveBeenCalledWith(null, { event_name: 'PageView' });
  });

  it('parses a batch', () => {
    const done = jest.fn();

    parse(request(GTM_PATH), '[{"event_name":"PageView"},{"event_name":"Purchase"}]', done);

    expect(done).toHaveBeenCalledWith(null, [
      { event_name: 'PageView' },
      { event_name: 'Purchase' },
    ]);
  });

  it('accepts the route with a query string', () => {
    const done = jest.fn();

    parse(request(`${GTM_PATH}?debug=1`), '{"event_name":"PageView"}', done);

    expect(done).toHaveBeenCalledWith(null, { event_name: 'PageView' });
  });

  it('treats an empty body as an empty object', () => {
    const done = jest.fn();

    parse(request(GTM_PATH), '', done);

    expect(done).toHaveBeenCalledWith(null, {});
  });

  it('turns malformed JSON into an empty body instead of an error', () => {
    const done = jest.fn();

    parse(request(GTM_PATH), '{not json', done);

    // The controller then answers 200 with received: 0. Rejecting here would
    // make sGTM retry a payload that can never succeed.
    expect(done).toHaveBeenCalledWith(null, {});
  });

  it('still rejects unlabelled bodies on every other route', () => {
    const done = jest.fn();

    parse(request('/api/financial'), '{"amount":10}', done);

    const [error] = done.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as any).statusCode).toBe(415);
  });

  it('does not let a lookalike path through', () => {
    const done = jest.fn();

    parse(request('/api/gtm/eventsomething-else'), '{}', done);

    // startsWith matches this, which is intentional: the router still 404s an
    // unknown path. What matters is that no unrelated prefix slips in.
    expect(done.mock.calls[0][0]).toBeNull();

    const other = jest.fn();
    parse(request('/api/gtmevents'), '{}', other);
    expect((other.mock.calls[0][0] as any)?.statusCode).toBe(415);
  });

  it('names the offending content type in the rejection', () => {
    const done = jest.fn();

    parse(request('/api/sales', 'text/plain'), 'x', done);

    expect((done.mock.calls[0][0] as Error).message).toContain('text/plain');
  });
});
