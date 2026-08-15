import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, Plus } from 'lucide-react';

interface UserFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  planFilter: string | null;
  onPlanFilterChange: (value: string | null) => void;
  roleFilter: string | null;
  onRoleFilterChange: (value: string | null) => void;
  facebookStatusFilter: string | null;
  onFacebookStatusFilterChange: (value: string | null) => void;
  onCreateClick: () => void;
}

export function UserFilters({
  search,
  onSearchChange,
  planFilter,
  onPlanFilterChange,
  roleFilter,
  onRoleFilterChange,
  facebookStatusFilter,
  onFacebookStatusFilterChange,
  onCreateClick,
}: UserFiltersProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-col gap-4 md:flex-row">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={planFilter || 'all'} onValueChange={(v) => onPlanFilterChange(v === 'all' ? null : v)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Plano" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Planos</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
            <SelectItem value="unlimited">Unlimited</SelectItem>
          </SelectContent>
        </Select>
        <Select value={roleFilter || 'all'} onValueChange={(v) => onRoleFilterChange(v === 'all' ? null : v)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>
        <Select value={facebookStatusFilter || 'all'} onValueChange={(v) => onFacebookStatusFilterChange(v === 'all' ? null : v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status FB" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="connected">Conectado</SelectItem>
            <SelectItem value="expired">Expirado</SelectItem>
            <SelectItem value="not_configured">Não configurado</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={onCreateClick}>
        <Plus className="mr-2 h-4 w-4" />
        Criar Usuário
      </Button>
    </div>
  );
}
