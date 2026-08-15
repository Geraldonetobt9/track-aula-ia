import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { parse as csvParse } from 'csv-parse/sync';
import { AppModule } from '../../../app.module';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { SalesService } from '../sales.service';

const fixturePath = (name: string) =>
  path.join(__dirname, 'fixtures', name);

const FULL_CSV_HEADER =
  '﻿Nome do Produto;Nome do Produtor;Documento do Produtor;Nome do Afiliado;Transação;Meio de Pagamento;Origem;Moeda;Preço do Produto;Moeda;Preço da Oferta;Taxa de Câmbio;Moeda;Preço Original;Número da Parcela;Recorrência;Data de Venda;Data de Confirmação;Status;Nome;Documento;Email;DDD;Telefone;CEP;Cidade;Estado;Bairro;País;Endereço;Número;Complemento;chave;Código do Produto;Código da Afiliação;Código de Oferta;Origem de Checkout;Tipo de Pagamento;Período Grátis;Tem co-produção;Venda feita como;Preço Total;Tipo pagamento oferta;Taxa de Câmbio Real;Preço Total Convertido;Quantidade de itens;Oferta de Upgrade;Cupom;Moeda;Valor que você recebeu convertido;Taxa de Câmbio do valor recebido;Data Vencimento;Instagram;Origem da venda;Moeda de recebimento;Faturamento líquido;Código do assinante;Nota Fiscal;Valor do frete bruto\n';

const BIG_ROW_TEMPLATE =
  'X;X;X;X;HP{i};X;Facebook;ARS;1;BRL;1;1;BRL;1;1;;20/04/2026 20:00:00;20/04/2026 20:00:00;Aprovado;N;;a@b.com;;;;;;;Brasil;;;;;1;;;;PIX;Não;Não;Produtor;1;A;1;43.92;1;Não;;BRL;43.92;1;;;;BRL;1;;Vendedor;0';

interface SupabaseMockState {
  userByToken: Record<string, { id: string } | null>;
  workspaceOwner: Record<string, string>; // workspace_id -> user_id
  activeIntegrations: Array<{ id: string; name: string }>;
  integrationDetails: { id: string; workspace_id: string; platform: string; is_active: boolean } | null;
  existingExternalIds: string[];
}

function freshState(): SupabaseMockState {
  return {
    userByToken: {
      'valid-token-user-1': { id: 'user-1' },
      'valid-token-user-2': { id: 'user-2' },
    },
    workspaceOwner: { 'ws-1': 'user-1' },
    activeIntegrations: [{ id: 'int-1', name: 'Hotmart Principal' }],
    integrationDetails: {
      id: 'int-1',
      workspace_id: 'ws-1',
      platform: 'hotmart',
      is_active: true,
    },
    existingExternalIds: [],
  };
}

function buildSupabaseMock(state: SupabaseMockState) {
  const buildWorkspacesBuilder = () => {
    let userIdFilter: string | null = null;
    let workspaceIdFilter: string | null = null;
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: string) => {
        if (col === 'user_id') userIdFilter = val;
        if (col === 'id') workspaceIdFilter = val;
        return builder;
      },
      maybeSingle: () => {
        if (!workspaceIdFilter) return Promise.resolve({ data: null, error: null });
        const owner = state.workspaceOwner[workspaceIdFilter];
        if (owner && userIdFilter === owner) {
          return Promise.resolve({ data: { id: workspaceIdFilter }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  };

  const buildIntegrationsBuilder = () => {
    let eqCount = 0;
    const builder: any = {
      select: () => builder,
      eq: () => {
        eqCount += 1;
        return builder;
      },
      maybeSingle: () =>
        Promise.resolve({ data: state.integrationDetails, error: null }),
      // Make the builder awaitable so the list query (3 eqs) resolves directly.
      then: (resolve: any, reject?: any) => {
        try {
          return Promise.resolve({
            data: state.activeIntegrations,
            error: null,
          }).then(resolve, reject);
        } catch (err) {
          if (reject) reject(err);
          else throw err;
        }
      },
    };
    return builder;
  };

  const buildSalesBuilder = () => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      in: (_col: string, vals: string[]) =>
        Promise.resolve({
          data: state.existingExternalIds
            .filter((id) => vals.includes(id))
            .map((id) => ({ external_id: id })),
          error: null,
        }),
      upsert: (rows: any[]) => ({
        select: () =>
          Promise.resolve({
            data: rows
              .filter((r) => !state.existingExternalIds.includes(r.external_id))
              .map((r) => ({ id: `sale-${r.external_id}`, external_id: r.external_id })),
            error: null,
          }),
      }),
    };
    return builder;
  };

  return {
    getClient: () => ({
      from: (table: string) => {
        if (table === 'workspaces') return buildWorkspacesBuilder();
        if (table === 'checkout_integrations') return buildIntegrationsBuilder();
        if (table === 'sales') return buildSalesBuilder();
        // Default chainable no-op for any other table (defensive)
        const noop: any = {
          select: () => noop,
          eq: () => noop,
          in: () => Promise.resolve({ data: [], error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return noop;
      },
    }),
    getUserFromToken: async (token: string) =>
      state.userByToken[token] ?? null,
    isAdmin: async () => false,
  };
}

function csvToXlsxBuffer(csvPath: string): Buffer {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows: string[][] = csvParse(stripped, {
    delimiter: ';',
    relax_quotes: true,
    skip_empty_lines: true,
  });
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('Sales import (e2e HTTP)', () => {
  let app: NestFastifyApplication;
  let state: SupabaseMockState;
  let matchSpy: jest.SpyInstance;
  let upsertSpy: jest.SpyInstance;

  beforeAll(async () => {
    state = freshState();
    const supabaseMock = buildSupabaseMock(state);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue(supabaseMock)
      .compile();

    const fastifyAdapter = new FastifyAdapter();
    app = moduleRef.createNestApplication<NestFastifyApplication>(fastifyAdapter);

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api', { exclude: ['health'] });

    const fastifyInstance = app.getHttpAdapter().getInstance();
    await fastifyInstance.register(require('@fastify/multipart'), {
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 5,
      },
    });

    await app.init();
    await fastifyInstance.ready();

    const webhooksService = app.get(WebhooksService);
    matchSpy = jest
      .spyOn(webhooksService, 'matchAndUpdateSale')
      .mockResolvedValue(undefined);

    const salesService = app.get(SalesService);
    upsertSpy = jest.spyOn(salesService, 'upsertManyImported');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset mutable mock state.
    const fresh = freshState();
    Object.assign(state, fresh);
    matchSpy.mockClear();
    matchSpy.mockResolvedValue(undefined);
    upsertSpy.mockClear();
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  describe('auth', () => {
    it('rejects request without Authorization header with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });
      expect(res.status).toBe(401);
    });

    it('rejects invalid bearer token with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer not-a-real-token')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Preview — happy path
  // -------------------------------------------------------------------------
  describe('preview happy path', () => {
    it('returns classification summary for CSV fixture', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(201);
      expect(res.body.total_rows).toBe(5);
      expect(res.body.to_import).toBe(2);
      expect(res.body.duplicates).toBe(0);
      expect(res.body.non_approved).toBe(1);
      expect(res.body.invalid).toBe(2);
      expect(res.body.integrations).toHaveLength(1);
      expect(res.body.sample_preview).toHaveLength(2);
    });

    it('counts pre-existing external_ids as duplicates', async () => {
      state.existingExternalIds = ['HP0000000001'];
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(201);
      expect(res.body.to_import).toBe(1);
      expect(res.body.duplicates).toBe(1);
    });

    it('accepts XLSX input produced from the CSV fixture', async () => {
      const xlsxBuf = csvToXlsxBuffer(fixturePath('hotmart-sample.csv'));
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', xlsxBuf, {
          filename: 'hotmart-sample.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(res.status).toBe(201);
      expect(res.body.total_rows).toBe(5);
      expect(res.body.to_import).toBe(2);
      expect(res.body.non_approved).toBe(1);
      expect(res.body.invalid).toBe(2);
      expect(res.body.integrations).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Preview — authorization / integration
  // -------------------------------------------------------------------------
  describe('preview authorization', () => {
    it('returns 403 workspace_forbidden when workspace is not owned by caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-2')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('workspace_forbidden');
    });

    it('returns 400 no_active_integration when workspace has no active Hotmart integration', async () => {
      state.activeIntegrations = [];
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('no_active_integration');
    });
  });

  // -------------------------------------------------------------------------
  // Preview — file validation
  // -------------------------------------------------------------------------
  describe('preview file validation', () => {
    it('rejects PDF with 400 unsupported_format', async () => {
      const pdfBuf = Buffer.from('%PDF-1.4\n%\x80\x80\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', pdfBuf, {
          filename: 'dummy.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unsupported_format');
    });

    it('rejects legacy .xls (CFBF magic) even when extension says .xlsx', async () => {
      const xlsBuf = Buffer.concat([
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
        Buffer.alloc(100, 0),
      ]);
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', xlsBuf, {
          filename: 'legacy.xlsx',
          contentType: 'application/vnd.ms-excel',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unsupported_format');
    });

    it('rejects an empty CSV (header-only) with 400 no_data_rows', async () => {
      const buf = Buffer.from(FULL_CSV_HEADER, 'utf-8');
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', buf, {
          filename: 'empty.csv',
          contentType: 'text/csv',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('no_data_rows');
    });

    it('rejects CSV missing required Transação column with 400 unsupported_schema', async () => {
      const buf = Buffer.from('colA;colB\nval1;val2\n', 'utf-8');
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', buf, {
          filename: 'bad-schema.csv',
          contentType: 'text/csv',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unsupported_schema');
      expect(res.body.missing_column).toBe('Transação');
    });

    it('rejects CSV with more than 5000 data rows with 400 too_many_rows', async () => {
      let big = FULL_CSV_HEADER;
      for (let i = 0; i < 5001; i++) {
        big += BIG_ROW_TEMPLATE.replace('{i}', String(i)) + '\n';
      }
      const buf = Buffer.from(big, 'utf-8');
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', buf, {
          filename: 'too-big.csv',
          contentType: 'text/csv',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('too_many_rows');
      expect(res.body.max).toBe(5000);
    });

    it('rejects files larger than 5MB with 413', async () => {
      // 5MB + 1KB — comfortably over the 5MB multipart cap.
      const oversized = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x41);
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', oversized, {
          filename: 'huge.csv',
          contentType: 'text/csv',
        });
      // Observed behavior: @fastify/multipart@8 surfaces the size-limit as an
      // async iterator abort. Our controller catches it and raises 413 with
      // body { error: 'file_too_large', max_bytes: 5242880 } via HttpException,
      // which NestJS serializes verbatim. If the adapter version ever emits a
      // plain Fastify error object (e.g. { statusCode: 413, code: 'FST_...' })
      // the status assertion still holds — that is the user-visible contract.
      expect(res.status).toBe(413);
    });
  });

  // -------------------------------------------------------------------------
  // Preview — multipart / field validation
  // -------------------------------------------------------------------------
  describe('preview multipart / field validation', () => {
    it('returns 400 file_missing when no file part is attached', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('file_missing');
    });

    it('returns 400 unsupported_platform when platform is not hotmart', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'kiwify')
        .field('workspace_id', 'ws-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unsupported_platform');
    });

    it('returns 400 missing_workspace_id when workspace_id field is absent', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import/preview')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('missing_workspace_id');
    });
  });

  // -------------------------------------------------------------------------
  // Commit (POST /api/sales/import)
  // -------------------------------------------------------------------------
  describe('commit', () => {
    it('imports 2 approved rows, skips 1 non-approved and 2 invalid, runs matching once per row', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .field('integration_id', 'int-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(201);
      expect(res.body.imported).toBe(2);
      expect(res.body.skipped_duplicates).toBe(0);
      expect(res.body.skipped_non_approved).toBe(1);
      expect(res.body.skipped_invalid).toBe(2);
      expect(matchSpy).toHaveBeenCalledTimes(2);

      // Explicitly assert that only the 2 approved rows reach upsertManyImported.
      expect(upsertSpy).toHaveBeenCalledTimes(1);
      expect(upsertSpy.mock.calls[0][0]).toHaveLength(2);
    });

    it('skips pre-existing duplicates during commit', async () => {
      state.existingExternalIds = ['HP0000000001'];
      const res = await request(app.getHttpServer())
        .post('/api/sales/import')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .field('integration_id', 'int-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(201);
      expect(res.body.imported).toBe(1);
      expect(res.body.skipped_duplicates).toBe(1);
      expect(matchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns 403 integration_forbidden when integration_id does not belong to workspace', async () => {
      state.integrationDetails = null;
      const res = await request(app.getHttpServer())
        .post('/api/sales/import')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .field('integration_id', 'int-foreign')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('integration_forbidden');
    });

    it('returns 400 missing_integration_id when integration_id field is absent', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('missing_integration_id');
    });

    it('non-approved and invalid rows never reach upsertManyImported', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sales/import')
        .set('Authorization', 'Bearer valid-token-user-1')
        .field('platform', 'hotmart')
        .field('workspace_id', 'ws-1')
        .field('integration_id', 'int-1')
        .attach('file', fs.readFileSync(fixturePath('hotmart-sample.csv')), {
          filename: 'hotmart-sample.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(201);
      expect(upsertSpy).toHaveBeenCalledTimes(1);
      const rowsSentToUpsert = upsertSpy.mock.calls[0][0];
      expect(rowsSentToUpsert).toHaveLength(2);
      const externalIds = rowsSentToUpsert.map((r: any) => r.external_id).sort();
      expect(externalIds).toEqual(['HP0000000001', 'HP0000000002']);
    });
  });
});
