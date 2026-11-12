import {
  evaluateTerrainModifiers,
  sculptStamps,
  type SculptStampsModifier,
  type TerrainStamp,
  type TerrainStampFalloff,
} from './terrain-modifiers.ts';

export type TerrainSculptMode = 'raise' | 'lower' | 'smooth' | 'flatten';

export const TERRAIN_SCULPT_MIN_RADIUS_M = 1;
export const TERRAIN_SCULPT_MAX_RADIUS_M = 25;
export const TERRAIN_SCULPT_DEFAULT_RADIUS_M = 6;

export const TERRAIN_SCULPT_MIN_STRENGTH_M = 0.05;
export const TERRAIN_SCULPT_MAX_STRENGTH_M = 1.0;
export const TERRAIN_SCULPT_DEFAULT_STRENGTH_M = 0.35;

export const TERRAIN_SCULPT_DEFAULT_PATCH_ID = 'site-sculpt';

export interface TerrainSculptPatchPayload {
  readonly kind: 'sculptStamps';
  readonly id: string;
  readonly stamps: readonly TerrainStamp[];
}

export interface TerrainSculptSnapshot {
  readonly active: boolean;
  readonly mode: TerrainSculptMode;
  readonly radiusM: number;
  readonly strength: number;
  readonly strokeCount: number;
  readonly stampCount: number;
  readonly canUndo: boolean;
  readonly patchId: string;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function clampSculptRadiusM(radiusM: number): number {
  if (!Number.isFinite(radiusM)) return TERRAIN_SCULPT_DEFAULT_RADIUS_M;
  return Math.min(
    TERRAIN_SCULPT_MAX_RADIUS_M,
    Math.max(TERRAIN_SCULPT_MIN_RADIUS_M, radiusM)
  );
}

export function clampSculptStrengthM(strengthM: number): number {
  if (!Number.isFinite(strengthM)) return TERRAIN_SCULPT_DEFAULT_STRENGTH_M;
  return Math.min(
    TERRAIN_SCULPT_MAX_STRENGTH_M,
    Math.max(TERRAIN_SCULPT_MIN_STRENGTH_M, strengthM)
  );
}

function sanitizeStamp(stamp: TerrainStamp): TerrainStamp {
  const base: {
    x: number;
    z: number;
    radiusX: number;
    radiusZ?: number;
    rotationY?: number;
    deltaY: number;
    falloff?: TerrainStampFalloff;
    plateauRatio?: number;
  } = {
    x: round3(stamp.x),
    z: round3(stamp.z),
    radiusX: round3(Math.max(0.01, stamp.radiusX)),
    deltaY: round4(stamp.deltaY),
  };
  if (stamp.radiusZ !== undefined && Math.abs(stamp.radiusZ - stamp.radiusX) > 1e-4) {
    base.radiusZ = round3(Math.max(0.01, stamp.radiusZ));
  }
  if (stamp.rotationY !== undefined && Math.abs(stamp.rotationY) > 1e-4) {
    base.rotationY = round4(stamp.rotationY);
  }
  if (stamp.falloff !== undefined && stamp.falloff !== 'smooth') {
    base.falloff = stamp.falloff;
  } else if (stamp.falloff === 'smooth') {
    base.falloff = 'smooth';
  }
  if (stamp.falloff === 'plateau' && stamp.plateauRatio !== undefined) {
    base.plateauRatio = round3(stamp.plateauRatio);
  }
  return base;
}

export interface ComputeSculptBrushStampOptions {
  readonly mode: TerrainSculptMode;
  readonly wx: number;
  readonly wz: number;
  readonly radiusM: number;
  readonly strengthM: number;
  readonly sampleY: (wx: number, wz: number) => number;
  readonly flattenTargetY?: number;
  readonly stepScale?: number;
}

/**
 * Computes a single `TerrainStamp` for a brush dab at `(wx, wz)` in the requested sculpt mode.
 * Returns `null` if the computed height delta is negligible (`|deltaY| < 0.0001 m`).
 */
export function computeSculptBrushStamp(
  options: ComputeSculptBrushStampOptions
): TerrainStamp | null {
  const { mode, wx, wz, sampleY } = options;
  if (!Number.isFinite(wx) || !Number.isFinite(wz)) return null;

  const radiusX = round3(clampSculptRadiusM(options.radiusM));
  const strength = clampSculptStrengthM(options.strengthM);
  const scale = Math.max(0.1, Math.min(1.5, options.stepScale ?? 1));
  const stepStrength = strength * scale;

  let deltaY = 0;
  let falloff: TerrainStampFalloff = 'smooth';
  let plateauRatio: number | undefined;

  if (mode === 'raise') {
    deltaY = stepStrength;
  } else if (mode === 'lower') {
    deltaY = -stepStrength;
  } else if (mode === 'flatten') {
    const currentY = sampleY(wx, wz);
    const targetY = options.flattenTargetY ?? currentY;
    const diff = targetY - currentY;
    deltaY = Math.max(-stepStrength, Math.min(stepStrength, diff));
    falloff = 'plateau';
    plateauRatio = 0.45;
  } else if (mode === 'smooth') {
    const currentY = sampleY(wx, wz);
    const outerR = radiusX * 0.65;
    const innerR = radiusX * 0.325;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      sum += sampleY(wx + ca * outerR, wz + sa * outerR);
      count += 1;
      if (i % 2 === 0) {
        sum += sampleY(wx + ca * innerR, wz + sa * innerR);
        count += 1;
      }
    }
    const avgY = count > 0 ? sum / count : currentY;
    const blend = Math.min(0.85, stepStrength);
    deltaY = (avgY - currentY) * blend;
  }

  const roundedDelta = round4(deltaY);
  if (Math.abs(roundedDelta) < 1e-4) {
    return null;
  }

  return sanitizeStamp({
    x: wx,
    z: wz,
    radiusX,
    deltaY: roundedDelta,
    falloff,
    ...(plateauRatio !== undefined ? { plateauRatio } : {}),
  });
}

export function buildSculptStampsPatchPayload(
  stamps: readonly TerrainStamp[],
  id = TERRAIN_SCULPT_DEFAULT_PATCH_ID
): TerrainSculptPatchPayload {
  const cleanId = id.trim() || TERRAIN_SCULPT_DEFAULT_PATCH_ID;
  return {
    kind: 'sculptStamps',
    id: cleanId,
    stamps: stamps.map(sanitizeStamp),
  };
}

/**
 * Formats accumulated stamps as a JSON `TerrainModifier` payload:
 * `{ "kind": "sculptStamps", "id": "...", "stamps": [...] }`
 */
export function formatTerrainSculptModifierJson(
  stamps: readonly TerrainStamp[],
  id = TERRAIN_SCULPT_DEFAULT_PATCH_ID
): string {
  return JSON.stringify(buildSculptStampsPatchPayload(stamps, id), null, 2);
}

function formatTsStampLine(s: TerrainStamp): string {
  const parts: string[] = [
    `x: ${s.x}`,
    `z: ${s.z}`,
    `radiusX: ${s.radiusX}`,
  ];
  if (s.radiusZ !== undefined) parts.push(`radiusZ: ${s.radiusZ}`);
  if (s.rotationY !== undefined) parts.push(`rotationY: ${s.rotationY}`);
  parts.push(`deltaY: ${s.deltaY}`);
  if (s.falloff !== undefined) parts.push(`falloff: '${s.falloff}'`);
  if (s.plateauRatio !== undefined) parts.push(`plateauRatio: ${s.plateauRatio}`);
  return `    { ${parts.join(', ')} },`;
}

/**
 * Formats accumulated stamps as a TypeScript `TerrainModifier` object literal
 * ready to paste straight into `defineHouse({ terrain: { modifiers: [...] } })`.
 */
export function formatTerrainSculptModifierTs(
  stamps: readonly TerrainStamp[],
  id = TERRAIN_SCULPT_DEFAULT_PATCH_ID
): string {
  const payload = buildSculptStampsPatchPayload(stamps, id);
  const escapedId = payload.id.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (payload.stamps.length === 0) {
    return `{\n  kind: 'sculptStamps',\n  id: '${escapedId}',\n  stamps: [],\n}`;
  }
  const lines = payload.stamps.map(formatTsStampLine).join('\n');
  return `{\n  kind: 'sculptStamps',\n  id: '${escapedId}',\n  stamps: [\n${lines}\n  ],\n}`;
}

export interface TerrainSculptSessionOptions {
  readonly mode?: TerrainSculptMode;
  readonly radiusM?: number;
  readonly strength?: number;
  readonly patchId?: string;
}

/**
 * Pure, engine-independent stroke & stamp accumulator for interactive terrain sculpting.
 * Groups brush dabs per pointer stroke so `undoLastStroke()` cleanly reverts an entire drag.
 */
export class TerrainSculptSession {
  private mode: TerrainSculptMode;
  private radiusM: number;
  private strength: number;
  private patchId: string;

  private readonly strokes: TerrainStamp[][] = [];
  private activeStroke: TerrainStamp[] | null = null;
  private activeFlattenTargetY: number | null = null;
  private lastBrushPos: { x: number; z: number } | null = null;

  private cachedStamps: readonly TerrainStamp[] | null = null;
  private cachedModifier: SculptStampsModifier | null = null;

  public constructor(options: TerrainSculptSessionOptions = {}) {
    this.mode = options.mode ?? 'raise';
    this.radiusM = clampSculptRadiusM(options.radiusM ?? TERRAIN_SCULPT_DEFAULT_RADIUS_M);
    this.strength = clampSculptStrengthM(options.strength ?? TERRAIN_SCULPT_DEFAULT_STRENGTH_M);
    this.patchId = options.patchId?.trim() || TERRAIN_SCULPT_DEFAULT_PATCH_ID;
  }

  private invalidateCache(): void {
    this.cachedStamps = null;
    this.cachedModifier = null;
  }

  public getMode(): TerrainSculptMode {
    return this.mode;
  }

  public setMode(mode: TerrainSculptMode): void {
    this.mode = mode;
  }

  public getRadiusM(): number {
    return this.radiusM;
  }

  public setRadiusM(radiusM: number): number {
    this.radiusM = round3(clampSculptRadiusM(radiusM));
    return this.radiusM;
  }

  public getStrength(): number {
    return this.strength;
  }

  public setStrength(strength: number): number {
    this.strength = round3(clampSculptStrengthM(strength));
    return this.strength;
  }

  public getPatchId(): string {
    return this.patchId;
  }

  public setPatchId(id: string): void {
    this.patchId = id.trim() || TERRAIN_SCULPT_DEFAULT_PATCH_ID;
    this.cachedModifier = null;
  }

  public isStrokeActive(): boolean {
    return this.activeStroke !== null;
  }

  public getStrokeCount(): number {
    const activeNonEmpty = this.activeStroke && this.activeStroke.length > 0 ? 1 : 0;
    return this.strokes.length + activeNonEmpty;
  }

  public canUndo(): boolean {
    return this.getStrokeCount() > 0;
  }

  public getStamps(): readonly TerrainStamp[] {
    if (this.cachedStamps) return this.cachedStamps;
    const out: TerrainStamp[] = [];
    for (const s of this.strokes) {
      out.push(...s);
    }
    if (this.activeStroke) {
      out.push(...this.activeStroke);
    }
    this.cachedStamps = out;
    return out;
  }

  public toModifier(): SculptStampsModifier {
    if (!this.cachedModifier) {
      this.cachedModifier = sculptStamps({
        id: this.patchId,
        stamps: this.getStamps(),
      });
    }
    return this.cachedModifier;
  }

  /**
   * Evaluates sculpted height at `(wx, wz)` over `baseY` (or a base sampler function).
   */
  public evaluateHeight(
    baseOrY: number | ((wx: number, wz: number) => number),
    wx: number,
    wz: number
  ): number {
    const baseY = typeof baseOrY === 'function' ? baseOrY(wx, wz) : baseOrY;
    const stamps = this.getStamps();
    if (stamps.length === 0) return baseY;
    return evaluateTerrainModifiers(baseY, wx, wz, [this.toModifier()]);
  }

  /**
   * Starts a new brush stroke at `(wx, wz)`, sampling `baseSampleY` combined with all
   * stamps accumulated so far.
   */
  public beginStroke(
    wx: number,
    wz: number,
    baseSampleY: (x: number, z: number) => number,
    flattenTargetY?: number
  ): TerrainStamp | null {
    if (this.activeStroke !== null) {
      this.endStroke();
    }
    this.activeStroke = [];
    const liveSampleY = (x: number, z: number): number => this.evaluateHeight(baseSampleY, x, z);
    this.activeFlattenTargetY =
      this.mode === 'flatten' ? (flattenTargetY ?? liveSampleY(wx, wz)) : null;
    this.lastBrushPos = { x: wx, z: wz };

    const stamp = computeSculptBrushStamp({
      mode: this.mode,
      wx,
      wz,
      radiusM: this.radiusM,
      strengthM: this.strength,
      sampleY: liveSampleY,
      flattenTargetY: this.activeFlattenTargetY ?? undefined,
      stepScale: 1.0,
    });
    if (stamp) {
      this.activeStroke.push(stamp);
      this.invalidateCache();
    }
    return stamp;
  }

  /**
   * Continues an active drag stroke toward `(wx, wz)`, spacing brush dabs evenly
   * so fast pointer motion produces continuous ridges, swales, or level pads.
   */
  public continueStroke(
    wx: number,
    wz: number,
    baseSampleY: (x: number, z: number) => number
  ): readonly TerrainStamp[] {
    if (!this.activeStroke || !this.lastBrushPos) {
      const first = this.beginStroke(wx, wz, baseSampleY);
      return first ? [first] : [];
    }

    const spacing = Math.max(0.35, this.radiusM * 0.35);
    const dx = wx - this.lastBrushPos.x;
    const dz = wz - this.lastBrushPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < spacing) {
      return [];
    }

    const steps = Math.min(32, Math.floor(dist / spacing));
    const ux = dx / dist;
    const uz = dz / dist;
    const added: TerrainStamp[] = [];
    const liveSampleY = (x: number, z: number): number => this.evaluateHeight(baseSampleY, x, z);

    let curX = this.lastBrushPos.x;
    let curZ = this.lastBrushPos.z;
    for (let i = 1; i <= steps; i++) {
      curX = this.lastBrushPos.x + ux * spacing * i;
      curZ = this.lastBrushPos.z + uz * spacing * i;
      const stamp = computeSculptBrushStamp({
        mode: this.mode,
        wx: curX,
        wz: curZ,
        radiusM: this.radiusM,
        strengthM: this.strength,
        sampleY: liveSampleY,
        flattenTargetY: this.activeFlattenTargetY ?? undefined,
        stepScale: 0.55,
      });
      if (stamp) {
        this.activeStroke.push(stamp);
        added.push(stamp);
        this.invalidateCache();
      }
    }
    this.lastBrushPos = { x: curX, z: curZ };
    return added;
  }

  /** Finishes the active stroke and commits it to the undo stack if non-empty. */
  public endStroke(): boolean {
    const stroke = this.activeStroke;
    this.activeStroke = null;
    this.activeFlattenTargetY = null;
    this.lastBrushPos = null;
    if (!stroke || stroke.length === 0) {
      return false;
    }
    this.strokes.push(stroke);
    this.invalidateCache();
    return true;
  }

  /** Appends a pre-built stroke of stamps (useful for programmatic tests or paste). */
  public pushStroke(stamps: readonly TerrainStamp[]): boolean {
    if (stamps.length === 0) return false;
    if (this.activeStroke !== null) this.endStroke();
    this.strokes.push(stamps.map(sanitizeStamp));
    this.invalidateCache();
    return true;
  }

  /** Pops the most recent stroke (or cancels an in-progress stroke). */
  public undoLastStroke(): boolean {
    if (this.activeStroke && this.activeStroke.length > 0) {
      this.activeStroke = null;
      this.activeFlattenTargetY = null;
      this.lastBrushPos = null;
      this.invalidateCache();
      return true;
    }
    this.activeStroke = null;
    this.activeFlattenTargetY = null;
    this.lastBrushPos = null;
    if (this.strokes.length === 0) return false;
    this.strokes.pop();
    this.invalidateCache();
    return true;
  }

  /** Clears all strokes and resets the sculpt patch back to the unmodified base terrain. */
  public resetStrokes(): boolean {
    const hadAny =
      this.strokes.length > 0 || (this.activeStroke !== null && this.activeStroke.length > 0);
    this.strokes.length = 0;
    this.activeStroke = null;
    this.activeFlattenTargetY = null;
    this.lastBrushPos = null;
    this.invalidateCache();
    return hadAny;
  }

  public toModifierPayload(idOverride?: string): TerrainSculptPatchPayload {
    return buildSculptStampsPatchPayload(this.getStamps(), idOverride ?? this.patchId);
  }

  public formatModifierJson(idOverride?: string): string {
    return formatTerrainSculptModifierJson(this.getStamps(), idOverride ?? this.patchId);
  }

  public formatModifierTs(idOverride?: string): string {
    return formatTerrainSculptModifierTs(this.getStamps(), idOverride ?? this.patchId);
  }
}
