import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { SaleWithDetails } from '@/hooks/useSales';
import { CHECKOUT_PLATFORMS, CheckoutPlatform } from '@/types/checkout';
import { BarChart3, Code } from 'lucide-react';
import { SaleJourney } from './SaleJourney';

interface SaleDetailsDrawerProps {
  sale: SaleWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatCurrency = (value: number | null | undefined) => {
  return (value ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
};

/**
 * Parses a piped UTM value (e.g., "name|ID") into name and ID parts
 */
function parsePipedValue(value: string | null): { name: string | null; id: string | null } {
  if (!value) return { name: null, id: null };
  
  const parts = value.split('|');
  if (parts.length < 2) return { name: value, id: null };
  
  // Find the numeric ID (last numeric part)
  let id: string | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const trimmed = parts[i].trim();
    if (/^\d+$/.test(trimmed)) {
      id = trimmed;
      break;
    }
  }
  
  // Name is everything except the ID
  const name = parts.filter(p => p.trim() !== id).join('|') || null;
  
  return { name, id };
}

export function SaleDetailsDrawer({ sale, open, onOpenChange }: SaleDetailsDrawerProps) {
  if (!sale) return null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-primary text-primary-foreground">Aprovada</Badge>;
      case 'pending':
        return <Badge className="bg-foreground/15 text-muted-foreground/80">Pendente</Badge>;
      case 'refunded':
        return <Badge className="bg-foreground/10">Reembolsada</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getPlatformBadge = (platform: string | null) => {
    if (!platform) return <Badge variant="secondary">Manual</Badge>;
    const config = CHECKOUT_PLATFORMS[platform as CheckoutPlatform];
    if (!config) return <Badge variant="secondary">{platform}</Badge>;
    return (
      <Badge className={config.color + ' text-foreground'}>
        {config.name}
      </Badge>
    );
  };

  const hasAttribution = sale.campaign_name && sale.campaign_name !== '-';
  
  // Check if this is a Guru sale (has piped UTM values)
  const isGuruFormat = sale.utm_content?.includes('|') || sale.utm_campaign?.includes('|');
  
  // Parse piped UTM values for Guru sales
  const parsedCampaign = parsePipedValue(sale.utm_medium);
  const parsedAdSet = parsePipedValue(sale.utm_campaign);
  const parsedAd = parsePipedValue(sale.utm_content);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Detalhes da Venda</SheetTitle>
          <SheetDescription>
            ID: {sale.external_id || sale.id.slice(0, 8)}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status and Platform */}
          <div className="flex items-center gap-3 flex-wrap">
            {getStatusBadge(sale.status || 'pending')}
            {getPlatformBadge(sale.checkout_platform)}
            <Badge variant="outline" className={sale.type === 'paid' ? 'border-foreground/20 text-muted-foreground/70' : 'border-primary/30 text-accent-readable'}>
              {sale.type === 'paid' ? 'Facebook Ads' : 'Orgânica'}
            </Badge>
          </div>

          <Separator />

          {/* Product */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Produto</h4>
            <div className="space-y-2">
              <p className="font-medium">{sale.product_name || 'Produto não identificado'}</p>
              <p className="text-2xl font-light text-accent-readable" style={{ letterSpacing: '-0.04em' }}>{formatCurrency(sale.amount)}</p>
              {sale.payment_method && (
                <p className="text-sm text-muted-foreground">
                  Pagamento: {sale.payment_method}
                </p>
              )}
            </div>
          </div>

          <Separator />

          {/* Customer */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Cliente</h4>
            <div className="space-y-1">
              <p className="font-medium">{sale.customer_name || 'Nome não informado'}</p>
              <p className="text-sm text-muted-foreground">{sale.customer_email || 'Email não informado'}</p>
              {sale.customer_phone && (
                <p className="text-sm text-muted-foreground">Tel: {sale.customer_phone}</p>
              )}
              {sale.customer_doc && (
                <p className="text-sm text-muted-foreground">Doc: {sale.customer_doc}</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Facebook Ads Tracking Section */}
          {hasAttribution && (
            <>
              <Card className="border-foreground/10 bg-foreground/[0.03]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground/70" />
                    Rastreamento Facebook Ads
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Hierarchy */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Campanha</span>
                      <span className="text-sm font-medium text-right max-w-[200px] truncate">
                        {sale.campaign_name}
                      </span>
                    </div>
                    {sale.ad_set_name && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Conjunto</span>
                        <span className="text-sm text-right max-w-[200px] truncate">
                          {sale.ad_set_name}
                        </span>
                      </div>
                    )}
                    {sale.ad_name && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Anúncio</span>
                        <span className="text-sm text-right max-w-[200px] truncate">
                          {sale.ad_name}
                        </span>
                      </div>
                    )}
                    {sale.ad_id && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Ad ID</span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {sale.ad_id}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Separator />
            </>
          )}

          {/* Attribution - Simple view if no match */}
          {!hasAttribution && (
            <>
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-muted-foreground">Atribuição</h4>
                <p className="text-sm text-muted-foreground">
                  Venda orgânica (sem campanha vinculada)
                </p>
                {sale.ad_id && (
                  <p className="text-xs text-muted-foreground">
                    Ad ID recebido: <span className="font-mono">{sale.ad_id}</span>
                    <br />
                    <span className="text-muted-foreground/60">Este ID ainda não foi vinculado a um anúncio sincronizado.</span>
                  </p>
                )}
              </div>

              <Separator />
            </>
          )}

          {/* Guru-specific Parsed UTM Display */}
          {isGuruFormat && (parsedCampaign.id || parsedAdSet.id || parsedAd.id) && (
            <>
              <Card className="border-foreground/10 bg-foreground/[0.03]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Code className="h-4 w-4 text-accent-readable" />
                    Rastreamento Guru Digital
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {parsedCampaign.name && (
                    <div>
                      <p className="text-xs text-muted-foreground">Campanha</p>
                      <p className="text-sm font-medium">{parsedCampaign.name}</p>
                      {parsedCampaign.id && (
                        <p className="text-xs font-mono text-muted-foreground">ID: {parsedCampaign.id}</p>
                      )}
                    </div>
                  )}
                  {parsedAdSet.name && (
                    <div>
                      <p className="text-xs text-muted-foreground">Conjunto</p>
                      <p className="text-sm font-medium">{parsedAdSet.name}</p>
                      {parsedAdSet.id && (
                        <p className="text-xs font-mono text-muted-foreground">ID: {parsedAdSet.id}</p>
                      )}
                    </div>
                  )}
                  {parsedAd.name && (
                    <div>
                      <p className="text-xs text-muted-foreground">Anúncio</p>
                      <p className="text-sm font-medium">{parsedAd.name}</p>
                      {parsedAd.id && (
                        <p className="text-xs font-mono text-muted-foreground">ID: {parsedAd.id}</p>
                      )}
                    </div>
                  )}
                  {sale.utm_term && (
                    <div>
                      <p className="text-xs text-muted-foreground">Posição</p>
                      <p className="text-sm">{sale.utm_term}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Separator />
            </>
          )}

          {/* UTM Parameters */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Parâmetros UTM (brutos)</h4>
            <div className="grid grid-cols-1 gap-2 text-sm">
              {[
                { label: 'Source', value: sale.utm_source },
                { label: 'Medium', value: sale.utm_medium },
                { label: 'Campaign', value: sale.utm_campaign },
                { label: 'Content', value: sale.utm_content },
                { label: 'Term', value: sale.utm_term },
              ].map((param) => (
                <div key={param.label} className="break-all">
                  <span className="text-muted-foreground">{param.label}: </span>
                  <span className={param.value ? 'font-medium font-mono text-xs' : 'text-muted-foreground'}>
                    {param.value || '-'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Jornada: só aparece quando a venda foi ligada a uma visita rastreada */}
          <SaleJourney saleId={sale.id} />

          {/* Timeline */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Timeline</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data da venda</span>
                <span>{format(new Date(sale.sold_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Registrado em</span>
                <span>{format(new Date(sale.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
