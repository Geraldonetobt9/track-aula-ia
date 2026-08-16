import { useMemo } from 'react';
import { useTheme } from 'next-themes';

export interface ChartColors {
  primary: string;
  accent: string;
  success: string;
  destructive: string;
  warning: string;
  info: string;
  muted: string;
  foreground: string;
  background: string;
  border: string;
  /** Multi-series palette for charts that need multiple distinct colors */
  series: string[];
  /** Returns an HSL string with the requested alpha (0–1) applied to a token name */
  withAlpha: (token: TokenName, alpha: number) => string;
}

type TokenName =
  | '--primary'
  | '--accent-readable'
  | '--success'
  | '--destructive'
  | '--warning'
  | '--info'
  | '--muted-foreground'
  | '--foreground'
  | '--background'
  | '--border';

function readHsl(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function token(name: string, fallback: string): string {
  const raw = readHsl(name);
  return raw ? `hsl(${raw})` : fallback;
}

export function useChartColors(): ChartColors {
  const { resolvedTheme } = useTheme();

  return useMemo(() => {
    const primary = token('--primary', '#3e8fd8');
    const accent = token('--accent-readable', primary);
    const success = token('--success', '#16a34a');
    const destructive = token('--destructive', '#dc2626');
    const warning = token('--warning', '#f59e0b');
    const info = token('--info', '#3b82f6');
    const muted = token('--muted-foreground', '#a1a4a5');
    const foreground = token('--foreground', '#171717');
    const background = token('--background', '#ffffff');
    const border = token('--border', '#e6e6e6');

    const tokenMap: Record<TokenName, string> = {
      '--primary': '--primary',
      '--accent-readable': '--accent-readable',
      '--success': '--success',
      '--destructive': '--destructive',
      '--warning': '--warning',
      '--info': '--info',
      '--muted-foreground': '--muted-foreground',
      '--foreground': '--foreground',
      '--background': '--background',
      '--border': '--border',
    };

    const withAlpha = (name: TokenName, alpha: number): string => {
      const raw = readHsl(tokenMap[name]);
      if (!raw) return `rgba(0,0,0,${alpha})`;
      return `hsl(${raw} / ${alpha})`;
    };

    return {
      primary,
      accent,
      success,
      destructive,
      warning,
      info,
      muted,
      foreground,
      background,
      border,
      series: [primary, info, accent, warning, success, destructive],
      withAlpha,
    };
  }, [resolvedTheme]);
}
