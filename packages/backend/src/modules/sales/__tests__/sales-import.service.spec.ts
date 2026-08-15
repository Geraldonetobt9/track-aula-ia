import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { SalesImportService } from '../sales-import.service';
import { SalesService } from '../sales.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../../webhooks/webhooks.service';

const fixturePath = (name: string) =>
  path.join(__dirname, 'fixtures', name);

const mockSupabase = {
  getClient: jest.fn(),
};

const mockSalesService = {
  upsertManyImported: jest.fn(),
};

const mockWebhooksService = {
  matchAndUpdateSale: jest.fn().mockResolvedValue(undefined),
};

describe('SalesImportService', () => {
  let service: SalesImportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SalesImportService,
        { provide: SalesService, useValue: mockSalesService },
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: WebhooksService, useValue: mockWebhooksService },
      ],
    }).compile();
    service = module.get(SalesImportService);
  });

  describe('parseAndClassify (CSV)', () => {
    it('reads the fixture with BOM and ; delimiter and returns rows bucketed', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));
      const result = await (service as any).parseAndClassify(buf, 'hotmart-sample.csv');

      expect(result.totalRows).toBe(5);
      expect(result.approved.map((r: any) => r.external_id)).toEqual(['HP0000000001', 'HP0000000002']);
      expect(result.nonApproved).toBe(1);
      expect(result.invalid).toHaveLength(2);
      const reasons = result.invalid.map((i: any) => i.reason as string);
      expect(reasons.some((r: string) => r.includes('Transação'))).toBe(true);
      expect(reasons.some((r: string) => r.includes('Valor que você recebeu convertido'))).toBe(true);
    });

    it('converts Data de Venda from America/Sao_Paulo to UTC', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));
      const result = await (service as any).parseAndClassify(buf, 'hotmart-sample.csv');
      // 20/04/2026 20:01:44 BRT (UTC-3) = 2026-04-20T23:01:44Z
      expect(result.approved[0].sold_at).toBe('2026-04-20T23:01:44.000Z');
    });

    it('lowercases customer_email and maps Brasil -> BR', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));
      const result = await (service as any).parseAndClassify(buf, 'hotmart-sample.csv');
      expect(result.approved[0].customer_email).toBe('aprovado1@test.com');
      expect(result.approved[0].customer_country).toBe('BR');
    });

    it('runs xcod through parseXcod so utm_* and ad_id are populated', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));
      const result = await (service as any).parseAndClassify(buf, 'hotmart-sample.csv');
      expect(result.approved[0].utm_source).toBe('Facebook_Mobile_Reels');
      expect(result.approved[0].ad_id).toBe('120242604345070467');
      expect(result.approved[1].utm_source).toBe('FB');
      expect(result.approved[1].ad_id).toBe('120242453126770467');
    });

    it('takes amount from "Valor que você recebeu convertido" (BRL) — NOT "Preço Total Convertido" (offer currency)', async () => {
      // Regression: fixture rows 2/3 have "Preço Total Convertido"=10.84 (USD)
      // and "Valor que você recebeu convertido"=43.92 (BRL). The system must
      // persist 43.92/BRL, not 10.84. Treating USD as BRL produced a ~4x
      // underestimation on the dashboard for the affected producer.
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));
      const result = await (service as any).parseAndClassify(buf, 'hotmart-sample.csv');
      expect(result.approved).toHaveLength(2);
      for (const row of result.approved) {
        expect(row.amount).toBe(43.92);
        expect(row.currency).toBe('BRL');
      }
    });

    it('rejects rows where the "Moeda" column preceding "Valor que você recebeu convertido" is not BRL', async () => {
      const header =
        '﻿Nome do Produto;Transação;Status;Email;Data de Venda;Origem;Moeda;Valor que você recebeu convertido\n';
      const row =
        'Produto;HP0000000042;Aprovado;user@test.com;20/04/2026 12:00:00;Facebook;USD;10.44\n';
      const buf = Buffer.from(header + row, 'utf-8');
      const result = await (service as any).parseAndClassify(buf, 'usd.csv');
      expect(result.approved).toHaveLength(0);
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0].reason).toMatch(/USD.*não suportada/);
    });

    it('rejects files where "Valor que você recebeu convertido" is missing', async () => {
      const buf = Buffer.from(
        'Transação;Status;Email;Data de Venda;Origem;Preço Total Convertido\n' +
          'HP1;Aprovado;a@b.com;20/04/2026 12:00:00;FB;10.00\n',
        'utf-8',
      );
      const err = await (service as any)
        .parseAndClassify(buf, 'old-schema.csv')
        .catch((e: any) => e);
      expect(err.response.error).toBe('unsupported_schema');
      expect(err.response.missing_column).toContain('Valor que você recebeu convertido');
    });

    it('rejects files with more than 5000 data rows', async () => {
      const header =
        '﻿Nome do Produto;Nome do Produtor;Documento do Produtor;Nome do Afiliado;Transação;Meio de Pagamento;Origem;Moeda;Preço do Produto;Moeda;Preço da Oferta;Taxa de Câmbio;Moeda;Preço Original;Número da Parcela;Recorrência;Data de Venda;Data de Confirmação;Status;Nome;Documento;Email;DDD;Telefone;CEP;Cidade;Estado;Bairro;País;Endereço;Número;Complemento;chave;Código do Produto;Código da Afiliação;Código de Oferta;Origem de Checkout;Tipo de Pagamento;Período Grátis;Tem co-produção;Venda feita como;Preço Total;Tipo pagamento oferta;Taxa de Câmbio Real;Preço Total Convertido;Quantidade de itens;Oferta de Upgrade;Cupom;Moeda;Valor que você recebeu convertido;Taxa de Câmbio do valor recebido;Data Vencimento;Instagram;Origem da venda;Moeda de recebimento;Faturamento líquido;Código do assinante;Nota Fiscal;Valor do frete bruto\n';
      const dataRow = 'X;X;X;X;HP{i};X;Facebook;ARS;1;BRL;1;1;BRL;1;1;;20/04/2026 20:00:00;20/04/2026 20:00:00;Aprovado;N;;a@b.com;;;;;;;Brasil;;;;;1;;;;PIX;Não;Não;Produtor;1;A;1;43.92;1;Não;;BRL;43.92;1;;;;BRL;1;;Vendedor;0';
      let csv = header;
      for (let i = 0; i < 5001; i++) csv += dataRow.replace('{i}', String(i)) + '\n';
      const buf = Buffer.from(csv, 'utf-8');
      await expect((service as any).parseAndClassify(buf, 'big.csv')).rejects.toMatchObject({
        response: { error: 'too_many_rows', max: 5000 },
      });
    });

    it('rejects files with missing critical columns', async () => {
      const buf = Buffer.from('colA;colB\nval1;val2\n', 'utf-8');
      const err = await (service as any)
        .parseAndClassify(buf, 'bad.csv')
        .catch((e: any) => e);
      expect(err.response.error).toBe('unsupported_schema');
      expect(typeof err.response.missing_column).toBe('string');
    });

    it('rejects empty files', async () => {
      const header =
        '﻿Nome do Produto;Nome do Produtor;Documento do Produtor;Nome do Afiliado;Transação;Meio de Pagamento;Origem;Moeda;Preço do Produto;Moeda;Preço da Oferta;Taxa de Câmbio;Moeda;Preço Original;Número da Parcela;Recorrência;Data de Venda;Data de Confirmação;Status;Nome;Documento;Email;DDD;Telefone;CEP;Cidade;Estado;Bairro;País;Endereço;Número;Complemento;chave;Código do Produto;Código da Afiliação;Código de Oferta;Origem de Checkout;Tipo de Pagamento;Período Grátis;Tem co-produção;Venda feita como;Preço Total;Tipo pagamento oferta;Taxa de Câmbio Real;Preço Total Convertido;Quantidade de itens;Oferta de Upgrade;Cupom;Moeda;Valor que você recebeu convertido;Taxa de Câmbio do valor recebido;Data Vencimento;Instagram;Origem da venda;Moeda de recebimento;Faturamento líquido;Código do assinante;Nota Fiscal;Valor do frete bruto\n';
      const buf = Buffer.from(header, 'utf-8');
      await expect((service as any).parseAndClassify(buf, 'empty.csv')).rejects.toMatchObject({
        response: { error: 'no_data_rows' },
      });
    });
  });

  describe('preview', () => {
    it('returns summary counts and lists active Hotmart integrations for the workspace', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));

      const fakeClient = {
        from: (table: string) => {
          if (table === 'workspaces') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: 'ws-1' } }),
                  }),
                }),
              }),
            };
          }
          if (table === 'checkout_integrations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => Promise.resolve({
                      data: [
                        { id: 'int-1', name: 'Hotmart Principal' },
                        { id: 'int-2', name: 'Hotmart Secundária' },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'sales') {
            return {
              select: () => ({
                eq: () => ({
                  in: () => Promise.resolve({
                    data: [{ external_id: 'HP0000000001' }],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        },
      };
      mockSupabase.getClient.mockReturnValue(fakeClient);

      const result = await service.preview(buf, 'hotmart-sample.csv', 'user-1', 'ws-1');

      expect(result.total_rows).toBe(5);
      expect(result.non_approved).toBe(1);
      expect(result.invalid).toBe(2);
      expect(result.duplicates).toBe(1);
      expect(result.to_import).toBe(1);
      expect(result.sample_preview).toHaveLength(1);
      expect(result.integrations).toHaveLength(2);
    });

    it('throws no_active_integration when workspace has zero active Hotmart integrations', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));
      const fakeClient = {
        from: (table: string) => {
          if (table === 'workspaces') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: 'ws-1' } }),
                  }),
                }),
              }),
            };
          }
          if (table === 'checkout_integrations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === 'sales') {
            return {
              select: () => ({
                eq: () => ({
                  in: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
          }
          return {};
        },
      };
      mockSupabase.getClient.mockReturnValue(fakeClient);
      await expect(service.preview(buf, 'hotmart-sample.csv', 'user-1', 'ws-1'))
        .rejects.toMatchObject({ response: { error: 'no_active_integration' } });
    });

    it('throws Forbidden when workspace does not belong to the user', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));
      const fakeClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null }),
              }),
            }),
          }),
        }),
      };
      mockSupabase.getClient.mockReturnValue(fakeClient);
      await expect(service.preview(buf, 'hotmart-sample.csv', 'user-x', 'ws-1'))
        .rejects.toMatchObject({ response: { error: 'workspace_forbidden' } });
    });
  });

  describe('import (commit)', () => {
    it('inserts approved rows, runs ad matching per row, returns report', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));

      const fakeClient = {
        from: (table: string) => {
          if (table === 'workspaces') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: 'ws-1' } }),
                  }),
                }),
              }),
            };
          }
          if (table === 'checkout_integrations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: () => Promise.resolve({
                          data: { id: 'int-1', workspace_id: 'ws-1', platform: 'hotmart', is_active: true },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'sales') {
            return {
              select: () => ({
                eq: () => ({
                  in: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
          }
          return {};
        },
      };
      mockSupabase.getClient.mockReturnValue(fakeClient);

      mockSalesService.upsertManyImported.mockResolvedValue([
        { id: 'sale-1', external_id: 'HP0000000001' },
        { id: 'sale-2', external_id: 'HP0000000002' },
      ]);

      const result = await service.import(buf, 'hotmart-sample.csv', 'user-1', 'ws-1', 'int-1');

      expect(result.imported).toBe(2);
      expect(result.skipped_non_approved).toBe(1);
      expect(result.skipped_invalid).toBe(2);
      expect(result.skipped_duplicates).toBe(0);
      expect(mockSalesService.upsertManyImported).toHaveBeenCalledTimes(1);
      const sent = mockSalesService.upsertManyImported.mock.calls[0][0];
      expect(sent).toHaveLength(2);
      expect(sent[0].user_id).toBe('user-1');
      expect(sent[0].workspace_id).toBe('ws-1');
      expect(sent[0].checkout_integration_id).toBe('int-1');
      expect(mockWebhooksService.matchAndUpdateSale).toHaveBeenCalledTimes(2);
    });

    it('pairs ad matching by external_id even if upsertManyImported drops rows (race condition)', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));

      const fakeClient = {
        from: (table: string) => {
          if (table === 'workspaces') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: 'ws-1' } }),
                  }),
                }),
              }),
            };
          }
          if (table === 'checkout_integrations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: () => Promise.resolve({
                          data: { id: 'int-1', workspace_id: 'ws-1', platform: 'hotmart', is_active: true },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'sales') {
            return {
              select: () => ({
                eq: () => ({
                  in: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            };
          }
          return {};
        },
      };
      mockSupabase.getClient.mockReturnValue(fakeClient);

      // Simulate: HP0000000001 was inserted by a concurrent webhook, so upsertManyImported
      // silently skips it (ignoreDuplicates=true) and returns only the second row.
      mockSalesService.upsertManyImported.mockResolvedValue([
        { id: 'sale-2', external_id: 'HP0000000002' },
      ]);

      const result = await service.import(buf, 'hotmart-sample.csv', 'user-1', 'ws-1', 'int-1');

      expect(result.imported).toBe(1);
      expect(mockWebhooksService.matchAndUpdateSale).toHaveBeenCalledTimes(1);
      const [saleId, , tracking] = mockWebhooksService.matchAndUpdateSale.mock.calls[0];
      expect(saleId).toBe('sale-2');
      // The tracking must come from HP0000000002 (second row of fixture), which has ad_id 120242453126770467.
      expect(tracking.adId).toBe('120242453126770467');
    });

    it('throws integration_forbidden when integration_id does not belong to workspace', async () => {
      const buf = fs.readFileSync(fixturePath('hotmart-sample.csv'));
      const fakeClient = {
        from: (table: string) => {
          if (table === 'workspaces') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: 'ws-1' } }),
                  }),
                }),
              }),
            };
          }
          if (table === 'checkout_integrations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: () => Promise.resolve({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        },
      };
      mockSupabase.getClient.mockReturnValue(fakeClient);
      await expect(service.import(buf, 'hotmart-sample.csv', 'user-1', 'ws-1', 'int-wrong'))
        .rejects.toMatchObject({ response: { error: 'integration_forbidden' } });
    });
  });
});
