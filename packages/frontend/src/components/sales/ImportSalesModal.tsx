import { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Loader2, Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useSalesImportPreview } from '@/hooks/useSalesImportPreview';
import { useSalesImportCommit } from '@/hooks/useSalesImportCommit';
import { format } from 'date-fns';

type Step = 'idle' | 'previewing' | 'preview-ready' | 'importing' | 'done' | 'error';

const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function ImportSalesModal({ open, onOpenChange, onImported }: Props) {
  const { activeWorkspaceId } = useWorkspaceContext();
  const preview = useSalesImportPreview();
  const commit = useSalesImportCommit();

  const [step, setStep] = useState<Step>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [integrationId, setIntegrationId] = useState<string>('');
  const [clientError, setClientError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('idle');
    setFile(null);
    setIntegrationId('');
    setClientError(null);
    preview.reset();
    commit.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const closeSafely = (next: boolean) => {
    if (step === 'importing') return;
    if (!next && step === 'done') {
      onImported?.();
    }
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFileChosen = async (f: File) => {
    setClientError(null);
    if (!/\.(csv|xlsx)$/i.test(f.name)) {
      setClientError('Formato não suportado. Envie um arquivo .csv ou .xlsx.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setClientError('Arquivo excede 5 MB.');
      return;
    }
    if (!activeWorkspaceId) {
      setClientError('Workspace ativo não encontrado.');
      return;
    }
    setFile(f);
    setStep('previewing');
    try {
      const result = await preview.run(f, activeWorkspaceId);
      if (result.integrations.length === 1) {
        setIntegrationId(result.integrations[0].id);
      }
      setStep('preview-ready');
    } catch {
      setStep('error');
    }
  };

  const handleConfirm = async () => {
    if (!file || !activeWorkspaceId || !integrationId) return;
    setStep('importing');
    try {
      await commit.run(file, activeWorkspaceId, integrationId);
      setStep('done');
    } catch {
      setStep('error');
    }
  };

  const renderBody = () => {
    if (step === 'idle' || step === 'error') {
      return (
        <div className="space-y-4">
          <div className="border border-dashed border-foreground/10 rounded-md p-8 text-center">
            <Upload className="mx-auto h-8 w-8 text-muted-foreground/70" />
            <p className="mt-3 text-sm text-foreground">Selecione um arquivo CSV ou XLSX</p>
            <p className="mt-1 text-xs text-muted-foreground/70">Máx 5 MB, até 5.000 linhas.</p>
            <p className="mt-1 text-xs text-muted-foreground/70">Apenas vendas com status "Aprovado" são importadas.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => e.target.files && e.target.files[0] && handleFileChosen(e.target.files[0])}
            />
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => fileInputRef.current?.click()}
            >
              Selecionar arquivo
            </Button>
          </div>
          {clientError && (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> {clientError}
            </p>
          )}
          {step === 'error' && preview.error && (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> {humanizeError(preview.error as any)}
            </p>
          )}
          {step === 'error' && commit.error && (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> {humanizeError(commit.error as any)}
            </p>
          )}
        </div>
      );
    }

    if (step === 'previewing') {
      return (
        <div className="py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Analisando arquivo…</span>
        </div>
      );
    }

    if (step === 'preview-ready' && preview.data) {
      const p = preview.data;
      return (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground/70">Arquivo: {file?.name}</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Total de linhas</div>              <div className="text-right">{p.total_rows}</div>
            <div>A serem importadas</div>           <div className="text-right text-foreground font-medium">{p.to_import}</div>
            <div>Já existentes (skip)</div>         <div className="text-right">{p.duplicates}</div>
            <div>Não aprovadas (skip)</div>         <div className="text-right">{p.non_approved}</div>
            <div>Com erro (skip)</div>              <div className="text-right">{p.invalid}</div>
          </div>

          {p.integrations.length > 1 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground/70">Conta Hotmart</label>
              <Select value={integrationId} onValueChange={setIntegrationId}>
                <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                <SelectContent>
                  {p.integrations.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {p.sample_preview.length > 0 && (
            <div className="border border-foreground/10 rounded-md p-3 text-xs">
              <div className="text-muted-foreground/70 mb-2">Prévia (primeiras {p.sample_preview.length}):</div>
              {p.sample_preview.map((s) => (
                <div key={s.transaction} className="py-1 border-b border-foreground/5 last:border-0 grid grid-cols-4 gap-2">
                  <div>{format(new Date(s.sold_at), 'dd/MM HH:mm')}</div>
                  <div className="truncate">{s.product_name}</div>
                  <div className="truncate">{s.customer_email}</div>
                  <div className="text-right">R$ {s.amount_brl.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (step === 'importing') {
      return (
        <div className="py-10 flex flex-col items-center">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="mt-4 text-sm">Processando {preview.data?.to_import ?? ''} vendas…</p>
          <p className="mt-1 text-xs text-muted-foreground/70">Não feche esta janela.</p>
        </div>
      );
    }

    if (step === 'done' && commit.data) {
      const d = commit.data;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">{d.imported} vendas importadas com sucesso</span>
          </div>
          <ul className="text-xs text-muted-foreground/70 space-y-1 pl-7">
            <li>{d.skipped_duplicates} ignoradas (já existiam)</li>
            <li>{d.skipped_non_approved} ignoradas (não aprovadas)</li>
            <li>{d.skipped_invalid} com erro</li>
          </ul>
          {d.invalid_samples.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground/70">Ver linhas com erro</summary>
              <ul className="mt-2 space-y-1">
                {d.invalid_samples.map((s) => (
                  <li key={s.row}>Linha {s.row}: {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      );
    }

    return null;
  };

  const renderFooter = () => {
    if (step === 'preview-ready' && preview.data) {
      const canConfirm = !!integrationId && preview.data.to_import > 0;
      return (
        <DialogFooter>
          <Button variant="outline" onClick={() => reset()}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Confirmar ({preview.data.to_import})
          </Button>
        </DialogFooter>
      );
    }
    if (step === 'done') {
      return (
        <DialogFooter>
          <Button onClick={() => closeSafely(false)}>Fechar</Button>
        </DialogFooter>
      );
    }
    if (step === 'error') {
      return (
        <DialogFooter>
          <Button variant="outline" onClick={() => reset()}>Tentar outro arquivo</Button>
        </DialogFooter>
      );
    }
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={closeSafely}>
      <DialogContent hideCloseButton={step === 'importing'}>
        <DialogHeader>
          <DialogTitle>
            {step === 'importing' ? 'Importando vendas' :
             step === 'done' ? 'Importação concluída' :
             'Importar vendas'}
          </DialogTitle>
          {step === 'idle' && (
            <DialogDescription>
              Importe vendas antigas da Hotmart. Importações não contam no limite do seu plano.
            </DialogDescription>
          )}
        </DialogHeader>
        {renderBody()}
        {renderFooter()}
      </DialogContent>
    </Dialog>
  );
}

function humanizeError(err: Error & { status?: number; body?: any }): string {
  const code = err.body?.error;
  switch (code) {
    case 'no_active_integration': return 'Nenhuma integração Hotmart ativa neste workspace. Conecte uma em Configurações > Integrações.';
    case 'workspace_forbidden':   return 'Workspace inválido para sua conta.';
    case 'unsupported_format':    return 'Formato não suportado. Envie CSV ou XLSX (não .xls legado).';
    case 'unsupported_schema':    return `Coluna obrigatória ausente: ${err.body?.missing_column ?? '(desconhecida)'}.`;
    case 'too_many_rows':         return 'Arquivo excede 5.000 linhas. Divida em arquivos menores.';
    case 'file_too_large':        return 'Arquivo excede 5 MB.';
    case 'no_data_rows':          return 'Arquivo está vazio.';
    case 'integration_forbidden': return 'Integração selecionada inválida.';
    case 'parse_error':           return 'Não foi possível ler o arquivo. Verifique o delimitador e a codificação.';
    default:                      return err.message || 'Erro desconhecido.';
  }
}
