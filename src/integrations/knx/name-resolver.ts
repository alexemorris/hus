import type { CircuitId } from '../../core/types/knx.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { KnxProject } from './project.ts';

/**
 * Offline natural-language name resolver for a KNX project.
 *
 * Maps free text ("barn downlights", "the plant room", "mezzanine lamps") to circuit, zone and
 * zone-scene ids using only the project's own data: ids (camelCase split), names, short names,
 * room names, locations and `aliases`. Pure and synchronous — used by the AI assistant both to
 * coerce model output and as the local fallback parser.
 */

export interface KnxNameMatch<T extends string> {
  readonly id: T;
  /** 0..~1.2; higher is better. Exact alias / name matches score ≥ 1. */
  readonly score: number;
  /** The candidate phrase that produced the match (normalised). */
  readonly matched: string;
}

export interface KnxSceneMatch extends KnxNameMatch<string> {
  /** Index into the zone's `scenes` list. */
  readonly index: number;
}

export type KnxNameResolverProject = Pick<KnxProject, 'circuits' | 'zones' | 'rooms'>;

export interface KnxNameResolver {
  resolveCircuit(text: string): KnxNameMatch<CircuitId> | null;
  resolveZone(text: string): KnxNameMatch<RoomZoneId> | null;
  resolveScene(zoneId: RoomZoneId, text: string): KnxSceneMatch | null;
  /** All circuits scoring above the threshold, best first. */
  rankCircuits(text: string): readonly KnxNameMatch<CircuitId>[];
  /** All zones scoring above the threshold, best first. */
  rankZones(text: string): readonly KnxNameMatch<RoomZoneId>[];
}

/** Minimum score a candidate needs to be returned. */
export const KNX_NAME_MATCH_THRESHOLD = 0.5;

const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'my', 'our', 'please', 'in', 'on', 'of', 'to', 'at', 'for', 'and', 'with',
  'turn', 'switch', 'set', 'put', 'make', 'it', 'up', 'down', 'all', 'some', 'can', 'you', 'i',
]);

/** Fitting words: still matched, but count less than room / feature words. */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'light', 'lamp', 'downlight', 'spot', 'pendant', 'led', 'fitting', 'bulb', 'room', 'area',
]);

const SYNONYMS: Readonly<Record<string, string>> = {
  lighting: 'light',
  lights: 'light',
  spotlight: 'spot',
  spots: 'spot',
  spotlights: 'spot',
  downlighter: 'downlight',
  lamps: 'lamp',
  leds: 'led',
  '5a': '',
};

function singularise(word: string): string {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) {
    return word.slice(0, -1);
  }
  return word;
}

function normaliseToken(raw: string): string {
  const syn = SYNONYMS[raw];
  if (syn !== undefined) return syn;
  const single = singularise(raw);
  return SYNONYMS[single] ?? single;
}

/** Lower-cases, splits camelCase, `&`→and, strips punctuation and normalises plurals. */
export function tokeniseKnxName(text: string, keepStopWords = false): string[] {
  const spaced = text
    // "Lamps5A" / "5V/5A" — socket ratings carry no meaning for naming.
    .replace(/5A(?![a-z])/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ');
  const out: string[] = [];
  for (const raw of spaced.split(' ')) {
    if (!raw) continue;
    if (!keepStopWords && STOP_WORDS.has(raw)) continue;
    const tok = normaliseToken(raw);
    if (tok) out.push(tok);
  }
  return out;
}

interface CandidatePhrase {
  readonly tokens: readonly string[];
  readonly text: string;
  readonly weight: number;
}

interface Candidate<T extends string> {
  readonly id: T;
  readonly phrases: readonly CandidatePhrase[];
}

function phrase(text: string, weight: number): CandidatePhrase | null {
  const tokens = tokeniseKnxName(text);
  return tokens.length > 0 ? { tokens, text: tokens.join(' '), weight } : null;
}

function tokenWeight(tok: string): number {
  return GENERIC_WORDS.has(tok) ? 0.5 : 1;
}

function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function scorePhrase(query: readonly string[], p: CandidatePhrase): number {
  if (query.length === 0) return 0;
  const q = query.join(' ');
  if (q === p.text) return p.weight * 1.1;
  const querySet = new Set(query);
  let phraseTotal = 0;
  let phraseHit = 0;
  for (const tok of p.tokens) {
    const w = tokenWeight(tok);
    phraseTotal += w;
    if (querySet.has(tok)) phraseHit += w;
  }
  if (phraseHit === 0) return 0;
  const phraseSet = new Set(p.tokens);
  let queryTotal = 0;
  let queryHit = 0;
  for (const tok of query) {
    const w = tokenWeight(tok);
    queryTotal += w;
    if (phraseSet.has(tok)) queryHit += w;
  }
  const coverage = phraseHit / phraseTotal;
  const precision = queryHit / queryTotal;
  // A whole candidate phrase appearing verbatim inside a longer sentence is a strong signal.
  if (p.tokens.length > 0 && containsSequence(query, p.tokens)) {
    return p.weight * (0.85 + 0.15 * precision);
  }
  // Matching only generic fitting words ("lights") is never enough on its own.
  if (phraseHit <= 0.5 && queryHit <= 0.5) return 0;
  return p.weight * (0.6 * coverage + 0.4 * precision);
}

function rank<T extends string>(
  candidates: readonly Candidate<T>[],
  text: string,
  threshold = KNX_NAME_MATCH_THRESHOLD,
): KnxNameMatch<T>[] {
  const query = tokeniseKnxName(text);
  const out: { match: KnxNameMatch<T>; len: number }[] = [];
  for (const c of candidates) {
    let best = 0;
    let bestText = '';
    let bestLen = Number.POSITIVE_INFINITY;
    for (const p of c.phrases) {
      const s = scorePhrase(query, p);
      if (s > best + 1e-9 || (Math.abs(s - best) <= 1e-9 && s > 0 && p.tokens.length < bestLen)) {
        best = s;
        bestText = p.text;
        bestLen = p.tokens.length;
      }
    }
    if (best >= threshold) out.push({ match: { id: c.id, score: best, matched: bestText }, len: bestLen });
  }
  out.sort((a, b) => b.match.score - a.match.score || a.len - b.len);
  return out.map((o) => o.match);
}

function compact(phrases: readonly (CandidatePhrase | null)[]): CandidatePhrase[] {
  return phrases.filter((p): p is CandidatePhrase => p !== null);
}

export function createKnxNameResolver(project: KnxNameResolverProject): KnxNameResolver {
  const roomById = new Map(project.rooms.map((r) => [r.id, r]));

  const circuitCandidates: Candidate<CircuitId>[] = project.circuits.map((c) => ({
    id: c.id,
    phrases: compact([
      phrase(c.id, 0.95),
      phrase(c.name, 1),
      phrase(c.shortName, 1),
      phrase(c.location, 0.6),
      ...(c.aliases ?? []).map((a) => phrase(a, 1.05)),
    ]),
  }));

  const zoneCandidates: Candidate<RoomZoneId>[] = project.zones.map((z) => {
    const room = roomById.get(z.id);
    return {
      id: z.id,
      phrases: compact([
        phrase(z.id, 0.95),
        phrase(z.name, 1),
        room ? phrase(room.name, 1) : null,
        room ? phrase(room.shortName, 1) : null,
        ...(z.aliases ?? []).map((a) => phrase(a, 1.05)),
      ]),
    };
  });

  const zoneById = new Map(project.zones.map((z) => [z.id, z]));

  return {
    resolveCircuit: (text) => rank(circuitCandidates, text)[0] ?? null,
    resolveZone: (text) => rank(zoneCandidates, text)[0] ?? null,
    rankCircuits: (text) => rank(circuitCandidates, text),
    rankZones: (text) => rank(zoneCandidates, text),
    resolveScene: (zoneId, text) => {
      const zone = zoneById.get(zoneId);
      if (!zone || zone.scenes.length === 0) return null;
      const trimmed = text.trim();
      const numeric = /^(?:scene\s*)?(\d{1,2})$/i.exec(trimmed);
      if (numeric) {
        const index = Number(numeric[1]) - 1;
        const s = zone.scenes[index];
        return s ? { id: s.id, index, score: 1.1, matched: trimmed.toLowerCase() } : null;
      }
      const exactId = zone.scenes.findIndex((s) => s.id === trimmed);
      if (exactId >= 0) {
        const s = zone.scenes[exactId];
        return { id: s.id, index: exactId, score: 1.2, matched: s.id };
      }
      const candidates: Candidate<string>[] = zone.scenes.map((s) => ({
        id: s.id,
        phrases: compact([phrase(s.label, 1), phrase(s.id, 0.95)]),
      }));
      const best = rank(candidates, text)[0];
      if (!best) return null;
      return { ...best, index: zone.scenes.findIndex((s) => s.id === best.id) };
    },
  };
}
