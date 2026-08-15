import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';
import { StripeService } from '../stripe/stripe.service';
import { isValidTaxId, normalizeDigits, TaxIdType } from '../../shared/helpers/tax-id';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly stripe: StripeService,
    private readonly discord: DiscordLoggerService,
  ) {}

  async updateProfile(
    userId: string,
    userEmail: string,
    dto: { name: string },
  ): Promise<{ name: string }> {
    const client = this.supabase.getClient();
    const newName = dto.name.trim();

    const { data: prev, error: readErr } = await client
      .from('profiles')
      .select('name')
      .eq('user_id', userId)
      .maybeSingle();

    if (readErr) {
      this.discord.logAccountChangeError({
        userId,
        userEmail,
        field: 'name',
        attempted: newName,
        errorMessage: readErr.message,
        stage: 'profile',
      });
      throw new Error(`Failed to read profile: ${readErr.message}`);
    }

    const prevName = prev?.name ?? '';

    if (prevName === newName) {
      return { name: newName };
    }

    const { error: updateErr } = await client
      .from('profiles')
      .update({ name: newName, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (updateErr) {
      this.discord.logAccountChangeError({
        userId,
        userEmail,
        field: 'name',
        attempted: newName,
        errorMessage: updateErr.message,
        stage: 'profile',
      });
      throw new Error(`Failed to update profile: ${updateErr.message}`);
    }

    this.discord.logAccountChangeSuccess({
      userId,
      userEmail,
      field: 'name',
      before: prevName,
      after: newName,
    });

    return { name: newName };
  }

  async updateTaxId(
    userId: string,
    userEmail: string,
    dto: { type: TaxIdType; value: string },
  ): Promise<{ type: TaxIdType; value: string; stripeSynced: boolean }> {
    const digits = normalizeDigits(dto.value);

    if (!isValidTaxId(dto.type, digits)) {
      const msg = dto.type === 'cpf' ? 'CPF inválido' : 'CNPJ inválido';
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'tax_id',
        attempted: this.formatTaxIdForLog(dto.type, digits),
        errorMessage: msg,
        stage: 'validation',
      });
      throw new BadRequestException(msg);
    }

    const client = this.supabase.getClient();

    // Read previous values
    const { data: prev, error: readErr } = await client
      .from('profiles')
      .select('cpf, cnpj')
      .eq('user_id', userId)
      .maybeSingle();
    if (readErr) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'tax_id',
        attempted: this.formatTaxIdForLog(dto.type, digits),
        errorMessage: readErr.message,
        stage: 'profile',
      });
      throw new Error(`Failed to read profile: ${readErr.message}`);
    }

    const beforeLabel = this.taxIdLabelFromProfile(prev?.cpf, prev?.cnpj);
    const newPair = dto.type === 'cpf'
      ? { cpf: digits, cnpj: null }
      : { cpf: null, cnpj: digits };

    // Idempotent no-op
    if (
      (dto.type === 'cpf' && prev?.cpf === digits) ||
      (dto.type === 'cnpj' && prev?.cnpj === digits)
    ) {
      return { type: dto.type, value: digits, stripeSynced: true };
    }

    // Update profile
    const { error: updErr } = await client
      .from('profiles')
      .update({ ...newPair, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (updErr) {
      const isConflict = (updErr as any).code === '23505';
      const errMsg = isConflict
        ? (dto.type === 'cpf' ? 'Este CPF já está cadastrado' : 'Este CNPJ já está cadastrado')
        : updErr.message;
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'tax_id',
        attempted: this.formatTaxIdForLog(dto.type, digits),
        errorMessage: errMsg,
        stage: 'profile',
      });
      if (isConflict) throw new ConflictException(errMsg);
      throw new Error(`Failed to update tax_id: ${updErr.message}`);
    }

    // Sync Stripe (best-effort)
    const { data: sub } = await client
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    const customerId = sub?.stripe_customer_id ?? null;
    const hasCustomer = !!customerId;
    let stripeSynced = false;

    if (customerId) {
      try {
        const stripe = this.stripe.getClient();

        // Create-first then delete-old: if anything after create fails, the
        // customer still has a valid tax_id (the new one), instead of being
        // left with no tax_id at all.
        const created = await stripe.customers.createTaxId(customerId, {
          type: dto.type === 'cpf' ? 'br_cpf' : 'br_cnpj',
          value: digits,
        });

        const existing = await stripe.customers.listTaxIds(customerId);
        for (const t of existing.data ?? []) {
          if ((t.type === 'br_cpf' || t.type === 'br_cnpj') && t.id !== created.id) {
            await stripe.customers.deleteTaxId(customerId, t.id);
          }
        }

        await stripe.customers.update(customerId, {
          metadata: {
            cpf: newPair.cpf ?? '',
            cnpj: newPair.cnpj ?? '',
          },
        });
        stripeSynced = true;
      } catch (err: any) {
        this.logger.warn(`Stripe tax_id sync failed for user ${userId}: ${err?.message}`);
        stripeSynced = false;
      }
    }

    const afterLabel = this.taxIdLabelFromProfile(newPair.cpf, newPair.cnpj);
    const successPayload: any = {
      userId, userEmail, field: 'tax_id',
      before: beforeLabel, after: afterLabel,
    };
    if (hasCustomer) successPayload.stripeSynced = stripeSynced;
    this.discord.logAccountChangeSuccess(successPayload);

    return { type: dto.type, value: digits, stripeSynced };
  }

  private formatTaxIdForLog(type: TaxIdType, digits: string): string {
    if (type === 'cpf' && digits.length === 11) {
      return `CPF · ${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
    }
    if (type === 'cnpj' && digits.length === 14) {
      return `CNPJ · ${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
    }
    return `${type.toUpperCase()} · ${digits}`;
  }

  private taxIdLabelFromProfile(cpf?: string | null, cnpj?: string | null): string {
    if (cpf) return this.formatTaxIdForLog('cpf', cpf);
    if (cnpj) return this.formatTaxIdForLog('cnpj', cnpj);
    return '—';
  }

  async updateEmail(
    userId: string,
    userEmail: string,
    dto: { email: string },
  ): Promise<{ email: string; stripeSynced: boolean }> {
    const newEmail = dto.email.trim().toLowerCase();

    // Idempotent no-op: same email
    if (userEmail.toLowerCase() === newEmail) {
      return { email: newEmail, stripeSynced: false };
    }

    const client = this.supabase.getClient();

    // 1) Duplicidade (validation stage)
    try {
      const { data: list, error: listErr } = await client.auth.admin.listUsers({ email: newEmail } as any);
      if (listErr) throw new Error(listErr.message);
      const taken = list?.users?.find((u: any) => u.email?.toLowerCase() === newEmail && u.id !== userId);
      if (taken) {
        const msg = 'Este e-mail já está em uso';
        this.discord.logAccountChangeError({
          userId, userEmail, field: 'email',
          attempted: newEmail,
          errorMessage: msg,
          stage: 'validation',
        });
        throw new ConflictException(msg);
      }
    } catch (err: any) {
      if (err instanceof ConflictException) throw err;
      // listUsers itself failed — log and continue (Auth update is the real gate).
      this.logger.warn(`listUsers failed during email duplicity check: ${err?.message}`);
    }

    // 2) Auth update (mandatory)
    const { error: authErr } = await client.auth.admin.updateUserById(userId, {
      email: newEmail,
      email_confirm: true,
    } as any);
    if (authErr) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'email',
        attempted: newEmail,
        errorMessage: authErr.message,
        stage: 'auth',
      });
      throw new Error(`Failed to update auth email: ${authErr.message}`);
    }

    // 3) DB update (the trigger from migration 20260502170000 also covers this,
    //    but we update explicitly to keep response and downstream consistent).
    const { error: dbErr } = await client
      .from('profiles')
      .update({ email: newEmail, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (dbErr) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'email',
        attempted: newEmail,
        errorMessage: dbErr.message,
        stage: 'profile',
      });
      throw new Error(`Failed to update profile email: ${dbErr.message}`);
    }

    // 4) Stripe (best-effort)
    const { data: sub } = await client
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    const customerId = sub?.stripe_customer_id ?? null;
    let stripeSynced = false;
    const hasCustomer = !!customerId;
    if (customerId) {
      try {
        await this.stripe.getClient().customers.update(customerId, { email: newEmail });
        stripeSynced = true;
      } catch (err: any) {
        this.logger.warn(`Stripe email sync failed for user ${userId}: ${err?.message}`);
        stripeSynced = false;
      }
    }

    // 5) Revoke sessions (best-effort but loud)
    try {
      await (client.auth.admin as any).signOut(userId, 'global');
    } catch (err: any) {
      this.logger.warn(`signOut(global) failed for user ${userId}: ${err?.message}`);
    }

    const successPayload: any = {
      userId, userEmail, field: 'email',
      before: userEmail, after: newEmail,
    };
    if (hasCustomer) successPayload.stripeSynced = stripeSynced;
    this.discord.logAccountChangeSuccess(successPayload);

    return { email: newEmail, stripeSynced };
  }

  async updatePassword(
    userId: string,
    userEmail: string,
    dto: { password: string },
  ): Promise<{ ok: true }> {
    const client = this.supabase.getClient();
    const { error } = await client.auth.admin.updateUserById(userId, {
      password: dto.password,
    });

    if (error) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'password',
        errorMessage: error.message,
        stage: 'auth',
      });
      throw new Error(`Failed to update password: ${error.message}`);
    }

    this.discord.logAccountChangeSuccess({
      userId, userEmail, field: 'password',
    });
    return { ok: true };
  }
}
