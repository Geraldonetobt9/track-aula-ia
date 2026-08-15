import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, UserCheck, UserPlus, Link, Megaphone, ShoppingCart, DollarSign, Plug, Loader2 } from 'lucide-react';
import { AdminStats } from '@/types/admin';

interface AdminStatsCardsProps {
  stats: AdminStats | null;
  loading: boolean;
}

export function AdminStatsCards({ stats, loading }: AdminStatsCardsProps) {
  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  const topCards = [
    {
      title: 'Total de Usuários',
      value: stats?.total_users || 0,
      icon: Users,
    },
    {
      title: 'Ativos (30d)',
      value: stats?.active_users_30d || 0,
      icon: UserCheck,
    },
    {
      title: 'Novos (7d)',
      value: stats?.new_users_7d || 0,
      icon: UserPlus,
    },
    {
      title: 'Facebook Ativos',
      value: stats?.facebook_connections_active || 0,
      icon: Link,
    },
  ];

  const bottomCards = [
    {
      title: 'Total Campanhas',
      value: stats?.total_campaigns || 0,
      icon: Megaphone,
    },
    {
      title: 'Total Vendas',
      value: stats?.total_sales || 0,
      icon: ShoppingCart,
    },
    {
      title: 'Faturamento Total',
      value: new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(stats?.total_revenue || 0),
      icon: DollarSign,
    },
    {
      title: 'Checkouts Ativos',
      value: stats?.checkout_integrations_active || 0,
      icon: Plug,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {topCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground/60" />
            </CardHeader>
            <CardContent>
              <div className="metric-number text-foreground" style={{ fontSize: '24px' }}>{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {bottomCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground/60" />
            </CardHeader>
            <CardContent>
              <div className="metric-number text-foreground" style={{ fontSize: '24px' }}>{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
