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

  async isAdmin(_userId: string): Promise<boolean> {
    // Nao ha mais papeis: a tabela user_roles saiu junto com o painel admin.
    // Quem administra usa o painel do Supabase, nao o produto.
    return false;
  }
}
