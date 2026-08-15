import { parseXcod as parse, extractAdIdFromValue as extractAdId } from '../hotmart-tracking.util';

type Parsed = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ad_id: string | null;
  campaign_fb_id: string | null;
  adset_fb_id: string | null;
};

describe('Hotmart tracking parser (snapshot of legacy behavior)', () => {
  it('parses real Facebook_Mobile_Reels format from the CSV export', () => {
    const xcod = 'Facebook_Mobile_Reels|[AyunoMetabolico] - BIDCAP|N49 -> N52 - 15/04|N50|120242604345070467';
    expect(parse(xcod)).toEqual({
      utm_source: 'Facebook_Mobile_Reels',
      utm_medium: '[AyunoMetabolico] - BIDCAP|N49 -> N52 - 15/04',
      utm_campaign: 'N50|120242604345070467',
      utm_content: null,
      utm_term: null,
      ad_id: '120242604345070467',
      campaign_fb_id: null,
      adset_fb_id: '120242604345070467',
    });
  });

  it('parses real FB long-tail format', () => {
    const xcod = 'FB|N32 - N36 - 12/04|120242453126740467|[AyunoMetabolico] - BIDCAP|120242302624290467|N34|120242453126770467|Facebook_Mobile_Feed';
    const p = parse(xcod);
    expect(p.utm_source).toBe('FB');
    expect(p.utm_medium).toBe('N32 - N36 - 12/04|120242453126740467');
    expect(p.utm_campaign).toBe('[AyunoMetabolico] - BIDCAP|120242302624290467');
    expect(p.utm_content).toBe('N34|120242453126770467');
    expect(p.utm_term).toBe('Facebook_Mobile_Feed');
    expect(p.ad_id).toBe('120242453126770467');
    expect(p.campaign_fb_id).toBe('120242453126740467');
    expect(p.adset_fb_id).toBe('120242302624290467');
  });

  it('parses Facebook_Stories single-tail format', () => {
    const xcod = 'Facebook_Stories|[AyunoMetabolico] - BIDCAP|N49 -> N52 - 15/04|N50|120242604345070467';
    const p = parse(xcod);
    expect(p.utm_source).toBe('Facebook_Stories');
    expect(p.ad_id).toBe('120242604345070467');
  });

  it('parses Instagram_Stories trailing-tail format', () => {
    const xcod = 'FB|N8.6 -> N8.9 - 09/04|120242362984860467|[AyunoMetabolico] - BIDCAP|120242302624290467|N8.7|120242362984880467|Instagram_Stories';
    const p = parse(xcod);
    expect(p.utm_term).toBe('Instagram_Stories');
    expect(p.ad_id).toBe('120242362984880467');
  });

  it('returns empty result for null xcod', () => {
    const p = parse(null);
    expect(p).toEqual({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      ad_id: null,
      campaign_fb_id: null,
      adset_fb_id: null,
    });
  });

  it('returns empty result for empty string', () => {
    const p = parse('');
    expect(p).toEqual({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      ad_id: null,
      campaign_fb_id: null,
      adset_fb_id: null,
    });
  });

  it('handles single-segment xcod with no ad id', () => {
    const p = parse('Organic');
    expect(p.utm_source).toBe('Organic');
    expect(p.ad_id).toBeNull();
  });

  it('handles xcod with slash-separated compound segment', () => {
    const p = parse('FB|medium|campaign|set/120242999999999');
    expect(p.ad_id).toBe('120242999999999');
  });

  describe('extractAdIdFromValue', () => {
    it('finds numeric id in pipe-separated string', () => {
      expect(extractAdId('src|120242453126770467|tail')).toBe('120242453126770467');
    });

    it('finds numeric id in slash-separated string', () => {
      expect(extractAdId('prefix/120242453126770467')).toBe('120242453126770467');
    });

    it('returns null when no digits-only segment of length > 5', () => {
      expect(extractAdId('no|numbers|here')).toBeNull();
      expect(extractAdId('12345')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(extractAdId(null)).toBeNull();
    });

    it('returns the whole value when it is a pure long numeric', () => {
      expect(extractAdId('120242999999999')).toBe('120242999999999');
    });
  });
});
