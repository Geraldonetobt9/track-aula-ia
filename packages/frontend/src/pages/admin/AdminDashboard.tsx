import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminStatsCards } from '@/components/admin/AdminStatsCards';
import { useAdminDashboard } from '@/hooks/useAdminDashboard';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';
import { useChartColors } from '@/hooks/useChartColors';

export default function AdminDashboard() {
  const { stats, loading, error } = useAdminDashboard();
  const navigate = useNavigate();
  const chart = useChartColors();

  const PLAN_COLORS: Record<string, string> = {
    starter: chart.withAlpha('--foreground', 0.25),
    pro: chart.primary,
    enterprise: chart.withAlpha('--foreground', 0.5),
  };

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center text-destructive">
        Erro ao carregar dados: {error}
      </div>
    );
  }

  const planData = stats?.users_by_plan
    ? Object.entries(stats.users_by_plan).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        color: PLAN_COLORS[name as keyof typeof PLAN_COLORS] || PLAN_COLORS.starter,
      }))
    : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard Administrativo</h1>
        <p className="text-sm text-muted-foreground/70 mt-1">Visão geral da plataforma</p>
      </div>

      <AdminStatsCards stats={stats || null} loading={loading} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* New Users Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Novos Usuários</CardTitle>
            <CardDescription>Últimos 30 dias</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats?.new_users_by_day || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.withAlpha('--foreground', 0.05)} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) => format(new Date(value), 'dd/MM')}
                    tick={{ fontSize: 11, fill: chart.muted }}
                    axisLine={{ stroke: chart.withAlpha('--foreground', 0.05) }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: chart.muted }}
                    axisLine={{ stroke: chart.withAlpha('--foreground', 0.05) }}
                    tickLine={false}
                  />
                  <Tooltip
                    labelFormatter={(value) => format(new Date(value), 'dd/MM/yyyy', { locale: ptBR })}
                    formatter={(value: number) => [value, 'Usuários']}
                    contentStyle={{ backgroundColor: chart.background, border: `1px solid ${chart.border}`, borderRadius: '8px' }}
                    labelStyle={{ color: chart.muted }}
                    itemStyle={{ color: chart.accent }}
                  />
                  <Bar dataKey="count" fill={chart.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Plan Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição por Plano</CardTitle>
            <CardDescription>Usuários por tipo de plano</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={planData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={{ stroke: chart.withAlpha('--foreground', 0.15) }}
                  >
                    {planData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [value, 'Usuários']}
                    contentStyle={{ backgroundColor: chart.background, border: `1px solid ${chart.border}`, borderRadius: '8px' }}
                    itemStyle={{ color: chart.foreground }}
                  />
                  <Legend wrapperStyle={{ color: chart.muted }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Users */}
        <Card>
          <CardHeader>
            <CardTitle>Últimos Usuários Registrados</CardTitle>
            <CardDescription>10 mais recentes</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Registrado</TableHead>
                    <TableHead>Facebook</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats?.recent_users?.map((user) => (
                    <TableRow
                      key={user.id}
                      className="cursor-pointer hover:bg-foreground/[0.03]"
                      onClick={() => navigate(`/admin/users/${user.user_id}`)}
                    >
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell className="capitalize">{user.plan}</TableCell>
                      <TableCell>{format(new Date(user.created_at), 'dd/MM/yyyy')}</TableCell>
                      <TableCell>
                        {user.facebook_connected === true && '🟢'}
                        {user.facebook_connected === false && '🔴'}
                        {user.facebook_connected === null && '⚫'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Users with Sync Errors */}
        <Card>
          <CardHeader>
            <CardTitle>Usuários com Erros de Sync</CardTitle>
            <CardDescription>Necessitam atenção</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : stats?.users_with_sync_errors?.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground/70">
                Nenhum erro de sincronização
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Erro</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats?.users_with_sync_errors?.map((user) => (
                    <TableRow
                      key={user.user_id}
                      className="cursor-pointer hover:bg-foreground/[0.03]"
                      onClick={() => navigate(`/admin/users/${user.user_id}`)}
                    >
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-destructive">
                        {user.last_sync_error}
                      </TableCell>
                      <TableCell>
                        {user.last_sync_at && format(new Date(user.last_sync_at), 'dd/MM HH:mm')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
