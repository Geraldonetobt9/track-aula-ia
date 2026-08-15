import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from '../account.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { StripeService } from '../../stripe/stripe.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';

describe('AccountService.updateProfile', () => {
  let service: AccountService;
  let updateFn: jest.Mock;
  let selectFn: jest.Mock;
  let logSuccess: jest.Mock;
  let logError: jest.Mock;
  let updateSpy: jest.Mock;

  beforeEach(async () => {
    updateFn = jest.fn().mockResolvedValue({ data: null, error: null });
    selectFn = jest.fn().mockResolvedValue({
      data: { name: 'Old Name' },
      error: null,
    });
    logSuccess = jest.fn();
    logError = jest.fn();
    updateSpy = jest.fn(() => ({ eq: updateFn }));

    const supabase = {
      getClient: () => ({
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: selectFn }) }),
          update: updateSpy,
        }),
      }),
    };
    const stripe = { getClient: () => ({}) };
    const discord = {
      logAccountChangeSuccess: logSuccess,
      logAccountChangeError: logError,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StripeService, useValue: stripe },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();
    service = module.get(AccountService);
  });

  it('updates the name and emits Discord success log with before/after', async () => {
    const result = await service.updateProfile('user-1', 'a@b.com', {
      name: 'New Name',
    });

    expect(result).toEqual({ name: 'New Name' });
    expect(updateFn).toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith({
      name: 'New Name',
      updated_at: expect.any(String),
    });
    expect(logSuccess).toHaveBeenCalledWith({
      userId: 'user-1',
      userEmail: 'a@b.com',
      field: 'name',
      before: 'Old Name',
      after: 'New Name',
    });
  });

  it('emits Discord error log on DB failure', async () => {
    updateFn.mockResolvedValueOnce({ data: null, error: { message: 'DB down' } });
    await expect(
      service.updateProfile('user-1', 'a@b.com', { name: 'New' }),
    ).rejects.toThrow();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'name',
        stage: 'profile',
        errorMessage: expect.stringContaining('DB down'),
      }),
    );
  });

  it('no-ops when name is unchanged: no DB write, no Discord log', async () => {
    selectFn.mockResolvedValueOnce({ data: { name: 'Same' }, error: null });

    const result = await service.updateProfile('user-1', 'a@b.com', {
      name: 'Same',
    });

    expect(result).toEqual({ name: 'Same' });
    expect(updateFn).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(logSuccess).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('emits Discord error log with stage=profile when reading the profile fails', async () => {
    selectFn.mockResolvedValueOnce({ data: null, error: { message: 'Read denied' } });

    await expect(
      service.updateProfile('user-1', 'a@b.com', { name: 'New' }),
    ).rejects.toThrow();

    expect(updateFn).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'name',
        stage: 'profile',
        errorMessage: expect.stringContaining('Read denied'),
      }),
    );
    expect(logSuccess).not.toHaveBeenCalled();
  });
});

describe('AccountService.updatePassword', () => {
  let service: AccountService;
  let adminUpdateUser: jest.Mock;
  let logSuccess: jest.Mock;
  let logError: jest.Mock;

  beforeEach(async () => {
    adminUpdateUser = jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    logSuccess = jest.fn();
    logError = jest.fn();

    const supabase = {
      getClient: () => ({
        auth: { admin: { updateUserById: adminUpdateUser } },
      }),
    };
    const stripe = { getClient: () => ({}) };
    const discord = { logAccountChangeSuccess: logSuccess, logAccountChangeError: logError };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StripeService, useValue: stripe },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();
    service = module.get(AccountService);
  });

  it('updates password via Supabase admin and logs success', async () => {
    const result = await service.updatePassword('user-1', 'a@b.com', { password: 'NewPass123!' });
    expect(adminUpdateUser).toHaveBeenCalledWith('user-1', { password: 'NewPass123!' });
    expect(logSuccess).toHaveBeenCalledWith({
      userId: 'user-1', userEmail: 'a@b.com', field: 'password',
    });
    expect(result).toEqual({ ok: true });
  });

  it('emits Discord error log on Auth failure', async () => {
    adminUpdateUser.mockResolvedValueOnce({ data: null, error: { message: 'Auth API failure' } });
    await expect(
      service.updatePassword('user-1', 'a@b.com', { password: 'NewPass123!' }),
    ).rejects.toThrow();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'password', stage: 'auth',
        errorMessage: expect.stringContaining('Auth API failure'),
      }),
    );
  });
});

describe('AccountService.updateTaxId', () => {
  let service: AccountService;
  let profileUpdateFn: jest.Mock;
  let profileSelectFn: jest.Mock;
  let subSelectFn: jest.Mock;
  let stripeTaxIdsList: jest.Mock;
  let stripeTaxIdsCreate: jest.Mock;
  let stripeTaxIdsDel: jest.Mock;
  let stripeCustomerUpdate: jest.Mock;
  let logSuccess: jest.Mock;
  let logError: jest.Mock;

  beforeEach(async () => {
    profileUpdateFn = jest.fn().mockResolvedValue({ data: null, error: null });
    profileSelectFn = jest.fn().mockResolvedValue({
      data: { cpf: '52998224725', cnpj: null },
      error: null,
    });
    subSelectFn = jest.fn().mockResolvedValue({
      data: { stripe_customer_id: 'cus_123' },
      error: null,
    });
    stripeTaxIdsList = jest.fn().mockResolvedValue({
      data: [
        { id: 'txi_old', type: 'br_cpf', value: '52998224725' },
        { id: 'txi_new', type: 'br_cnpj', value: '11222333000181' },
      ],
    });
    stripeTaxIdsCreate = jest.fn().mockResolvedValue({ id: 'txi_new' });
    stripeTaxIdsDel = jest.fn().mockResolvedValue({ deleted: true });
    stripeCustomerUpdate = jest.fn().mockResolvedValue({ id: 'cus_123' });
    logSuccess = jest.fn();
    logError = jest.fn();

    const supabase = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'profiles') return {
            select: () => ({ eq: () => ({ maybeSingle: profileSelectFn }) }),
            update: () => ({ eq: profileUpdateFn }),
          };
          if (table === 'subscriptions') return {
            select: () => ({ eq: () => ({ maybeSingle: subSelectFn }) }),
          };
          return {};
        },
      }),
    };
    const stripe = {
      getClient: () => ({
        customers: {
          listTaxIds: stripeTaxIdsList,
          createTaxId: stripeTaxIdsCreate,
          deleteTaxId: stripeTaxIdsDel,
          update: stripeCustomerUpdate,
        },
      }),
    };
    const discord = { logAccountChangeSuccess: logSuccess, logAccountChangeError: logError };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StripeService, useValue: stripe },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();
    service = module.get(AccountService);
  });

  it('rejects invalid CPF', async () => {
    await expect(
      service.updateTaxId('u', 'a@b.com', { type: 'cpf', value: '111.111.111-11' }),
    ).rejects.toThrow(/CPF inválido/);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'tax_id', stage: 'validation' }),
    );
  });

  it('switches CPF→CNPJ in DB and replaces Stripe tax_id', async () => {
    const result = await service.updateTaxId('user-1', 'a@b.com', {
      type: 'cnpj',
      value: '11.222.333/0001-81',
    });

    expect(profileUpdateFn).toHaveBeenCalled();
    expect(stripeTaxIdsList).toHaveBeenCalledWith('cus_123');
    expect(stripeTaxIdsDel).toHaveBeenCalledWith('cus_123', 'txi_old');
    expect(stripeTaxIdsCreate).toHaveBeenCalledWith('cus_123', {
      type: 'br_cnpj',
      value: '11222333000181',
    });
    expect(stripeCustomerUpdate).toHaveBeenCalledWith('cus_123', {
      metadata: expect.objectContaining({ cnpj: '11222333000181' }),
    });
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'tax_id', stripeSynced: true,
      }),
    );
    expect(result).toEqual({ type: 'cnpj', value: '11222333000181', stripeSynced: true });
  });

  it('returns stripeSynced=false when Stripe call fails (best effort)', async () => {
    stripeTaxIdsCreate.mockRejectedValueOnce(new Error('Stripe down'));
    const result = await service.updateTaxId('user-1', 'a@b.com', {
      type: 'cnpj',
      value: '11.222.333/0001-81',
    });
    expect(result.stripeSynced).toBe(false);
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'tax_id', stripeSynced: false }),
    );
    // No separate error log — represented in success embed as ⚠️ pendente.
    expect(logError).not.toHaveBeenCalled();
  });

  it('skips Stripe entirely when no stripe_customer_id', async () => {
    subSelectFn.mockResolvedValueOnce({ data: { stripe_customer_id: null }, error: null });
    const result = await service.updateTaxId('user-1', 'a@b.com', {
      type: 'cnpj',
      value: '11.222.333/0001-81',
    });
    expect(stripeTaxIdsList).not.toHaveBeenCalled();
    expect(result.stripeSynced).toBe(false);
    // When there is no customer, log without stripeSynced field
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'tax_id' }),
    );
  });

  it('renders before label as "—" when user has neither CPF nor CNPJ', async () => {
    profileSelectFn.mockResolvedValueOnce({
      data: { cpf: null, cnpj: null },
      error: null,
    });
    // Use no Stripe customer to keep the test focused on the label
    subSelectFn.mockResolvedValueOnce({ data: { stripe_customer_id: null }, error: null });

    await service.updateTaxId('user-1', 'a@b.com', {
      type: 'cpf',
      value: '529.982.247-25',
    });

    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'tax_id',
        before: '—',
        after: 'CPF · 529.982.247-25',
      }),
    );
  });
});

describe('AccountService.updateEmail', () => {
  let service: AccountService;
  let listUsers: jest.Mock;
  let adminUpdateUser: jest.Mock;
  let signOut: jest.Mock;
  let profileUpdate: jest.Mock;
  let subSelect: jest.Mock;
  let stripeCustomerUpdate: jest.Mock;
  let logSuccess: jest.Mock;
  let logError: jest.Mock;

  beforeEach(async () => {
    listUsers = jest.fn().mockResolvedValue({ data: { users: [] }, error: null });
    adminUpdateUser = jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    signOut = jest.fn().mockResolvedValue({ error: null });
    profileUpdate = jest.fn().mockResolvedValue({ data: null, error: null });
    subSelect = jest.fn().mockResolvedValue({ data: { stripe_customer_id: 'cus_1' }, error: null });
    stripeCustomerUpdate = jest.fn().mockResolvedValue({ id: 'cus_1' });
    logSuccess = jest.fn();
    logError = jest.fn();

    const supabase = {
      getClient: () => ({
        auth: { admin: { listUsers, updateUserById: adminUpdateUser, signOut } },
        from: (table: string) => {
          if (table === 'profiles') return {
            update: () => ({ eq: profileUpdate }),
          };
          if (table === 'subscriptions') return {
            select: () => ({ eq: () => ({ maybeSingle: subSelect }) }),
          };
          return {};
        },
      }),
    };
    const stripe = {
      getClient: () => ({ customers: { update: stripeCustomerUpdate } }),
    };
    const discord = { logAccountChangeSuccess: logSuccess, logAccountChangeError: logError };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StripeService, useValue: stripe },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();
    service = module.get(AccountService);
  });

  it('changes email across Auth, DB, Stripe and revokes sessions', async () => {
    const result = await service.updateEmail('user-1', 'old@x.com', { email: 'new@x.com' });

    expect(adminUpdateUser).toHaveBeenCalledWith('user-1', {
      email: 'new@x.com', email_confirm: true,
    });
    expect(profileUpdate).toHaveBeenCalled();
    expect(stripeCustomerUpdate).toHaveBeenCalledWith('cus_1', { email: 'new@x.com' });
    expect(signOut).toHaveBeenCalledWith('user-1', 'global');
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'email', before: 'old@x.com', after: 'new@x.com', stripeSynced: true,
      }),
    );
    expect(result).toEqual({ email: 'new@x.com', stripeSynced: true });
  });

  it('returns 200 idempotent no-op when email matches current', async () => {
    const result = await service.updateEmail('user-1', 'same@x.com', { email: 'same@x.com' });
    expect(adminUpdateUser).not.toHaveBeenCalled();
    expect(logSuccess).not.toHaveBeenCalled();
    expect(result).toEqual({ email: 'same@x.com', stripeSynced: false });
  });

  it('throws Conflict when another user has the email', async () => {
    listUsers.mockResolvedValueOnce({
      data: { users: [{ id: 'someone-else', email: 'taken@x.com' }] },
      error: null,
    });
    await expect(
      service.updateEmail('user-1', 'old@x.com', { email: 'taken@x.com' }),
    ).rejects.toThrow(/já está em uso|already/i);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'email', stage: 'validation' }),
    );
  });

  it('aborts and logs error when Auth admin update fails', async () => {
    adminUpdateUser.mockResolvedValueOnce({ data: null, error: { message: 'Auth error' } });
    await expect(
      service.updateEmail('user-1', 'old@x.com', { email: 'new@x.com' }),
    ).rejects.toThrow();
    expect(profileUpdate).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'email', stage: 'auth' }),
    );
  });

  it('returns stripeSynced=false when Stripe update fails (best effort)', async () => {
    stripeCustomerUpdate.mockRejectedValueOnce(new Error('Stripe down'));
    const result = await service.updateEmail('user-1', 'old@x.com', { email: 'new@x.com' });
    expect(result.stripeSynced).toBe(false);
    expect(signOut).toHaveBeenCalled(); // signOut still happens
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ stripeSynced: false }),
    );
    expect(logError).not.toHaveBeenCalled();
  });
});
