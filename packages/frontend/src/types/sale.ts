export type SaleStatus = 'approved' | 'pending' | 'refunded';

export interface SaleMetricsInput {
  status: SaleStatus | string | null;
  amount: number;
}

export interface SalesMetrics {
  totalSales: number;
  grossRevenue: number;
  netRevenue: number;
  averageTicket: number;
  refundRate: number;
  approvedCount: number;
  pendingCount: number;
  refundedCount: number;
  adSpend: number;
}

export function calculateSalesMetrics(sales: SaleMetricsInput[], adSpend: number = 0): SalesMetrics {
  const approvedSales = sales.filter(s => s.status === 'approved');
  const refundedSales = sales.filter(s => s.status === 'refunded');

  const grossRevenue = approvedSales.reduce((sum, s) => sum + Number(s.amount), 0);
  
  // CORREÇÃO: Líquido = Bruto - Gasto com Ads
  const netRevenue = grossRevenue - adSpend;
  const averageTicket = approvedSales.length > 0 ? grossRevenue / approvedSales.length : 0;
  
  // Taxa de reembolso: reembolsados / aprovados (já estava correto)
  const refundRate = approvedSales.length > 0 ? (refundedSales.length / approvedSales.length) * 100 : 0;

  return {
    // CORREÇÃO: Total = somente aprovadas
    totalSales: approvedSales.length,
    grossRevenue,
    netRevenue,
    averageTicket,
    refundRate,
    approvedCount: approvedSales.length,
    pendingCount: 0,
    refundedCount: refundedSales.length,
    adSpend,
  };
}
