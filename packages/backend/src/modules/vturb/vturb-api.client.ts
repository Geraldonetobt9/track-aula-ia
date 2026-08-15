import { Injectable, Logger } from '@nestjs/common';

const VTURB_BASE_URL = 'https://analytics.vturb.net';

/** The only version the spec documents as stable. */
const VTURB_API_VERSION = 'v1';

/**
 * Generous on purpose: the busiest videos are the slowest, and at 20s they were
 * exactly the ones timing out — which quietly removed most of the account's
 * revenue from the totals.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * How many player-scoped calls run at once when fanning out.
 *
 * The documented per-minute budget is on the order of 60 queries, and VTurb
 * warns that one request can count as more than one query. Six at a time keeps
 * a fan-out over a large library from spending the whole minute in one burst.
 */
export const VTURB_MAX_CONCURRENCY = 6;

/** Enough of an upstream error body to act on, without pasting a stack trace into the UI. */
const MAX_ERROR_DETAIL = 300;

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

export class VturbApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly quotaExceeded = false,
  ) {
    super(message);
  }
}

/**
 * Thin HTTP client for the VTurb Analytics API.
 *
 * Knows about transport only — auth headers, timeouts and error shape. What to
 * ask for and how to combine it lives in VturbService.
 */
@Injectable()
export class VturbApiClient {
  private readonly logger = new Logger(VturbApiClient.name);

  /**
   * Almost every read in this API is a POST with a JSON body — including the
   * ones that only fetch. That is their design, not a mistake here.
   */
  post<T>(token: string, path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(token, path, { method: 'POST', body: JSON.stringify(body) });
  }

  get<T>(token: string, path: string, query: Record<string, string> = {}): Promise<T> {
    const search = new URLSearchParams(query).toString();
    return this.request<T>(token, `${path}${search ? `?${search}` : ''}`, { method: 'GET' });
  }

  private async request<T>(token: string, path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${VTURB_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Token': token,
          'X-Api-Version': VTURB_API_VERSION,
        },
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // 429 is the quota window, not a transient failure. Surfaced separately
        // so the UI can say "wait" instead of "something broke".
        const quotaExceeded = response.status === 429;
        this.logger.warn(`VTurb ${path} -> ${response.status} ${detail.slice(0, 500)}`);

        if (quotaExceeded) {
          throw new VturbApiError(
            'Cota da API da VTurb excedida. Tente novamente em alguns minutos.',
            response.status,
            true,
          );
        }

        // The path and the upstream body both go into the message on purpose.
        // VTurb documents 400 as "look at the response body for more
        // information" — dropping it would make the one error that explains
        // itself the one impossible to diagnose.
        throw new VturbApiError(
          `VTurb respondeu ${response.status} em ${path}${
            detail ? `: ${truncate(detail, MAX_ERROR_DETAIL)}` : ''
          }`,
          response.status,
          false,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof VturbApiError) throw error;
      if ((error as Error)?.name === 'AbortError') {
        throw new VturbApiError('A VTurb demorou demais para responder', 504);
      }
      throw new VturbApiError(`Falha ao falar com a VTurb: ${(error as Error).message}`, 502);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Runs `worker` over `items` with a ceiling on how many are in flight.
 *
 * `Promise.all` over a whole video library would fire every request at once and
 * trip the per-minute quota on the first load.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}
