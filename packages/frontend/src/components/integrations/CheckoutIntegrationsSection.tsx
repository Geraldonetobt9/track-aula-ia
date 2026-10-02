import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { Plus, Clock, MoreHorizontal, Trash2 } from 'lucide-react';
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

  // Passo 4 do card de Checkout e rastreio: o webhook do checkout escolhido
  // no passo 1 abre direto; os já criados ficam listados.
  const renderAddButton = (platformId: string | null) => {
    const chosen = platformId && platformId in CHECKOUT_PLATFORMS ? (platformId as CheckoutPlatform) : null;
    if (!chosen) {
      return <p className="text-xs text-muted-foreground/70">Escolha o checkout no passo 1.</p>;
    }
    const exists = integrations.some((i) => i.platform === chosen);
    return exists ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => canAddIntegration && setShowPlatformSelector(true)}
        disabled={!canAddIntegration}
        title={integrationLimitTooltip}
      >
        <Plus className="mr-1.5 h-4 w-4" />
        Criar outro webhook
      </Button>
    ) : (
      <Button
        size="sm"
        onClick={() => canAddIntegration && handlePlatformSelected(chosen)}
        disabled={!canAddIntegration}
        title={integrationLimitTooltip}
      >
        <Plus className="mr-1.5 h-4 w-4" />
        Criar webhook da {CHECKOUT_PLATFORMS[chosen].name}
      </Button>
    );
  };

  const webhooks = (platformId: string | null) => loading ? (
    <div className="space-y-2">
      {[1, 2].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  ) : (
    <div className="space-y-2">
      {integrations.map((integration) => {
        const config = CHECKOUT_PLATFORMS[integration.platform];
        const logo = PLATFORM_LOGOS[integration.platform];
        const isConnected = integration.is_active;

        return (
          <div
            key={integration.id}
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            {logo ? (
              <img src={logo.src} alt={logo.alt} className="h-8 w-8 shrink-0 rounded-md object-cover" />
            ) : (
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${config.color} text-xs font-bold text-foreground`}>
                {config.name.substring(0, 2)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{integration.name}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{config.name}</span>
                {integration.last_webhook_at && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(integration.last_webhook_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </span>
                )}
              </p>
            </div>
            <span className="hidden items-center gap-1.5 text-xs sm:inline-flex">
              <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-muted-foreground/50'}`} aria-hidden />
              <span className={isConnected ? 'text-foreground' : 'text-muted-foreground'}>
                {isConnected ? 'Conectado' : 'Desativado'}
              </span>
            </span>
            <Button variant="ghost" size="sm" className="px-3" onClick={() => handleEdit(integration)}>
              Editar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Mais opções">
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
        );
      })}
      {renderAddButton(platformId)}
    </div>
  );

  return (
    <>
      <TrackingSnippetCard webhooks={webhooks} />

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
    </>
  );
}
