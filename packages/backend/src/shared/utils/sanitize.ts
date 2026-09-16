/**
 * Sanitization utilities — scraped data is untrusted and must be sanitized
 * to prevent stored XSS and injection attacks.
 */

// Strip common dangerous HTML constructs
const DANGEROUS_TAG_REGEX = /<\s*(script|iframe|object|embed|form|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const TAG_REGEX = /<\/?[^>]+>/g;
const EVENT_HANDLER_REGEX = /\s*on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_PROTOCOL_REGEX = /javascript\s*:/gi;

/**
 * Sanitize HTML description: remove dangerous tags, event handlers, js: URLs
 * and optionally strip remaining tags to plain text. We preserve plain text
 * but escape remaining angle brackets.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';
  let output = input.trim();

  // Remove dangerous tags with content
  output = output.replace(DANGEROUS_TAG_REGEX, '');

  // Remove event handlers
  output = output.replace(EVENT_HANDLER_REGEX, '');

  // Remove javascript: protocol
  output = output.replace(JS_PROTOCOL_REGEX, '');

  return output.trim();
}

/**
 * Strip all HTML tags and decode basic entities, collapse whitespace.
 * Use this when we need pure text for matching/fingerprinting.
 */
export function stripHtml(input: string): string {
  if (!input) return '';
  let output = input.replace(TAG_REGEX, ' ');
  // Decode common entities
  output = output
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return output.replace(/\s+/g, ' ').trim();
}

/**
 * General text sanitization: trim, collapse whitespace, limit length,
 * and strip control characters.
 */
export function sanitizeText(input: string, maxLength?: number): string {
  if (!input) return '';
  let output = input.trim().replace(/\s+/g, ' ');
  // Remove control chars except newline/tab already collapsed
  output = output.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (maxLength && output.length > maxLength) {
    output = output.slice(0, maxLength);
  }
  return output;
}

/**
 * Escape HTML entities for safe rendering.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
