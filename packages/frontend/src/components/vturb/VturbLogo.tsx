import { useState } from 'react';
import { cn } from '@/lib/utils';

interface VturbLogoProps {
  className?: string;
}

/**
 * VTurb's mark, shown beside the page title.
 *
 * Served from `public/` rather than imported from `src/assets` on purpose: a
 * missing file there would break the build, while here it just fails to load.
 * Combined with the `onError` fallback, the page still renders its title if the
 * asset is ever absent — the logo is decoration, not information.
 */
export function VturbLogo({ className }: VturbLogoProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <img
      src="/vturb-logo.webp"
      alt="VTurb"
      onError={() => setFailed(true)}
      className={cn('h-7 w-7 shrink-0 object-contain sm:h-8 sm:w-8', className)}
    />
  );
}
