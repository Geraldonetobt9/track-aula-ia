import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Settings, Clock, MoreHorizontal, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CheckoutPlatform, CHECKOUT_PLATFORMS, CheckoutIntegration } from '@/types/checkout';
import { useCheckoutIntegrations } from '@/hooks/useCheckoutIntegrations';
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { CheckoutConfigModal } from './CheckoutConfigModal';
import { PlatformSelectorModal } from './PlatformSelectorModal';
import { TrackingSnippetCard } from './TrackingSnippetCard';
import { Skeleton } from '@/components/ui/skeleton';

const PLATFORM_LOGOS: Partial<Record<CheckoutPlatform, { src: string; alt: string }>> = {
  hotmart: { src: '/hotmart-logo.png', alt: 'Hotmart' },
  kiwify: { src: '/kiwify-logo.jpg', alt: 'Kiwify' },
  kirvano: { src: '/kirvano-logo.png', alt: 'Kirvano' },
  guru: { src: '/guru-logo.jpg', alt: 'Guru Digital' },
  perfectpay: { src: '/perfectpay-logo.png', alt: 'Perfect Pay' },
  ticto: { src: '/ticto-logo.png', alt: 'Ticto' },
  payt: { src: '/payt-logo.png', alt: 'PayT' },
  cakto: { src: '/cakto-logo.jpg', alt: 'Cakto' },
  hubla: { src: '/hubla-logo.svg', alt: 'Hubla' },
  cartpanda: { src: '/cartpanda-logo.avif', alt: 'CartPanda' },
  ggcheckout: { src: '/ggcheckout-logo.png', alt: 'GG Checkout' },
  lastlink: { src: '/lastlink-logo.ico', alt: 'LastLink' },
  eduzz: { src: '/eduzz-logo.png', alt: 'Eduzz' },
  mundpay: { src: '/mundpay-logo.svg', alt: 'Mundpay' },
  monetizze: { src: '/monetizze-logo.svg', alt: 'Monetizze' },
  greenn: { src: '/greenn-logo.webp', alt: 'Greenn' },
};

export function CheckoutIntegrationsSection() {
  const [showPlatformSelector, setShowPlatformSelector] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<CheckoutIntegration | null>(null);
  const [selectedPlatformForNew, setSelectedPlatformForNew] = useState<CheckoutPlatform | null>(null);
  const [integrationToDelete, setIntegrationToDelete] = useState<CheckoutIntegration | null>(null);

  const {
    integrations,
    loading,
    saving,
    saveIntegration,
    toggleIntegration,
    deleteIntegration,
    generateWebhookUrl,
  } = useCheckoutIntegrations();

  const { canCreate: canCreateResource, isAtLimit, usage } = usePlanUsage();
  const canAddIntegration = canCreateResource('integration');
  const integrationLimitTooltip = isAtLimit('integration')
    ? `Limite de integrações atingido (${usage?.integrations.used}/${usage?.integrations.limit}). Faça upgrade.`
    : undefined;

  const handleEdit = (integration: CheckoutIntegration) => {
    setSelectedIntegration(integration);
    setSelectedPlatformForNew(null);
  };

  const handlePlatformSelected = (platform: CheckoutPlatform) => {
    setSelectedPlatformForNew(platform);
    setSelectedIntegration(null);
  };

  const handleCloseConfig = () => {
    setSelectedIntegration(null);
    setSelectedPlatformForNew(null);
  };

  const isConfigOpen = !!(selectedIntegration || selectedPlatformForNew);
  const configPlatform = selectedIntegration?.platform || selectedPlatformForNew;
  const configIntegration = selectedIntegration || undefined;

  const handleSave = async (params: { name: string; token: string; useCommissionValue: boolean }) => {
    if (!configPlatform) return false;
    return await saveIntegration({
      id: selectedIntegration?.id,
      platform: configPlatform,
      name: params.name,
      token: params.token,
      useCommissionValue: params.useCommissionValue,
    });
  };

  const handleToggle = async (active: boolean) => {
    if (selectedIntegration) {
      await toggleIntegration(selectedIntegration.id, active);
    }
  };

  const handleDeleteFromModal = async () => {
    if (selectedIntegration) {
      await deleteIntegration(selectedIntegration.id);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Checkout e rastreio</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Checkout e rastreio</h2>
          <p className="text-sm text-muted-foreground">
            O webhook que recebe as vendas e o código que liga cada venda à visita
          </p>
        </div>
        <Button
          onClick={() => canAddIntegration && setShowPlatformSelector(true)}
          disabled={!canAddIntegration}
          title={integrationLimitTooltip}
        >
          <Plus className="mr-2 h-4 w-4" />
          Adicionar integração
        </Button>
      </div>

      {integrations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Settings className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground mb-4">Nenhuma integração configurada</p>
            <Button
              onClick={() => canAddIntegration && setShowPlatformSelector(true)}
              disabled={!canAddIntegration}
              title={integrationLimitTooltip}
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar primeira integração
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {integrations.map((integration) => {
            const config = CHECKOUT_PLATFORMS[integration.platform];
            const logo = PLATFORM_LOGOS[integration.platform];
            const isConnected = integration.is_active;

            return (
              <Card key={integration.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {logo ? (
                        <img src={logo.src} alt={logo.alt} className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${config.color} text-sm font-bold text-foreground`}>
                          {config.name.substring(0, 2)}
                        </div>
                      )}
                      <div>
                        <CardTitle className="text-base">{integration.name}</CardTitle>
                        <p className="text-xs text-muted-foreground">{config.name}</p>
                      </div>
                    </div>
                    <Badge
                      variant={isConnected ? 'default' : 'secondary'}
                      className={isConnected ? 'bg-primary text-primary-foreground' : ''}
                    >
                      {isConnected ? 'Conectado' : 'Desativado'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {integration.last_webhook_at && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        Último webhook:{' '}
                        {format(new Date(integration.last_webhook_at), "dd/MM 'às' HH:mm", {
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleEdit(integration)}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Editar
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setIntegrationToDelete(integration)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Snippet da página de vendas: fecha o elo entre o anúncio e o checkout. */}
      <TrackingSnippetCard checkoutPlatforms={integrations.map((i) => i.platform)} />

      <AlertDialog open={!!integrationToDelete} onOpenChange={(open) => !open && setIntegrationToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover integração</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover a integração "{integrationToDelete?.name}"? As vendas já registradas não serão afetadas, mas novos webhooks desta integração não serão mais processados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (integrationToDelete) {
                  deleteIntegration(integrationToDelete.id);
                  setIntegrationToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PlatformSelectorModal
        open={showPlatformSelector}
        onOpenChange={setShowPlatformSelector}
        onSelectPlatform={handlePlatformSelected}
      />

      {configPlatform && (
        <CheckoutConfigModal
          open={isConfigOpen}
          onOpenChange={(open) => !open && handleCloseConfig()}
          platform={configPlatform}
          integration={configIntegration}
          webhookUrl={generateWebhookUrl(configPlatform)}
          onSave={handleSave}
          onToggle={handleToggle}
          onDelete={handleDeleteFromModal}
          saving={saving}
        />
      )}
    </div>
  );
}
