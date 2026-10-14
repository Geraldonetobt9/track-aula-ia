import { Module } from '@nestjs/common';
import { AbTestsController } from './ab-tests.controller';
import { AbTestsService } from './ab-tests.service';

/**
 * Testes A/B da página de vendas.
 *
 * O sorteio acontece no tracker.js e chega pelo /collect do TrackingModule,
 * que importa este módulo para gravar o sorteio e para pôr os testes rodando
 * dentro do script. A conversão vem do indexador: a venda que volta com
 * stl_<sessão> é ligada ao visitante, e o visitante à variante.
 */
@Module({
  controllers: [AbTestsController],
  providers: [AbTestsService],
  exports: [AbTestsService],
})
export class AbTestsModule {}
