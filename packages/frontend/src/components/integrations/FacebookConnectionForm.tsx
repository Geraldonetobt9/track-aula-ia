import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Facebook, Loader2, AlertCircle, Trash2, User, ChevronDown, ChevronRight, CheckCheck, ExternalLink, Copy, Check, RefreshCw } from 'lucide-react';
import { useFacebookConnection, FacebookConnectionInfo } from '@/hooks/useFacebookConnection';
import { usePlanUsage } from '@/hooks/usePlanUsage';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface FacebookProfile {
  facebookUserId: string;
  profileName: string;
  connections: FacebookConnectionInfo[];
}

const FB_ACCOUNT_STATUS: Record<number, { label: string; className: string }> = {
  1: { label: 'Ativa', className: 'bg-success/20 text-success' },
  2: { label: 'Desabilitada', className: 'bg-destructive/20 text-destructive' },
  3: { label: 'Pendente', className: 'bg-warning/20 text-warning' },
  7: { label: 'Pendente', className: 'bg-warning/20 text-warning' },
  100: { label: 'Fechada', className: 'bg-foreground/10 text-muted-foreground' },
  101: { label: 'Fechada', className: 'bg-foreground/10 text-muted-foreground' },
};

function AdAccountRow({
  connection,
  onToggle,
  toggling,
  adAccountLimitReached,
}: {
  connection: FacebookConnectionInfo;
  onToggle: (id: string, active: boolean) => Promise<boolean>;
  toggling: string | null;
  adAccountLimitReached: boolean;
}) {
  const isToggling = toggling === connection.id;
  const status = connection.account_status != null
    ? FB_ACCOUNT_STATUS[connection.account_status]
    : null;

  const disableActivate = !connection.is_active && adAccountLimitReached;
  const toggleTitle = disableActivate
    ? 'Limite de contas de anúncio ativas atingido. Faça upgrade.'
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
      connection.is_active
        ? 'bg-primary/5 border-primary/20'
        : 'bg-foreground/[0.02] border-foreground/5'
    }`}>
      <Switch
        checked={connection.is_active}
        onCheckedChange={(checked) => onToggle(connection.id, checked)}
        disabled={isToggling || disableActivate}
        title={toggleTitle}
        className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-foreground/20"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {connection.account_name || 'Sem nome'}
          </span>
          {status && (
            <Badge className={`text-[9px] px-1.5 py-0 ${status.className}`}>
              {status.label}
            </Badge>
          )}
          {connection.is_active && (
            <Badge className="bg-primary text-primary-foreground text-[9px] px-1.5 py-0">
              Rastreando
            </Badge>
          )}
        </div>
      </div>
      {isToggling && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/50 shrink-0" />}
    </div>
  );
}

function ProfileSection({
  profile,
  onToggle,
  onActivateAll,
  onDeleteProfile,
  onRefreshProfile,
  toggling,
  activatingAll,
  deleting,
  refreshing,
  adAccountLimitReached,
}: {
  profile: FacebookProfile;
  onToggle: (id: string, active: boolean) => Promise<boolean>;
  onActivateAll: (connections: FacebookConnectionInfo[]) => void;
  onDeleteProfile: (facebookUserId: string) => void;
  onRefreshProfile: (facebookUserId: string) => void;
  toggling: string | null;
  activatingAll: string | null;
  deleting: string | null;
  refreshing: string | null;
  adAccountLimitReached: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDeleting = deleting === profile.facebookUserId;
  const isActivatingAll = activatingAll === profile.facebookUserId;
  const isRefreshing = refreshing === profile.facebookUserId;
  const accountCount = profile.connections.length;
  const activeCount = profile.connections.filter(c => c.is_active).length;
  const allActive = activeCount === accountCount;

  return (
    <div className="rounded-lg border border-foreground/10 overflow-hidden">
      {/* Profile header */}
      <div className="flex items-center justify-between px-4 py-3 bg-foreground/[0.03]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[#1877F2]/20 shrink-0">
            <User className="h-4 w-4 text-[#1877F2]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {profile.profileName}
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              {activeCount} de {accountCount} conta{accountCount !== 1 ? 's' : ''} ativa{activeCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            disabled={isRefreshing || isDeleting}
            onClick={() => onRefreshProfile(profile.facebookUserId)}
            title="Buscar novas contas de anúncios neste perfil"
            className="h-8 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Buscando...' : 'Atualizar'}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={isDeleting}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover perfil do Facebook?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso vai remover o perfil <strong>{profile.profileName}</strong> e
                  todas as <strong>{accountCount} conta{accountCount !== 1 ? 's' : ''} de anúncios</strong> associadas.
                  Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDeleteProfile(profile.facebookUserId)}
                  className="bg-destructive hover:bg-destructive/90 text-foreground"
                >
                  Remover perfil
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Collapsible toggle + Ativar Todas */}
      <div className="px-4 py-2 flex items-center justify-between border-t border-foreground/5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          Ver contas de anúncios
        </button>

        {!allActive && (
          <Button
            variant="ghost"
            size="sm"
            disabled={isActivatingAll}
            onClick={() => onActivateAll(profile.connections)}
            className="h-7 px-2.5 text-[11px] text-accent-readable hover:text-accent-readable hover:bg-primary/10"
          >
            {isActivatingAll ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <CheckCheck className="mr-1.5 h-3 w-3" />
            )}
            Ativar Todas
          </Button>
        )}
      </div>

      {/* Ad accounts list (collapsible) */}
      {expanded && (
        <div className="px-2 pb-2 space-y-1.5">
          {profile.connections.map(conn => (
            <AdAccountRow
              key={conn.id}
              connection={conn}
              onToggle={onToggle}
              toggling={toggling}
              adAccountLimitReached={adAccountLimitReached}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FacebookConnectionForm() {
  const {
    allConnections, loading,
    toggleActive, deleteProfile, refreshProfile,
  } = useFacebookConnection();
  const { workspaces, activeWorkspaceId } = useWorkspaceContext();
  const { user } = useAuth();
  const { isAtLimit } = usePlanUsage();
  const adAccountLimitReached = isAtLimit('adAccount');
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [activatingAll, setActivatingAll] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const hasConnections = allConnections.length > 0;
  const activeCount = allConnections.filter(c => c.is_active).length;

  // Group connections by Facebook profile
  const profiles = useMemo<FacebookProfile[]>(() => {
    const profileMap = new Map<string, FacebookProfile>();

    for (const conn of allConnections) {
      const key = conn.facebook_user_id || `unknown_${conn.id}`;
      const existing = profileMap.get(key);

      if (existing) {
        existing.connections.push(conn);
      } else {
        profileMap.set(key, {
          facebookUserId: conn.facebook_user_id || '',
          profileName: conn.facebook_user_name || conn.account_name || 'Perfil desconhecido',
          connections: [conn],
        });
      }
    }

    return Array.from(profileMap.values());
  }, [allConnections]);

  // Handle OAuth callback query params
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (connected === 'true') {
      toast({
        title: 'Facebook conectado com sucesso!',
        description: 'Selecione quais contas de anúncios você quer rastrear.',
      });
      searchParams.delete('connected');
      setSearchParams(searchParams, { replace: true });
    }

    if (error) {
      toast({
        title: 'Erro ao conectar',
        description: decodeURIComponent(error),
        variant: 'destructive',
      });
      searchParams.delete('error');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  const buildConnectUrl = async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) {
      toast({
        title: 'Erro',
        description: 'Você precisa estar autenticado.',
        variant: 'destructive',
      });
      return null;
    }
    return `${API_URL}/facebook/auth/connect?token=${encodeURIComponent(token)}`;
  };

  const handleOpenConnectModal = async () => {
    setConnecting(true);
    const url = await buildConnectUrl();
    setConnecting(false);
    if (!url) return;
    setConnectUrl(url);
    setCopied(false);
    setConnectModalOpen(true);
  };

  const handleContinueInBrowser = () => {
    if (connectUrl) {
      setConnectModalOpen(false);
      window.location.href = connectUrl;
    }
  };

  const handleCopyLink = async () => {
    if (!connectUrl) return;
    try {
      await navigator.clipboard.writeText(connectUrl);
      setCopied(true);
      toast({ title: 'Link copiado!' });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast({
        title: 'Erro ao copiar',
        description: 'Não foi possível copiar o link.',
        variant: 'destructive',
      });
    }
  };

  const handleToggle = async (connectionId: string, isActive: boolean): Promise<boolean> => {
    setToggling(connectionId);
    const result = await toggleActive(connectionId, isActive);
    setToggling(null);
    return result;
  };

  const handleActivateAll = async (connections: FacebookConnectionInfo[]) => {
    const inactive = connections.filter(c => !c.is_active);
    if (inactive.length === 0) return;

    const profileId = connections[0]?.facebook_user_id || '';
    setActivatingAll(profileId);

    await Promise.allSettled(
      inactive.map(c => toggleActive(c.id, true)),
    );

    setActivatingAll(null);
  };

  const handleDeleteProfile = async (facebookUserId: string) => {
    setDeleting(facebookUserId);
    await deleteProfile(facebookUserId);
    setDeleting(null);
  };

  const handleRefreshProfile = async (facebookUserId: string) => {
    setRefreshing(facebookUserId);
    await refreshProfile(facebookUserId);
    setRefreshing(null);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Facebook className="h-8 w-8 text-muted-foreground/60" />
            <div>
              <CardTitle className="text-lg">Facebook Ads</CardTitle>
              <CardDescription>
                {hasConnections
                  ? `${activeCount} conta${activeCount !== 1 ? 's' : ''} ativa${activeCount !== 1 ? 's' : ''} de ${allConnections.length} disponíve${allConnections.length !== 1 ? 'is' : 'l'}`
                  : 'Conecte sua conta do Facebook para rastrear anúncios'
                }
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Profiles with collapsible ad account lists */}
        {profiles.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground/60 font-medium uppercase tracking-wider">
              Perfis conectados
            </p>
            {profiles.map(profile => (
              <ProfileSection
                key={profile.facebookUserId || profile.connections[0]?.id}
                profile={profile}
                onToggle={handleToggle}
                onActivateAll={handleActivateAll}
                onDeleteProfile={handleDeleteProfile}
                onRefreshProfile={handleRefreshProfile}
                toggling={toggling}
                activatingAll={activatingAll}
                deleting={deleting}
                refreshing={refreshing}
                adAccountLimitReached={adAccountLimitReached}
              />
            ))}
          </div>
        )}

        {/* Connect button — opens method chooser modal */}
        <Button
          onClick={handleOpenConnectModal}
          disabled={connecting}
          className={`w-full font-medium py-5 ${
            hasConnections
              ? 'bg-foreground/10 hover:bg-foreground/15 text-foreground'
              : 'bg-[#1877F2] hover:bg-[#1877F2]/90 text-foreground'
          }`}
        >
          {connecting ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Facebook className="mr-2 h-5 w-5" />
          )}
          {connecting
            ? 'Preparando...'
            : hasConnections
              ? 'Conectar outro perfil'
              : 'Conectar com Facebook'
          }
        </Button>

        {/* Connection method chooser modal */}
        <Dialog open={connectModalOpen} onOpenChange={setConnectModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-center">Como deseja conectar?</DialogTitle>
              <DialogDescription className="text-center">
                Escolha onde autorizar o acesso ao Facebook
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              {/* Option 1: Continue in this browser */}
              <button
                type="button"
                onClick={handleContinueInBrowser}
                className="w-full group flex items-center gap-4 p-4 rounded-xl border border-foreground/10 bg-foreground/[0.03] hover:bg-[#1877F2]/10 hover:border-[#1877F2]/30 transition-all text-left"
              >
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-[#1877F2]/15 group-hover:bg-[#1877F2]/25 transition-colors shrink-0">
                  <ExternalLink className="h-5 w-5 text-[#1877F2]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Continuar neste navegador</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Conectar diretamente por aqui
                  </p>
                </div>
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-foreground/10" />
                <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">ou</span>
                <div className="flex-1 h-px bg-foreground/10" />
              </div>

              {/* Option 2: Copy link for multi-login browser */}
              <button
                type="button"
                onClick={handleCopyLink}
                className="w-full group flex items-center gap-4 p-4 rounded-xl border border-foreground/10 bg-foreground/[0.03] hover:bg-foreground/[0.06] hover:border-foreground/20 transition-all text-left"
              >
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-foreground/10 group-hover:bg-foreground/15 transition-colors shrink-0">
                  {copied ? (
                    <Check className="h-5 w-5 text-success" />
                  ) : (
                    <Copy className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {copied ? 'Link copiado!' : 'Copiar link de conexão'}
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Use em um navegador multi-login ou compartilhe
                  </p>
                </div>
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {hasConnections && activeCount === 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/5 border border-warning/10">
            <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-warning/80">
              Ative pelo menos uma conta para começar a rastrear suas campanhas e métricas.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
