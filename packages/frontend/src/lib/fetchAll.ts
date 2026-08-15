/**
 * Pagination helper for queries that return { data, error }.
 * Fetches all pages by calling fetchPage(from, to) repeatedly
 * until fewer than pageSize rows are returned.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PageResult<T> = { data: T[] | null; error: any };

export async function fetchAllWithRange<T>(
  fetchPage: (from: number, to: number) => Promise<PageResult<T>>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  // Safety cap to avoid infinite loops in case ordering is unstable.
  const maxPages = 200; // 200k rows max per request context

  for (let page = 0; page < maxPages; page++) {
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;

    const rows = data ?? [];
    all.push(...rows);

    // If we got less than a full page, we're done.
    if (rows.length < pageSize) break;

    from += pageSize;
  }

  return all;
}
