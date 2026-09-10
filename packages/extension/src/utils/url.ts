// Client-side canonicalization — mirrors backend shared/utils/url.ts
// Keep in sync; backend is authoritative.

const TRACKING_PREFIXES = ['utm_', 'tracking_'];
const TRACKING_EXACT = new Set(['fbclid', 'gclid', 'msclkid', '_ga', '_gl', 'yclid', 'dclid', 'igshid', 'mc_eid', 'mkt_tok', 'trk', 'trkcampaign', 'sc_campaign', 'spm']);

export function canonicalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
    const params = new URLSearchParams(url.search);
    const keys: string[] = [];
    params.forEach((_, k) => keys.push(k));
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (TRACKING_EXACT.has(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p))) params.delete(key);
    }
    params.sort();
    url.search = params.toString() ? `?${params.toString()}` : '';
    url.hash = '';
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    url.pathname = pathname;
    return url.toString();
  } catch {
    return trimmed;
  }
}
