import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { SupabaseService } from '../../../shared/services/supabase.service';

describe('AuthService.signup', () => {
  let service: AuthService;
  let adminCreateUser: jest.Mock;
  let selectProfileFn: jest.Mock;

  beforeEach(async () => {
    adminCreateUser = jest.fn();
    selectProfileFn = jest.fn();

    const supabase = {
      getClient: () => ({
        auth: { admin: { createUser: adminCreateUser } },
        from: (table: string) => {
          if (table !== 'profiles') return {};
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: selectProfileFn,
              }),
            }),
          };
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  const baseDto = {
    email: 'user@example.com',
    password: 'StrongPass123',
    name: 'Teste Silva',
    termsAccepted: true,
  };

  it('creates user with CPF in metadata on valid input', async () => {
    selectProfileFn.mockResolvedValue({ data: null, error: null });
    adminCreateUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@example.com' } },
      error: null,
    });

    const result = await service.signup({
      ...baseDto,
      taxIdType: 'cpf',
      taxIdValue: '529.982.247-25',
    });

    expect(adminCreateUser).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'StrongPass123',
      email_confirm: true,
      user_metadata: { name: 'Teste Silva', cpf: '52998224725' },
    });
    expect(result).toEqual({ userId: 'user-1', email: 'user@example.com' });
  });

  it('creates user with CNPJ in metadata on valid input', async () => {
    selectProfileFn.mockResolvedValue({ data: null, error: null });
    adminCreateUser.mockResolvedValue({
      data: { user: { id: 'user-2', email: 'biz@example.com' } },
      error: null,
    });

    await service.signup({
      ...baseDto,
      email: 'biz@example.com',
      taxIdType: 'cnpj',
      taxIdValue: '11.222.333/0001-81',
    });

    expect(adminCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        user_metadata: expect.objectContaining({ cnpj: '11222333000181' }),
      }),
    );
  });

  it('rejects when terms are not accepted', async () => {
    await expect(
      service.signup({
        ...baseDto,
        termsAccepted: false,
        taxIdType: 'cpf',
        taxIdValue: '52998224725',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(adminCreateUser).not.toHaveBeenCalled();
  });

  it('rejects invalid CPF checksum', async () => {
    await expect(
      service.signup({
        ...baseDto,
        taxIdType: 'cpf',
        taxIdValue: '12345678900',
      }),
    ).rejects.toThrow(/CPF invalido/);
    expect(adminCreateUser).not.toHaveBeenCalled();
  });

  it('rejects invalid CNPJ checksum', async () => {
    await expect(
      service.signup({
        ...baseDto,
        taxIdType: 'cnpj',
        taxIdValue: '11.222.333/0001-99',
      }),
    ).rejects.toThrow(/CNPJ invalido/);
    expect(adminCreateUser).not.toHaveBeenCalled();
  });

  it('rejects when tax id already in use', async () => {
    selectProfileFn.mockResolvedValue({ data: { id: 'existing' }, error: null });

    await expect(
      service.signup({
        ...baseDto,
        taxIdType: 'cpf',
        taxIdValue: '52998224725',
      }),
    ).rejects.toThrow(ConflictException);
    expect(adminCreateUser).not.toHaveBeenCalled();
  });

  it('maps Supabase duplicate-email error to ConflictException', async () => {
    selectProfileFn.mockResolvedValue({ data: null, error: null });
    adminCreateUser.mockResolvedValue({
      data: null,
      error: { message: 'A user with this email has already been registered', code: 'email_exists' },
    });

    await expect(
      service.signup({
        ...baseDto,
        taxIdType: 'cpf',
        taxIdValue: '52998224725',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
