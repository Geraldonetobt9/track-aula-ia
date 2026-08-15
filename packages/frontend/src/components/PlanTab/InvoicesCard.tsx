import { Download, ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useInvoices } from '@/hooks/useStripeBilling';
import type { Invoice } from '@/hooks/useStripeBilling';
import { usePlanUsage } from '@/hooks/usePlanUsage';

const STATUS_LABEL: Record<Invoice['status'], string> = {
  paid: 'Paga',
  open: 'Em aberto',
  draft: 'Rascunho',
  uncollectible: 'Não cobrável',
  void: 'Anulada',
  unknown: '—',
};

const STATUS_TONE: Record<Invoice['status'], string> = {
  paid: 'bg-primary/15 text-accent-readable',
  open: 'bg-warning/15 text-warning',
  draft: 'bg-foreground/5 text-muted-foreground',
  uncollectible: 'bg-destructive/15 text-destructive',
  void: 'bg-foreground/5 text-muted-foreground',
  unknown: 'bg-foreground/5 text-muted-foreground',
};

function formatMoney(cents: number, currency: string): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(value);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function InvoicesCard() {
  const { usage } = usePlanUsage();
  const hasStripeCustomer = !!usage?.subscription.has_stripe_customer;

  const { data: invoices = [], isLoading } = useInvoices();

  if (!hasStripeCustomer) return null;

  return (
    <div className="rounded-2xl border border-foreground/10 bg-card p-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">Faturas recentes</h3>
        <p className="mt-0.5 text-xs text-muted-foreground/70">
          Histórico das últimas cobranças da sua assinatura.
        </p>
      </div>

      <div className="mt-5">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-foreground/10 bg-muted px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma fatura emitida ainda.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="text-sm text-foreground">
                    {formatDate(invoice.created)}
                    {invoice.number && (
                      <div className="text-xs text-muted-foreground/60">{invoice.number}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[invoice.status]}`}
                    >
                      {STATUS_LABEL[invoice.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium text-foreground">
                    {formatMoney(invoice.total_cents, invoice.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-3">
                      {invoice.hosted_invoice_url && (
                        <a
                          href={invoice.hosted_invoice_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          title="Ver fatura"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Ver
                        </a>
                      )}
                      {invoice.invoice_pdf && (
                        <a
                          href={invoice.invoice_pdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          title="Baixar PDF"
                        >
                          <Download className="h-3.5 w-3.5" />
                          PDF
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
