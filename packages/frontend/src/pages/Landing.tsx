import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart3, 
  Target, 
  Zap, 
  Shield, 
  TrendingUp, 
  Users, 
  Check,
  ArrowRight,
  Facebook
} from 'lucide-react';
import { Logo } from '@/components/Logo';

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link to="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="ghost">Entrar</Button>
            </Link>
            <Link to="/register">
              <Button>Comece Grátis</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <Badge className="mb-4" variant="secondary">
          🚀 Rastreamento Avançado de Facebook Ads
        </Badge>
        <h1 className="mb-6 text-4xl font-extrabold tracking-tight md:text-6xl">
          Descubra o{' '}
          <span className="text-primary">ROI Real</span>
          {' '}das suas Campanhas
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground md:text-xl">
          Cruze dados de vendas dos seus checkouts com métricas do Facebook Ads. 
          Saiba exatamente qual campanha, conjunto e anúncio está gerando cada venda.
        </p>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link to="/register">
            <Button size="lg" className="gap-2">
              Comece Grátis <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Button size="lg" variant="outline">
            Ver Demonstração
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          ✓ 7 dias grátis • ✓ Sem cartão de crédito • ✓ Cancele quando quiser
        </p>
      </section>

      {/* Benefits Section */}
      <section className="border-t border-border bg-card/50 py-20">
        <div className="container mx-auto px-4">
          <h2 className="mb-12 text-center text-3xl font-bold">
            Por que usar o Painel de Tracking?
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border bg-card">
              <CardHeader>
                <Target className="mb-2 h-10 w-10 text-primary" />
                <CardTitle>Atribuição Precisa</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Saiba exatamente qual anúncio gerou cada venda, sem depender apenas do pixel do Facebook.
                </CardDescription>
              </CardContent>
            </Card>
            <Card className="border-border bg-card">
              <CardHeader>
                <BarChart3 className="mb-2 h-10 w-10 text-primary" />
                <CardTitle>Métricas Reais</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  ROI, ROAS e CPA calculados com dados reais de vendas do seu checkout, não estimativas.
                </CardDescription>
              </CardContent>
            </Card>
            <Card className="border-border bg-card">
              <CardHeader>
                <Zap className="mb-2 h-10 w-10 text-primary" />
                <CardTitle>Integração Fácil</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Conecte sua conta do Facebook e checkouts em minutos. Sem código, sem complicação.
                </CardDescription>
              </CardContent>
            </Card>
            <Card className="border-border bg-card">
              <CardHeader>
                <Shield className="mb-2 h-10 w-10 text-primary" />
                <CardTitle>Dados Seguros</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Seus dados são criptografados e protegidos. Conformidade total com LGPD.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <h2 className="mb-12 text-center text-3xl font-bold">
            Como Funciona
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                1
              </div>
              <h3 className="mb-2 text-xl font-semibold">Conecte o Facebook</h3>
              <p className="text-muted-foreground">
                Autorize o acesso às suas campanhas de Facebook Ads com um clique.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                2
              </div>
              <h3 className="mb-2 text-xl font-semibold">Configure o Webhook</h3>
              <p className="text-muted-foreground">
                Adicione nossa URL de webhook no seu checkout (Hotmart, Kiwify ou Kirvano).
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                3
              </div>
              <h3 className="mb-2 text-xl font-semibold">Acompanhe os Dados</h3>
              <p className="text-muted-foreground">
                Veja em tempo real o ROI de cada campanha, conjunto e anúncio.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="border-t border-border bg-card/50 py-20">
        <div className="container mx-auto px-4">
          <h2 className="mb-4 text-center text-3xl font-bold">
            Planos e Preços
          </h2>
          <p className="mb-12 text-center text-muted-foreground">
            Escolha o plano ideal para o seu negócio
          </p>
          <div className="grid gap-6 md:grid-cols-3">
            {/* Starter */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle>Starter</CardTitle>
                <CardDescription>Para quem está começando</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">R$ 47</span>
                  <span className="text-muted-foreground">/mês</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>1 conta de anúncios</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>1 checkout integrado</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>Até 500 vendas/mês</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>Dashboard básico</span>
                  </li>
                </ul>
                <Link to="/register" className="mt-6 block">
                  <Button variant="outline" className="w-full">
                    Começar Grátis
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Pro */}
            <Card className="relative border-primary bg-card">
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                Mais Popular
              </Badge>
              <CardHeader>
                <CardTitle>Pro</CardTitle>
                <CardDescription>Para negócios em crescimento</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">R$ 97</span>
                  <span className="text-muted-foreground">/mês</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>3 contas de anúncios</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>3 checkouts integrados</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>Até 2.000 vendas/mês</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>Dashboard completo</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>Relatórios avançados</span>
                  </li>
                </ul>
                <Link to="/register" className="mt-6 block">
                  <Button className="w-full">Começar Grátis</Button>
                </Link>
              </CardContent>
            </Card>

            {/* Business */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle>Business</CardTitle>
                <CardDescription>Para operações de escala</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">R$ 197</span>
                  <span className="text-muted-foreground">/mês</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>Contas ilimitadas</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>Checkouts ilimitados</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>Vendas ilimitadas</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>API de integração</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span>Suporte prioritário</span>
                  </li>
                </ul>
                <Link to="/register" className="mt-6 block">
                  <Button variant="outline" className="w-full">
                    Começar Grátis
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20">
        <div className="container mx-auto max-w-3xl px-4">
          <h2 className="mb-12 text-center text-3xl font-bold">
            Perguntas Frequentes
          </h2>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger>
                O que é o Painel de Tracking?
              </AccordionTrigger>
              <AccordionContent>
                O Painel de Tracking é uma plataforma que cruza dados de vendas dos seus checkouts 
                (Hotmart, Kiwify, Kirvano) com as métricas das suas campanhas de Facebook Ads, 
                permitindo que você saiba exatamente qual anúncio gerou cada venda.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger>
                Como funciona o período de teste?
              </AccordionTrigger>
              <AccordionContent>
                Você tem 7 dias para testar gratuitamente todas as funcionalidades do plano 
                escolhido, sem necessidade de cartão de crédito. Após o período de teste, 
                você pode escolher continuar ou cancelar.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3">
              <AccordionTrigger>
                Quais checkouts são suportados?
              </AccordionTrigger>
              <AccordionContent>
                Atualmente suportamos Hotmart, Kiwify e Kirvano. Estamos constantemente 
                adicionando novas integrações. Se você usa outro checkout, entre em contato conosco.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-4">
              <AccordionTrigger>
                Meus dados estão seguros?
              </AccordionTrigger>
              <AccordionContent>
                Sim! Utilizamos criptografia de ponta a ponta e seguimos todas as normas da LGPD. 
                Seus dados nunca são compartilhados com terceiros.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-5">
              <AccordionTrigger>
                Posso cancelar a qualquer momento?
              </AccordionTrigger>
              <AccordionContent>
                Sim, você pode cancelar sua assinatura a qualquer momento. Não há multas ou 
                taxas de cancelamento. Você mantém o acesso até o fim do período pago.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-border bg-primary py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 text-3xl font-bold text-primary-foreground">
            Pronto para descobrir seu ROI real?
          </h2>
          <p className="mb-8 text-primary-foreground/80">
            Comece agora e tenha acesso completo por 7 dias grátis.
          </p>
          <Link to="/register">
            <Button size="lg" variant="secondary" className="gap-2">
              Criar Conta Gratuita <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <Logo />
            <div className="flex gap-6 text-sm text-muted-foreground">
              <Link to="/terms" className="hover:text-foreground">
                Termos de Uso
              </Link>
              <Link to="/privacy" className="hover:text-foreground">
                Política de Privacidade
              </Link>
            </div>
            <div className="text-sm text-muted-foreground">
              © Painel de Tracking.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
