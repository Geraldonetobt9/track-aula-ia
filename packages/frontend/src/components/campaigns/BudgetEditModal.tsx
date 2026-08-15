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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBudgetUpdate } from '@/hooks/useBudgetUpdate';
import { Loader2 } from 'lucide-react';

interface BudgetEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'campaign' | 'adset';
  facebookId: string;
  name: string;
  currentDailyBudget?: number | null;
  currentLifetimeBudget?: number | null;
  onSuccess?: (facebookId: string, budgetType: 'daily' | 'lifetime', amountCents: number) => void;
}

export function BudgetEditModal({
  open,
  onOpenChange,
  type,
  facebookId,
  name,
  currentDailyBudget,
  currentLifetimeBudget,
  onSuccess,
}: BudgetEditModalProps) {
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('daily');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const { updateBudget, updating } = useBudgetUpdate({
    onSuccess: (result) => {
      onOpenChange(false);
      onSuccess?.(result.facebook_id, result.budget_type, result.amount);
    },
  });

  // Pre-fill form when modal opens with current budget
  useEffect(() => {
    if (open) {
      setError('');
      
      // Determine current budget type and value
      if (currentLifetimeBudget && currentLifetimeBudget > 0) {
        setBudgetType('lifetime');
        setAmount(currentLifetimeBudget.toFixed(2).replace('.', ','));
      } else if (currentDailyBudget && currentDailyBudget > 0) {
        setBudgetType('daily');
        setAmount(currentDailyBudget.toFixed(2).replace('.', ','));
      } else {
        setBudgetType('daily');
        setAmount('');
      }
    }
  }, [open, currentDailyBudget, currentLifetimeBudget]);

  // Format input value as currency
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    
    // Remove all non-numeric characters except comma and dot
    value = value.replace(/[^\d.,]/g, '');
    
    // Replace comma with dot for parsing
    value = value.replace(',', '.');
    
    // Only allow one decimal separator
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    
    // Limit decimal places to 2
    if (parts.length === 2 && parts[1].length > 2) {
      value = parts[0] + '.' + parts[1].substring(0, 2);
    }

    setAmount(value);
    setError('');
  };

  const handleSubmit = async () => {
    // Parse amount to cents
    const numericAmount = parseFloat(amount);
    
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Digite um valor válido maior que zero');
      return;
    }

    if (numericAmount < 1) {
      setError('O orçamento mínimo é R$ 1,00');
      return;
    }

    const amountInCents = Math.round(numericAmount * 100);

    const success = await updateBudget({
      type,
      facebook_id: facebookId,
      budget_type: budgetType,
      amount: amountInCents,
    });

    if (!success) {
      // Error already shown via toast
    }
  };

  const typeLabel = type === 'campaign' ? 'Campanha' : 'Conjunto';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar Orçamento</DialogTitle>
          <DialogDescription>
            {typeLabel}: <span className="font-medium">{name}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="budget-type">Tipo de Orçamento</Label>
            <Select
              value={budgetType}
              onValueChange={(value: 'daily' | 'lifetime') => setBudgetType(value)}
              disabled={updating}
            >
              <SelectTrigger id="budget-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diário</SelectItem>
                <SelectItem value="lifetime">Vitalício</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amount">Valor (R$)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                R$
              </span>
              <Input
                id="amount"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={handleAmountChange}
                disabled={updating}
                className="pl-10"
              />
            </div>
            {error && <p className="text-sm text-muted-foreground/60">{error}</p>}
            <p className="text-xs text-muted-foreground">
              Orçamento mínimo: R$ 1,00
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={updating}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={updating || !amount}>
            {updating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
