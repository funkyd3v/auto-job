// Treat scraped data as untrusted — never store/inject raw HTML.
const DANGEROUS_TAG_REGEX = /<\s*(script|iframe|object|embed|form|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const EVENT_HANDLER_REGEX = /\s*on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_PROTOCOL_REGEX = /javascript\s*:/gi;

export function sanitizeHtml(input: string): string {
  if (!input) return '';
  let out = input.trim();
  out = out.replace(DANGEROUS_TAG_REGEX, '');
  out = out.replace(EVENT_HANDLER_REGEX, '');
  out = out.replace(JS_PROTOCOL_REGEX, '');
  return out.trim();
}

export function sanitizeText(input: string, maxLength?: number): string {
  if (!input) return '';
  let out = input.trim().replace(/\s+/g, ' ');
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (maxLength && out.length > maxLength) out = out.slice(0, maxLength);
  return out;
}
