import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import {
  isValidTaxId,
  normalizeDigits,
  TaxIdType,
} from '../../shared/helpers/tax-id';
import { SignupDto } from './dto/signup.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async signup(dto: SignupDto): Promise<{ userId: string; email: string }> {
    if (!dto.termsAccepted) {
      throw new BadRequestException('Voce precisa aceitar os termos de uso');
    }

    const taxIdDigits = normalizeDigits(dto.taxIdValue);
    if (!isValidTaxId(dto.taxIdType, taxIdDigits)) {
      throw new BadRequestException(
        dto.taxIdType === 'cpf' ? 'CPF invalido' : 'CNPJ invalido',
      );
    }

    const client = this.supabase.getClient();

    // Uniqueness check — PostgREST partial-unique indexes would catch this
    // at insert time, but we return a friendly error early.
    await this.assertTaxIdUnique(dto.taxIdType, taxIdDigits);

    // Create the auth.users row. The handle_new_user trigger reads
    // cpf/cnpj from raw_user_meta_data and populates the profile + workspace
    // + subscription automatically.
    const metadata: Record<string, string> = { name: dto.name };
    if (dto.taxIdType === 'cpf') metadata.cpf = taxIdDigits;
    else metadata.cnpj = taxIdDigits;

    const { data, error } = await client.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (error) {
      // Supabase signals duplicate email via status 422 message
      if (
        /already registered/i.test(error.message) ||
        /already been registered/i.test(error.message) ||
        error.code === 'email_exists'
      ) {
        throw new ConflictException('Este email ja esta cadastrado');
      }
      this.logger.error(`signup failure: ${error.message}`);
      throw new BadRequestException(error.message);
    }
    if (!data.user) {
      throw new BadRequestException('Nao foi possivel criar a conta');
    }

    return { userId: data.user.id, email: data.user.email ?? dto.email };
  }

  private async assertTaxIdUnique(
    type: TaxIdType,
    digits: string,
  ): Promise<void> {
    const column = type === 'cpf' ? 'cpf' : 'cnpj';
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id')
      .eq(column, digits)
      .maybeSingle();

    if (error) {
      this.logger.warn(`tax-id uniqueness check failed: ${error.message}`);
      return;
    }
    if (data) {
      throw new ConflictException(
        type === 'cpf' ? 'Este CPF ja esta cadastrado' : 'Este CNPJ ja esta cadastrado',
      );
    }
  }
}
