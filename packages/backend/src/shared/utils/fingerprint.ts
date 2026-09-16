import crypto from 'crypto';

/**
 * Normalize text for fingerprint: lowercased, trimmed, collapsed whitespace,
 * stripped punctuation/extra symbols for stable hashing.
 */
export function normalizeForFingerprint(input: string): string {
  if (!input) return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width
    .trim();
}

/**
 * Generate job fingerprint per DOMAIN.md:
 * hash(source_type + "|" + canonical_url + "|" + normalized_title + "|" + normalized_company)
 *
 * Uses SHA-256 hex (64 chars) — matches jobFingerprint VARCHAR(64) UNIQUE.
 */
export function generateJobFingerprint(params: {
  sourceType: string;
  canonicalUrl: string;
  normalizedTitle: string;
  normalizedCompany: string;
}): string {
  const raw = `${params.sourceType}|${params.canonicalUrl}|${params.normalizedTitle}|${params.normalizedCompany}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Generic SHA-256 hex helper.
 */
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
