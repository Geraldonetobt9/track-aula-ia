import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditableRow } from '../EditableRow';
import { useUpdatePassword } from '@/hooks/useUpdatePassword';

export function PasswordRow() {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const mutation = useUpdatePassword();

  const mismatch = confirm.length > 0 && confirm !== pwd;
  const tooShort = pwd.length > 0 && pwd.length < 8;
  const canSave = pwd.length >= 8 && pwd === confirm;

  return (
    <EditableRow
      id="password"
      label="Senha"
      triggerLabel="Alterar senha"
      saveLabel="Salvar nova senha"
      saving={mutation.isPending}
      saveDisabled={!canSave}
      onCancel={() => { setPwd(''); setConfirm(''); }}
      onSave={async () => {
        await mutation.mutateAsync({ password: pwd });
        setPwd(''); setConfirm('');
      }}
      view={
        <div>
          <div className="text-[15px] font-medium text-muted-foreground">••••••••••••</div>
        </div>
      }
      editForm={() => (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-pwd">Nova senha</Label>
            <Input
              id="new-pwd"
              type="password"
              autoFocus
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
            {tooShort && <p className="text-xs text-destructive">Mínimo 8 caracteres</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pwd">Confirmar nova senha</Label>
            <Input
              id="confirm-pwd"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch && <p className="text-xs text-destructive">As senhas não coincidem</p>}
          </div>
        </div>
      )}
    />
  );
}
