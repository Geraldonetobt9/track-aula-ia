import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2 } from 'lucide-react';
import { useCompanyCosts } from '@/hooks/useCompanyCosts';
import { PlanUsageCard } from '@/components/PlanUsageCard';
import { CurrentPlanCard } from '@/components/PlanTab/CurrentPlanCard';
import { PlanCards } from '@/components/PlanTab/PlanCards';
import { CheckoutReturnHandler } from '@/components/PlanTab/CheckoutReturnHandler';
import { PaymentMethodsCard } from '@/components/PlanTab/PaymentMethodsCard';
import { InvoicesCard } from '@/components/PlanTab/InvoicesCard';
import { ProfileCard } from '@/components/profile/ProfileCard';
import { AppearanceCard } from '@/components/settings/AppearanceCard';

const VALID_TABS = ['profile', 'appearance', 'plan', 'taxes'] as const;
const DEFAULT_TAB = 'profile';

export default function Settings() {
  const { costs, addCost, removeCost } = useCompanyCosts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [newCostName, setNewCostName] = useState('');
  const [newCostType, setNewCostType] = useState<'percentage' | 'fixed'>('percentage');
  const [newCostValue, setNewCostValue] = useState('');

  const currentTab = useMemo(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl as typeof VALID_TABS[number])) {
      return tabFromUrl;
    }
    return DEFAULT_TAB;
  }, [searchParams]);

  const handleAddCost = () => {
    if (!newCostName || !newCostValue) return;
    addCost(newCostName, newCostType, parseFloat(newCostValue));
    setNewCostName('');
    setNewCostValue('');
  };

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-sentinel-in">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Configurações</h1>
          <p className="text-sm text-muted-foreground/70 mt-1">Gerencie sua conta e preferências</p>
        </div>

        <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList>
            <TabsTrigger value="profile">Perfil</TabsTrigger>
            <TabsTrigger value="appearance">Aparência</TabsTrigger>
            <TabsTrigger value="plan">Plano</TabsTrigger>
            <TabsTrigger value="taxes">Custos</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileCard />
          </TabsContent>

          <TabsContent value="appearance">
            <AppearanceCard />
          </TabsContent>

          <TabsContent value="plan">
            <div className="space-y-6">
              <CheckoutReturnHandler />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
                <CurrentPlanCard />
                <PlanUsageCard />
              </div>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <PaymentMethodsCard />
                <InvoicesCard />
              </div>
              <PlanCards />
            </div>
          </TabsContent>

          <TabsContent value="taxes">
            <Card>
              <CardHeader>
                <CardTitle>Custos da Empresa</CardTitle>
                <CardDescription>
                  Configure custos que serão descontados do faturamento bruto
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  {costs.map((cost) => (
                    <div
                      key={cost.id}
                      className="flex items-center justify-between rounded-lg border border-foreground/5 p-4"
                    >
                      <div>
                        <p className="font-medium">{cost.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {cost.type === 'percentage'
                            ? `${cost.value}% do faturamento`
                            : `R$ ${cost.value.toFixed(2)} fixo`}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeCost(cost.id)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground/60" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="border-t border-foreground/5 pt-6">
                  <h4 className="mb-4 font-medium">Adicionar novo custo</h4>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input
                        placeholder="Ex: Taxa Gateway"
                        value={newCostName}
                        onChange={(e) => setNewCostName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={newCostType}
                        onChange={(e) => setNewCostType(e.target.value as 'percentage' | 'fixed')}
                      >
                        <option value="percentage">Percentual</option>
                        <option value="fixed">Valor Fixo</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Valor</Label>
                      <Input
                        type="number"
                        placeholder={newCostType === 'percentage' ? '10' : '50.00'}
                        value={newCostValue}
                        onChange={(e) => setNewCostValue(e.target.value)}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button onClick={handleAddCost} className="w-full">
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
