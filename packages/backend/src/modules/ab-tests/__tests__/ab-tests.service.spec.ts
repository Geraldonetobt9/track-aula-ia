import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SupabaseFake } from '../../../../test/helpers/supabaseFake';
import { CacheService } from '../../../shared/services/cache.service';
import { AbTestsService } from '../ab-tests.service';
import { CreateAbTestDto } from '../dto/ab-test.dto';

const USER = 'user-1';
const WS = 'ws-1';

function setup() {
  const fake = new SupabaseFake();
  fake.seed('workspaces', [
    { id: WS, user_id: USER },
    { id: 'ws-2', user_id: 'user-2' },
  ]);
  const rpc = jest.fn().mockResolvedValue({ data: { variants: [], daily: [], unmatched_sales: 0 }, error: null });
  const supabase = { getClient: () => ({ ...fake.getClient(), rpc }) };
  const service = new AbTestsService(supabase as any, new CacheService());
  return { fake, rpc, service };
}

function dto(over: Partial<CreateAbTestDto> = {}): CreateAbTestDto {
  return {
    workspace_id: WS,
    name: 'Headline nova',
    mode: 'redirect',
    page_url: 'https://www.loja.com.br/oferta',
    goal: 'sale',
    variants: [
      { name: 'Atual', weight: 50 },
      { name: 'Headline nova', url: 'https://loja.com.br/oferta-b', weight: 50 },
    ],
    ...over,
  };
}

describe('AbTestsService', () => {
  describe('criar', () => {
    it('nasce em rascunho, com as letras na ordem e o controle na propria pagina', async () => {
      const { service, fake } = setup();
      const test = await service.create(USER, dto());

      expect(test.status).toBe('draft');
      expect(test.variants.map((v) => [v.key, v.url, v.isControl])).toEqual([
        ['A', 'https://www.loja.com.br/oferta', true],
        ['B', 'https://loja.com.br/oferta-b', false],
      ]);
      expect(fake.store.ab_test_variants).toHaveLength(2);
    });

    it('modo elements nao guarda URL de variante', async () => {
      const { service } = setup();
      const test = await service.create(
        USER,
        dto({ mode: 'elements', variants: [{ name: 'A', weight: 50 }, { name: 'B', url: 'https://x.com', weight: 50 }] }),
      );
      expect(test.variants.every((v) => v.url === null)).toBe(true);
    });

    it.each([
      ['em outro dominio', 'https://outraloja.com/b', /mesmo domínio/],
      ['igual a do controle', 'https://loja.com.br/oferta/', /mesma página/],
      ['sem URL', undefined, /URL inválida/],
    ])('recusa variante %s', async (_, url, message) => {
      const { service } = setup();
      await expect(
        service.create(USER, dto({ variants: [{ name: 'A', weight: 50 }, { name: 'B', url, weight: 50 }] })),
      ).rejects.toThrow(message);
    });

    it('nao cria na area de outra pessoa', async () => {
      const { service } = setup();
      await expect(service.create(USER, dto({ workspace_id: 'ws-2' }))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('estado', () => {
    it('rascunho → rodando → pausado → rodando → encerrado, com a vencedora', async () => {
      const { service } = setup();
      const { id, variants } = await service.create(USER, dto());

      const running = await service.setStatus(USER, id, { action: 'start' });
      expect(running.status).toBe('running');
      expect(running.startedAt).toBeTruthy();

      expect((await service.setStatus(USER, id, { action: 'pause' })).status).toBe('paused');
      const resumed = await service.setStatus(USER, id, { action: 'start' });
      expect(resumed.startedAt).toBe(running.startedAt); // retomar não zera o início

      const done = await service.setStatus(USER, id, { action: 'finish', winner_variant_id: variants[1].id });
      expect(done.status).toBe('finished');
      expect(done.endedAt).toBeTruthy();
      expect(done.winnerVariantId).toBe(variants[1].id);
    });

    it('transicao invalida e vencedora de outro teste sao recusadas', async () => {
      const { service } = setup();
      const { id } = await service.create(USER, dto());
      await expect(service.setStatus(USER, id, { action: 'pause' })).rejects.toBeInstanceOf(BadRequestException);
      await service.setStatus(USER, id, { action: 'start' });
      await expect(service.setStatus(USER, id, { action: 'start' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.setStatus(USER, id, { action: 'finish', winner_variant_id: 'nao-e-daqui' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('com o teste no ar, so nome e hipotese mudam', async () => {
      const { service } = setup();
      const { id } = await service.create(USER, dto());
      await service.setStatus(USER, id, { action: 'start' });

      await expect(service.update(USER, id, { goal: 'checkout' })).rejects.toBeInstanceOf(BadRequestException);
      const renamed = await service.update(USER, id, { name: 'Outro nome', hypothesis: 'Mais curta vende mais' });
      expect(renamed.name).toBe('Outro nome');
      expect(renamed.hypothesis).toBe('Mais curta vende mais');
    });

    it('em rascunho, trocar as variantes refaz as letras', async () => {
      const { service, fake } = setup();
      const { id } = await service.create(USER, dto());
      const updated = await service.update(USER, id, {
        variants: [
          { name: 'Atual', weight: 34 },
          { name: 'B', url: 'https://loja.com.br/b', weight: 33 },
          { name: 'C', url: 'https://loja.com.br/c', weight: 33 },
        ],
      });
      expect(updated.variants.map((v) => v.key)).toEqual(['A', 'B', 'C']);
      expect(fake.store.ab_test_variants).toHaveLength(3);
    });

    it('dois testes na mesma pagina nao rodam juntos', async () => {
      const { service } = setup();
      const first = await service.create(USER, dto());
      const second = await service.create(USER, dto({ name: 'Outro' }));
      await service.setStatus(USER, first.id, { action: 'start' });
      await expect(service.setStatus(USER, second.id, { action: 'start' })).rejects.toBeInstanceOf(ConflictException);

      await service.setStatus(USER, first.id, { action: 'finish' });
      expect((await service.setStatus(USER, second.id, { action: 'start' })).status).toBe('running');
    });

    it('outra pessoa nao le nem mexe', async () => {
      const { service } = setup();
      const { id } = await service.create(USER, dto());
      await expect(service.get('user-2', id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.remove('user-2', id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('snippet', () => {
    it('so os testes rodando vao para o script, e o cache cai ao mudar o estado', async () => {
      const { service } = setup();
      const { id } = await service.create(USER, dto());
      expect(await service.getScriptTests(WS)).toEqual([]);

      await service.setStatus(USER, id, { action: 'start' });
      const [t] = await service.getScriptTests(WS);
      expect(t).toMatchObject({ id, m: 'redirect', p: 'loja.com.br/oferta' });
      expect(t.v.map((v) => [v.k, v.p, v.w])).toEqual([
        ['A', 'loja.com.br/oferta', 50],
        ['B', 'loja.com.br/oferta-b', 50],
      ]);

      await service.setStatus(USER, id, { action: 'pause' });
      expect(await service.getScriptTests(WS)).toEqual([]);
    });

    it('banco fora: sem teste, sem erro', async () => {
      const service = new AbTestsService(
        { getClient: () => { throw new Error('fora do ar'); } } as any,
        new CacheService(),
      );
      await expect(service.getScriptTests(WS)).resolves.toEqual([]);
      await expect(service.recordAssignments(WS, 'v', 's', [{ test_id: 't', variant_id: 'v' }])).resolves.toBe(0);
    });

    it('sem sorteio no lote, nao chama o banco', async () => {
      const { service, rpc } = setup();
      await service.recordAssignments(WS, 'v', 's', undefined);
      await service.recordAssignments(WS, 'v', 's', []);
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe('resultado', () => {
    const now = new Date().toISOString();
    const test = {
      id: 't', workspace_id: WS, name: 'x', hypothesis: null, mode: 'redirect' as const,
      page_url: 'https://loja.com/a', goal: 'sale' as const, status: 'running' as const,
      started_at: now, ended_at: null, winner_variant_id: null, created_at: now, updated_at: now,
    };
    const variants = ['A', 'B', 'C'].map((key, i) => ({
      id: `v${key}`, test_id: 't', key, name: key, url: null, weight: 1, position: i,
    }));
    const row = (id: string, visitors: number, buyers: number, revenue = buyers * 100) => ({
      id, visitors, checkout_visitors: buyers * 3, buyers, orders: buyers, orders_indexed: buyers,
      revenue, revenue_sq: buyers * 100 * 100,
    });
    const present = (rows: ReturnType<typeof row>[], n = 2, over: Partial<typeof test> = {}) =>
      setup().service.present(
        { ...test, ...over },
        variants.slice(0, n),
        { variants: rows, daily: [], unmatched_sales: 3 },
      );

    it('pouca amostra: ainda coletando, mesmo com diferenca grande', () => {
      const r = present([row('vA', 40, 1), row('vB', 40, 8)]);
      expect(r.summary.verdict).toBe('collecting');
      expect(r.variants[1].comparison!.significant).toBe(false);
    });

    it('B claramente melhor com amostra: vencedora', () => {
      const r = present([row('vA', 2000, 100), row('vB', 2000, 150)]);
      expect(r.summary.verdict).toBe('winner');
      expect(r.summary.leader).toBe('B');
      expect(r.variants[1].conversionRate).toBe(7.5);
      expect(r.variants[1].comparison).toMatchObject({ lift: 50, significant: true });
      expect(r.summary.unmatchedSales).toBe(3);
    });

    it('B claramente pior: o controle vence', () => {
      const r = present([row('vA', 2000, 150), row('vB', 2000, 100)]);
      expect(r.summary.verdict).toBe('control');
      expect(r.summary.leader).toBe('A');
    });

    it('diferenca pequena com amostra: inconclusivo', () => {
      const r = present([row('vA', 2000, 100), row('vB', 2000, 104)]);
      expect(r.summary.verdict).toBe('inconclusive');
    });

    it('com dois desafiantes, o nivel e dividido (Bonferroni)', () => {
      // p ≈ 0,035: passa a 5%, não passa a 2,5%.
      const two = present([row('vA', 1000, 100), row('vB', 1000, 130)]);
      const three = present([row('vA', 1000, 100), row('vB', 1000, 130), row('vC', 1000, 100)], 3);
      expect(two.variants[1].comparison!.significant).toBe(true);
      expect(three.summary.alpha).toBe(0.025);
      expect(three.variants[1].comparison!.significant).toBe(false);
    });

    it('rascunho nao tem veredito; amostra necessaria vem da taxa do controle', () => {
      const draft = present([row('vA', 0, 0), row('vB', 0, 0)], 2, { status: 'draft' as any });
      expect(draft.summary.verdict).toBe('draft');
      const r = present([row('vA', 1000, 100), row('vB', 500, 50)]);
      expect(r.summary.samplePerVariant).toBeGreaterThan(3800);
      expect(r.summary.progress).toBe(Math.round((500 / r.summary.samplePerVariant!) * 100));
    });
  });
});
