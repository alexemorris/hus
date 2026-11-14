import {
  applyVariationsToUrl,
  isSafeVariationId,
} from '../core/variations-url.ts';
export {
  VARIATION_PARAM_PREFIX,
  VARIATIONS_QUERY_PARAM,
  applyVariationsToUrl,
  formatVariationSearchParam,
  isSafeVariationId,
  parseVariationSearchParams,
} from "../core/variations-url.ts";
import type { FloorViewMode } from '../core/types/scene.ts';
import type { RoomZoneId } from '../core/types/topology.ts';
import type { ShareViewState, TradeView } from '../core/types/twin-ux.ts';

/**
 * Share-link state codec.
 *
 * The view state is serialised as a compact JSON tuple, then base64url encoded
 * into a single `?v=` URL parameter. Numbers are rounded to centimetres so links
 * stay short and stable.
 *
 * Room and floor ids are house data, not codec data: any safe identifier is accepted, and a
 * house can narrow that with {@link configureShareStateCodec} (or per-call options).
 */

export const SHARE_URL_PARAM = 'v';

const TRADE_VIEWS: readonly TradeView[] = ['owner', 'architect', 'builder', 'electrician', 'plumber'];
/** Floor order assumed for numeric `f` when no house floors are configured (legacy links). */
const DEFAULT_FLOOR_IDS: readonly string[] = ['ground', 'first'];
const ALL_FLOORS: FloorViewMode = 'all';
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface ShareStateCodecOptions {
  /** When set, only these room ids survive encode/decode; otherwise any safe identifier does. */
  readonly allowedRooms?: ReadonlySet<string>;
  /**
   * Floor ids in ascending order. Numeric `f` indexes `[...floors, 'all']`; when set, string
   * `f` values outside that list are rejected.
   */
  readonly floors?: readonly string[];
}

let codecDefaults: ShareStateCodecOptions = {};

/**
 * Registers the active house's rooms/floors as the codec defaults (replacing any previous
 * configuration). Call with no argument to reset to the permissive defaults.
 */
export function configureShareStateCodec(options: ShareStateCodecOptions = {}): void {
  codecDefaults = {
    ...(options.allowedRooms ? { allowedRooms: new Set(options.allowedRooms) } : {}),
    ...(options.floors ? { floors: [...options.floors] } : {}),
  };
}

function resolveOptions(options: ShareStateCodecOptions | undefined): ShareStateCodecOptions {
  return {
    allowedRooms: options?.allowedRooms ?? codecDefaults.allowedRooms,
    floors: options?.floors ?? codecDefaults.floors,
  };
}

function floorModes(options: ShareStateCodecOptions): readonly FloorViewMode[] {
  return [...(options.floors ?? DEFAULT_FLOOR_IDS), ALL_FLOORS];
}

/** Wire format: short keys keep the encoded string compact. */
interface CompactShareState {
  readonly c: readonly number[];
  readonly t: readonly number[];
  /** Index into `[...floors, 'all']`, or a floor id the configured floors do not list. */
  readonly f: number | string;
  readonly o: number;
  readonly r?: string;
  readonly w: number;
  readonly g: number;
  readonly vr?: Readonly<Record<string, string>>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(param: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(param)) return null;
  const padded = param.replace(/-/g, '+').replace(/_/g, '/');
  const withPad = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  try {
    const binary = atob(withPad);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * True for any syntactically safe room id. Deliberately independent of the configured
 * `allowedRooms`, so persisted data carrying older ids is still recognised.
 */
export function isRoomZoneId(value: string): value is RoomZoneId {
  return SAFE_ID_RE.test(value);
}

function isAcceptedRoom(value: unknown, options: ShareStateCodecOptions): value is RoomZoneId {
  if (typeof value !== 'string' || !isRoomZoneId(value)) return false;
  return options.allowedRooms ? options.allowedRooms.has(value) : true;
}

function encodeFloor(floor: FloorViewMode, options: ShareStateCodecOptions): number | string {
  const idx = floorModes(options).indexOf(floor);
  if (idx >= 0) return idx;
  return options.floors === undefined && SAFE_ID_RE.test(floor) ? floor : 0;
}

function decodeFloor(value: unknown, options: ShareStateCodecOptions): FloorViewMode {
  const modes = floorModes(options);
  if (typeof value === 'number') return modes[value] ?? modes[0];
  if (typeof value === 'string' && SAFE_ID_RE.test(value)) {
    if (options.floors === undefined || modes.includes(value)) return value;
  }
  return modes[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVec3(value: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out: number[] = [];
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 10000) return null;
    out.push(v);
  }
  return [out[0], out[1], out[2]];
}

export function encodeShareState(s: ShareViewState, options?: ShareStateCodecOptions): string {
  const opts = resolveOptions(options);
  const compact: CompactShareState = {
    c: s.cam.map(round2),
    t: s.target.map(round2),
    f: encodeFloor(s.floor, opts),
    o: s.ortho ? 1 : 0,
    ...(isAcceptedRoom(s.room, opts) ? { r: s.room } : {}),
    w: Math.max(0, TRADE_VIEWS.indexOf(s.view)),
    g: s.guest ? 1 : 0,
    ...(s.vars && Object.keys(s.vars).length > 0 ? { vr: s.vars } : {}),
  };
  return toBase64Url(JSON.stringify(compact));
}

export function decodeShareState(
  param: string,
  options?: ShareStateCodecOptions
): ShareViewState | null {
  const opts = resolveOptions(options);
  const json = fromBase64Url(param.trim());
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const cam = readVec3(parsed.c);
  const target = readVec3(parsed.t);
  if (!cam || !target) return null;

  const floor = decodeFloor(parsed.f, opts);
  const viewIdx = typeof parsed.w === 'number' ? parsed.w : 0;
  const view = TRADE_VIEWS[viewIdx] ?? 'owner';
  const room = isAcceptedRoom(parsed.r, opts) ? parsed.r : undefined;
  let vars: Record<string, string> | undefined;
  if (isRecord(parsed.vr)) {
    const cleanVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.vr)) {
      if (isSafeVariationId(k) && isSafeVariationId(v)) {
        cleanVars[k] = v;
      }
    }
    if (Object.keys(cleanVars).length > 0) vars = cleanVars;
  }

  return {
    cam,
    target,
    floor,
    ortho: parsed.o === 1,
    ...(room ? { room } : {}),
    view,
    guest: parsed.g !== 0,
    ...(vars ? { vars } : {}),
  };
}

/** Builds an absolute share URL for the current page, replacing any previous view state. */
export function buildShareUrl(
  s: ShareViewState,
  baseHref: string = window.location.href,
  options?: ShareStateCodecOptions
): string {
  const url = new URL(baseHref);
  url.hash = '';
  // Developer / transport params never travel with a share link.
  url.searchParams.delete('dev');
  url.searchParams.delete('knxWs');
  url.searchParams.set(SHARE_URL_PARAM, encodeShareState(s, options));
  return applyVariationsToUrl(url.toString(), s.vars ?? {});
}

/** Reads `?v=` from the current location (or the given search string). */
export function readShareStateFromLocation(
  search: string = window.location.search,
  options?: ShareStateCodecOptions
): ShareViewState | null {
  const raw = new URLSearchParams(search).get(SHARE_URL_PARAM);
  return raw ? decodeShareState(raw, options) : null;
}
