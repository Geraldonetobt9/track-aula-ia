import { DashboardLayout } from '@/components/DashboardLayout';
import { FacebookConnectionForm } from '@/components/integrations/FacebookConnectionForm';
import { CheckoutIntegrationsSection } from '@/components/integrations/CheckoutIntegrationsSection';
import { MetaCapiCard } from '@/components/integrations/MetaCapiCard';
import { Separator } from '@/components/ui/separator';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { Card, CardContent } from '@/components/ui/card';
import { Layers } from 'lucide-react';

export default function Integrations() {
  const { activeWorkspaceId, workspaces } = useWorkspaceContext();
  const hasWorkspace = workspaces.length > 0 && !!activeWorkspaceId;

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-sentinel-in">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-foreground">Integrações</h1>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Conecte suas contas e configure webhooks
            {hasWorkspace && activeWorkspaceId && (
              <span className="ml-1">
                — Área: <span className="text-accent-readable font-medium">{workspaces.find(w => w.id === activeWorkspaceId)?.name}</span>
              </span>
            )}
          </p>
        </div>

        {!hasWorkspace ? (
          <Card className="border-dashed border-foreground/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Layers className="h-7 w-7 text-accent-readable" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Nenhuma área criada</h2>
              <p className="text-sm text-muted-foreground/70 max-w-sm">Crie uma área no Dashboard para começar a conectar integrações.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Facebook Ads - Developer App Form */}
            <FacebookConnectionForm />

            <Separator />

            {/* Checkout e rastreio: checkout, domínio, código, webhook e padrão de UTM */}
            <CheckoutIntegrationsSection />

            <Separator />

            <MetaCapiCard />

          </>
        )}
      </div>
    </DashboardLayout>
  );
}
