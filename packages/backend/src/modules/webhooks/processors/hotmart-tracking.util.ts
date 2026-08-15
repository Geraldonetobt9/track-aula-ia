export interface ParsedHotmartTracking {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ad_id: string | null;
  campaign_fb_id: string | null;
  adset_fb_id: string | null;
}

const EMPTY: ParsedHotmartTracking = {
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  utm_term: null,
  ad_id: null,
  campaign_fb_id: null,
  adset_fb_id: null,
};

function extractNumericId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const subParts = trimmed.split('/');
  for (let i = subParts.length - 1; i >= 0; i--) {
    const sub = subParts[i].trim();
    if (/^\d+$/.test(sub) && sub.length > 5) return sub;
  }
  return null;
}

export function parseXcod(xcod: string | null): ParsedHotmartTracking {
  if (!xcod) return { ...EMPTY };

  const parts = xcod.split('|');
  const utm_source = parts[0] || null;
  const utm_medium =
    parts[1] && parts[2] ? `${parts[1]}|${parts[2]}` : parts[1] || null;
  const utm_campaign =
    parts[3] && parts[4] ? `${parts[3]}|${parts[4]}` : parts[3] || null;
  const utm_content =
    parts[5] && parts[6] ? `${parts[5]}|${parts[6]}` : parts[5] || null;
  const utm_term = parts[7] || null;

  let ad_id = extractNumericId(parts[6]);
  if (!ad_id) {
    const slashParts = xcod.split(/[|\/]/);
    for (let i = slashParts.length - 1; i >= 0; i--) {
      const sub = slashParts[i].trim();
      if (/^\d+$/.test(sub) && sub.length > 5) {
        ad_id = sub;
        break;
      }
    }
  }

  return {
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    ad_id,
    campaign_fb_id: extractNumericId(parts[2]),
    adset_fb_id: extractNumericId(parts[4]),
  };
}

export function extractAdIdFromValue(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(/[|\/]/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const trimmed = parts[i].trim();
    if (/^\d+$/.test(trimmed) && trimmed.length > 5) return trimmed;
  }
  const cleaned = value.trim();
  if (/^\d+$/.test(cleaned) && cleaned.length > 5) return cleaned;
  return null;
}
