import { describe, it, expect } from 'vitest';
import { canonicalizeUrl } from '../../shared/utils/url.js';
import { sanitizeHtml, sanitizeText } from '../../shared/utils/sanitize.js';
import { generateJobFingerprint, normalizeForFingerprint } from '../../shared/utils/fingerprint.js';
import { JobNormalizer } from './jobs.service.js';

describe('URL Canonicalization', () => {
  it('strips utm params and normalizes', () => {
    expect(canonicalizeUrl('https://example.com/job/123?utm_source=email&utm_medium=test')).toBe('https://example.com/job/123');
    expect(canonicalizeUrl('https://example.com/job/123?tracking_id=xyz&page=2')).toBe('https://example.com/job/123?page=2');
    expect(canonicalizeUrl('https://EXAMPLE.COM/job/123/')).toBe('https://example.com/job/123');
    expect(canonicalizeUrl('https://example.com/job/123?fbclid=xxx&gclid=yyy&a=1&b=2')).toBe('https://example.com/job/123?a=1&b=2');
    expect(canonicalizeUrl('https://example.com/job/123#section')).toBe('https://example.com/job/123');
  });

  it('sorts remaining params', () => {
    expect(canonicalizeUrl('https://example.com/search?z=1&a=2&m=3')).toBe('https://example.com/search?a=2&m=3&z=1');
  });
});

describe('Fingerprint', () => {
  it('is deterministic for same inputs', () => {
    const fp1 = generateJobFingerprint({
      sourceType: 'linkedin',
      canonicalUrl: 'https://example.com/job/123',
      normalizedTitle: 'senior engineer',
      normalizedCompany: 'acme',
    });
    const fp2 = generateJobFingerprint({
      sourceType: 'linkedin',
      canonicalUrl: 'https://example.com/job/123',
      normalizedTitle: 'senior engineer',
      normalizedCompany: 'acme',
    });
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64);
  });

  it('differs when url has tracking stripped', () => {
    const url1 = canonicalizeUrl('https://example.com/job/123?utm_source=email');
    const url2 = canonicalizeUrl('https://example.com/job/123');
    expect(url1).toBe(url2);
    const fp1 = generateJobFingerprint({ sourceType: 'indeed', canonicalUrl: url1, normalizedTitle: 'a', normalizedCompany: 'b' });
    const fp2 = generateJobFingerprint({ sourceType: 'indeed', canonicalUrl: url2, normalizedTitle: 'a', normalizedCompany: 'b' });
    expect(fp1).toBe(fp2);
  });

  it('normalizeForFingerprint collapses case and spaces', () => {
    expect(normalizeForFingerprint('  Senior   Engineer ')).toBe('senior engineer');
    expect(normalizeForFingerprint('ACME Corp.')).toBe('acme corp.');
  });
});

describe('Sanitization', () => {
  it('removes script tags', () => {
    const input = 'Hello <script>alert(1)</script> world';
    expect(sanitizeHtml(input)).toBe('Hello  world');
  });
  it('removes event handlers', () => {
    const input = '<div onclick="alert(1)">click</div>hello';
    const sanitized = sanitizeHtml(input);
    expect(sanitized).not.toContain('onclick');
  });
  it('sanitizeText collapses whitespace', () => {
    expect(sanitizeText('  hello   world  ')).toBe('hello world');
  });
});

describe('JobNormalizer', () => {
  const normalizer = new JobNormalizer();

  it('normalizes and generates fingerprint', () => {
    const raw = {
      title: '  Senior Engineer ',
      company: 'ACME ',
      url: 'https://example.com/job/123?utm_source=email',
      description: '<p>Hello world</p><script>alert(1)</script>',
      external_job_id: ' 123 ',
      location: 'Remote',
      salary: '$100k',
      scraped_at: new Date().toISOString(),
    };
    const normalized = normalizer.normalize(raw, 'source-id-1', 'linkedin');
    expect(normalized.title).toBe('Senior Engineer');
    expect(normalized.company).toBe('ACME');
    expect(normalized.externalJobId).toBe('123');
    expect(normalized.canonicalUrl).toBe('https://example.com/job/123');
    expect(normalized.description).not.toContain('<script>');
    expect(normalized.jobFingerprint).toHaveLength(64);
  });

  it('handles missing external id', () => {
    const raw = {
      title: 'Dev',
      company: 'Co',
      url: 'https://example.com/j/1',
      description: 'desc',
    };
    const normalized = normalizer.normalize(raw as any, 'sid', 'indeed');
    expect(normalized.externalJobId).toBeNull();
  });

  it('canonicalizes url for fingerprint uniqueness', () => {
    const raw1 = { title: 'T', company: 'C', url: 'https://example.com/job/123?utm_campaign=test', description: 'd' } as any;
    const raw2 = { title: 'T', company: 'C', url: 'https://example.com/job/123', description: 'd' } as any;
    const n1 = normalizer.normalize(raw1, 'sid', 'linkedin');
    const n2 = normalizer.normalize(raw2, 'sid', 'linkedin');
    expect(n1.jobFingerprint).toBe(n2.jobFingerprint);
    expect(n1.canonicalUrl).toBe(n2.canonicalUrl);
  });
});
