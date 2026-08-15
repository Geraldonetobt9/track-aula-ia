import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-12 animate-sentinel-in">
        <Link to="/">
          <Button variant="ghost" className="mb-6 text-muted-foreground/60 hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        </Link>

        <h1 className="mb-8 text-2xl font-semibold text-foreground">Política de Privacidade</h1>

        <div className="prose prose-invert max-w-none space-y-6 text-muted-foreground/60">
          <p><strong>Última atualização:</strong> Janeiro de 2024</p>
          <p>Esta Política de Privacidade está em conformidade com a Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018).</p>
          
          <h2 className="text-xl font-semibold text-foreground">1. Dados Coletados</h2>
          <p>Coletamos informações que você nos fornece diretamente: nome, e-mail, dados de pagamento e informações de uso da plataforma.</p>
          
          <h2 className="text-xl font-semibold text-foreground">2. Uso dos Dados</h2>
          <p>Utilizamos seus dados para: fornecer e manter o serviço, processar pagamentos, enviar comunicações importantes e melhorar a plataforma.</p>
          
          <h2 className="text-xl font-semibold text-foreground">3. Compartilhamento de Dados</h2>
          <p>Não vendemos seus dados. Compartilhamos apenas com provedores de serviço essenciais (processamento de pagamento, hospedagem) sob acordos de confidencialidade.</p>
          
          <h2 className="text-xl font-semibold text-foreground">4. Segurança</h2>
          <p>Implementamos medidas de segurança técnicas e organizacionais para proteger seus dados contra acesso não autorizado, alteração ou destruição.</p>
          
          <h2 className="text-xl font-semibold text-foreground">5. Seus Direitos (LGPD)</h2>
          <p>Você tem direito a: acessar seus dados, corrigir dados incorretos, solicitar exclusão, portabilidade dos dados e revogar consentimento.</p>
          
          <h2 className="text-xl font-semibold text-foreground">6. Cookies</h2>
          <p>Utilizamos cookies essenciais para o funcionamento da plataforma e cookies de análise para melhorar a experiência do usuário.</p>
          
          <h2 className="text-xl font-semibold text-foreground">7. Retenção de Dados</h2>
          <p>Mantemos seus dados enquanto sua conta estiver ativa. Após exclusão da conta, os dados são removidos em até 30 dias.</p>
          
          <h2 className="text-xl font-semibold text-foreground">8. Contato do DPO</h2>
          <p>Para exercer seus direitos ou esclarecer dúvidas: privacidade@sentinel.app</p>
        </div>
      </div>
    </div>
  );
}
