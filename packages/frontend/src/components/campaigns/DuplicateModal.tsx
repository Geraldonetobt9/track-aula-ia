import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

interface DuplicateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (times: number) => void;
  loading?: boolean;
}

export function DuplicateModal({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  loading,
}: DuplicateModalProps) {
  const [value, setValue] = useState('1');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValue('1');
      setError('');
    }
  }, [open]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    setValue(raw);
    setError('');
  };

  const handleConfirm = () => {
    const num = parseInt(value, 10);
    if (!num || num < 1) {
      setError('Digite um numero maior que zero');
      return;
    }
    if (num > 50) {
      setError('Maximo de 50 duplicacoes por vez');
      return;
    }
    onConfirm(num);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Duplicar</DialogTitle>
          <DialogDescription>
            {selectedCount} item{selectedCount > 1 ? 's' : ''} selecionado{selectedCount > 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-4">
          <div className="grid gap-2">
            <Label htmlFor="duplicate-times">Quantas copias?</Label>
            <Input
              id="duplicate-times"
              type="text"
              inputMode="numeric"
              placeholder="1"
              value={value}
              onChange={handleChange}
              disabled={loading}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !value}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Duplicando...
              </>
            ) : (
              'Confirmar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
