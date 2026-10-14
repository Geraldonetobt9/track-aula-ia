import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';
import type { TrackerAbTest } from '../tracking/tracker-script';
import type { AbAssignment } from '../tracking/collect-payload';
import { normalizePageUrl, NormalizedPage } from './ab-url';
import {
  ALPHA,
  Comparison,
  compareMeans,
  compareProportions,
  MIN_CONVERSIONS,
  MIN_VISITORS_PER_VARIANT,
  sampleSizePerVariant,
} from './ab-stats';
import {
  AbAction,
  AbGoal,
  AbMode,
  AbTestStatusDto,
  AbVariantDto,
  CreateAbTestDto,
  UpdateAbTestDto,
} from './dto/ab-test.dto';

const TEST_COLUMNS =
  'id, workspace_id, name, hypothesis, mode, page_url, goal, status, started_at, ended_at, winner_variant_id, created_at, updated_at';
const VARIANT_COLUMNS = 'id, test_id, key, name, url, weight, position';
const KEYS = ['A', 'B', 'C', 'D', 'E'];

/**
 * Testes rodando, por área, para o tracker.js. Curto: começar ou pausar um
 * teste precisa chegar logo à página (o navegador ainda segura o script por
 * até 5 minutos, pelo Cache-Control do tracker.js).
 */
const SCRIPT_CACHE_TTL_MS = 60_000;

type AbStatus = 'draft' | 'running' | 'paused' | 'finished';

interface TestRow {
  id: string;
  workspace_id: string;
  name: string;
  hypothesis: string | null;
  mode: AbMode;
  page_url: string;
  goal: AbGoal;
  status: AbStatus;
  started_at: string | null;
  ended_at: string | null;
  winner_variant_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VariantRow {
  id: string;
  test_id: string;
  key: string;
  name: string;
  url: string | null;
  weight: number;
  position: number;
}

interface RpcVariant {
  id: string;
  visitors: number;
  checkout_visitors: number;
  buyers: number;
  orders: number;
  orders_indexed: number;
  revenue: number;
  revenue_sq: number;
}

interface ResultsRpc {
  variants: RpcVariant[];
  daily: { date: string; variant_id: string; visitors: number; buyers: number }[];
  unmatched_sales: number;
}

/** Variante como sai para o painel. */
export interface AbVariantResult {
  id: string;
  key: string;
  name: string;
  url: string | null;
  weight: number;
  isControl: boolean;
  visitors: number;
  checkoutVisitors: number;
  buyers: number;
  orders: number;
  /** Pedidos ligados à visita pelo indexador (sck) — o vínculo exato. */
  ordersIndexed: number;
  revenue: number;
  /** Percentuais de 0 a 100. */
  checkoutRate: number;
  conversionRate: number;
  revenuePerVisitor: number;
  /** Contra o controle, na métrica do objetivo. null no próprio controle. */
  comparison: (Comparison & { significant: boolean }) | null;
}

export type AbVerdict = 'draft' | 'collecting' | 'winner' | 'control' | 'inconclusive';

/** Valores numéricos do Postgres chegam como string quando são numeric. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class AbTestsService {
  private readonly logger = new Logger(AbTestsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  async list(userId: string, workspaceId: string) {
    await this.assertOwner(userId, workspaceId);
    const client = this.supabase.getClient();

    const { data: tests, error } = await client
      .from('ab_tests')
      .select(TEST_COLUMNS)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    if (!tests?.length) return [];

    const variants = await this.variantsOf(tests.map((t) => t.id));
    const results = await Promise.all(
      (tests as TestRow[]).map((t) => (t.status === 'draft' ? null : this.results(userId, t.id))),
    );

    return (tests as TestRow[]).map((t, i) =>
      this.present(t, variants.filter((v) => v.test_id === t.id), results[i]),
    );
  }

  async get(userId: string, testId: string) {
    const test = await this.loadOwned(userId, testId);
    const variants = await this.variantsOf([test.id]);
    const results = test.status === 'draft' ? null : await this.results(userId, test.id);
    return this.present(test, variants, results);
  }

  // -------------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------------

  async create(userId: string, dto: CreateAbTestDto) {
    await this.assertOwner(userId, dto.workspace_id);
    const prepared = this.prepare(dto.mode, dto.page_url, dto.variants);
    const client = this.supabase.getClient();

    const { data: test, error } = await client
      .from('ab_tests')
      .insert({
        workspace_id: dto.workspace_id,
        name: dto.name.trim(),
        hypothesis: dto.hypothesis?.trim() || null,
        mode: dto.mode,
        page_url: prepared.page.url,
        goal: dto.goal,
        status: 'draft',
      })
      .select('id')
      .single();
    if (error || !test) throw new Error(error?.message ?? 'Falha ao criar o teste');

    const { error: variantsError } = await client
      .from('ab_test_variants')
      .insert(prepared.variants.map((v) => ({ ...v, test_id: test.id })));
    if (variantsError) {
      await client.from('ab_tests').delete().eq('id', test.id);
      throw new Error(variantsError.message);
    }

    return this.get(userId, test.id);
  }

  /**
   * Nome e hipótese mudam a qualquer momento. Página, modo, objetivo e
   * variantes, só em rascunho: trocar a página ou o peso com o teste no ar
   * misturaria dois experimentos no mesmo resultado.
   */
  async update(userId: string, testId: string, dto: UpdateAbTestDto) {
    const test = await this.loadOwned(userId, testId);
    const structural =
      dto.mode !== undefined || dto.page_url !== undefined || dto.goal !== undefined || dto.variants !== undefined;
    if (structural && test.status !== 'draft') {
      throw new BadRequestException(
        'Página, modo, objetivo e variantes só mudam em rascunho. Duplique o teste para mudar o experimento.',
      );
    }

    const client = this.supabase.getClient();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.hypothesis !== undefined) patch.hypothesis = dto.hypothesis.trim() || null;
    if (dto.goal !== undefined) patch.goal = dto.goal;

    if (structural) {
      const mode = dto.mode ?? test.mode;
      const variants =
        dto.variants ??
        (await this.variantsOf([test.id])).map((v) => ({ name: v.name, url: v.url ?? undefined, weight: v.weight }));
      const prepared = this.prepare(mode, dto.page_url ?? test.page_url, variants);
      patch.mode = mode;
      patch.page_url = prepared.page.url;

      const { error: delError } = await client.from('ab_test_variants').delete().eq('test_id', test.id);
      if (delError) throw new Error(delError.message);
      const { error: insError } = await client
        .from('ab_test_variants')
        .insert(prepared.variants.map((v) => ({ ...v, test_id: test.id })));
      if (insError) throw new Error(insError.message);
    }

    const { error } = await client.from('ab_tests').update(patch).eq('id', test.id);
    if (error) throw new Error(error.message);
    this.invalidateScript(test.workspace_id);
    return this.get(userId, test.id);
  }

  async setStatus(userId: string, testId: string, dto: AbTestStatusDto) {
    const test = await this.loadOwned(userId, testId);
    const variants = await this.variantsOf([test.id]);
    const patch = this.transition(test, dto.action);

    if (dto.action === 'start') {
      // Revalida: o teste pode ter sido criado antes de outro ocupar a página.
      this.prepare(
        test.mode,
        test.page_url,
        variants.map((v) => ({ name: v.name, url: v.url ?? undefined, weight: v.weight })),
      );
      await this.assertNoConflict(test, variants);
    }
    if (dto.action === 'finish' && dto.winner_variant_id) {
      if (!variants.some((v) => v.id === dto.winner_variant_id)) {
        throw new BadRequestException('A variante vencedora não é deste teste');
      }
      patch.winner_variant_id = dto.winner_variant_id;
    }

    const { error } = await this.supabase.getClient().from('ab_tests').update(patch).eq('id', test.id);
    if (error) throw new Error(error.message);
    this.invalidateScript(test.workspace_id);
    return this.get(userId, test.id);
  }

  async remove(userId: string, testId: string) {
    const test = await this.loadOwned(userId, testId);
    const { error } = await this.supabase.getClient().from('ab_tests').delete().eq('id', test.id);
    if (error) throw new Error(error.message);
    this.invalidateScript(test.workspace_id);
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Snippet
  // -------------------------------------------------------------------------

  /**
   * Os testes rodando, no formato do tracker.js. Nunca lança: sem teste (ou
   * com o banco fora), o rastreio segue igual — é só não haver sorteio.
   */
  async getScriptTests(workspaceId: string): Promise<TrackerAbTest[]> {
    const key = `ab:script:${workspaceId}`;
    const cached = this.cache.get<TrackerAbTest[]>(key);
    if (cached) return cached;

    try {
      const client = this.supabase.getClient();
      const { data: tests, error } = await client
        .from('ab_tests')
        .select('id, mode, page_url')
        .eq('workspace_id', workspaceId)
        .eq('status', 'running');
      if (error) throw new Error(error.message);

      let out: TrackerAbTest[] = [];
      if (tests?.length) {
        const variants = await this.variantsOf(tests.map((t) => t.id));
        out = tests
          .map((t) => this.scriptTest(t as Pick<TestRow, 'id' | 'mode' | 'page_url'>, variants))
          .filter((t): t is TrackerAbTest => t !== null);
      }
      this.cache.set(key, out, SCRIPT_CACHE_TTL_MS);
      return out;
    } catch (err: any) {
      this.logger.warn(`Testes A/B da area ${workspaceId} indisponiveis: ${err?.message}`);
      return [];
    }
  }

  /** Grava os sorteios que o snippet mandou. Melhor esforço, como a ingestão. */
  async recordAssignments(
    workspaceId: string,
    visitorId: string,
    sessionId: string,
    assignments: AbAssignment[] | undefined,
  ): Promise<number> {
    if (!assignments?.length) return 0;
    try {
      const { data, error } = await this.supabase.getClient().rpc('ab_record_assignments', {
        p_workspace_id: workspaceId,
        p_visitor_id: visitorId,
        p_session_id: sessionId,
        p_assignments: assignments,
      });
      if (error) {
        this.logger.warn(`ab_record_assignments falhou: ${error.message}`);
        return 0;
      }
      return typeof data === 'number' ? data : 0;
    } catch (err: any) {
      this.logger.warn(`ab_record_assignments erro: ${err?.message}`);
      return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private transition(test: TestRow, action: AbAction): Record<string, unknown> {
    const now = new Date().toISOString();
    const allowed: Record<AbAction, AbStatus[]> = {
      start: ['draft', 'paused'],
      pause: ['running'],
      finish: ['running', 'paused'],
    };
    if (!allowed[action].includes(test.status)) {
      const labels: Record<AbStatus, string> = {
        draft: 'em rascunho',
        running: 'rodando',
        paused: 'pausado',
        finished: 'encerrado',
      };
      throw new BadRequestException(`O teste está ${labels[test.status]}: não dá para ${
        { start: 'iniciar', pause: 'pausar', finish: 'encerrar' }[action]
      }.`);
    }
    if (action === 'start') return { status: 'running', started_at: test.started_at ?? now, updated_at: now };
    if (action === 'pause') return { status: 'paused', updated_at: now };
    return { status: 'finished', ended_at: now, updated_at: now };
  }

  /**
   * Confere a configuração e monta as linhas das variantes. A primeira é o
   * controle; no modo redirect a URL dela é a própria página do teste.
   *
   * As variantes ficam no mesmo domínio da página: o _stl_vid (que decide o
   * sorteio) é um cookie do domínio. Em outro domínio o visitante teria outro
   * id, outro sorteio, e poderia ser mandado de volta.
   */
  prepare(mode: AbMode, pageUrl: string, variants: AbVariantDto[]) {
    const page = normalizePageUrl(pageUrl);
    if (!page) throw new BadRequestException('URL da página inválida. Use o endereço completo, com https://');
    if (variants.length < 2 || variants.length > KEYS.length) {
      throw new BadRequestException(`O teste precisa de 2 a ${KEYS.length} variantes`);
    }

    const seen = new Set<string>();
    const rows = variants.map((v, i) => {
      const key = KEYS[i];
      let target: NormalizedPage | null = null;
      if (mode === 'redirect') {
        target = i === 0 ? page : normalizePageUrl(v.url);
        if (!target) throw new BadRequestException(`Variante ${key}: URL inválida`);
        if (target.host !== page.host) {
          throw new BadRequestException(
            `Variante ${key}: precisa estar no mesmo domínio da página do teste (${page.host})`,
          );
        }
        if (seen.has(target.key)) {
          throw new BadRequestException(`Variante ${key}: a mesma página de outra variante`);
        }
        seen.add(target.key);
      }
      return {
        key,
        name: v.name.trim() || `Variante ${key}`,
        url: target?.url ?? null,
        weight: v.weight,
        position: i,
      };
    });

    return { page, variants: rows };
  }

  /** Duas páginas no ar em dois testes ao mesmo tempo: o snippet não saberia qual sortear. */
  private async assertNoConflict(test: TestRow, variants: VariantRow[]): Promise<void> {
    const { data: others, error } = await this.supabase
      .getClient()
      .from('ab_tests')
      .select('id, name, mode, page_url')
      .eq('workspace_id', test.workspace_id)
      .eq('status', 'running')
      .neq('id', test.id);
    if (error) throw new Error(error.message);
    if (!others?.length) return;

    const mine = new Set(this.pageKeys(test, variants));
    const otherVariants = await this.variantsOf(others.map((o) => o.id));
    for (const other of others as TestRow[]) {
      const keys = this.pageKeys(other, otherVariants.filter((v) => v.test_id === other.id));
      if (keys.some((k) => mine.has(k))) {
        throw new ConflictException(
          `O teste "${other.name}" já está rodando nesta página. Encerre ou pause ele antes.`,
        );
      }
    }
  }

  private pageKeys(test: Pick<TestRow, 'mode' | 'page_url'>, variants: VariantRow[]): string[] {
    if (test.mode === 'elements') {
      const page = normalizePageUrl(test.page_url);
      return page ? [page.key] : [];
    }
    return variants.map((v) => normalizePageUrl(v.url)?.key).filter((k): k is string => !!k);
  }

  private scriptTest(test: Pick<TestRow, 'id' | 'mode' | 'page_url'>, all: VariantRow[]): TrackerAbTest | null {
    const page = normalizePageUrl(test.page_url);
    const variants = all.filter((v) => v.test_id === test.id).sort((a, b) => a.position - b.position);
    if (!page || variants.length < 2) return null;
    return {
      id: test.id,
      m: test.mode,
      p: page.key,
      v: variants.map((v) => {
        const target = test.mode === 'redirect' ? normalizePageUrl(v.url) : null;
        return { id: v.id, k: v.key, w: v.weight, u: target?.url ?? null, p: target?.key ?? null };
      }),
    };
  }

  private invalidateScript(workspaceId: string): void {
    this.cache.invalidate(`ab:script:${workspaceId}`);
  }

  private async results(userId: string, testId: string): Promise<ResultsRpc | null> {
    const { data, error } = await this.supabase
      .getClient()
      .rpc('ab_test_results', { p_user_id: userId, p_test_id: testId });
    if (error) throw new Error(error.message);
    return (data as ResultsRpc | null) ?? null;
  }

  private async variantsOf(testIds: string[]): Promise<VariantRow[]> {
    if (!testIds.length) return [];
    const { data, error } = await this.supabase
      .getClient()
      .from('ab_test_variants')
      .select(VARIANT_COLUMNS)
      .in('test_id', testIds)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as VariantRow[];
  }

  private async loadOwned(userId: string, testId: string): Promise<TestRow> {
    const { data, error } = await this.supabase
      .getClient()
      .from('ab_tests')
      .select(TEST_COLUMNS)
      .eq('id', testId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Teste nao encontrado');
    await this.assertOwner(userId, data.workspace_id);
    return data as TestRow;
  }

  private async assertOwner(userId: string, workspaceId: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Area nao encontrada');
  }

  /** Linha do banco + números do RPC → o que o painel mostra, com a estatística já feita. */
  present(test: TestRow, variantRows: VariantRow[], results: ResultsRpc | null) {
    const byId = new Map((results?.variants ?? []).map((r) => [r.id, r]));
    const sorted = [...variantRows].sort((a, b) => a.position - b.position);

    const base = sorted.map((v, i) => {
      const r = byId.get(v.id);
      const visitors = num(r?.visitors);
      const buyers = num(r?.buyers);
      const checkoutVisitors = num(r?.checkout_visitors);
      const revenue = num(r?.revenue);
      return {
        id: v.id,
        key: v.key,
        name: v.name,
        url: v.url,
        weight: v.weight,
        isControl: i === 0,
        visitors,
        checkoutVisitors,
        buyers,
        orders: num(r?.orders),
        ordersIndexed: num(r?.orders_indexed),
        revenue: money(revenue),
        revenueSq: num(r?.revenue_sq),
        checkoutRate: pct(checkoutVisitors, visitors),
        conversionRate: pct(buyers, visitors),
        revenuePerVisitor: visitors > 0 ? money(revenue / visitors) : 0,
      };
    });

    // Bonferroni: com k desafiantes, cada comparação usa ALPHA / k.
    const challengers = Math.max(1, base.length - 1);
    const alpha = ALPHA / challengers;
    const control = base[0];
    const goalEvents = (v: (typeof base)[number]) => (test.goal === 'checkout' ? v.checkoutVisitors : v.buyers);

    // Variantes desafiantes que já têm amostra para o p-valor significar algo.
    const enoughData = new Set<string>();

    const variants: AbVariantResult[] = base.map((v) => {
      const { revenueSq, ...rest } = v;
      if (!control || v.isControl) return { ...rest, comparison: null };

      const cmp =
        test.goal === 'revenue'
          ? compareMeans(
              { n: control.visitors, sum: control.revenue, sumSq: control.revenueSq },
              { n: v.visitors, sum: v.revenue, sumSq: revenueSq },
            )
          : compareProportions(goalEvents(control), control.visitors, goalEvents(v), v.visitors);

      const enough =
        Math.min(control.visitors, v.visitors) >= MIN_VISITORS_PER_VARIANT &&
        goalEvents(control) + goalEvents(v) >= MIN_CONVERSIONS;
      if (enough) enoughData.add(v.id);
      return { ...rest, comparison: { ...cmp, significant: enough && cmp.pValue !== null && cmp.pValue < alpha } };
    });

    const challengersResults = variants.filter((v) => !v.isControl);
    const winners = challengersResults.filter((v) => v.comparison?.significant && (v.comparison.lift ?? 0) > 0);
    const metric = (v: AbVariantResult) =>
      test.goal === 'revenue' ? v.revenuePerVisitor : test.goal === 'checkout' ? v.checkoutRate : v.conversionRate;

    let verdict: AbVerdict;
    let leader: string | null = null;
    if (test.status === 'draft') verdict = 'draft';
    else if (winners.length) {
      verdict = 'winner';
      leader = winners.reduce((best, v) => (metric(v) > metric(best) ? v : best)).key;
    } else if (
      challengersResults.length &&
      challengersResults.every((v) => v.comparison?.significant && (v.comparison.lift ?? 0) < 0)
    ) {
      verdict = 'control';
      leader = control.key;
    } else verdict = enoughData.size ? 'inconclusive' : 'collecting';

    // Amostra para detectar +20% sobre a taxa do controle (na receita, a
    // conversão em compra serve de base: é ela que move a receita).
    const baselineRate =
      control && control.visitors > 0
        ? (test.goal === 'checkout' ? control.checkoutVisitors : control.buyers) / control.visitors
        : 0;
    const samplePerVariant = sampleSizePerVariant(baselineRate, 0.2, alpha);
    const minVisitors = variants.length ? Math.min(...variants.map((v) => v.visitors)) : 0;

    return {
      id: test.id,
      workspaceId: test.workspace_id,
      name: test.name,
      hypothesis: test.hypothesis,
      mode: test.mode,
      pageUrl: test.page_url,
      goal: test.goal,
      status: test.status,
      startedAt: test.started_at,
      endedAt: test.ended_at,
      winnerVariantId: test.winner_variant_id,
      createdAt: test.created_at,
      updatedAt: test.updated_at,
      variants,
      summary: {
        verdict,
        leader,
        alpha,
        totalVisitors: variants.reduce((s, v) => s + v.visitors, 0),
        totalOrders: variants.reduce((s, v) => s + v.orders, 0),
        ordersIndexed: variants.reduce((s, v) => s + v.ordersIndexed, 0),
        unmatchedSales: num(results?.unmatched_sales),
        samplePerVariant,
        progress: samplePerVariant ? Math.min(100, Math.round((minVisitors / samplePerVariant) * 100)) : null,
      },
      daily: this.cumulative(results?.daily ?? [], sorted),
    };
  }

  /** Série acumulada por dia: visitantes, compradores e conversão de cada variante até aquele dia. */
  private cumulative(daily: ResultsRpc['daily'], variants: VariantRow[]) {
    const keyOf = new Map(variants.map((v) => [v.id, v.key]));
    const dates = [...new Set(daily.map((d) => d.date))].sort();
    const totals = new Map<string, { visitors: number; buyers: number }>(
      variants.map((v) => [v.key, { visitors: 0, buyers: 0 }]),
    );

    return dates.map((date) => {
      for (const row of daily) {
        if (row.date !== date) continue;
        const key = keyOf.get(row.variant_id);
        const t = key ? totals.get(key) : undefined;
        if (!t) continue;
        t.visitors += num(row.visitors);
        t.buyers += num(row.buyers);
      }
      const values: Record<string, { visitors: number; buyers: number; rate: number }> = {};
      for (const [key, t] of totals) values[key] = { ...t, rate: pct(t.buyers, t.visitors) };
      return { date, values };
    });
  }
}
