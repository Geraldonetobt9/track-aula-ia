import { Test, TestingModule } from '@nestjs/testing';
import { DiscordLoggerService, SaleLogData, ErrorLogData } from '../discord-logger.service';
import { SupabaseService } from '../supabase.service';

// Mock global fetch
const mockFetch = jest.fn().mockResolvedValue({ ok: true });
(global as any).fetch = mockFetch;

// Helper: trigger the queue processor (private method) via interval simulation
async function flushQueue(service: DiscordLoggerService): Promise<void> {
  // Access the private processQueue method
  await (service as any).processQueue();
}

describe('DiscordLoggerService', () => {
  let service: DiscordLoggerService;

  beforeEach(async () => {
    mockFetch.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordLoggerService,
        {
          provide: SupabaseService,
          useValue: { getClient: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(DiscordLoggerService);
  });

  const saleData: SaleLogData = {
    amount: 297,
    customerName: 'João Silva',
    customerEmail: 'joao@test.com',
    productName: 'Curso Marketing',
    paymentMethod: 'pix',
    adMatched: true,
    utmSource: 'FBjLj696',
    utmMedium: 'CJ|120241',
    utmCampaign: 'CAMP|120241',
    utmContent: 'AD|120241',
    utmTerm: 'Instagram_Stories',
  };

  describe('logSale', () => {
    it('should queue and send a green embed with sale data', async () => {
      service.logSale('hotmart', saleData);

      // Message is queued, not sent yet
      expect(mockFetch).not.toHaveBeenCalled();

      // Process the queue
      await flushQueue(service);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('discord.com'),
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0x00cc66);
      expect(embed.title).toContain('Venda Aprovada');
      expect(embed.title).toContain('Hotmart');
      expect(embed.timestamp).toBeDefined();

      const fieldValues = embed.fields.map((f: any) => f.value);
      const fieldNames = embed.fields.map((f: any) => f.name);
      expect(fieldValues).toContain('R$ 297,00');
      expect(fieldValues).toContain('João Silva');
      expect(fieldValues).toContain('joao@test.com');
      expect(fieldValues).toContain('Curso Marketing');
      expect(fieldValues).toContain('PIX');
      expect(fieldValues).toContain('✅');
      expect(fieldNames).toContain('📊 UTMs');
    });

    it('should show Ad Match ❌ when adMatched is false', async () => {
      service.logSale('hotmart', { ...saleData, adMatched: false });
      await flushQueue(service);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const fieldValues = body.embeds[0].fields.map((f: any) => f.value);
      expect(fieldValues).toContain('❌');
    });

    it('should handle null fields gracefully', async () => {
      service.logSale('kiwify', {
        amount: 0,
        customerName: null,
        customerEmail: null,
        productName: null,
        paymentMethod: null,
        adMatched: false,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
      });
      await flushQueue(service);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldValues).toContain('—');
      const fieldNames = embed.fields.map((f: any) => f.name);
      expect(fieldNames).not.toContain('📊 UTMs');
    });
  });

  describe('logRefund', () => {
    it('should queue and send a red embed with refund data', async () => {
      service.logRefund('kiwify', saleData);
      await flushQueue(service);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0xff4444);
      expect(embed.title).toContain('Reembolso');
      expect(embed.title).toContain('Kiwify');
      expect(embed.timestamp).toBeDefined();
    });
  });

  describe('logError', () => {
    it('should send to both platform channel and webhookErrors', async () => {
      const errorData: ErrorLogData = {
        errorType: 'token_invalid',
        message: 'Token não corresponde a nenhuma integração ativa',
        suggestion: 'Verificar com o usuário se o token está correto',
        tokenPartial: 'x9z2',
        customerName: 'João',
        amount: 297,
        productName: 'Curso',
      };

      service.logError('hotmart', errorData);
      await flushQueue(service);

      // Platform channel + webhookErrors = 2 calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].color).toBe(0xff8c00);
      expect(body.embeds[0].title).toBe('⚠️ Token Inválido');
    });

    it('should NOT send unknown_event to webhookErrors', async () => {
      service.logError('hotmart', {
        errorType: 'unknown_event',
        message: 'Evento "order.updated" não é processado',
        suggestion: 'Informativo, sem ação',
      });
      await flushQueue(service);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].color).toBe(0x808080);
    });
  });

  describe('logTestIgnored', () => {
    it('should queue and send a gray embed', async () => {
      service.logTestIgnored('cakto');
      await flushQueue(service);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].color).toBe(0x808080);
      expect(body.embeds[0].description).toContain('teste ignorado');
    });
  });

  describe('queue behavior', () => {
    it('should retry failed messages up to MAX_RETRIES then discard', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      service.logSale('hotmart', saleData);

      // Flush 4 times: initial + 3 retries
      for (let i = 0; i < 4; i++) {
        await flushQueue(service);
      }

      // 4 attempts total (1 initial + 3 retries)
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Queue should be empty after exhausting retries
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({ ok: true });
      await flushQueue(service);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should skip if no webhook URL for channel', async () => {
      service.logSale('nonexistent_platform' as any, saleData);
      await flushQueue(service);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('logAccountChangeSuccess', () => {
    it('emits a green embed with before/after for tax_id changes', async () => {
      service.logAccountChangeSuccess({
        userId: 'user-1',
        userEmail: 'mozo1926@gmail.com',
        field: 'tax_id',
        before: 'CPF · 529.982.247-25',
        after: 'CNPJ · 12.345.678/0001-90',
        stripeSynced: true,
      });

      await flushQueue(service);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0x00cc66);
      expect(embed.title).toContain('Conta alterada');
      const fieldNames = embed.fields.map((f: any) => f.name);
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldNames.some((n: string) => n.includes('Usuário'))).toBe(true);
      expect(fieldValues).toContain('mozo1926@gmail.com');
      expect(fieldValues).toContain('CPF · 529.982.247-25');
      expect(fieldValues).toContain('CNPJ · 12.345.678/0001-90');
      expect(fieldValues.some((v: string) => v.includes('sincronizado'))).toBe(true);
    });

    it('omits before/after for password changes', async () => {
      service.logAccountChangeSuccess({
        userId: 'user-2',
        userEmail: 'a@b.com',
        field: 'password',
      });
      await flushQueue(service);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      const fieldNames = embed.fields.map((f: any) => f.name);
      expect(fieldNames.some((n: string) => n.includes('De') || n.includes('Para'))).toBe(false);
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldValues.some((v: string) => v === 'Senha alterada')).toBe(true);
    });

    it('marks stripe as pending when stripeSynced is false', async () => {
      service.logAccountChangeSuccess({
        userId: 'user-3',
        userEmail: 'a@b.com',
        field: 'email',
        before: 'a@b.com',
        after: 'c@d.com',
        stripeSynced: false,
      });
      await flushQueue(service);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldValues.some((v: string) => v.includes('pendente'))).toBe(true);
    });
  });

  describe('logAccountChangeError', () => {
    it('emits a red embed with stage and reason', async () => {
      service.logAccountChangeError({
        userId: 'user-1',
        userEmail: 'mozo1926@gmail.com',
        field: 'email',
        attempted: 'novo@email.com',
        errorMessage: 'Supabase Admin: User already registered',
        stage: 'auth',
      });
      await flushQueue(service);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0xff4444);
      expect(embed.title).toContain('Falha ao alterar conta');
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldValues).toContain('novo@email.com');
      expect(fieldValues).toContain('auth');
      expect(fieldValues).toContain('Supabase Admin: User already registered');
    });

    it('omits attempted value for password errors', async () => {
      service.logAccountChangeError({
        userId: 'user-2',
        userEmail: 'a@b.com',
        field: 'password',
        attempted: 'should-not-appear',
        errorMessage: 'Auth API failure',
        stage: 'auth',
      });
      await flushQueue(service);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldValues).not.toContain('should-not-appear');
      expect(fieldValues).toContain('Auth API failure');
    });
  });
});
