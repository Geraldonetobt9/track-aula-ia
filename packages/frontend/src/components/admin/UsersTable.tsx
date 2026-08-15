import { useNavigate } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MoreHorizontal, Eye, Pencil, Shield, ShieldOff, RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { AdminUser } from '@/types/admin';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface UsersTableProps {
  users: AdminUser[];
  loading: boolean;
  onEdit: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
  onToggleAdmin: (user: AdminUser) => void;
  onForceSync: (user: AdminUser) => void;
}

export function UsersTable({ users, loading, onEdit, onDelete, onToggleAdmin, onForceSync }: UsersTableProps) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Nenhum usuário encontrado
      </div>
    );
  }

  const getPlanBadge = (plan: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
      free: 'secondary',
      starter: 'secondary',
      pro: 'default',
      enterprise: 'outline',
      unlimited: 'destructive',
    };
    const labels: Record<string, string> = {
      free: 'Free',
      starter: 'Starter',
      pro: 'Pro',
      enterprise: 'Enterprise',
      unlimited: 'Unlimited',
    };
    return <Badge variant={variants[plan] || 'secondary'}>{labels[plan] || plan}</Badge>;
  };

  const getRoleBadge = (role: string) => {
    return (
      <Badge variant={role === 'admin' ? 'destructive' : 'secondary'}>
        {role}
      </Badge>
    );
  };

  const getFacebookStatus = (connected: boolean | null) => {
    if (connected === true) return <span className="text-primary">🟢 Conectado</span>;
    if (connected === false) return <span className="text-muted-foreground/60">🔴 Expirado</span>;
    return <span className="text-muted-foreground">⚫ Não configurado</span>;
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  return (
    <div className="rounded-lg glass-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuário</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Plano</TableHead>
            <TableHead>Facebook</TableHead>
            <TableHead className="text-right">Campanhas</TableHead>
            <TableHead className="text-right">Vendas</TableHead>
            <TableHead className="text-right">Faturamento</TableHead>
            <TableHead>Assinatura</TableHead>
            <TableHead>Último Login</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow
              key={user.id}
              className="cursor-pointer"
              onClick={() => navigate(`/admin/users/${user.user_id}`)}
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatar_url || undefined} />
                    <AvatarFallback>{user.name?.charAt(0) || 'U'}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{user.name}</div>
                    <div className="text-sm text-muted-foreground">{user.email}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>{getRoleBadge(user.role)}</TableCell>
              <TableCell>{getPlanBadge(user.plan)}</TableCell>
              <TableCell>{getFacebookStatus(user.facebook_connected)}</TableCell>
              <TableCell className="text-right">{user.campaigns_count}</TableCell>
              <TableCell className="text-right">{user.sales_count}</TableCell>
              <TableCell className="text-right">{formatCurrency(user.total_revenue)}</TableCell>
              <TableCell>
                {user.subscription_start || user.subscription_end ? (
                  <div className="text-xs space-y-0.5">
                    {user.subscription_start && <div className="text-muted-foreground">De: {new Date(user.subscription_start).toLocaleDateString('pt-BR')}</div>}
                    {user.subscription_end && (
                      <div className={new Date(user.subscription_end) < new Date() ? 'text-destructive' : 'text-muted-foreground'}>
                        Até: {new Date(user.subscription_end).toLocaleDateString('pt-BR')}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {user.last_sign_in_at
                  ? formatDistanceToNow(new Date(user.last_sign_in_at), { addSuffix: true, locale: ptBR })
                  : 'Nunca'}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/admin/users/${user.user_id}`); }}>
                      <Eye className="mr-2 h-4 w-4" />
                      Ver Detalhes
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(user); }}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onToggleAdmin(user); }}>
                      {user.role === 'admin' ? (
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
                    </DropdownMenuItem>
                    {user.facebook_connected && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onForceSync(user); }}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Forçar Sync
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onDelete(user); }}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Excluir Usuário
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
