import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { parse as csvParse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { fromZonedTime } from 'date-fns-tz';
import { SupabaseService } from '../../shared/services/supabase.service';
import { SalesService } from './sales.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { parseXcod, extractAdIdFromValue } from '../webhooks/processors/hotmart-tracking.util';

const MAX_ROWS = 5000;
const IMPORT_TZ = 'America/Sao_Paulo';

const REQUIRED_COLUMNS = [
  'Transação',
  'Status',
  'Data de Venda',
  'Email',
  'Valor que você recebeu convertido',
  'Origem',
];

const AMOUNT_COLUMN = 'Valor que você recebeu convertido';
const NET_COLUMN = 'Faturamento líquido';
const APPROVED_STATUS = new Set(['aprovado', 'completo']);
const INDEXER = /stl_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** O xcod do rastreador é a string com "|" (utm_source|conjunto|id|...). Um id solto é o src. */
export function looksLikeXcod(value: string): boolean {
  return value.includes('|');
}

export function extractIndexer(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(INDEXER);
  return match ? match[0].toLowerCase() : null;
}

function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

// The Hotmart export contains four columns literally named "Moeda" (one per
// adjacent price column). csv-parse/XLSX would otherwise collapse duplicates,
// so we rename later occurrences to "Moeda (2)", "Moeda (3)", etc. This makes
// each position addressable so classify can read the one that qualifies
// "Valor que você recebeu convertido".
function renameDuplicateHeaders(columns: string[]): string[] {
  const counts: Record<string, number> = {};
  return columns.map((raw) => {
    const name = String(raw ?? '').trim();
    counts[name] = (counts[name] ?? 0) + 1;
    return counts[name] === 1 ? name : `${name} (${counts[name]})`;
  });
}

const PAYMENT_METHOD_MAP: Record<string, string> = {
  'Cartão de Crédito': 'CREDIT_CARD',
  'Cartao de Credito': 'CREDIT_CARD',
  'PIX': 'PIX',
  'Boleto': 'BILLET',
  'PayPal': 'PAYPAL',
  'Mercado Pago': 'MERCADO_PAGO',
  'Apple Pay': 'APPLE_PAY',
  'Nequi': 'NEQUI',
  'PSE': 'PSE',
  'Servipag': 'SERVIPAG',
  'SPEI': 'SPEI',
  'Yape': 'YAPE',
};

const COUNTRY_MAP: Record<string, string> = {
  brasil: 'BR',
  brazil: 'BR',
  argentina: 'AR',
  chile: 'CL',
  mexico: 'MX',
  méxico: 'MX',
  colombia: 'CO',
  colômbia: 'CO',
  peru: 'PE',
  perú: 'PE',
  uruguay: 'UY',
  uruguai: 'UY',
};

export interface ClassifiedRow {
  external_id: string;
  workspace_id?: string;
  user_id?: string;
  checkout_integration_id?: string;
  checkout_source: 'hotmart';
  amount: number;
  currency: string;
  status: 'approved';
  product_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_doc: string | null;
  customer_state: string | null;
  customer_city: string | null;
  customer_country: string | null;
  payment_method: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ad_id: string | null;
  sold_at: string;
  metadata: Record<string, any>;
}

export interface ClassificationResult {
  totalRows: number;
  approved: ClassifiedRow[];
  nonApproved: number;
  invalid: Array<{ row: number; reason: string }>;
  /** Motivo de cada linha que não entra: erro de valor/data e status fora de Aprovado/Completo. */
  rowIssues: Array<{ row: number; reason: string }>;
}

export interface PreviewResponse {
  total_rows: number;
  to_import: number;
  duplicates: number;
  non_approved: number;
  invalid: number;
  invalid_samples: Array<{ row: number; reason: string }>;
  row_issues: Array<{ row: number; reason: string }>;
  sample_preview: Array<{
    transaction: string;
    product_name: string | null;
    customer_email: string | null;
    amount_brl: number;
    sold_at: string;
  }>;
  integrations: Array<{ id: string; name: string }>;
}

export interface ImportResponse {
  imported: number;
  skipped_duplicates: number;
  skipped_non_approved: number;
  skipped_invalid: number;
  invalid_samples: Array<{ row: number; reason: string }>;
  row_issues: Array<{ row: number; reason: string }>;
}

@Injectable()
export class SalesImportService {
  private readonly logger = new Logger(SalesImportService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly salesService: SalesService,
    @Inject(forwardRef(() => WebhooksService))
    private readonly webhooksService: WebhooksService,
  ) {}

  async preview(
    file: Buffer,
    filename: string,
    userId: string,
    workspaceId: string,
  ): Promise<PreviewResponse> {
    await this.assertWorkspaceOwnership(userId, workspaceId);

    const classified = await this.parseAndClassify(file, filename);

    const externalIds = classified.approved.map((r) => r.external_id);
    const duplicateIds = externalIds.length > 0
      ? await this.findExistingExternalIds(workspaceId, externalIds)
      : new Set<string>();

    const toImport = classified.approved.filter((r) => !duplicateIds.has(r.external_id));

    const integrations = await this.listActiveHotmartIntegrations(workspaceId);
    if (integrations.length === 0) {
      throw new BadRequestException({
        error: 'no_active_integration',
        message: 'Nenhuma integração Hotmart ativa neste workspace',
      });
    }

    return {
      total_rows: classified.totalRows,
      to_import: toImport.length,
      duplicates: duplicateIds.size,
      non_approved: classified.nonApproved,
      invalid: classified.invalid.length,
      invalid_samples: classified.invalid.slice(0, 5),
      row_issues: classified.rowIssues.slice(0, 100),
      sample_preview: toImport.slice(0, 5).map((r) => ({
        transaction: r.external_id,
        product_name: r.product_name,
        customer_email: r.customer_email,
        amount_brl: r.amount,
        sold_at: r.sold_at,
      })),
      integrations,
    };
  }

  async import(
    file: Buffer,
    filename: string,
    userId: string,
    workspaceId: string,
    integrationId: string,
  ): Promise<ImportResponse> {
    await this.assertWorkspaceOwnership(userId, workspaceId);
    await this.assertIntegrationBelongsToWorkspace(integrationId, workspaceId);

    const classified = await this.parseAndClassify(file, filename);

    const externalIds = classified.approved.map((r) => r.external_id);
    const duplicateIds = externalIds.length > 0
      ? await this.findExistingExternalIds(workspaceId, externalIds)
      : new Set<string>();

    const toImport = classified.approved.filter((r) => !duplicateIds.has(r.external_id));

    const rows = toImport.map((r) => ({
      ...r,
      user_id: userId,
      workspace_id: workspaceId,
      checkout_integration_id: integrationId,
    }));

    const inserted = await this.salesService.upsertManyImported(rows);

    // Mesmo casamento do webhook (stl_ no metadata → tracking_match_sale).
    // Não passa por upsertFromWebhook, então não dispara Purchase na CAPI.
    await this.salesService.linkImportedSales(inserted.map((saved) => saved.id));

    const sourceByExternalId = new Map(toImport.map((r) => [r.external_id, r]));
    const matchPromises = inserted
      .map((saved) => {
        const src = sourceByExternalId.get(saved.external_id);
        if (!src) return null;
        return this.webhooksService.matchAndUpdateSale(saved.id, userId, {
          adId: src.ad_id,
          utmCampaign: src.utm_campaign,
          utmContent: src.utm_content,
          utmTerm: src.utm_term,
          adSetFbId: (src.metadata as any).adset_fb_id ?? null,
          campaignFbId: (src.metadata as any).campaign_fb_id ?? null,
        });
      })
      .filter((p): p is Promise<void> => p !== null);
    await Promise.allSettled(matchPromises);

    this.logger.log(
      JSON.stringify({
        event: 'sales_import',
        workspace_id: workspaceId,
        imported: inserted.length,
        skipped_duplicates: duplicateIds.size,
        skipped_invalid: classified.invalid.length,
        skipped_non_approved: classified.nonApproved,
      }),
    );

    return {
      imported: inserted.length,
      skipped_duplicates: duplicateIds.size,
      skipped_non_approved: classified.nonApproved,
      skipped_invalid: classified.invalid.length,
      invalid_samples: classified.invalid.slice(0, 5),
      row_issues: classified.rowIssues.slice(0, 100),
    };
  }

  private async assertWorkspaceOwnership(userId: string, workspaceId: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenException({ error: 'workspace_forbidden' });
  }

  private async assertIntegrationBelongsToWorkspace(
    integrationId: string,
    workspaceId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('checkout_integrations')
      .select('id, workspace_id, platform, is_active')
      .eq('id', integrationId)
      .eq('workspace_id', workspaceId)
      .eq('platform', 'hotmart')
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new ForbiddenException({ error: 'integration_forbidden' });
    }
  }

  private async listActiveHotmartIntegrations(
    workspaceId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await this.supabase
      .getClient()
      .from('checkout_integrations')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .eq('platform', 'hotmart')
      .eq('is_active', true);
    if (error) throw error;
    return data || [];
  }

  private async findExistingExternalIds(
    workspaceId: string,
    externalIds: string[],
  ): Promise<Set<string>> {
    const { data, error } = await this.supabase
      .getClient()
      .from('sales')
      .select('external_id')
      .eq('workspace_id', workspaceId)
      .in('external_id', externalIds);
    if (error) throw error;
    return new Set((data || []).map((r: any) => r.external_id));
  }

  private async parseAndClassify(
    file: Buffer,
    filename: string,
  ): Promise<ClassificationResult> {
    const isXlsx = /\.xlsx$/i.test(filename);
    const rows: Record<string, string>[] = isXlsx
      ? this.parseXlsx(file)
      : this.parseCsv(file);

    if (rows.length === 0) {
      throw new BadRequestException({ error: 'no_data_rows' });
    }
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException({ error: 'too_many_rows', max: MAX_ROWS });
    }

    const header = Object.keys(rows[0]);
    for (const col of REQUIRED_COLUMNS) {
      if (!header.includes(col)) {
        throw new BadRequestException({
          error: 'unsupported_schema',
          missing_column: col,
        });
      }
    }

    // The currency for AMOUNT_COLUMN is carried by the "Moeda" column
    // immediately preceding it in the Hotmart export. Everything after
    // renameDuplicateHeaders looks like "Moeda (4)" in the parsed dict.
    const amountIdx = header.indexOf(AMOUNT_COLUMN);
    const currencyKey = amountIdx > 0 ? header[amountIdx - 1] : null;
    if (!currencyKey || !/^Moeda(?:\s|$|\s*\(\d+\))/.test(currencyKey)) {
      throw new BadRequestException({
        error: 'unsupported_schema',
        missing_column: `Coluna "Moeda" antes de "${AMOUNT_COLUMN}"`,
      });
    }

    const approved: ClassifiedRow[] = [];
    const invalid: Array<{ row: number; reason: string }> = [];
    const rowIssues: Array<{ row: number; reason: string }> = [];
    let nonApproved = 0;
    const netIdx = header.indexOf(NET_COLUMN);

    const reject = (row: number, reason: string) => {
      invalid.push({ row, reason });
      rowIssues.push({ row, reason });
    };

    rows.forEach((raw, idx) => {
      const rowNum = idx + 2;
      const status = (raw['Status'] || '').trim();
      if (!APPROVED_STATUS.has(status.toLowerCase())) {
        nonApproved += 1;
        rowIssues.push({
          row: rowNum,
          reason: status
            ? `Status "${status}" não entra (só Aprovado e Completo)`
            : 'Status vazio — só entram Aprovado e Completo',
        });
        return;
      }

      const transaction = (raw['Transação'] || '').trim();
      if (!transaction) {
        reject(rowNum, 'Transação ausente');
        return;
      }

      // "Valor que você recebeu convertido" é o líquido em BRL quando a Hotmart
      // preenche. No export novo essa célula vem vazia e o líquido está em
      // "Faturamento líquido", com a moeda na coluna imediatamente anterior.
      const received = parseAmount(raw[AMOUNT_COLUMN]);
      const net = netIdx >= 0 ? parseAmount(raw[NET_COLUMN]) : null;
      let amount: number | null = null;
      let currencyKeyUsed: string | null = null;
      if (received != null) {
        amount = received;
        currencyKeyUsed = currencyKey;
      } else if (net != null && netIdx > 0) {
        amount = net;
        currencyKeyUsed = header[netIdx - 1];
      }
      if (amount == null) {
        reject(
          rowNum,
          `${AMOUNT_COLUMN} vazio e ${NET_COLUMN} sem valor em BRL ("${raw[AMOUNT_COLUMN] ?? ''}" / "${raw[NET_COLUMN] ?? ''}")`,
        );
        return;
      }

      const currency = (raw[currencyKeyUsed!] || '').trim().toUpperCase();
      if (currency !== 'BRL') {
        reject(
          rowNum,
          `Moeda de recebimento "${currency || 'vazia'}" não suportada — esta conta Hotmart precisa receber em BRL para importação.`,
        );
        return;
      }

      const email = (raw['Email'] || '').trim().toLowerCase();
      if (!email) {
        reject(rowNum, 'Email ausente');
        return;
      }

      const soldAtLocal = this.parseBrDate(raw['Data de Venda']);
      if (!soldAtLocal) {
        reject(rowNum, `Data de Venda inválida: "${raw['Data de Venda']}"`);
        return;
      }

      const origem = (raw['Origem'] || '').trim();
      const xcod = looksLikeXcod(origem);
      const parsed = xcod ? parseXcod(origem) : null;
      // Id numérico sozinho é o src (conjunto), não o anúncio. Não vira ad_id.
      const src = !xcod && /^\d{6,}$/.test(origem) ? origem : null;
      const adId = parsed ? parsed.ad_id || extractAdIdFromValue(origem) : null;
      const checkoutOrigin = (raw['Origem de Checkout'] || '').trim();
      const indexer = extractIndexer(checkoutOrigin) || extractIndexer(origem);

      const country = this.mapCountry(raw['País']);
      const ddd = (raw['DDD'] || '').trim();
      const phone = (raw['Telefone'] || '').trim();
      const customerPhone = ddd || phone ? `${ddd} ${phone}`.trim() : null;

      approved.push({
        external_id: transaction,
        checkout_source: 'hotmart',
        amount,
        currency,
        status: 'approved',
        product_name: (raw['Nome do Produto'] || '').trim() || null,
        customer_name: (raw['Nome'] || '').trim() || null,
        customer_email: email,
        customer_phone: customerPhone,
        customer_doc: (raw['Documento'] || '').trim() || null,
        customer_state: (raw['Estado'] || '').trim() || null,
        customer_city: (raw['Cidade'] || '').trim() || null,
        customer_country: country,
        payment_method: this.mapPaymentMethod(raw['Tipo de Pagamento']),
        utm_source: parsed?.utm_source ?? null,
        utm_medium: parsed?.utm_medium ?? null,
        utm_campaign: parsed?.utm_campaign ?? null,
        utm_content: parsed?.utm_content ?? null,
        utm_term: parsed?.utm_term ?? null,
        ad_id: adId,
        sold_at: soldAtLocal,
        metadata: {
          source_type: 'import',
          imported_at: new Date().toISOString(),
          original_filename: filename,
          xcod_raw: xcod ? origem : null,
          src,
          sck: indexer,
          // O casamento com a visita procura stl_<sessão> em qualquer lugar do metadata.
          tracking_ref: indexer,
          checkout_origin: checkoutOrigin || null,
          campaign_fb_id: parsed?.campaign_fb_id ?? null,
          adset_fb_id: parsed?.adset_fb_id ?? src,
        },
      });
    });

    return {
      totalRows: rows.length,
      approved,
      nonApproved,
      invalid,
      rowIssues,
    };
  }

  private parseCsv(buf: Buffer): Record<string, string>[] {
    const tryDelimiter = (delim: string) => {
      try {
        return csvParse(buf, {
          delimiter: delim,
          columns: renameDuplicateHeaders,
          bom: true,
          skip_empty_lines: true,
          trim: true,
          relax_quotes: true,
        }) as Record<string, string>[];
      } catch {
        return null;
      }
    };

    const semi = tryDelimiter(';');
    if (semi && semi.length > 0 && Object.keys(semi[0]).length > 1) {
      return semi;
    }
    const comma = tryDelimiter(',');
    if (comma && comma.length > 0 && Object.keys(comma[0]).length > 1) {
      return comma;
    }
    // Empty file with only header — return empty array so caller throws no_data_rows
    if (semi && semi.length === 0) return [];
    if (comma && comma.length === 0) return [];
    throw new BadRequestException({ error: 'parse_error' });
  }

  private parseXlsx(buf: Buffer): Record<string, string>[] {
    // Reject legacy .xls (magic bytes D0 CF 11 E0)
    if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
      throw new BadRequestException({
        error: 'unsupported_format',
        message: 'Legacy .xls is not supported. Export as CSV or XLSX.',
      });
    }
    const wb = XLSX.read(buf, { type: 'buffer', raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    if (matrix.length === 0) return [];
    const rawHeader = (matrix[0] as any[]).map((s) => String(s ?? '').trim());
    const header = renameDuplicateHeaders(rawHeader);
    return matrix.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((name, i) => {
        const v = (row as any[])[i];
        obj[name] = v === undefined || v === null ? '' : String(v);
      });
      return obj;
    });
  }

  private parseBrDate(raw: string | undefined): string | null {
    if (!raw) return null;
    const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, dd, mm, yyyy, HH, MM, SS] = match;
    const isoLocal = `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}`;
    const utc = fromZonedTime(isoLocal, IMPORT_TZ);
    if (isNaN(utc.getTime())) return null;
    return utc.toISOString();
  }

  private mapPaymentMethod(raw: string | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    return PAYMENT_METHOD_MAP[trimmed] || trimmed.toUpperCase().replace(/\s+/g, '_');
  }

  private mapCountry(raw: string | undefined): string | null {
    if (!raw) return null;
    const key = raw.trim().toLowerCase();
    return COUNTRY_MAP[key] || null;
  }
}
