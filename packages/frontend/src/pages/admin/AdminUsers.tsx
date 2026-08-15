import { useState, useEffect } from 'react';
import { useAdminUsers } from '@/hooks/useAdminUsers';
import { useDebounce } from '@/hooks/useDebounce';
import { UserFilters } from '@/components/admin/UserFilters';
import { UsersTable } from '@/components/admin/UsersTable';
import { CreateUserModal } from '@/components/admin/CreateUserModal';
import { EditUserModal } from '@/components/admin/EditUserModal';
import { DeleteUserDialog } from '@/components/admin/DeleteUserDialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AdminUser } from '@/types/admin';

export default function AdminUsers() {
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

  const {
    users,
    totalCount,
    loading,
    page,
    setPage,
    totalPages,
    search,
    setSearch,
    planFilter,
    setPlanFilter,
    roleFilter,
    setRoleFilter,
    facebookStatusFilter,
    setFacebookStatusFilter,
    createUser,
    updateUser,
    deleteUser,
    forceSync,
    isCreating,
    isUpdating,
    isDeleting,
  } = useAdminUsers();

  // Update search when debounced value changes
  useEffect(() => {
    setSearch(debouncedSearch);
  }, [debouncedSearch, setSearch]);

  const handleEdit = (user: AdminUser) => {
    setSelectedUser(user);
    setEditModalOpen(true);
  };

  const handleDelete = (user: AdminUser) => {
    setSelectedUser(user);
    setDeleteDialogOpen(true);
  };

  const handleToggleAdmin = async (user: AdminUser) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    await updateUser(user.user_id, { role: newRole });
  };

  const handleForceSync = async (user: AdminUser) => {
    await forceSync(user.user_id);
  };

  const handleConfirmDelete = async () => {
    if (selectedUser) {
      await deleteUser(selectedUser.user_id);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Usuários</h1>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Gerencie os usuários da plataforma ({totalCount} total)
        </p>
      </div>

      <UserFilters
        search={searchInput}
        onSearchChange={setSearchInput}
        planFilter={planFilter}
        onPlanFilterChange={setPlanFilter}
        roleFilter={roleFilter}
        onRoleFilterChange={setRoleFilter}
        facebookStatusFilter={facebookStatusFilter}
        onFacebookStatusFilterChange={setFacebookStatusFilter}
        onCreateClick={() => setCreateModalOpen(true)}
      />

      <UsersTable
        users={users}
        loading={loading}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggleAdmin={handleToggleAdmin}
        onForceSync={handleForceSync}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground/70">
            Mostrando {(page - 1) * 20 + 1}-{Math.min(page * 20, totalCount)} de {totalCount} usuários
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground/70">
              Página {page} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages}
            >
              Próximo
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      <CreateUserModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={createUser}
        isLoading={isCreating}
      />

      <EditUserModal
        user={selectedUser}
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSubmit={updateUser}
        isLoading={isUpdating}
      />

      <DeleteUserDialog
        user={selectedUser}
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />
    </div>
  );
}
