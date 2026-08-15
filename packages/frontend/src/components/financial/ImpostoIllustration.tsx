import { useState } from 'react';

const IMPOSTO_IMAGE_SRC = '/imposto.webp';

/**
 * Illustration for the manual tax card. Height-capped so it fills the space
 * between the input and the period total without pushing the card taller than
 * the Meta Ads one beside it. Disappears if the file is absent.
 */
export function ImpostoIllustration() {
  const [missing, setMissing] = useState(false);

  if (missing) return null;

  return (
    <img
      src={IMPOSTO_IMAGE_SRC}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setMissing(true)}
      className="mx-auto max-h-36 w-auto rounded-lg object-contain"
    />
  );
}
