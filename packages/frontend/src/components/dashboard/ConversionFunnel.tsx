import { Skeleton } from '@/components/ui/skeleton';

interface ConversionFunnelProps {
  linkClicks: number;
  landingPageViews: number;
  initiateCheckouts: number;
  sales: number;
  loading: boolean;
}

const STEP_WIDTHS = [100, 78, 54, 36];

const STEP_COLORS = [
  { bg: 'hsl(208.4 66.4% 54.5% / 0.15)', border: 'hsl(208.4 66.4% 54.5% / 0.25)' },
  { bg: 'hsl(208.4 66.4% 54.5% / 0.22)', border: 'hsl(208.4 66.4% 54.5% / 0.35)' },
  { bg: 'hsl(208.4 66.4% 54.5% / 0.32)', border: 'hsl(208.4 66.4% 54.5% / 0.45)' },
  { bg: 'hsl(208.4 66.4% 54.5% / 0.50)', border: 'hsl(208.4 66.4% 54.5% / 0.65)' },
];

export function ConversionFunnel({
  linkClicks,
  landingPageViews,
  initiateCheckouts,
  sales,
  loading,
}: ConversionFunnelProps) {
  const steps = [
    { label: 'Cliques', value: linkClicks },
    { label: 'Views', value: landingPageViews },
    { label: 'Checkouts', value: initiateCheckouts },
    { label: 'Vendas', value: sales },
  ];

  const getConversionRate = (current: number, previous: number): string => {
    if (previous === 0) return '0';
    return ((current / previous) * 100).toFixed(1);
  };

  const totalConversion =
    linkClicks > 0 ? ((sales / linkClicks) * 100).toFixed(1) : '0';

  if (loading) {
    return (
      <div>
        <div className="mb-4">
          <Skeleton className="h-4 w-36 mx-auto" />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          {STEP_WIDTHS.map((w, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  const isEmpty = linkClicks === 0 && landingPageViews === 0 && initiateCheckouts === 0 && sales === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
          Funil de Conversao
        </h3>
        <div className="flex items-center gap-1.5 bg-foreground/[0.04] rounded-full px-2.5 py-1">
          <span className="text-[10px] text-muted-foreground/50">Total</span>
          <span className="text-xs font-bold text-primary">{totalConversion}%</span>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
          Nenhum dado de funil disponivel
        </div>
      ) : (
        <div className="flex flex-col items-center">
          {steps.map((step, i) => {
            const prevStep = i > 0 ? steps[i - 1] : null;
            const convRate = prevStep ? getConversionRate(step.value, prevStep.value) : null;
            const colors = STEP_COLORS[i];
            const isLast = i === steps.length - 1;

            return (
              <div key={step.label} className="flex flex-col items-center w-full">
                {convRate && (
                  <div className="flex items-center gap-1.5 py-1">
                    <span className="text-[10px] text-foreground/30 tabular-nums">
                      ↓ {convRate}%
                    </span>
                  </div>
                )}
                <div
                  className="relative rounded-lg transition-all duration-500 ease-out"
                  style={{
                    width: `${STEP_WIDTHS[i]}%`,
                    background: colors.bg,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderStyle: 'solid',
                  }}
                >
                  <div className="flex items-center justify-center gap-2 px-3 py-2">
                    <span
                      className={`text-[11px] font-medium whitespace-nowrap ${
                        isLast ? 'text-accent-readable' : 'text-foreground/60'
                      }`}
                    >
                      {step.label}
                    </span>
                    <span
                      className={`text-sm font-bold tabular-nums whitespace-nowrap ${
                        isLast ? 'text-accent-readable' : 'text-foreground/90'
                      }`}
                    >
                      {step.value.toLocaleString('pt-BR')}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
