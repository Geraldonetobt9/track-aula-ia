import { ReactNode, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEditableRowControl } from './EditableRowGroup';

interface EditableRowProps {
  id?: string;                        // when set, joins an EditableRowGroup for single-edit-at-a-time
  label: string;
  view: ReactNode;
  triggerLabel?: string;             // default "Editar"
  editForm: (helpers: { close: () => void }) => ReactNode;
  onSave: () => Promise<void> | void;
  onCancel?: () => void;
  saving?: boolean;
  saveLabel?: string;                 // default "Salvar"
  saveDisabled?: boolean;
  locked?: boolean;                   // hides the edit trigger
  lockedLabel?: string;               // chip label, e.g. "Bloqueado"
}

export function EditableRow(props: EditableRowProps) {
  const group = useEditableRowControl(props.id);
  const [internalEditing, setInternalEditing] = useState(false);
  const editing = group ? group.editing : internalEditing;
  const setEditing = (open: boolean) => {
    if (group) group.setEditing(open);
    else setInternalEditing(open);
  };
  const containerRef = useRef<HTMLDivElement>(null);

  function close() {
    setEditing(false);
    props.onCancel?.();
  }

  async function handleSave() {
    try {
      await props.onSave();
      setEditing(false);
    } catch {
      // Toast handled by mutation hook; stay in edit mode.
    }
  }

  // ESC to cancel
  useEffect(() => {
    if (!editing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'border-b border-foreground/5 py-4 last:border-b-0 transition-colors',
        editing && 'bg-primary/5 -mx-3 px-3 rounded-xl border-b-transparent',
      )}
    >
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1.5">
        {props.label}
      </div>

      {!editing ? (
        <div className="flex items-center justify-between gap-4 min-h-[28px]">
          <div className="flex-1">{props.view}</div>
          {props.locked ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 py-1 rounded-full bg-foreground/[0.03] border border-foreground/[0.06]">
              {props.lockedLabel ?? 'Bloqueado'}
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-accent-readable hover:text-accent-readable hover:bg-primary/[0.08]"
              onClick={() => setEditing(true)}
            >
              {props.triggerLabel ?? 'Editar'}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {props.editForm({ close })}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={props.saveDisabled || props.saving}>
              {props.saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {props.saveLabel ?? 'Salvar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={close} disabled={props.saving}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
