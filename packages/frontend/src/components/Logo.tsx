import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const APP_NAME = 'Painel de Tracking';

// Marca neutra: ícone + nome. Sem imagem, para quem implantar trocar só o
// APP_NAME (e o <title> do index.html) em vez de caçar arquivos de logo.
const SIZES = {
  sm: { box: 'h-7 w-7 rounded-md', icon: 'h-4 w-4', text: 'text-sm' },
  md: { box: 'h-8 w-8 rounded-lg', icon: 'h-5 w-5', text: 'text-base' },
  lg: { box: 'h-12 w-12 rounded-xl', icon: 'h-7 w-7', text: 'text-xl' },
};

interface LogoProps {
  size?: keyof typeof SIZES;
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  const s = SIZES[size];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('flex shrink-0 items-center justify-center bg-primary text-primary-foreground', s.box)}>
        <BarChart3 className={s.icon} />
      </div>
      {showText && <span className={cn('font-semibold tracking-tight text-foreground', s.text)}>{APP_NAME}</span>}
    </div>
  );
}
