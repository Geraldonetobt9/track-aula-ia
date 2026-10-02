import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatPercent, type TrackingBreakdownRow } from '@/hooks/useTracking';

/** Página sem o protocolo: "loja.com/oferta" cabe na coluna, "https://www." não acrescenta nada. */
function shortUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || url;
}

export function TrackingBreakdownTable({
  rows,
  loading,
  keyLabel,
  isUrl,
  blurValues,
}: {
  rows: TrackingBreakdownRow[];
  loading: boolean;
  keyLabel: string;
  isUrl?: boolean;
  blurValues?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full bg-foreground/5" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground/70">Nenhuma visita no período.</p>;
  }

  return (
    <div className={cn('overflow-x-auto transition-[filter] duration-200 ease-out', blurValues && 'blur-md select-none')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{keyLabel}</TableHead>
            <TableHead className="text-right">Visitantes</TableHead>
            <TableHead className="text-right">Checkout</TableHead>
            <TableHead className="text-right">Vendas</TableHead>
            <TableHead className="text-right">Conversão</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="max-w-[320px] truncate font-medium" title={r.key}>
                {isUrl && r.key.startsWith('http') ? shortUrl(r.key) : r.key}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.visitors.toLocaleString('pt-BR')}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPercent(r.checkoutRate)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.sales.toLocaleString('pt-BR')}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPercent(r.conversionRate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
