import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { EditableRow } from '../EditableRow';
import { useUpdateTaxId } from '@/hooks/useUpdateTaxId';
import { formatTaxId, isValidTaxId, stripDigits, TaxIdType } from '@/lib/tax-id';

interface Props {
  initialType: TaxIdType;
  initialValue: string; // digits-only
}

export function TaxIdRow({ initialType, initialValue }: Props) {
  const [type, setType] = useState<TaxIdType>(initialType);
  const [value, setValue] = useState<string>(formatTaxId(initialType, initialValue));
  const mutation = useUpdateTaxId();

  const isValid = isValidTaxId(type, value);
  const formatted = initialValue
    ? `${initialType === 'cpf' ? 'CPF' : 'CNPJ'} · ${formatTaxId(initialType, initialValue)}`
    : '—';

  return (
    <EditableRow
      id="tax-id"
      label="Documento"
      view={
        <div>
          <div className="text-[15px] font-medium">{formatted}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {initialType === 'cpf' ? 'Pessoa física' : 'Empresa'} — usado em recibos e faturas.
          </div>
        </div>
      }
      saving={mutation.isPending}
      saveDisabled={!isValid}
      onCancel={() => {
        setType(initialType);
        setValue(formatTaxId(initialType, initialValue));
      }}
      onSave={async () => { await mutation.mutateAsync({ type, value: stripDigits(value) }); }}
      editForm={() => (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Tipo de documento</Label>
            <RadioGroup
              value={type}
              onValueChange={(v) => {
                setType(v as TaxIdType);
                setValue('');
              }}
              className="flex gap-6"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="cpf" id="tax-cpf" />
                <span className="text-sm">CPF</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="cnpj" id="tax-cnpj" />
                <span className="text-sm">CNPJ</span>
              </label>
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-tax-id">{type === 'cpf' ? 'CPF' : 'CNPJ'}</Label>
            <Input
              id="profile-tax-id"
              inputMode="numeric"
              autoFocus
              placeholder={type === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00'}
              value={value}
              onChange={(e) => setValue(formatTaxId(type, e.target.value))}
            />
            {value && !isValid && (
              <p className="text-xs text-destructive">
                {type === 'cpf' ? 'CPF inválido' : 'CNPJ inválido'}
              </p>
            )}
          </div>
        </div>
      )}
    />
  );
}
