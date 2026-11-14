/**
 * Pure URL query-string parser & serializer for Room / Design Variations.
 *
 * Supports both:
 * - Compact multi-group parameter: `?vars=groupId:optionId,group2:opt2`
 * - Per-group parameter overrides: `?var.<groupId>=<optionId>`
 */

export const VARIATIONS_QUERY_PARAM = 'vars';
export const VARIATION_PARAM_PREFIX = 'var.';

const SAFE_VARIATION_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

export function isSafeVariationId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_VARIATION_ID_RE.test(value);
}

/**
 * Parses room variation selections from a URL `search` string (e.g. `window.location.search`).
 * Supports `?vars=groupA:opt1,groupB:opt2` and `?var.groupA=opt1` (later params win).
 */
export function parseVariationSearchParams(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!search) return out;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  for (const [key, rawVal] of params.entries()) {
    if (key === VARIATIONS_QUERY_PARAM) {
      const pairs = rawVal.split(',');
      for (const pair of pairs) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx <= 0 || colonIdx >= trimmed.length - 1) continue;
        const groupId = trimmed.slice(0, colonIdx).trim();
        const optionId = trimmed.slice(colonIdx + 1).trim();
        if (isSafeVariationId(groupId) && isSafeVariationId(optionId)) {
          out[groupId] = optionId;
        }
      }
    } else if (key.startsWith(VARIATION_PARAM_PREFIX)) {
      const groupId = key.slice(VARIATION_PARAM_PREFIX.length).trim();
      const optionId = rawVal.trim();
      if (isSafeVariationId(groupId) && isSafeVariationId(optionId)) {
        out[groupId] = optionId;
      }
    }
  }
  return out;
}

/** Formats non-empty `groupId -> optionId` selections into `groupId:optionId,...`. */
export function formatVariationSearchParam(selections: Readonly<Record<string, string>>): string {
  const parts: string[] = [];
  for (const [groupId, optionId] of Object.entries(selections)) {
    if (isSafeVariationId(groupId) && isSafeVariationId(optionId)) {
      parts.push(`${groupId}:${optionId}`);
    }
  }
  return parts.join(',');
}

/**
 * Returns an updated URL string with `selections` written to `?vars=...` (and any stale
 * `?var.<groupId>=...` params normalized), preserving all unrelated query params & hash.
 * When `selections` is empty (all groups at defaults), removes `?vars` and `?var.*`.
 */
export function applyVariationsToUrl(
  baseHref: string,
  selections: Readonly<Record<string, string>>
): string {
  const url = new URL(baseHref);
  const keysToDelete: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (key === VARIATIONS_QUERY_PARAM || key.startsWith(VARIATION_PARAM_PREFIX)) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    url.searchParams.delete(key);
  }
  const formatted = formatVariationSearchParam(selections);
  if (formatted.length > 0) {
    url.searchParams.set(VARIATIONS_QUERY_PARAM, formatted);
  }
  return url.toString();
}
