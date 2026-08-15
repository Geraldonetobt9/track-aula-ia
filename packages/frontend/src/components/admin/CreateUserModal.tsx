import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { CreateUserData } from '@/types/admin';

interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateUserData) => Promise<void>;
  isLoading: boolean;
}

function formatCPF(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function validateCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  if (parseInt(digits[9]) !== check) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  check = 11 - (sum % 11);
  if (check >= 10) check = 0;
  return parseInt(digits[10]) === check;
}

export function CreateUserModal({ open, onClose, onSubmit, isLoading }: CreateUserModalProps) {
  const [formData, setFormData] = useState<CreateUserData>({
    name: '',
    email: '',
    password: '',
    cpf: '',
    plan: 'free',
    role: 'user',
    subscription_start: '',
    subscription_end: '',
  });
  const [cpfError, setCpfError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.cpf) {
      if (!validateCPF(formData.cpf)) {
        setCpfError('CPF inválido');
        return;
      }
    }
    setCpfError('');
    const submitData = {
      ...formData,
      cpf: formData.cpf ? formData.cpf.replace(/\D/g, '') : undefined,
      subscription_start: formData.subscription_start || undefined,
      subscription_end: formData.subscription_end || undefined,
    };
    await onSubmit(submitData);
    setFormData({ name: '', email: '', password: '', cpf: '', plan: 'free', role: 'user', subscription_start: '', subscription_end: '' });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar Novo Usuário</DialogTitle>
          <DialogDescription>
            Preencha os dados para criar um novo usuário no sistema.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nome completo"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@exemplo.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpf">CPF</Label>
              <Input
                id="cpf"
                value={formData.cpf ? formatCPF(formData.cpf) : ''}
                onChange={(e) => {
                  setCpfError('');
                  setFormData({ ...formData, cpf: e.target.value.replace(/\D/g, '') });
                }}
                placeholder="000.000.000-00"
                maxLength={14}
              />
              {cpfError && <p className="text-xs text-destructive">{cpfError}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Plano</Label>
                <Select value={formData.plan} onValueChange={(v) => setFormData({ ...formData, plan: v as any })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="free">Free</SelectItem>
                     <SelectItem value="starter">Starter</SelectItem>
                     <SelectItem value="pro">Pro</SelectItem>
                     <SelectItem value="enterprise">Enterprise</SelectItem>
                     <SelectItem value="unlimited">Unlimited</SelectItem>
                   </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v as any })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="subscription_start">Início da Assinatura</Label>
                <Input
                  id="subscription_start"
                  type="date"
                  value={formData.subscription_start || ''}
                  onChange={(e) => setFormData({ ...formData, subscription_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subscription_end">Fim da Assinatura</Label>
                <Input
                  id="subscription_end"
                  type="date"
                  value={formData.subscription_end || ''}
                  onChange={(e) => setFormData({ ...formData, subscription_end: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Usuário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
