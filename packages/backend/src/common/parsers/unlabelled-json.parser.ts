/**
 * Fallback body parser for callers that post JSON without a Content-Type.
 *
 * Fastify answers 415 before the handler runs when it has no parser for the
 * request's content type — including when the header is absent entirely. The
 * sGTM HTTP Request tag does exactly that, and a public ingestion endpoint
 * should not depend on the caller labelling its body: we control neither the
 * tag template nor its future versions.
 *
 * Registered as Fastify's catch-all (`'*'`), which only ever runs for content
 * types that have no parser of their own — `application/json` and
 * `multipart/form-data` keep theirs. Requests outside `allowedPathPrefix` are
 * rejected with the same 415 they got before, so no other endpoint silently
 * starts accepting unlabelled payloads.
 */

export interface ParserRequest {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

export type ParserDone = (error: Error | null, result?: unknown) => void;

export function createUnlabelledJsonParser(allowedPathPrefix: string) {
  return function parseUnlabelledBody(
    request: ParserRequest,
    body: string,
    done: ParserDone,
  ): void {
    if (!request.url?.startsWith(allowedPathPrefix)) {
      const error = new Error(
        `Unsupported Media Type: ${request.headers['content-type']}`,
      ) as Error & { statusCode: number };
      error.statusCode = 415;
      done(error);
      return;
    }

    try {
      done(null, body ? JSON.parse(body) : {});
    } catch {
      // Ingestion never fails the caller: the controller answers 200 with
      // `received: 0`, and sGTM has nothing useful to retry. Rejecting here
      // would turn a malformed payload into a retry loop.
      done(null, {});
    }
  };
}
