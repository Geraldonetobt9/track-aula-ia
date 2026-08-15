import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAdminUserDetail } from '@/hooks/useAdminUserDetail';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, Pencil, Shield, ShieldOff, Trash2, Loader2, Eye } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { EditUserModal } from '@/components/admin/EditUserModal';
import { DeleteUserDialog } from '@/components/admin/DeleteUserDialog';
import { AdminUser } from '@/types/admin';
import { UserDetailContent } from './user-detail/UserDetailContent';

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading, error, refetch } = useAdminUserDetail(id!);
  const { updateUser, deleteUser, isUpdating, isDeleting } = useAdminUsers();
  const { startImpersonation } = useImpersonation();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-destructive">{error || 'Usuário não encontrado'}</p>
        <Button variant="outline" onClick={() => navigate('/admin/users')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>
    );
  }

  const { profile, facebook, health } = user;

  const userForModals: AdminUser = {
    id: profile.user_id,
    user_id: profile.user_id,
    name: profile.name ?? '',
    email: profile.email ?? '',
    cpf: profile.cpf,
    plan: (profile.plan ?? 'starter') as AdminUser['plan'],
    avatar_url: profile.avatar_url,
    role: profile.role,
    facebook_connected: facebook.connections_count > 0
      ? facebook.connections.some((c) => c.is_valid)
      : null,
    campaigns_count: 0,
    sales_count: health.sales_count,
    total_revenue: health.total_revenue,
    last_sign_in_at: profile.last_sign_in_at,
    subscription_start: profile.subscription_start,
    subscription_end: profile.subscription_end,
  };

  const handleToggleAdmin = async () => {
    const newRole = profile.role === 'admin' ? 'user' : 'admin';
    await updateUser(profile.user_id, { role: newRole });
    refetch();
  };

  const handleDelete = async () => {
    await deleteUser(profile.user_id);
    navigate('/admin/users');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/users')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar className="h-16 w-16">
            <AvatarImage src={profile.avatar_url || undefined} />
            <AvatarFallback className="bg-foreground/10 text-muted-foreground/80 text-xl">
              {profile.name?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{profile.name}</h1>
            <p className="text-sm text-muted-foreground/70">{profile.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={profile.role === 'admin' ? 'destructive' : 'secondary'}>
                {profile.role}
              </Badge>
              <Badge variant="outline" className="capitalize">{profile.plan ?? '—'}</Badge>
              <span className="text-xs text-muted-foreground/60">
                Desde {format(new Date(profile.created_at), 'MMM yyyy', { locale: ptBR })}
              </span>
              <span className="text-xs text-muted-foreground/60">
                ·{' '}
                {profile.last_sign_in_at
                  ? `Último login ${formatDistanceToNow(new Date(profile.last_sign_in_at), { addSuffix: true, locale: ptBR })}`
                  : 'Nunca logou'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => {
              startImpersonation(profile.user_id, profile.name || profile.email || '');
              navigate('/dashboard');
            }}
          >
            <Eye className="mr-2 h-4 w-4" />
            Acessar Dashboard
          </Button>
          <Button variant="outline" onClick={() => setEditModalOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Button variant="outline" onClick={handleToggleAdmin}>
            {profile.role === 'admin' ? (
              <>
                <ShieldOff className="mr-2 h-4 w-4" />
                Remover Admin
              </>
            ) : (
              <>
                <Shield className="mr-2 h-4 w-4" />
                Tornar Admin
              </>
            )}
          </Button>
          <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Excluir
          </Button>
        </div>
      </div>

      <UserDetailContent user={user} />

      <EditUserModal
        user={userForModals}
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSubmit={async (userId, data) => {
          await updateUser(userId, data);
          refetch();
        }}
        isLoading={isUpdating}
      />

      <DeleteUserDialog
        user={userForModals}
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />
    </div>
  );
}
