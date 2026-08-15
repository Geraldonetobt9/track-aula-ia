import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-12 animate-sentinel-in">
        <Link to="/">
          <Button variant="ghost" className="mb-6 text-muted-foreground/60 hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        </Link>

        <h1 className="mb-8 text-2xl font-semibold text-foreground">Termos de Uso</h1>

        <div className="prose prose-invert max-w-none space-y-6 text-muted-foreground/60">
          <p><strong>Última atualização:</strong> Janeiro de 2024</p>
          
          <h2 className="text-xl font-semibold text-foreground">1. Aceitação dos Termos</h2>
          <p>Ao acessar e usar o Sentinel, você concorda em cumprir estes Termos de Uso. Se você não concordar com qualquer parte destes termos, não poderá acessar o serviço.</p>
          
          <h2 className="text-xl font-semibold text-foreground">2. Descrição do Serviço</h2>
          <p>O Sentinel é uma plataforma SaaS que permite rastrear e analisar dados de campanhas de Facebook Ads em conjunto com dados de vendas de plataformas de checkout.</p>
          
          <h2 className="text-xl font-semibold text-foreground">3. Conta do Usuário</h2>
          <p>Você é responsável por manter a confidencialidade de sua conta e senha. Você concorda em aceitar responsabilidade por todas as atividades que ocorram em sua conta.</p>
          
          <h2 className="text-xl font-semibold text-foreground">4. Uso Aceitável</h2>
          <p>Você concorda em não usar o serviço para qualquer finalidade ilegal ou não autorizada. Você não deve violar quaisquer leis em sua jurisdição.</p>
          
          <h2 className="text-xl font-semibold text-foreground">5. Pagamentos e Assinaturas</h2>
          <p>Os planos são cobrados mensalmente. Você pode cancelar sua assinatura a qualquer momento. Não há reembolsos para períodos parciais.</p>
          
          <h2 className="text-xl font-semibold text-foreground">6. Limitação de Responsabilidade</h2>
          <p>O Sentinel não será responsável por quaisquer danos indiretos, incidentais, especiais, consequenciais ou punitivos.</p>
          
          <h2 className="text-xl font-semibold text-foreground">7. Alterações nos Termos</h2>
          <p>Reservamo-nos o direito de modificar estes termos a qualquer momento. Notificaremos os usuários sobre mudanças significativas.</p>
          
          <h2 className="text-xl font-semibold text-foreground">8. Contato</h2>
          <p>Para questões sobre estes termos, entre em contato: contato@sentinel.app</p>
        </div>
      </div>
    </div>
  );
}
