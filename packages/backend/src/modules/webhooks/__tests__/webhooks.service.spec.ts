import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from '../webhooks.service';
import { SupabaseService } from '../../../shared/services/supabase.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let mockSupabase: any;
  let mockClient: any;

  beforeEach(async () => {
    mockClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
    };

    mockSupabase = {
      getClient: jest.fn().mockReturnValue(mockClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  describe('matchAndUpdateSale', () => {
    it('should be defined', () => {
      expect(service.matchAndUpdateSale).toBeDefined();
    });

    it('should call matchSaleToAds and update sale when match found', async () => {
      jest.spyOn(service, 'matchSaleToAds').mockResolvedValue({
        campaign_id: 'camp-uuid',
        ad_set_id: 'adset-uuid',
        ad_internal_id: 'ad-uuid',
      });

      mockClient.eq.mockReturnValue({ error: null });

      await service.matchAndUpdateSale('sale-123', 'user-456', {
        adId: '120245519580910309',
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
      });

      expect(service.matchSaleToAds).toHaveBeenCalledWith(
        'user-456',
        '120245519580910309',
        null,
        null,
        null,
        undefined,
        undefined,
      );
    });

    it('should not update sale when no match found', async () => {
      jest.spyOn(service, 'matchSaleToAds').mockResolvedValue({
        campaign_id: null,
        ad_set_id: null,
        ad_internal_id: null,
      });

      await service.matchAndUpdateSale('sale-123', 'user-456', {
        adId: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
      });

      expect(mockClient.update).not.toHaveBeenCalled();
    });

    it('should not throw when match fails', async () => {
      jest.spyOn(service, 'matchSaleToAds').mockRejectedValue(
        new Error('DB connection failed'),
      );

      await expect(
        service.matchAndUpdateSale('sale-123', 'user-456', {
          adId: '120245519580910309',
          utmCampaign: null,
          utmContent: null,
          utmTerm: null,
        }),
      ).resolves.not.toThrow();
    });
  });
});
