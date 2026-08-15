import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditableRow } from '../EditableRow';
import { ConfirmEmailChangeDialog } from '../ConfirmEmailChangeDialog';

export function EmailRow({ email }: { email: string }) {
  const [draft, setDraft] = useState(email);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <EditableRow
        id="email"
        label="E-mail"
        view={
          <div>
            <div className="text-[15px] font-medium">{email}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Alterar o e-mail desconecta sua conta automaticamente.
            </div>
          </div>
        }
        saveLabel="Salvar"
        saveDisabled={!draft.trim() || draft.trim().toLowerCase() === email.toLowerCase()}
        onCancel={() => setDraft(email)}
        onSave={async () => {
          // Open the confirmation dialog instead of submitting directly.
          setConfirming(true);
        }}
        editForm={() => (
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Novo e-mail</Label>
            <Input
              id="profile-email"
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          </div>
        )}
      />
      <ConfirmEmailChangeDialog
        open={confirming}
        currentEmail={email}
        newEmail={draft.trim()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
