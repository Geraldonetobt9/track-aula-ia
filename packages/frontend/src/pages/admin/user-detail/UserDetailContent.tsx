import { useCallback, useMemo, useState } from 'react';
import { Link2, Plug, Sparkles, CreditCard, ChevronRight, FolderTree, Archive } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AdminUserDetail } from '@/types/admin';
import {
  AutomationRuleSummary,
  CheckoutCredentialsBlock,
  FactRow,
  PLAN_LABEL,
  PlanSlug,
  SUBSCRIPTION_STATUS_HUMAN,
  SectionTitle,
  ToneBadge,
  UsageBar,
  buildUsageItems,
  fbAccountStatusHuman,
  formatCurrency,
  formatNumber,
  formatRelative,
  formatShortDate,
  formatTaxId,
  platformLabel,
  platformLogo,
} from './shared';

const ALL_AREAS = 'all';
const NO_AREA = 'none';

interface UserDetailContentProps {
  user: AdminUserDetail;
}

export function UserDetailContent({ user }: UserDetailContentProps) {
  // Os campos `workspace_id` / `workspaces` no payload do RPC mantêm o nome
  // antigo (contrato com o backend). Na UI, exibimos como "Área".
  const areas = user.workspaces ?? [];
  const usage = useMemo(() => buildUsageItems(user), [user]);

  const planLabel = PLAN_LABEL[(user.profile.plan ?? 'free') as PlanSlug];
  const sub = user.subscription;

  const [selectedArea, setSelectedArea] = useState<string>(ALL_AREAS);
  const [onlyActiveFb, setOnlyActiveFb] = useState(true);
  const [onlyActiveCheckouts, setOnlyActiveCheckouts] = useState(true);

  const hasOrphans =
    user.facebook.connections.some((c) => !c.workspace_id) ||
    user.checkouts.some((c) => !c.workspace_id);

  const matchesArea = useCallback(
    (areaId: string | null) => {
      if (selectedArea === ALL_AREAS) return true;
      if (selectedArea === NO_AREA) return areaId == null;
      return areaId === selectedArea;
    },
    [selectedArea],
  );

  const filteredConnections = useMemo(
    () =>
      [...user.facebook.connections]
        .filter((c) => matchesArea(c.workspace_id))
        .filter((c) => !onlyActiveFb || c.is_active)
        .sort((a, b) => (a.is_active === b.is_active ? 0 : a.is_active ? -1 : 1)),
    [user.facebook.connections, matchesArea, onlyActiveFb],
  );

  const filteredCheckouts = useMemo(
    () =>
      user.checkouts
        .filter((c) => matchesArea(c.workspace_id))
        .filter((c) => !onlyActiveCheckouts || c.is_active),
    [user.checkouts, matchesArea, onlyActiveCheckouts],
  );

  const filteredRules = useMemo(
    () => user.automation_rules.filter((r) => matchesArea(r.workspace_id)),
    [user.automation_rules, matchesArea],
  );

  const areaBadge =
    selectedArea === ALL_AREAS
      ? null
      : selectedArea === NO_AREA
        ? 'Sem área'
        : areas.find((a) => a.id === selectedArea)?.name ?? 'Área removida';

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Sidebar */}
      <aside className="lg:sticky lg:top-6 lg:self-start space-y-4">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-col items-center text-center">
              <Avatar className="h-20 w-20">
                <AvatarImage src={user.profile.avatar_url || undefined} />
                <AvatarFallback className="bg-foreground/10 text-muted-foreground/80 text-2xl">
                  {user.profile.name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
              <h2 className="mt-3 text-base font-semibold text-foreground">{user.profile.name}</h2>
              <p className="text-xs text-muted-foreground/70">{user.profile.email}</p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                <ToneBadge tone={user.profile.role === 'admin' ? 'danger' : 'info'}>
                  {user.profile.role === 'admin' ? 'Administrador' : 'Usuário'}
                </ToneBadge>
                <ToneBadge tone="neutral">{planLabel}</ToneBadge>
              </div>
            </div>

            <Separator className="bg-foreground/5" />

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground/70">Cadastro</span>
                <span className="text-foreground">{formatShortDate(user.profile.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/70">Último login</span>
                <span className="text-foreground">
                  {formatRelative(user.profile.last_sign_in_at) ?? 'nunca'}
                </span>
              </div>
              {(() => {
                const taxId = formatTaxId(user.profile.cpf ?? user.profile.cnpj);
                return (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground/70">{taxId?.label ?? 'CPF / CNPJ'}</span>
                    <span className="font-mono text-foreground">{taxId?.formatted ?? '—'}</span>
                  </div>
                );
              })()}
              <div className="flex justify-between">
                <span className="text-muted-foreground/70">Áreas</span>
                <span className="text-foreground">{areas.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick anchors */}
        <Card>
          <CardContent className="py-3">
            <p className="px-1 pb-2 text-[11px] uppercase tracking-wide text-muted-foreground/60">Ir para</p>
            <nav className="flex flex-col">
              <SidebarLink href="#plano" icon={CreditCard} label="Plano e uso" />
              <SidebarLink
                href="#facebook"
                icon={Link2}
                label="Facebook Ads"
                badge={`${filteredConnections.length}`}
              />
              <SidebarLink
                href="#checkouts"
                icon={Plug}
                label="Checkouts"
                badge={`${filteredCheckouts.length}`}
              />
              <SidebarLink
                href="#regras"
                icon={Sparkles}
                label="Automações"
                badge={`${filteredRules.length}`}
              />
            </nav>
          </CardContent>
        </Card>
      </aside>

      {/* Main */}
      <div className="space-y-6 min-w-0">
        {/* Filtro por área */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-foreground/5 p-2">
                  <FolderTree className="h-4 w-4 text-accent-readable" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Filtrar por área</p>
                  <p className="text-xs text-muted-foreground/70">
                    {selectedArea === ALL_AREAS
                      ? 'Mostrando dados de todas as áreas deste usuário'
                      : `Filtrando por: ${areaBadge}`}
                  </p>
                </div>
              </div>
              <div className="min-w-[240px]">
                <Select value={selectedArea} onValueChange={setSelectedArea}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma área" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_AREAS}>
                      Todas as áreas
                      {areas.length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({areas.length})
                        </span>
                      )}
                    </SelectItem>
                    {areas.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="flex items-center gap-2">
                          {a.name}
                          {a.archived_at && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Archive className="h-3 w-3" />
                              arquivada
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            ({countItemsForArea(user, a.id)})
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                    {hasOrphans && (
                      <SelectItem value={NO_AREA}>
                        Sem área
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({countItemsForArea(user, null)})
                        </span>
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Chips de resumo por área */}
            {areas.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <AreaChip
                  active={selectedArea === ALL_AREAS}
                  label="Todas"
                  count={
                    user.facebook.connections.length +
                    user.checkouts.length +
                    user.automation_rules.length
                  }
                  onClick={() => setSelectedArea(ALL_AREAS)}
                />
                {areas.map((a) => (
                  <AreaChip
                    key={a.id}
                    active={selectedArea === a.id}
                    label={a.name}
                    archived={!!a.archived_at}
                    count={countItemsForArea(user, a.id)}
                    onClick={() => setSelectedArea(a.id)}
                  />
                ))}
                {hasOrphans && (
                  <AreaChip
                    active={selectedArea === NO_AREA}
                    label="Sem área"
                    count={countItemsForArea(user, null)}
                    onClick={() => setSelectedArea(NO_AREA)}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Plano (sempre per-user, não filtrado) */}
        <Card id="plano" className="scroll-mt-6">
          <CardHeader className="pb-3">
            <SectionTitle
              icon={CreditCard}
              title="Plano e uso"
              description="Limites e consumo do plano. Não dependem da área selecionada."
            />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-semibold text-foreground">{planLabel}</span>
              {sub ? (
                <ToneBadge tone={SUBSCRIPTION_STATUS_HUMAN[sub.status].tone}>
                  Assinatura {SUBSCRIPTION_STATUS_HUMAN[sub.status].label.toLowerCase()}
                </ToneBadge>
              ) : (
                <ToneBadge tone="neutral">Sem assinatura no Stripe</ToneBadge>
              )}
              {sub?.cancel_at_period_end && (
                <ToneBadge tone="danger">Cancela em {formatShortDate(sub.current_period_end)}</ToneBadge>
              )}
              {sub?.scheduled_plan && sub.scheduled_changes_at && (
                <ToneBadge tone="info">
                  Muda para {sub.scheduled_plan} em {formatShortDate(sub.scheduled_changes_at)}
                </ToneBadge>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {usage.map((item) => (
                <UsageBar key={item.key} item={item} />
              ))}
            </div>

            <Separator className="bg-foreground/5" />

            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <FactRow
                label="Faturamento"
                value={<span className="text-foreground font-medium">{formatCurrency(user.health.total_revenue)}</span>}
                hint={`${formatNumber(user.health.sales_count)} vendas aprovadas`}
              />
              {sub && (
                <>
                  <FactRow
                    label="Período atual"
                    value={`${formatShortDate(sub.current_period_start)} → ${formatShortDate(sub.current_period_end)}`}
                  />
                  <FactRow label="Cliente Stripe" mono value={sub.stripe_customer_id ?? '—'} />
                  <FactRow label="Assinatura Stripe" mono value={sub.stripe_subscription_id ?? '—'} />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Facebook (filtrado) */}
        <Card id="facebook" className="scroll-mt-6">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <SectionTitle
                icon={Link2}
                title="Facebook Ads"
                description={
                  areaBadge
                    ? `Contas de anúncio em ${areaBadge}`
                    : 'Sincronização e contas de anúncio conectadas'
                }
              />
              <div className="flex items-center gap-2">
                <Switch
                  id="fb-only-active"
                  checked={onlyActiveFb}
                  onCheckedChange={setOnlyActiveFb}
                />
                <Label htmlFor="fb-only-active" className="text-xs text-muted-foreground cursor-pointer">
                  Só ativas
                </Label>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Sync info — não é por área, mostra só quando "Todas" para evitar confusão */}
            {selectedArea === ALL_AREAS && user.facebook.sync && (
              <div className="rounded-lg border border-foreground/5 bg-foreground/[0.02] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground/70">Sincronização:</span>
                  <ToneBadge tone={user.facebook.sync.is_active ? 'success' : 'neutral'}>
                    {user.facebook.sync.is_active ? 'Ativa' : 'Pausada'}
                  </ToneBadge>
                  <span className="text-xs text-muted-foreground/70">
                    a cada {user.facebook.sync.interval_minutes} min
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Última sincronização{' '}
                  {user.facebook.sync.last_sync_at ? formatRelative(user.facebook.sync.last_sync_at) : 'nunca executada'}
                  {user.facebook.sync.last_sync_status === 'success' && ' — concluída sem erro'}
                  {user.facebook.sync.last_sync_status === 'error' && ' — terminou com erro'}
                  {user.facebook.sync.last_sync_status === 'pending' && ' — em andamento'}
                </p>
                {user.facebook.sync.last_sync_error && (
                  <p className="mt-1 text-xs text-destructive">Erro: {user.facebook.sync.last_sync_error}</p>
                )}
              </div>
            )}

            {filteredConnections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {emptyFbMessage(selectedArea === ALL_AREAS, onlyActiveFb, areaBadge)}
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {filteredConnections.map((c) => {
                  const fbStatus = fbAccountStatusHuman(c.account_status);
                  const areaName = c.workspace_id
                    ? areas.find((a) => a.id === c.workspace_id)?.name
                    : null;
                  return (
                    <div key={c.id} className="rounded-lg border border-foreground/5 bg-foreground/[0.02] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {c.account_name || 'Conta sem nome'}
                          </p>
                          <p className="text-[11px] font-mono text-muted-foreground/70 truncate">{c.ad_account_id}</p>
                        </div>
                        <ToneBadge tone={c.is_active ? 'success' : 'neutral'}>
                          {c.is_active ? 'Ativa' : 'Inativa'}
                        </ToneBadge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <ToneBadge tone={fbStatus.tone}>{fbStatus.label}</ToneBadge>
                        <ToneBadge tone={c.is_valid ? 'success' : 'danger'}>
                          {c.is_valid ? 'Token válido' : 'Token inválido'}
                        </ToneBadge>
                        {selectedArea === ALL_AREAS && (
                          <ToneBadge tone="neutral">
                            <FolderTree className="h-3 w-3" />
                            {areaName ?? 'sem área'}
                          </ToneBadge>
                        )}
                      </div>
                      <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground/80">
                        <p>
                          <span className="text-muted-foreground/60">Usuário FB:</span>{' '}
                          {c.facebook_user_name || c.facebook_user_id || '—'}
                        </p>
                        <p>
                          <span className="text-muted-foreground/60">Validada:</span>{' '}
                          {formatRelative(c.last_validated_at) ?? '—'}
                        </p>
                        <p>
                          <span className="text-muted-foreground/60">Token expira:</span>{' '}
                          {formatShortDate(c.token_expires_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Checkouts (filtrado) */}
        <Card id="checkouts" className="scroll-mt-6">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <SectionTitle
                icon={Plug}
                title="Checkouts"
                description={
                  areaBadge ? `Integrações em ${areaBadge}` : 'Integrações de checkout e suas credenciais'
                }
              />
              <div className="flex items-center gap-2">
                <Switch
                  id="ck-only-active"
                  checked={onlyActiveCheckouts}
                  onCheckedChange={setOnlyActiveCheckouts}
                />
                <Label htmlFor="ck-only-active" className="text-xs text-muted-foreground cursor-pointer">
                  Só ativos
                </Label>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredCheckouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {emptyCheckoutsMessage(selectedArea === ALL_AREAS, onlyActiveCheckouts, areaBadge)}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredCheckouts.map((c) => {
                  const areaName = c.workspace_id
                    ? areas.find((a) => a.id === c.workspace_id)?.name
                    : null;
                  const logo = platformLogo(c.platform);
                  return (
                    <div
                      key={c.id}
                      className="rounded-lg border border-foreground/5 bg-foreground/[0.02] p-3 flex flex-col gap-3"
                    >
                      <div className="flex items-start gap-3">
                        {logo ? (
                          <img
                            src={logo.src}
                            alt={logo.alt}
                            className="h-9 w-9 rounded-md object-cover bg-foreground/5 flex-shrink-0"
                          />
                        ) : (
                          <div className="h-9 w-9 rounded-md bg-foreground/5 flex-shrink-0 flex items-center justify-center">
                            <Plug className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {platformLabel(c.platform)}
                          </p>
                          <p className="text-xs text-muted-foreground/80 truncate">{c.name}</p>
                        </div>
                        <ToneBadge tone={c.is_active ? 'success' : 'neutral'}>
                          {c.is_active ? 'Ativa' : 'Inativa'}
                        </ToneBadge>
                      </div>

                      <div className="flex flex-wrap gap-1.5 text-[11px]">
                        {selectedArea === ALL_AREAS && (
                          <ToneBadge tone="neutral">
                            <FolderTree className="h-3 w-3" />
                            {areaName ?? 'sem área'}
                          </ToneBadge>
                        )}
                        {c.use_commission_value && (
                          <ToneBadge tone="info">usa valor de comissão</ToneBadge>
                        )}
                      </div>

                      <p className="text-[11px] text-muted-foreground/70">
                        {c.last_webhook_at
                          ? `Último webhook ${formatRelative(c.last_webhook_at)}`
                          : 'Nenhum webhook recebido ainda'}
                      </p>

                      <CheckoutCredentialsBlock userId={user.profile.user_id} checkout={c} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Regras (filtrado) */}
        <Card id="regras" className="scroll-mt-6">
          <CardHeader className="pb-3">
            <SectionTitle
              icon={Sparkles}
              title="Regras de automação"
              description={
                areaBadge
                  ? `Regras em ${areaBadge}`
                  : filteredRules.length === 0
                    ? 'Nenhuma regra criada'
                    : `${filteredRules.length} regra${filteredRules.length === 1 ? '' : 's'} no total`
              }
            />
          </CardHeader>
          {filteredRules.length === 0 ? (
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {selectedArea === ALL_AREAS
                  ? 'Nenhuma regra criada.'
                  : `Nenhuma regra em ${areaBadge}.`}
              </p>
            </CardContent>
          ) : (
            <CardContent className="space-y-3">
              {filteredRules.map((rule) => (
                <div key={rule.id} className="rounded-lg border border-foreground/5 bg-foreground/[0.02] p-3">
                  <AutomationRuleSummary rule={rule} />
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

function SidebarLink({
  href,
  icon: Icon,
  label,
  badge,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
    >
      <span className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="flex items-center gap-1">
        {badge && <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px]">{badge}</span>}
        <ChevronRight className="h-3 w-3 opacity-50" />
      </span>
    </a>
  );
}

function AreaChip({
  active,
  label,
  count,
  archived,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  archived?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
        active
          ? 'border-accent-readable bg-primary/10 text-accent-readable'
          : 'border-foreground/10 bg-foreground/[0.02] text-muted-foreground hover:border-foreground/20 hover:text-foreground'
      }`}
    >
      {archived && <Archive className="h-3 w-3 opacity-70" />}
      <span>{label}</span>
      <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-primary/20' : 'bg-foreground/5'}`}>
        {count}
      </span>
    </button>
  );
}

function emptyFbMessage(allAreas: boolean, onlyActive: boolean, areaBadge: string | null): string {
  if (allAreas) {
    return onlyActive
      ? 'Nenhuma conta de anúncio ativa.'
      : 'Nenhuma conta de anúncio conectada.';
  }
  return onlyActive
    ? `Nenhuma conta de anúncio ativa em ${areaBadge}.`
    : `Nenhuma conta de anúncio em ${areaBadge}.`;
}

function emptyCheckoutsMessage(
  allAreas: boolean,
  onlyActive: boolean,
  areaBadge: string | null,
): string {
  if (allAreas) {
    return onlyActive ? 'Nenhuma integração ativa.' : 'Nenhuma integração configurada.';
  }
  return onlyActive
    ? `Nenhuma integração ativa em ${areaBadge}.`
    : `Nenhuma integração em ${areaBadge}.`;
}

function countItemsForArea(user: AdminUserDetail, areaId: string | null): number {
  const inArea = (id: string | null) => (areaId === null ? id == null : id === areaId);
  return (
    user.facebook.connections.filter((c) => inArea(c.workspace_id)).length +
    user.checkouts.filter((c) => inArea(c.workspace_id)).length +
    user.automation_rules.filter((r) => inArea(r.workspace_id)).length
  );
}
