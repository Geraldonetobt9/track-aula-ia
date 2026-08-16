import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor(private config: ConfigService) {
    this.client = createClient(
      this.config.getOrThrow<string>('SUPABASE_URL'),
      this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  async getUserFromToken(token: string) {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  }

  /**
   * Quem administra e' quem esta em ADMIN_EMAILS.
   *
   * A tabela user_roles saiu junto com o painel admin, e guardar o papel numa
   * coluna do banco significaria que qualquer escrita indevida promove alguem.
   * A variavel de ambiente so muda com acesso ao painel da Vercel, entao o
   * privilegio nao e alcancavel a partir do produto.
   *
   * Sem a variavel definida ninguem e admin: o padrao e fechado.
   */
  async isAdmin(userId: string): Promise<boolean> {
    const permitidos = (this.config.get<string>('ADMIN_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (permitidos.length === 0 || !userId) return false;

    const { data, error } = await this.client.auth.admin.getUserById(userId);
    const email = data?.user?.email?.toLowerCase();
    if (error || !email) return false;

    return permitidos.includes(email);
  }
}
