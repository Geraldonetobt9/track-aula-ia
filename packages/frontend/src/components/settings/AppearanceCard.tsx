import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const OPTIONS = [
  {
    value: 'system',
    label: 'Sistema',
    description: 'Acompanha a preferência do seu sistema operacional.',
    icon: Monitor,
  },
  {
    value: 'light',
    label: 'Claro',
    description: 'Visual claro, ideal para ambientes iluminados.',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'Escuro',
    description: 'Visual escuro, padrão original do painel.',
    icon: Moon,
  },
] as const;

export function AppearanceCard() {
  const { theme, setTheme } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tema</CardTitle>
        <CardDescription>Escolha como o painel aparece para você.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          {OPTIONS.map(({ value, label, description, icon: Icon }) => {
            const selected = theme === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={selected}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors',
                  selected
                    ? 'border-primary bg-accent/10'
                    : 'border-border hover:bg-foreground/5',
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5',
                    selected ? 'text-accent-readable' : 'text-muted-foreground',
                  )}
                  strokeWidth={1.5}
                />
                <div className="font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{description}</div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
