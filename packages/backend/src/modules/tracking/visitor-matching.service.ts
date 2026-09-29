import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

/**
 * Liga uma venda recém-gravada à visita que levou a ela.
 *
 * A regra inteira mora no RPC tracking_match_sale (ver a migration
 * 20260928000000_rastreio_de_visitantes): uma ida ao banco, e a ordem de
 * prioridade fica escrita num lugar só. Aqui é só a chamada.
 *
 * Camada complementar à atribuição por UTM do WebhooksService: não toca em
 * campaign_id, ad_set_id nem ad_internal_id.
 */
@Injectable()
export class VisitorMatchingService {
  private readonly logger = new Logger(VisitorMatchingService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Melhor esforço: nunca lança. A venda já está gravada quando isto roda, e
   * uma falha aqui não pode fazer o webhook responder erro — a plataforma
   * reenviaria uma venda que já existe.
   */
  async matchSale(saleId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .getClient()
        .rpc('tracking_match_sale', { p_sale_id: saleId });

      if (error) {
        this.logger.warn(`[matchSale] ${saleId}: ${error.message}`);
        return;
      }
      if (data) {
        this.logger.log(`[matchSale] ${saleId} ligada a sessao ${data.session_id} por ${data.method}`);
      }
    } catch (err: any) {
      this.logger.warn(`[matchSale] ${saleId}: ${err?.message}`);
    }
  }
}
