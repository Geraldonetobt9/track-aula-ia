import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { useGenderize } from '@/hooks/useGenderize';
import { RotateCcw } from 'lucide-react';
import type {
  RefundStateEntry,
  RefundedSampleEntry,
  SalesSummaryMetrics,
} from '@/hooks/useSalesSummary';

interface RefundAnalysisSectionProps {
  metrics: SalesSummaryMetrics;
  refundsByState: RefundStateEntry[];
  refundedSample: RefundedSampleEntry[];
  loading: boolean;
}

const STATE_COLORS = ['#ef4444', '#f97316', '#eab308'];

const GENDER_COLORS: Record<string, string> = {
  male: '#3b82f6',
  female: '#ec4899',
  unknown: '#6b7280',
};

const GENDER_LABELS: Record<string, string> = {
  male: 'Homem',
  female: 'Mulher',
  unknown: 'Indefinido',
};

export function RefundAnalysisSection({
  metrics,
  refundsByState,
  refundedSample,
  loading,
}: RefundAnalysisSectionProps) {
  const refundedNames = useMemo(
    () =>
      refundedSample
        .map((s) => s.customer_name)
        .filter((n): n is string => !!n),
    [refundedSample],
  );

  const { genderMap, loading: genderLoading } = useGenderize(refundedNames);

  // Gender breakdown of refunded customers in the sample.
  const genderData = useMemo(() => {
    const counts: Record<string, number> = { male: 0, female: 0 };
    refundedSample.forEach((sale) => {
      const gender = sale.customer_name ? genderMap[sale.customer_name] || 'unknown' : 'unknown';
      if (gender !== 'unknown') counts[gender]++;
    });

    const total = refundedSample.length || 1;
    return Object.entries(counts)
      .filter(([_, count]) => count > 0)
      .map(([gender, count]) => ({
        gender,
        label: GENDER_LABELS[gender],
        count,
        percentage: ((count / total) * 100).toFixed(1),
      }));
  }, [refundedSample, genderMap]);

  const stateData = useMemo(() => {
    return refundsByState.map((entry) => ({
      state: entry.state,
      count: entry.count,
    }));
  }, [refundsByState]);

  const isLoading = loading || genderLoading;
  const totalRefunds = metrics.refunds_count;
  const totalRefundValue = useMemo(
    () => refundedSample.reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
    [refundedSample],
  );
  const refundedSampleSize = refundedSample.length;
  const sampleNote =
    refundedSampleSize < totalRefunds
      ? ` (amostra de ${refundedSampleSize} de ${totalRefunds})`
      : '';

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Análise de Reembolsos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (totalRefunds === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Análise de Reembolsos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhum reembolso encontrado no período selecionado.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Análise de Reembolsos
          </CardTitle>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              Total: <span className="text-foreground font-medium">{totalRefunds}</span>
            </span>
            <span className="text-muted-foreground">
              Taxa: <span className="text-foreground font-medium">{metrics.refund_rate.toFixed(1)}%</span>
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top 3 States */}
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
              Top 3 Estados com Reembolsos
            </h4>
            {stateData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sem dados de estado</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stateData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <YAxis
                    dataKey="state"
                    type="category"
                    width={40}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--foreground))',
                    }}
                    formatter={(value: number) => [`${value} reembolso${value !== 1 ? 's' : ''}`, 'Quantidade']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {stateData.map((_, index) => (
                      <Cell key={index} fill={STATE_COLORS[index % STATE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Gender Breakdown */}
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
              Reembolsos por Gênero{sampleNote}
            </h4>
            {genderData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sem dados de gênero</p>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={200}>
                  <PieChart>
                    <Pie
                      data={genderData}
                      dataKey="count"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      strokeWidth={0}
                    >
                      {genderData.map((entry) => (
                        <Cell key={entry.gender} fill={GENDER_COLORS[entry.gender]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))',
                      }}
                      formatter={(value: number, name: string) => [
                        `${value} (${refundedSampleSize ? ((value / refundedSampleSize) * 100).toFixed(1) : '0'}%)`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-3">
                  {genderData.map((entry) => (
                    <div key={entry.gender} className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: GENDER_COLORS[entry.gender] }}
                      />
                      <div className="text-sm">
                        <span className="text-foreground font-medium">{entry.label}</span>
                        <span className="text-muted-foreground ml-2">
                          {entry.count} ({entry.percentage}%)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {refundedSampleSize > 0 && (
          <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground/70">
            Valor amostrado de reembolsos: R$ {totalRefundValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
