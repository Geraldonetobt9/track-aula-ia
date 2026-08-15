import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Copy, Check, Info, Wand2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { CheckoutPlatform, CHECKOUT_PLATFORMS, CheckoutIntegration } from '@/types/checkout';
import { absoluteApiUrl } from '@/lib/apiUrl';

interface CheckoutConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: CheckoutPlatform;
  integration: CheckoutIntegration | undefined;
  webhookUrl: string;
  onSave: (params: { name: string; token: string; useCommissionValue: boolean }) => Promise<boolean>;
  onToggle: (active: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  saving: boolean;
}



export function CheckoutConfigModal({
  open,
  onOpenChange,
  platform,
  integration,
  webhookUrl,
  onSave,
  onToggle,
  onDelete,
  saving,
}: CheckoutConfigModalProps) {
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [useCommissionValue, setUseCommissionValue] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const { toast } = useToast();
  const config = CHECKOUT_PLATFORMS[platform];

  const displayUrl = `${absoluteApiUrl()}/webhooks/${platform}`;

  useEffect(() => {
    if (open) {
      setToken(integration?.webhook_secret || '');
      setName(integration?.name || '');
      setUseCommissionValue(integration?.use_commission_value ?? false);
      setAttempted(false);
    }
  }, [open, integration?.webhook_secret, integration?.use_commission_value, integration?.name]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(displayUrl);
    setCopied(true);
    toast({
      title: 'URL copiada!',
      description: 'Cole essa URL nas configurações do seu checkout.',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateToken = () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const generated = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    setToken(generated);
    navigator.clipboard.writeText(generated);
    toast({
      title: 'Token gerado e copiado!',
      description: `Cole o mesmo valor no campo Secret da ${config.name}.`,
    });
  };

  const handleSave = async () => {
    setAttempted(true);
    if (!name.trim() || !token.trim()) return;
    const success = await onSave({ name, token, useCommissionValue });
    if (success) {
      onOpenChange(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    setShowDeleteConfirm(false);
    setDeleting(true);
    await onDelete();
    setDeleting(false);
    onOpenChange(false);
  };

  const nameError = attempted && !name.trim();
  const tokenError = attempted && !token.trim();

  const handleToggle = async (checked: boolean) => {
    await onToggle(checked);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${config.color} text-sm font-bold text-foreground`}>
              {config.name.charAt(0)}
            </div>
            Configurar {config.name}
          </DialogTitle>
          <DialogDescription>
            Configure a integração com o webhook do {config.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Integration Name */}
          <div className="space-y-2">
            <Label>Nome da integração</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Produto Digital A"
              className=""
            />
            {nameError && (
              <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5">
                <span className="text-sm">⚠️</span>
                <p className="text-xs font-medium text-destructive">Preencha o nome da integração</p>
              </div>
            )}
          </div>

          {/* Webhook URL */}
          <div className="space-y-2">
            <Label>URL do Webhook</Label>
            <div className="flex gap-2">
              <Input
                value={displayUrl}
                readOnly
                className="font-mono text-xs"
              />
              <Button variant="outline" size="icon" onClick={handleCopyUrl}>
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Copie esta URL e configure no painel do {config.name}
            </p>
          </div>

          {/* URL completa com token (apenas para plataformas que autenticam via query param) */}
          {config.tokenInUrl && token && (
            <div className="space-y-2">
              <Label>URL completa para colar na {config.name}</Label>
              <div className="flex gap-2">
                <Input
                  value={`${displayUrl}?token=${token}`}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(`${displayUrl}?token=${token}`);
                    toast({
                      title: 'URL completa copiada!',
                      description: `Cole essa URL inteira no campo Webhook URL da ${config.name}.`,
                    });
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Cole esta URL completa (com o ?token=...) no campo Webhook URL da {config.name}.
              </p>
            </div>
          )}

          {/* Platform Token */}
          <div className="space-y-2">
            <Label>{config.tokenLabel}</Label>
            <div className="flex gap-2">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  config.supportsGeneratedToken
                    ? `Clique em "Gerar token" ou cole um valor aqui`
                    : `Cole o ${config.tokenLabel.toLowerCase()} da plataforma aqui`
                }
                className="font-mono text-xs"
              />
              {config.supportsGeneratedToken && (
                <Button
                  variant="outline"
                  onClick={handleGenerateToken}
                  className="shrink-0"
                  type="button"
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  Gerar token
                </Button>
              )}
            </div>
            {tokenError && (
              <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5">
                <span className="text-sm">⚠️</span>
                <p className="text-xs font-medium text-destructive">Preencha o token da plataforma</p>
              </div>
            )}
            <div className="flex items-start gap-2 rounded-lg border border-info/20 bg-info/5 p-2">
              <Info className="h-4 w-4 text-info mt-0.5 shrink-0" />
              <p className="text-xs text-info/80">
                {config.tokenHelp}
              </p>
            </div>
          </div>

          {/* Active Toggle */}
          {integration && (
            <div className="flex items-center justify-between rounded-lg border border-foreground/5 p-4">
              <div>
                <p className="font-medium">Integração Ativa</p>
                <p className="text-sm text-muted-foreground">
                  {integration.is_active ? 'Recebendo webhooks normalmente' : 'Webhooks pausados'}
                </p>
              </div>
              <Switch
                checked={integration.is_active}
                onCheckedChange={handleToggle}
              />
            </div>
          )}

          {/* Value Type Selection */}
          <div className="space-y-3">
            <Label>Valor a registrar</Label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 rounded-lg border border-foreground/5 p-3 cursor-pointer hover:bg-foreground/[0.02] transition-colors">
                <input
                  type="radio"
                  name="valueType"
                  checked={!useCommissionValue}
                  onChange={() => setUseCommissionValue(false)}
                  className="accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">Valor da venda</p>
                  <p className="text-xs text-muted-foreground">Registra o valor bruto da venda (padrão)</p>
                </div>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-foreground/5 p-3 cursor-pointer hover:bg-foreground/[0.02] transition-colors">
                <input
                  type="radio"
                  name="valueType"
                  checked={useCommissionValue}
                  onChange={() => setUseCommissionValue(true)}
                  className="accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">Valor da comissão</p>
                  <p className="text-xs text-muted-foreground">Registra o valor líquido que você recebe após taxas da plataforma</p>
                </div>
              </label>
            </div>
          </div>

          {/* Instructions */}
          <div className="space-y-2">
            <Label>Como configurar</Label>
            <div className="rounded-lg border border-foreground/5 bg-foreground/[0.03] p-3">
              <ol className="space-y-1 text-sm text-muted-foreground">
                {config.instructions.map((instruction, index) => (
                  <li key={index}>{instruction}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-2">
          <div>
            {integration && (
              <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)} disabled={deleting}>
                {deleting ? 'Removendo...' : 'Remover'}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover integração</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover a integração "{integration?.name}"? As vendas já registradas não serão afetadas, mas novos webhooks desta integração não serão mais processados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirmed} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
