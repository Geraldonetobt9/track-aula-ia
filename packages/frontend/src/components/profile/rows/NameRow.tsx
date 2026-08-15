import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditableRow } from '../EditableRow';
import { useUpdateProfile } from '@/hooks/useUpdateProfile';

export function NameRow({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  const mutation = useUpdateProfile();

  return (
    <EditableRow
      id="name"
      label="Nome completo"
      view={<div className="text-[15px] font-medium">{name || '—'}</div>}
      saving={mutation.isPending}
      saveDisabled={!draft.trim()}
      onCancel={() => setDraft(name)}
      onSave={async () => { await mutation.mutateAsync({ name: draft.trim() }); }}
      editForm={() => (
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Nome completo</Label>
          <Input
            id="profile-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
        </div>
      )}
    />
  );
}
