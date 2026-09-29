import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  async sendWelcomeEmail(email: string, name?: string) {
    if (!email) {
      throw new Error('Email is required');
    }

    const client = this.supabase.getClient();

    // Check if welcome email was already sent (deduplication)
    const { data: existing } = await client
      .from('welcome_emails_sent')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existing) {
      this.logger.log(`Already sent welcome email to ${email}, skipping`);
      return { success: true, skipped: true };
    }

    const resendApiKey = this.config.get<string>('RESEND_API_KEY');
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    const displayName = name || 'Usuario';
    const defaultPassword = 'acesso123';
    const siteUrl = 'https://app.sentinelatracker.com.br';

    const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bem-vindo ao Painel de Tracking</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #050505; }
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; }
      .content-padding { padding: 32px 24px !important; }
      .hero-title { font-size: 24px !important; line-height: 30px !important; }
      .credential-box { padding: 16px 18px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#050505;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#050505;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" class="container" style="max-width:560px;width:100%;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
            </td>
          </tr>
          <tr>
            <td style="background:linear-gradient(145deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td class="content-padding" style="padding:40px 36px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="background-color:rgba(209,254,23,0.12);border:1px solid rgba(209,254,23,0.25);border-radius:20px;padding:6px 14px;">
                          <span style="color:#d1fe17;font-size:12px;font-weight:600;letter-spacing:0.5px;">&#10003; Conta criada</span>
                        </td>
                      </tr>
                    </table>
                    <h1 class="hero-title" style="color:#ffffff;font-size:28px;font-weight:700;line-height:34px;margin:20px 0 12px;">Bem-vindo ao Painel de Tracking</h1>
                    <p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:22px;margin:0 0 28px;">Sua conta est&aacute; pronta. Use os dados abaixo para acessar a plataforma e come&ccedil;ar a rastrear suas vendas.</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td class="credential-box" style="background-color:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px 24px;">
                          <p style="color:rgba(255,255,255,0.4);font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin:0 0 16px;">Dados de Acesso</p>
                          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 4px;">Login</p>
                          <p style="color:#ffffff;font-size:15px;font-weight:600;margin:0 0 14px;">${email}</p>
                          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 4px;">Senha</p>
                          <p style="color:#d1fe17;font-size:15px;font-weight:600;margin:0;">${defaultPassword}</p>
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:16px;">
                      <tr>
                        <td style="background-color:rgba(209,254,23,0.06);border:1px solid rgba(209,254,23,0.12);border-radius:8px;padding:12px 16px;">
                          <p style="color:rgba(255,255,255,0.5);font-size:12px;line-height:18px;margin:0;">Recomendamos que voc&ecirc; altere sua senha no primeiro acesso em Configura&ccedil;&otilde;es.</p>
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:28px;">
                      <tr>
                        <td align="center">
                          <a href="${siteUrl}/login" style="display:inline-block;background-color:#d1fe17;color:#050505;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;">Acessar Plataforma</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 0;">
              <p style="color:rgba(255,255,255,0.3);font-size:12px;margin:0 0 4px;">Painel de Tracking &mdash; Rastreamento de vendas</p>
              <p style="color:rgba(255,255,255,0.2);font-size:11px;margin:0;">Este &eacute; um email autom&aacute;tico. Se n&atilde;o solicitou esta conta, ignore este email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    this.logger.log(`Sending welcome email to ${email}...`);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Sentinela Tracker <noreply@contato.sentinelatracker.com.br>',
        to: [email],
        subject: `Bem-vindo ao Painel de Tracking, ${displayName}!`,
        html: htmlContent,
      }),
    });

    const resBody = await res.text();

    if (!res.ok) {
      this.logger.error(`Resend error [${res.status}]: ${resBody}`);
      throw new Error(`Resend error: ${resBody}`);
    }

    // Mark as sent
    await client
      .from('welcome_emails_sent')
      .insert({ email: email.toLowerCase() });

    this.logger.log(`Welcome email sent successfully to ${email}`);

    return { success: true };
  }
}
