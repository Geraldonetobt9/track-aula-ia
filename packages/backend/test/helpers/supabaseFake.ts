/**
 * Minimal in-memory Supabase client fake for Tier-2 integration tests.
 *
 * Supports the exact chain patterns used by PlanLimitsService, SubscriptionsService,
 * SalesService, and StripeWebhookService. Not a general-purpose Supabase stub.
 */

type Row = Record<string, any>;
type Store = Record<string, Row[]>;

interface QueryState {
  table: string;
  operation: 'select' | 'insert' | 'update' | 'delete' | null;
  selectColumns?: string;
  countMode?: boolean;
  headMode?: boolean;
  insertPayload?: Row | Row[];
  updatePayload?: Row;
  returnAffectedRows?: boolean;
  filters: Array<(row: Row) => boolean>;
  orderKey?: string;
  orderAsc?: boolean;
  limitN?: number;
}

export class SupabaseFake {
  readonly store: Store = {};
  private uniqueConstraints: Record<string, string[]> = {};
  private idCounter = 0;

  seed(table: string, rows: Row[]): void {
    this.store[table] = [...(this.store[table] ?? []), ...rows];
  }

  declareUnique(table: string, columns: string[]): void {
    this.uniqueConstraints[table] = columns;
  }

  private nextId(prefix = 'id'): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  getClient() {
    return {
      from: (table: string) => this.buildQuery(table),
    };
  }

  private buildQuery(table: string) {
    const state: QueryState = {
      table,
      operation: null,
      filters: [],
    };
    const builder: any = {};

    const addFilter = (fn: (row: Row) => boolean) => {
      state.filters.push(fn);
      return builder;
    };

    builder.select = (columns?: string, opts?: { count?: string; head?: boolean }) => {
      state.operation = state.operation === 'update' || state.operation === 'insert'
        ? state.operation
        : 'select';
      state.selectColumns = columns;
      if (opts?.count === 'exact') state.countMode = true;
      if (opts?.head) state.headMode = true;
      if (state.operation === 'update' || state.operation === 'insert') {
        state.returnAffectedRows = true;
      }
      return builder;
    };

    builder.insert = (payload: Row | Row[]) => {
      state.operation = 'insert';
      state.insertPayload = payload;
      return builder;
    };

    builder.update = (payload: Row) => {
      state.operation = 'update';
      state.updatePayload = payload;
      return builder;
    };

    builder.delete = () => {
      state.operation = 'delete';
      return builder;
    };

    builder.eq = (col: string, val: any) => addFilter((r) => r[col] === val);
    builder.neq = (col: string, val: any) => addFilter((r) => r[col] !== val);
    builder.is = (col: string, val: any) => addFilter((r) => r[col] === val);
    builder.in = (col: string, vals: any[]) => addFilter((r) => vals.includes(r[col]));
    builder.gte = (col: string, val: any) => addFilter((r) => r[col] >= val);
    builder.gt  = (col: string, val: any) => addFilter((r) => r[col] > val);
    builder.lte = (col: string, val: any) => addFilter((r) => r[col] <= val);
    builder.lt  = (col: string, val: any) => addFilter((r) => r[col] < val);
    builder.order = (col: string, opts?: { ascending?: boolean }) => {
      state.orderKey = col;
      state.orderAsc = opts?.ascending !== false;
      return builder;
    };
    builder.limit = (n: number) => {
      state.limitN = n;
      return builder;
    };

    const execute = (): { data: any; error: any; count?: number } => this.execute(state);

    builder.maybeSingle = async () => {
      const { data, error } = execute();
      if (error) return { data: null, error };
      const row = Array.isArray(data) ? (data[0] ?? null) : data;
      return { data: row, error: null };
    };
    builder.single = async () => {
      const { data, error } = execute();
      if (error) return { data: null, error };
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { data: null, error: { code: 'PGRST116', message: 'No rows' } };
      return { data: row, error: null };
    };

    builder.then = (resolve: (v: any) => void, reject?: (e: any) => void) => {
      try {
        const result = execute();
        return Promise.resolve(result).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    };

    return builder;
  }

  private execute(state: QueryState): { data: any; error: any; count?: number } {
    const rows = this.store[state.table] ?? (this.store[state.table] = []);

    if (state.operation === 'insert') {
      return this.executeInsert(state, rows);
    }

    const matched = rows.filter((r) => state.filters.every((f) => f(r)));

    if (state.operation === 'update') {
      for (const r of matched) Object.assign(r, state.updatePayload);
      if (state.returnAffectedRows) {
        return { data: matched.map((r) => ({ ...r })), error: null };
      }
      return { data: null, error: null };
    }

    if (state.operation === 'delete') {
      const remaining = rows.filter((r) => !matched.includes(r));
      this.store[state.table] = remaining;
      return { data: null, error: null };
    }

    // select
    let result = [...matched];
    if (state.orderKey) {
      const key = state.orderKey;
      result.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av === bv) return 0;
        if (av === null || av === undefined) return state.orderAsc ? -1 : 1;
        if (bv === null || bv === undefined) return state.orderAsc ? 1 : -1;
        return state.orderAsc ? (av < bv ? -1 : 1) : (av < bv ? 1 : -1);
      });
    }
    if (state.limitN !== undefined) result = result.slice(0, state.limitN);

    if (state.countMode) {
      return { data: state.headMode ? null : result, count: matched.length, error: null };
    }
    return { data: result, count: matched.length, error: null };
  }

  private executeInsert(state: QueryState, rows: Row[]): { data: any; error: any } {
    const payload = state.insertPayload!;
    const toInsert = Array.isArray(payload) ? payload : [payload];
    const uniqueCols = this.uniqueConstraints[state.table];

    const inserted: Row[] = [];
    for (const raw of toInsert) {
      const row: Row = {
        id: raw.id ?? this.nextId(`${state.table}-row`),
        created_at: raw.created_at ?? new Date().toISOString(),
        ...raw,
      };
      if (uniqueCols) {
        const collision = rows.some((existing) =>
          uniqueCols.every((col) => existing[col] === row[col]),
        );
        if (collision) {
          return {
            data: null,
            error: { code: '23505', message: `duplicate key value violates unique constraint on ${state.table}` },
          };
        }
      }
      rows.push(row);
      inserted.push(row);
    }

    if (state.returnAffectedRows) {
      return { data: inserted.map((r) => ({ ...r })), error: null };
    }
    return { data: null, error: null };
  }
}
