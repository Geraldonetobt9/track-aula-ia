import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SalesMetrics } from '@/types/sale';
import { Skeleton } from '@/components/ui/skeleton';

interface SalesMetricsCardsProps {
  metrics: SalesMetrics;
  loading?: boolean;
}

const formatCurrency = (value: number) => {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
};

export function SalesMetricsCards({ metrics, loading }: SalesMetricsCardsProps) {
  const cards = [
    {
      title: 'Total de Vendas',
      value: metrics.totalSales.toString(),
      subtitle: 'Vendas aprovadas',
      icon: ShoppingCart,
      iconColor: 'text-muted-foreground/60',
    },
    {
      title: 'Faturamento Bruto',
      value: formatCurrency(metrics.grossRevenue),
      subtitle: 'Valor total das vendas',
      icon: DollarSign,
      iconColor: 'text-muted-foreground/60',
    },
    {
      title: 'Ticket Médio',
      value: formatCurrency(metrics.averageTicket),
      subtitle: 'Por venda aprovada',
      icon: TrendingUp,
      iconColor: 'text-muted-foreground/60',
    },
    {
      title: 'Taxa de Reembolso',
      value: `${metrics.refundRate.toFixed(1)}%`,
      subtitle: `${metrics.refundedCount} reembolsos`,
      icon: Percent,
      iconColor: metrics.refundRate > 5 ? 'text-muted-foreground/70' : 'text-muted-foreground',
    },
  ];

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <div className="space-y-3">
                <Skeleton className="h-3 w-20 bg-foreground/5" />
                <Skeleton className="h-8 w-24 bg-foreground/5" />
                <Skeleton className="h-3 w-16 bg-foreground/5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, index) => (
        <div
          key={index}
          className="rounded-lg border border-primary/10 p-5"
          style={{
            background: 'linear-gradient(135deg, rgba(62,143,216,0.06) 0%, rgba(62,143,216,0.02) 40%, rgba(0,0,0,0.3) 100%)',
            backdropFilter: 'blur(24px)',
          }}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                {card.title}
              </p>
              <card.icon className="h-3.5 w-3.5 text-muted-foreground/25" />
            </div>
            <div className="metric-number text-foreground" style={{ fontSize: '24px' }}>{card.value}</div>
            <p className="text-xs text-muted-foreground/60">{card.subtitle}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
