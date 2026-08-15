import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { NameRow } from './rows/NameRow';
import { EmailRow } from './rows/EmailRow';
import { TaxIdRow } from './rows/TaxIdRow';
import { PasswordRow } from './rows/PasswordRow';
import { EditableRowGroup } from './EditableRowGroup';

interface ProfileRow {
  name: string | null;
  email: string | null;
  cpf: string | null;
  cnpj: string | null;
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

export function ProfileCard() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<ProfileRow | null>({
    queryKey: ['profile', user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('name, email, cpf, cnpj')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Carregando…
        </CardContent>
      </Card>
    );
  }

  const taxIdType = data.cnpj ? 'cnpj' : 'cpf';
  const taxIdValue = data.cnpj ?? data.cpf ?? '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil</CardTitle>
        <CardDescription>
          Suas informações pessoais e segurança da conta. Clique em Editar para alterar um item.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar className="h-20 w-20">
            <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
              {data.name ? getInitials(data.name) : 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="text-base font-semibold tracking-tight">{data.name || '—'}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{data.email}</div>
          </div>
          <Button variant="outline" disabled>Alterar foto</Button>
        </div>

        <EditableRowGroup>
          <div className="flex flex-col">
            <NameRow name={data.name ?? ''} />
            <EmailRow email={data.email ?? ''} />
            <TaxIdRow initialType={taxIdType} initialValue={taxIdValue} />
            <PasswordRow />
          </div>
        </EditableRowGroup>
      </CardContent>
    </Card>
  );
}
