/**
 * URL canonicalization — strip tracking params before fingerprint generation.
 * Per DOMAIN.md: /job/123?utm_source=email and /job/123?tracking_id=xyz
 * must resolve to /job/123.
 */

const TRACKING_PREFIXES = ['utm_', 'tracking_'];
const TRACKING_EXACT = new Set([
  'fbclid',
  'gclid',
  'msclkid',
  '_ga',
  '_gl',
  'yclid',
  'dclid',
  'igshid',
  'mc_eid',
  'mkt_tok',
  'trk',
  'trkcampaign',
  'sc_campaign',
  'spm',
]);

/**
 * Canonicalize a URL for deduplication fingerprinting.
 * - Lowercases hostname
 * - Removes default ports (80/443)
 * - Removes tracking query parameters (utm_*, tracking_id, fbclid, etc.)
 * - Sorts remaining query params
 * - Removes fragment (#)
 * - Removes trailing slash (except root)
 */
export function canonicalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);

    // Lowercase hostname
    url.hostname = url.hostname.toLowerCase();

    // Remove default ports
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }

    // Filter query params
    const params = new URLSearchParams(url.search);
    const keys = Array.from(params.keys());
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (TRACKING_EXACT.has(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p))) {
        params.delete(key);
      }
    }
    params.sort();
    url.search = params.toString() ? `?${params.toString()}` : '';

    // Remove fragment
    url.hash = '';

    // Normalize pathname: remove trailing slash except root
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    url.pathname = pathname;

    return url.toString();
  } catch {
    // If URL parsing fails, return trimmed original — validation will reject later
    return trimmed;
  }
}

/**
 * Validate URL is http(s) and parseable.
 */
export function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
