import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileCard } from '@/components/profile/ProfileCard';
import { AppearanceCard } from '@/components/settings/AppearanceCard';
import { UsersCard } from '@/components/settings/UsersCard';
import { api } from '@/lib/api';

// Plano e Custos saíram: não há cobrança neste painel, e um endereço antigo
// como ?tab=plan agora cai em Perfil por não estar nesta lista.
const VALID_TABS = ['profile', 'appearance', 'users'] as const;
const DEFAULT_TAB = 'profile';

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  // A aba Usuarios so existe para quem administra. O servidor recusa as rotas
  // de qualquer forma; isto e so para nao mostrar uma aba que daria 403.
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    api
      .get<{ is_admin: boolean }>('/users/permissions')
      .then((r) => setIsAdmin(r.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  const currentTab = useMemo(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && VALID_TABS.includes(tabFromUrl as typeof VALID_TABS[number])) {
      return tabFromUrl;
    }
    return DEFAULT_TAB;
  }, [searchParams]);

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
            {isAdmin && <TabsTrigger value="users">Usuários</TabsTrigger>}
          </TabsList>

          <TabsContent value="profile">
            <ProfileCard />
          </TabsContent>

          <TabsContent value="appearance">
            <AppearanceCard />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="users">
              <UsersCard />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
