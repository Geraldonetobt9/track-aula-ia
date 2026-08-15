import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Facebook, Copy, Check, CheckCircle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFacebookConnection } from '@/hooks/useFacebookConnection';
import { useAuth } from '@/contexts/AuthContext';

const steps = [
  { id: 1, title: 'Conectar Facebook' },
  { id: 2, title: 'Configurar Checkout' },
  { id: 3, title: 'Verificar Dados' },
];

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedCheckout, setSelectedCheckout] = useState('');
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const {
    isConfigured,
    isValid,
  } = useFacebookConnection();

  const webhookUrl = `https://api.sentinel.app/webhook/${selectedCheckout?.toLowerCase() || 'checkout'}/abc123`;

  const handleConnectFacebook = () => {
    if (!user?.id) return;
    const backendUrl = import.meta.env.VITE_API_URL || '';
    const session = (user as any).access_token || '';
    window.location.href = `${backendUrl}/facebook/auth/connect?token=${session}`;
  };

  const facebookConnected = isConfigured;

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast({
      title: 'URL copiada!',
      description: 'Cole essa URL nas configurações do seu checkout.',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNext = () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    } else {
      localStorage.removeItem('sentinel_needsOnboarding');
      navigate('/dashboard');
    }
  };

  const canProceed = () => {
    if (currentStep === 1) return facebookConnected;
    if (currentStep === 2) return !!selectedCheckout;
    return true;
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-2xl animate-sentinel-in">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors',
                    currentStep >= step.id
                      ? 'bg-foreground text-background'
                      : 'bg-foreground/5 text-muted-foreground/70'
                  )}
                >
                  {currentStep > step.id ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    step.id
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      'mx-2 h-0.5 w-16 md:w-24 transition-colors',
                      currentStep > step.id ? 'bg-foreground/30' : 'bg-foreground/5'
                    )}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-sm">
            {steps.map((step) => (
              <span
                key={step.id}
                className={cn(
                  'text-center',
                  currentStep >= step.id ? 'text-muted-foreground' : 'text-muted-foreground/60'
                )}
              >
                {step.title}
              </span>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <Card>
        {currentStep === 1 && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">Conectar Facebook Ads</CardTitle>
                <CardDescription>
                  Insira suas credenciais do Facebook Ads para começar a rastrear
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {facebookConnected ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/20">
                      <CheckCircle className="h-10 w-10 text-primary" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-foreground">
                        Facebook configurado com sucesso!
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {isValid ? 'Credenciais validadas' : 'Aguardando validação'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <Facebook className="h-12 w-12 text-[#1877F2]" />
                    <p className="text-sm text-muted-foreground text-center max-w-sm">
                      Conecte sua conta do Facebook para importar automaticamente suas contas de anuncios.
                    </p>
                    <Button
                      size="lg"
                      onClick={handleConnectFacebook}
                      className="w-full bg-[#1877F2] hover:bg-[#1877F2]/90 gap-2"
                    >
                      <Facebook className="h-5 w-5" />
                      Conectar com Facebook
                    </Button>
                  </div>
                )}
              </CardContent>
            </>
          )}

          {currentStep === 2 && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">Configurar Checkout</CardTitle>
                <CardDescription>
                  Selecione seu checkout e copie a URL do webhook
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Selecione o checkout</label>
                  <Select value={selectedCheckout} onValueChange={setSelectedCheckout}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha uma plataforma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Hotmart">Hotmart</SelectItem>
                      <SelectItem value="Kiwify">Kiwify</SelectItem>
                      <SelectItem value="Kirvano">Kirvano</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedCheckout && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">URL do Webhook</label>
                    <div className="flex gap-2">
                      <Input
                        value={webhookUrl}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleCopyWebhook}
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Cole essa URL nas configurações de webhook do {selectedCheckout}
                    </p>
                  </div>
                )}
              </CardContent>
            </>
          )}

          {currentStep === 3 && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">Verificar Conexões</CardTitle>
                <CardDescription>
                  Confira se tudo está configurado corretamente
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-foreground/5 p-4">
                  <div className="flex items-center gap-3">
                    <Facebook className="h-6 w-6 text-[#1877F2]" />
                    <div>
                      <p className="font-medium">Facebook Ads</p>
                      <p className="text-sm text-muted-foreground">
                        Business Manager conectado
                      </p>
                    </div>
                  </div>
                  <Badge className="bg-primary">Conectado</Badge>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-foreground/5 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-foreground/20 text-xs font-bold text-foreground">
                      {selectedCheckout?.[0] || 'C'}
                    </div>
                    <div>
                      <p className="font-medium">{selectedCheckout || 'Checkout'}</p>
                      <p className="text-sm text-muted-foreground">
                        Webhook configurado
                      </p>
                    </div>
                  </div>
                  <Badge className="bg-primary">Ativo</Badge>
                </div>

                <div className="mt-6 rounded-lg bg-primary/10 p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    🎉 Tudo pronto! Agora você pode acompanhar o ROI real das suas campanhas.
                  </p>
                </div>
              </CardContent>
            </>
          )}

          <div className="flex justify-between border-t border-foreground/5 p-6">
            {currentStep > 1 ? (
              <Button
                variant="outline"
                onClick={() => setCurrentStep(currentStep - 1)}
              >
                Voltar
              </Button>
            ) : (
              <div />
            )}
            <Button onClick={handleNext} disabled={!canProceed()}>
              {currentStep === 3 ? 'Ir para Dashboard' : 'Próximo'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
