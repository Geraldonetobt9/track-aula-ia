import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CreateUserDto } from './dto/create-user.dto';

export interface UserRow {
  user_id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  active: boolean | null;
}

/**
 * Criacao de usuarios pelo admin.
 *
 * O cadastro publico saiu do produto: nao ha mais tela de "criar conta" nem
 * rota aberta que crie usuario. Quem entra no painel foi criado aqui, por
 * alguem cujo e-mail esta em ADMIN_EMAILS.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(): Promise<UserRow[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('user_id, name, email, created_at, active')
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as UserRow[];
  }

  async create(dto: CreateUserDto): Promise<UserRow> {
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();

    const { data, error } = await this.supabase.getClient().auth.admin.createUser({
      email,
      password: dto.password,
      // Sem envio de e-mail de confirmacao: o admin entrega a senha em maos.
      email_confirm: true,
      user_metadata: { name },
    });

    if (error) {
      if (
        (error as { code?: string }).code === 'email_exists' ||
        /already (been )?registered|already exists/i.test(error.message)
      ) {
        throw new ConflictException('Ja existe um usuario com este e-mail');
      }
      // A senha nunca entra no log — so o motivo da recusa.
      this.logger.error(`falha ao criar usuario: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    if (!data?.user) {
      throw new BadRequestException('Nao foi possivel criar o usuario');
    }

    // O gatilho handle_new_user cria o perfil e a area. Ele roda dentro do
    // INSERT em auth.users, entao a linha ja existe quando chegamos aqui.
    return {
      user_id: data.user.id,
      name,
      email,
      created_at: data.user.created_at,
      active: true,
    };
  }
}
