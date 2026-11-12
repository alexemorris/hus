import * as THREE from 'three';
import type { CutawayWallDescriptor, Vec3Tuple } from '../../core/types/scene.ts';
import { computeSignedPolygonArea2D } from '../../engine/geometry/cad-primitives.ts';
import { tagCollisionRole, tagCutaway, type CollisionRole } from '../../engine/geometry/mesh-traits.ts';

export type RoomSide = 'left' | 'right';
export type SkirtingProfilePreset = 'ogee' | 'torus' | 'lambs-tongue' | 'chamfered';
export type SkirtingEndCap = 'butt' | 'selfReturn' | 'miter';

export interface SkirtingProfilePoint {
  readonly u: number;
  readonly v: number;
  readonly sharp?: boolean;
}

export type SkirtingProfileInput =
  | SkirtingProfilePreset
  | readonly (SkirtingProfilePoint | readonly [number, number])[];

export interface MouldingPathStartOptions {
  readonly y?: number;
  readonly roomSide?: RoomSide;
}

export type MouldingArcSpec =
  | {
      readonly radius: number;
      readonly clockwise?: boolean;
      readonly largeArc?: boolean;
      readonly segments?: number;
    }
  | {
      readonly bulge: number;
      readonly segments?: number;
    }
  | {
      readonly center: readonly [number, number];
      readonly clockwise?: boolean;
      readonly segments?: number;
    };

export interface ScribedStepPoint {
  /** Horizontal distance (metres) along the scribed segment from its start point. */
  readonly atDist?: number;
  /** Alternative world `[x, z]` coordinate of the riser along the segment. */
  readonly atXZ?: readonly [number, number];
  /** World `Y` elevation (metres) of the tread beginning at this riser. */
  readonly y: number;
}

export interface ScribedStepsOptions {
  readonly steps: readonly ScribedStepPoint[];
  /** Anti-z-fight clearance from stair treads & risers (default `0.0005` = `0.5 mm`). */
  readonly nosingClearanceM?: number;
}

export type MouldingSegmentKind = 'horizontal' | 'vertical' | 'rake';

export interface MouldingPathSegment {
  readonly from: Vec3Tuple;
  readonly to: Vec3Tuple;
  readonly length: number;
  readonly cumulativeDist: number;
  readonly kind: MouldingSegmentKind;
  readonly tangent: Vec3Tuple;
  /** Room-facing horizontal wall normal (`N_wall`, pointing into the room with `y = 0`). */
  readonly wallNormal: Vec3Tuple;
  /** Profile `+v` axis in the wall plane (`[0, 1, 0]` on horizontal runs, locked without roll on steps/rakes). */
  readonly vAxis: Vec3Tuple;
  readonly horizTangent: Vec3Tuple;
  readonly smoothStart: boolean;
  readonly smoothEnd: boolean;
  readonly scribedSteps?: ScribedStepsOptions;
}

export interface MouldingPathData {
  readonly roomSide: RoomSide;
  readonly closed: boolean;
  readonly totalLengthM: number;
  readonly segments: readonly MouldingPathSegment[];
}

export interface SkirtingGapBoxXZ {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly minY?: number;
  readonly maxY?: number;
}

export type SkirtingGapBoxBounds = THREE.Box3 | SkirtingGapBoxXZ;

export type SkirtingGapSpec =
  | {
      readonly startDist: number;
      readonly endDist: number;
      readonly cap?: SkirtingEndCap;
      readonly startCap?: SkirtingEndCap;
      readonly endCap?: SkirtingEndCap;
    }
  | {
      readonly at: readonly [number, number] | readonly [number, number, number];
      readonly width: number;
      readonly cap?: SkirtingEndCap;
      readonly startCap?: SkirtingEndCap;
      readonly endCap?: SkirtingEndCap;
    }
  | {
      readonly box: SkirtingGapBoxBounds;
      readonly boxXZ?: SkirtingGapBoxXZ;
      readonly cap?: SkirtingEndCap;
      readonly startCap?: SkirtingEndCap;
      readonly endCap?: SkirtingEndCap;
    }
  | {
      readonly boxXZ: SkirtingGapBoxXZ;
      readonly box?: SkirtingGapBoxBounds;
      readonly cap?: SkirtingEndCap;
      readonly startCap?: SkirtingEndCap;
      readonly endCap?: SkirtingEndCap;
    };

/** Convenient alias for `SkirtingGapSpec` (including `boxXZ` gap descriptors exported by `BuiltWallNetwork`). */
export type SkirtingGap = SkirtingGapSpec;

export type CutawayWallsInput =
  | readonly CutawayWallDescriptor[]
  | { readonly cutaways: readonly CutawayWallDescriptor[] };

export type MouldingPathInput =
  | MouldingPathBuilder
  | MouldingPathData
  | readonly (readonly [number, number] | readonly [number, number, number])[];

export interface CreateSkirtingProfileOptions {
  readonly height?: number;
  readonly thickness?: number;
}

export interface CreateSkirtingRunOptions {
  readonly path?: MouldingPathInput;
  readonly points?: readonly (readonly [number, number] | readonly [number, number, number])[];
  readonly closed?: boolean;
  readonly roomSide?: RoomSide;
  readonly elevationY?: number;
  readonly floorY?: number;
  readonly profile?: SkirtingProfileInput;
  readonly height?: number;
  readonly thickness?: number;
  readonly material: THREE.Material;
  readonly gaps?: readonly SkirtingGapSpec[];
  readonly cap?: SkirtingEndCap;
  readonly startCap?: SkirtingEndCap;
  readonly endCap?: SkirtingEndCap;
  readonly cutawayWalls?: CutawayWallsInput;
  readonly floor?: string;
  readonly cutawayToleranceM?: number;
  readonly includeHiddenBackAndBottomFaces?: boolean;
  readonly maxMiterRatio?: number;
  readonly uvScale?: number;
  readonly zone?: string;
  readonly name?: string;
  readonly collisionRole?: CollisionRole;
}

export interface CreateScribedStepSkirtingOptions
  extends CreateSkirtingRunOptions {
  readonly from?: readonly [number, number, number];
  readonly to?: readonly [number, number, number];
  readonly steps?: readonly ScribedStepPoint[];
  readonly nosingClearanceM?: number;
}

export type SkirtingRunResult = THREE.Group & {
  readonly cutawayMeshes: readonly THREE.Mesh[];
  readonly interiorMeshes: readonly THREE.Mesh[];
  readonly totalLengthM: number;
};

interface RawEdgeRecord {
  readonly from: [number, number, number];
  readonly to: [number, number, number];
  readonly smoothStart: boolean;
  readonly smoothEnd: boolean;
  readonly scribedSteps?: ScribedStepsOptions;
}

const EPS = 1e-7;

export function resolveCutawayWallsInput(
  input: CutawayWallsInput | undefined
): readonly CutawayWallDescriptor[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) return input;
  return (input as { readonly cutaways: readonly CutawayWallDescriptor[] }).cutaways;
}

export function computeHorizWallNormal(
  hx: number,
  hz: number,
  roomSide: RoomSide
): [number, number, number] {
  // UP x horizDir = [0, 1, 0] x [hx, 0, hz] = [hz, 0, -hx] ('left')
  // horizDir x UP = [-hz, 0, hx] ('right')
  if (roomSide === 'left') {
    return [hz, 0, -hx];
  }
  return [-hz, 0, hx];
}

export class MouldingPathBuilder {
  private readonly roomSide: RoomSide;
  private readonly startPt: [number, number, number];
  private currPt: [number, number, number];
  private readonly rawEdges: RawEdgeRecord[] = [];
  private isClosed = false;

  public constructor(
    startX = 0,
    startZ = 0,
    yOrOptions?: number | MouldingPathStartOptions,
    maybeOptions?: MouldingPathStartOptions
  ) {
    let startY = 0;
    let roomSide: RoomSide = 'left';
    if (typeof yOrOptions === 'number') {
      startY = yOrOptions;
      if (maybeOptions?.roomSide) {
        roomSide = maybeOptions.roomSide;
      }
      if (maybeOptions?.y !== undefined) {
        startY = maybeOptions.y;
      }
    } else if (yOrOptions) {
      startY = yOrOptions.y ?? 0;
      roomSide = yOrOptions.roomSide ?? 'left';
    }
    this.roomSide = roomSide;
    this.startPt = [startX, startY, startZ];
    this.currPt = [startX, startY, startZ];
  }

  private pushEdge(
    toX: number,
    toY: number,
    toZ: number,
    smoothStart: boolean,
    smoothEnd: boolean,
    scribedSteps?: ScribedStepsOptions
  ): void {
    const dx = toX - this.currPt[0];
    const dy = toY - this.currPt[1];
    const dz = toZ - this.currPt[2];
    if (dx * dx + dy * dy + dz * dz <= 1e-12) {
      return;
    }
    this.rawEdges.push({
      from: [this.currPt[0], this.currPt[1], this.currPt[2]],
      to: [toX, toY, toZ],
      smoothStart,
      smoothEnd,
      ...(scribedSteps ? { scribedSteps } : {}),
    });
    this.currPt = [toX, toY, toZ];
  }

  public lineTo(x: number, z: number): this;
  public lineTo(x: number, y: number, z: number): this;
  public lineTo(a: number, b: number, c?: number): this {
    if (c !== undefined) {
      this.pushEdge(a, b, c, false, false);
    } else {
      this.pushEdge(a, this.currPt[1], b, false, false);
    }
    return this;
  }

  public stepTo(newY: number): this {
    this.pushEdge(this.currPt[0], newY, this.currPt[2], false, false);
    return this;
  }

  public rakeTo(x: number, y: number, z: number): this {
    this.pushEdge(x, y, z, false, false);
    return this;
  }

  /**
   * Sweeps a raked upper moulding cap from the current 3D point to `(toX, toY, toZ)` while
   * scribing/notching the lower plinth fascia cleanly around each stair tread & riser.
   */
  public scribedStepsTo(
    toX: number,
    toY: number,
    toZ: number,
    options: ScribedStepsOptions
  ): this;
  public scribedStepsTo(
    options: ScribedStepsOptions & { readonly to: readonly [number, number, number] }
  ): this;
  public scribedStepsTo(
    arg0: number | (ScribedStepsOptions & { readonly to: readonly [number, number, number] }),
    arg1?: number,
    arg2?: number,
    arg3?: ScribedStepsOptions
  ): this {
    if (typeof arg0 === 'number') {
      this.pushEdge(arg0, arg1!, arg2!, false, false, arg3!);
    } else {
      this.pushEdge(arg0.to[0], arg0.to[1], arg0.to[2], false, false, {
        steps: arg0.steps,
        nosingClearanceM: arg0.nosingClearanceM,
      });
    }
    return this;
  }

  public arcTo(x: number, z: number, arc: MouldingArcSpec): this {
    const x0 = this.currPt[0];
    const y0 = this.currPt[1];
    const z0 = this.currPt[2];
    const dx = x - x0;
    const dz = z - z0;
    const chord = Math.hypot(dx, dz);
    if (chord <= 1e-7) {
      return this;
    }

    let cx = 0;
    let cz = 0;
    let startAngle = 0;
    let sweepAngle = 0;
    let radius = 0;
    const segs = Math.max(4, arc.segments ?? 16);

    if ('center' in arc) {
      cx = arc.center[0];
      cz = arc.center[1];
      const r0 = Math.hypot(x0 - cx, z0 - cz);
      const r1 = Math.hypot(x - cx, z - cz);
      radius = (r0 + r1) * 0.5;
      if (radius <= 1e-7) {
        return this.lineTo(x, z);
      }
      startAngle = Math.atan2(z0 - cz, x0 - cx);
      const endAngle = Math.atan2(z - cz, x - cx);
      const cw = arc.clockwise ?? false;
      sweepAngle = endAngle - startAngle;
      if (cw) {
        while (sweepAngle <= 1e-9) sweepAngle += Math.PI * 2;
      } else {
        while (sweepAngle >= -1e-9) sweepAngle -= Math.PI * 2;
      }
    } else if ('bulge' in arc) {
      const b = arc.bulge;
      if (Math.abs(b) <= 1e-6) {
        return this.lineTo(x, z);
      }
      sweepAngle = 4 * Math.atan(b);
      radius = (chord * 0.5) / Math.sin(Math.abs(sweepAngle) * 0.5);
      const h = (chord * 0.5) / Math.tan(sweepAngle * 0.5);
      const mx = (x0 + x) * 0.5;
      const mz = (z0 + z) * 0.5;
      const nx = -dz / chord;
      const nz = dx / chord;
      cx = mx + nx * h;
      cz = mz + nz * h;
      startAngle = Math.atan2(z0 - cz, x0 - cx);
    } else {
      const cw = arc.clockwise ?? false;
      const largeArc = arc.largeArc ?? false;
      radius = Math.max(Math.abs(arc.radius), chord * 0.5);
      const h = Math.sqrt(Math.max(0, radius * radius - chord * chord * 0.25));
      const mx = (x0 + x) * 0.5;
      const mz = (z0 + z) * 0.5;
      const sideSign = cw !== largeArc ? 1 : -1;
      const nx = (-dz / chord) * sideSign;
      const nz = (dx / chord) * sideSign;
      cx = mx + nx * h;
      cz = mz + nz * h;
      startAngle = Math.atan2(z0 - cz, x0 - cx);
      const endAngle = Math.atan2(z - cz, x - cx);
      sweepAngle = endAngle - startAngle;
      if (cw) {
        while (sweepAngle <= 1e-9) sweepAngle += Math.PI * 2;
      } else {
        while (sweepAngle >= -1e-9) sweepAngle -= Math.PI * 2;
      }
    }

    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const ang = startAngle + sweepAngle * t;
      const px = i === segs ? x : cx + Math.cos(ang) * radius;
      const pz = i === segs ? z : cz + Math.sin(ang) * radius;
      this.pushEdge(px, y0, pz, i > 1, i < segs);
    }
    return this;
  }

  public quadBezierTo(cpx: number, cpz: number, x: number, z: number, segments = 16): this {
    const x0 = this.currPt[0];
    const y0 = this.currPt[1];
    const z0 = this.currPt[2];
    const segs = Math.max(3, segments);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const mt = 1 - t;
      const px = i === segs ? x : mt * mt * x0 + 2 * mt * t * cpx + t * t * x;
      const pz = i === segs ? z : mt * mt * z0 + 2 * mt * t * cpz + t * t * z;
      this.pushEdge(px, y0, pz, i > 1, i < segs);
    }
    return this;
  }

  public bezierTo(
    cp1x: number,
    cp1z: number,
    cp2x: number,
    cp2z: number,
    x: number,
    z: number,
    segments = 20
  ): this {
    const x0 = this.currPt[0];
    const y0 = this.currPt[1];
    const z0 = this.currPt[2];
    const segs = Math.max(4, segments);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const t2 = t * t;
      const px =
        i === segs
          ? x
          : mt2 * mt * x0 + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t2 * t * x;
      const pz =
        i === segs
          ? z
          : mt2 * mt * z0 + 3 * mt2 * t * cp1z + 3 * mt * t2 * cp2z + t2 * t * z;
      this.pushEdge(px, y0, pz, i > 1, i < segs);
    }
    return this;
  }

  public splineThrough(
    points: readonly (readonly [number, number])[],
    segmentsPerSpan = 12
  ): this {
    if (points.length === 0) return this;
    const y0 = this.currPt[1];
    const ctrl = [
      new THREE.Vector3(this.currPt[0], y0, this.currPt[2]),
      ...points.map(([px, pz]) => new THREE.Vector3(px, y0, pz)),
    ];
    if (ctrl.length < 2) return this;
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal', 0.5);
    const totalSamples = Math.max(4, (ctrl.length - 1) * Math.max(3, segmentsPerSpan));
    for (let i = 1; i <= totalSamples; i++) {
      const pt = curve.getPoint(i / totalSamples);
      const last = points[points.length - 1]!;
      const px = i === totalSamples ? last[0] : pt.x;
      const pz = i === totalSamples ? last[1] : pt.z;
      this.pushEdge(px, y0, pz, i > 1, i < totalSamples);
    }
    return this;
  }

  public close(): this {
    const dx = this.startPt[0] - this.currPt[0];
    const dy = this.startPt[1] - this.currPt[1];
    const dz = this.startPt[2] - this.currPt[2];
    if (dx * dx + dy * dy + dz * dz > 1e-10) {
      this.pushEdge(this.startPt[0], this.startPt[1], this.startPt[2], false, false);
    }
    this.isClosed = true;
    return this;
  }

  public build(): MouldingPathData {
    const n = this.rawEdges.length;
    if (n === 0) {
      return {
        roomSide: this.roomSide,
        closed: false,
        totalLengthM: 0,
        segments: [],
      };
    }

    const rawHorizTangents: ([number, number, number] | null)[] = this.rawEdges.map((edge) => {
      const dx = edge.to[0] - edge.from[0];
      const dz = edge.to[2] - edge.from[2];
      const hLen = Math.hypot(dx, dz);
      if (hLen <= 1e-6) {
        return null;
      }
      return [dx / hLen, 0, dz / hLen];
    });

    const resolvedHorizTangents: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const direct = rawHorizTangents[i];
      if (direct) {
        resolvedHorizTangents.push(direct);
        continue;
      }
      let found: [number, number, number] | null = null;
      for (let back = i - 1; back >= 0; back--) {
        if (rawHorizTangents[back]) {
          found = rawHorizTangents[back]!;
          break;
        }
      }
      if (!found && this.isClosed) {
        for (let back = n - 1; back > i; back--) {
          if (rawHorizTangents[back]) {
            found = rawHorizTangents[back]!;
            break;
          }
        }
      }
      if (!found) {
        for (let fwd = i + 1; fwd < n; fwd++) {
          if (rawHorizTangents[fwd]) {
            found = rawHorizTangents[fwd]!;
            break;
          }
        }
      }
      resolvedHorizTangents.push(found ?? [1, 0, 0]);
    }

    const segments: MouldingPathSegment[] = [];
    let cumDist = 0;

    for (let i = 0; i < n; i++) {
      const edge = this.rawEdges[i]!;
      const dx = edge.to[0] - edge.from[0];
      const dy = edge.to[1] - edge.from[1];
      const dz = edge.to[2] - edge.from[2];
      const len = Math.hypot(dx, dy, dz);
      const tx = dx / len;
      const ty = dy / len;
      const tz = dz / len;
      const hLen = Math.hypot(dx, dz);

      let kind: MouldingSegmentKind;
      if (hLen <= 1e-6) {
        kind = 'vertical';
      } else if (Math.abs(dy) <= 1e-6) {
        kind = 'horizontal';
      } else {
        kind = 'rake';
      }

      const [hx, , hz] = resolvedHorizTangents[i]!;
      const wallNormal = computeHorizWallNormal(hx, hz, this.roomSide);

      // For scribed step segments, keep vAxis plumb [0, 1, 0] so horizontal corner miters
      // at top/bottom landings join plumb horizontal runs seamlessly without height foreshortening.
      let vAxis: Vec3Tuple;
      if (edge.scribedSteps) {
        vAxis = [0, 1, 0];
      } else {
        const tH = tx * hx + tz * hz;
        const tY = ty;
        const vLen = Math.hypot(tH, tY) || 1;
        vAxis = [(-tY * hx) / vLen, tH / vLen, (-tY * hz) / vLen];
      }

      segments.push({
        from: edge.from,
        to: edge.to,
        length: len,
        cumulativeDist: cumDist,
        kind,
        tangent: [tx, ty, tz],
        wallNormal,
        vAxis,
        horizTangent: [hx, 0, hz],
        smoothStart: edge.smoothStart,
        smoothEnd: edge.smoothEnd,
        ...(edge.scribedSteps ? { scribedSteps: edge.scribedSteps } : {}),
      });
      cumDist += len;
    }

    return {
      roomSide: this.roomSide,
      closed: this.isClosed && segments.length >= 2,
      totalLengthM: cumDist,
      segments,
    };
  }
}

export function createMouldingPath(
  x = 0,
  z = 0,
  yOrOptions?: number | MouldingPathStartOptions,
  maybeOptions?: MouldingPathStartOptions
): MouldingPathBuilder {
  return new MouldingPathBuilder(x, z, yOrOptions, maybeOptions);
}

export const mouldingPath = {
  startAt(
    x: number,
    z: number,
    yOrOptions?: number | MouldingPathStartOptions,
    maybeOptions?: MouldingPathStartOptions
  ): MouldingPathBuilder {
    return new MouldingPathBuilder(x, z, yOrOptions, maybeOptions);
  },
} as const;

/**
 * Generates an architectural skirting cross-section in `(u, v)` metres where:
 * - `u = 0` is seated flush (`0.0 mm`) against the wall plaster and `u = thickness` faces into the room.
 * - `v = 0` is seated flush (`0.0 mm`) on the finished floor and `v = height` is the top fillet.
 */
export function createSkirtingProfile(
  kind: SkirtingProfilePreset,
  options: CreateSkirtingProfileOptions = {}
): readonly SkirtingProfilePoint[] {
  const H = Math.max(0.03, options.height ?? 0.145);
  const T = Math.max(0.006, options.thickness ?? 0.018);

  if (kind === 'chamfered') {
    const bevelH = Math.min(H * 0.2, T * 0.85);
    const topFilletU = T * 0.25;
    return [
      { u: 0, v: 0, sharp: true },
      { u: T, v: 0, sharp: true },
      { u: T, v: H - bevelH, sharp: true },
      { u: topFilletU, v: H, sharp: true },
      { u: 0, v: H, sharp: true },
    ];
  }

  if (kind === 'torus') {
    const plinthH = H * 0.62;
    const quirkH = H * 0.645;
    const quirkU = T * 0.72;
    const torusBot = H * 0.66;
    const torusTop = H * 0.90;
    const torusCenterV = (torusBot + torusTop) * 0.5;
    const torusRadiusV = (torusTop - torusBot) * 0.5;
    const neckU = T * 0.44;
    const pts: SkirtingProfilePoint[] = [
      { u: 0, v: 0, sharp: true },
      { u: T, v: 0, sharp: true },
      { u: T, v: plinthH, sharp: true },
      { u: quirkU, v: plinthH + (quirkH - plinthH) * 0.5, sharp: true },
      { u: quirkU, v: torusBot, sharp: true },
    ];
    const arcSamples = 9;
    for (let i = 0; i <= arcSamples; i++) {
      const theta = -Math.PI * 0.5 + (Math.PI * i) / arcSamples;
      const u = neckU + (T - neckU) * Math.max(0, Math.cos(theta));
      const v = torusCenterV + torusRadiusV * Math.sin(theta);
      pts.push({ u, v, sharp: i === 0 });
    }
    pts.push(
      { u: neckU * 0.85, v: H * 0.96, sharp: false },
      { u: T * 0.3, v: H, sharp: true },
      { u: 0, v: H, sharp: true }
    );
    return pts;
  }

  if (kind === 'lambs-tongue') {
    const plinthH = H * 0.58;
    const mouldTop = H * 0.94;
    const topFilletU = T * 0.32;
    const pts: SkirtingProfilePoint[] = [
      { u: 0, v: 0, sharp: true },
      { u: T, v: 0, sharp: true },
      { u: T, v: plinthH, sharp: true },
    ];
    const samples = 10;
    for (let i = 1; i <= samples; i++) {
      const s = i / samples;
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * s);
      const bulge = Math.sin(Math.PI * 2 * s) * (T * 0.08);
      const u = T - (T - topFilletU) * ease + bulge;
      const v = plinthH + (mouldTop - plinthH) * s;
      pts.push({ u: Math.max(topFilletU * 0.85, Math.min(T, u)), v, sharp: i === samples });
    }
    pts.push(
      { u: topFilletU, v: H, sharp: true },
      { u: 0, v: H, sharp: true }
    );
    return pts;
  }

  // Default: 'ogee' (Georgian S-curve cyma reversa + quirk + fascia plinth)
  const plinthH = H * 0.63;
  const quirkU = T * 0.78;
  const ogeeStartV = H * 0.655;
  const ogeeEndV = H * 0.95;
  const topFilletU = T * 0.34;
  const pts: SkirtingProfilePoint[] = [
    { u: 0, v: 0, sharp: true },
    { u: T, v: 0, sharp: true },
    { u: T, v: plinthH, sharp: true },
    { u: quirkU, v: ogeeStartV, sharp: true },
  ];
  const samples = 10;
  for (let i = 1; i <= samples; i++) {
    const s = i / samples;
    const baseU = quirkU + (topFilletU - quirkU) * s;
    const wave = Math.sin(Math.PI * 2 * s) * (T * 0.16);
    const u = Math.max(T * 0.22, Math.min(T, baseU + wave));
    const v = ogeeStartV + (ogeeEndV - ogeeStartV) * s;
    pts.push({ u, v, sharp: false });
  }
  pts.push(
    { u: topFilletU, v: H, sharp: true },
    { u: 0, v: H, sharp: true }
  );
  return pts;
}

export function normalizeMouldingProfilePoints(
  raw: readonly (SkirtingProfilePoint | readonly [number, number] | { readonly x: number; readonly y: number })[]
): SkirtingProfilePoint[] {
  const pts: SkirtingProfilePoint[] = [];
  for (const item of raw) {
    let pt: SkirtingProfilePoint;
    if ('u' in item) {
      pt = { u: item.u, v: item.v, sharp: item.sharp ?? false };
    } else if (Array.isArray(item)) {
      pt = { u: item[0], v: item[1], sharp: true };
    } else {
      pt = { u: (item as { readonly x: number }).x, v: (item as { readonly y: number }).y, sharp: true };
    }
    if (
      pts.length === 0 ||
      Math.hypot(pt.u - pts[pts.length - 1]!.u, pt.v - pts[pts.length - 1]!.v) > 1e-6
    ) {
      pts.push(pt);
    }
  }
  while (
    pts.length > 1 &&
    Math.hypot(pts[0]!.u - pts[pts.length - 1]!.u, pts[0]!.v - pts[pts.length - 1]!.v) <= 1e-6
  ) {
    pts.pop();
  }

  const tuples = pts.map((p): [number, number] => [p.u, p.v]);
  if (pts.length >= 3 && computeSignedPolygonArea2D(tuples) < 0) {
    pts.reverse();
  }
  return pts;
}

function normalizeProfilePoints(
  profileInput: SkirtingProfileInput | undefined,
  options: CreateSkirtingProfileOptions
): SkirtingProfilePoint[] {
  const raw: readonly (SkirtingProfilePoint | readonly [number, number])[] =
    profileInput === undefined || typeof profileInput === 'string'
      ? createSkirtingProfile(profileInput ?? 'ogee', options)
      : profileInput;
  return normalizeMouldingProfilePoints(raw);
}

export function resolveMouldingPathData(options: {
  readonly path?: MouldingPathInput;
  readonly points?: readonly (readonly [number, number] | readonly [number, number, number])[];
  readonly closed?: boolean;
  readonly roomSide?: RoomSide;
  readonly elevationY?: number;
  readonly floorY?: number;
  readonly applyElevationToBuilder?: boolean;
}): MouldingPathData {
  const pathInput = options.path ?? options.points;
  const elev = options.elevationY ?? options.floorY;
  if (!pathInput) {
    throw new Error('resolveMouldingPathData: requires either options.path or options.points.');
  }
  if (pathInput instanceof MouldingPathBuilder) {
    if (options.closed) {
      pathInput.close();
    }
    const built = pathInput.build();
    if (options.applyElevationToBuilder && elev !== undefined && Math.abs(elev) > 1e-9) {
      const allZeroY = built.segments.every(
        (s) => Math.abs(s.from[1]) <= 1e-9 && Math.abs(s.to[1]) <= 1e-9
      );
      if (allZeroY) {
        const dy = elev;
        return {
          ...built,
          segments: built.segments.map((s) => ({
            ...s,
            from: [s.from[0], s.from[1] + dy, s.from[2]],
            to: [s.to[0], s.to[1] + dy, s.to[2]],
          })),
        };
      }
    }
    return built;
  }
  if ('segments' in pathInput && 'totalLengthM' in pathInput) {
    const built = pathInput;
    if (options.applyElevationToBuilder && elev !== undefined && Math.abs(elev) > 1e-9) {
      const allZeroY = built.segments.every(
        (s) => Math.abs(s.from[1]) <= 1e-9 && Math.abs(s.to[1]) <= 1e-9
      );
      if (allZeroY) {
        const dy = elev;
        return {
          ...built,
          segments: built.segments.map((s) => ({
            ...s,
            from: [s.from[0], s.from[1] + dy, s.from[2]],
            to: [s.to[0], s.to[1] + dy, s.to[2]],
          })),
        };
      }
    }
    return built;
  }

  const pts = pathInput;
  if (pts.length < 2) {
    return {
      roomSide: options.roomSide ?? 'left',
      closed: false,
      totalLengthM: 0,
      segments: [],
    };
  }
  const elevY = elev ?? 0;
  const first = pts[0]!;
  const startX = first[0];
  const startY = first.length === 3 ? first[1] : elevY;
  const startZ = first.length === 3 ? first[2] : first[1];
  const builder = new MouldingPathBuilder(startX, startZ, {
    y: startY,
    roomSide: options.roomSide ?? 'left',
  });
  let curX = startX;
  let curY = startY;
  let curZ = startZ;

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const nx = p[0];
    const ny = p.length === 3 ? p[1] : elevY;
    const nz = p.length === 3 ? p[2] : p[1];
    const hDist = Math.hypot(nx - curX, nz - curZ);
    const vDist = Math.abs(ny - curY);
    if (hDist <= 1e-6 && vDist > 1e-6) {
      builder.stepTo(ny);
    } else if (vDist <= 1e-6) {
      builder.lineTo(nx, nz);
    } else {
      builder.rakeTo(nx, ny, nz);
    }
    curX = nx;
    curY = ny;
    curZ = nz;
  }
  if (options.closed) {
    builder.close();
  }
  return builder.build();
}

export interface ResolvedGapInterval {
  startDist: number;
  endDist: number;
  startCap: SkirtingEndCap;
  endCap: SkirtingEndCap;
}

function clipSegmentToAABB(
  p0: Vec3Tuple,
  p1: Vec3Tuple,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number
): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];

  const clipAxis = (p: number, q: number): boolean => {
    if (Math.abs(p) <= 1e-12) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    !clipAxis(-dx, p0[0] - minX) ||
    !clipAxis(dx, maxX - p0[0]) ||
    !clipAxis(-dy, p0[1] - minY) ||
    !clipAxis(dy, maxY - p0[1]) ||
    !clipAxis(-dz, p0[2] - minZ) ||
    !clipAxis(dz, maxZ - p0[2])
  ) {
    return null;
  }

  if (t1 - t0 <= 1e-6) return null;
  return [t0, t1];
}

export function resolveMouldingGaps(
  pathData: MouldingPathData,
  gaps: readonly SkirtingGapSpec[] | undefined,
  defaultCap: SkirtingEndCap
): ResolvedGapInterval[] {
  if (!gaps || gaps.length === 0 || pathData.segments.length === 0) {
    return [];
  }

  const totalLen = pathData.totalLengthM;
  const rawIntervals: ResolvedGapInterval[] = [];

  for (const gap of gaps) {
    const sCap = gap.startCap ?? gap.cap ?? defaultCap;
    const eCap = gap.endCap ?? gap.cap ?? defaultCap;

    if ('startDist' in gap) {
      const a = Math.max(0, Math.min(totalLen, Math.min(gap.startDist, gap.endDist)));
      const b = Math.max(0, Math.min(totalLen, Math.max(gap.startDist, gap.endDist)));
      if (b - a > 1e-5) {
        rawIntervals.push({ startDist: a, endDist: b, startCap: sCap, endCap: eCap });
      }
    } else if ('at' in gap) {
      const is3D = gap.at.length === 3;
      const ax = gap.at[0];
      const ay = is3D ? gap.at[1] : 0;
      const az = is3D ? gap.at[2] : gap.at[1];

      let bestDistSq = Infinity;
      let bestArcDist = 0;

      for (const seg of pathData.segments) {
        if (!is3D && seg.kind === 'vertical') continue;
        const dx = seg.to[0] - seg.from[0];
        const dy = is3D ? seg.to[1] - seg.from[1] : 0;
        const dz = seg.to[2] - seg.from[2];
        const lenSq = dx * dx + dy * dy + dz * dz;
        const t =
          lenSq > 1e-12
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((ax - seg.from[0]) * dx +
                    (is3D ? (ay - seg.from[1]) * dy : 0) +
                    (az - seg.from[2]) * dz) /
                    lenSq
                )
              )
            : 0;
        const px = seg.from[0] + dx * t;
        const py = is3D ? seg.from[1] + dy * t : 0;
        const pz = seg.from[2] + dz * t;
        const dSq =
          (ax - px) * (ax - px) +
          (is3D ? (ay - py) * (ay - py) : 0) +
          (az - pz) * (az - pz);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestArcDist = seg.cumulativeDist + t * seg.length;
        }
      }

      const halfW = gap.width * 0.5;
      if (pathData.closed && (bestArcDist - halfW < 0 || bestArcDist + halfW > totalLen)) {
        if (bestArcDist - halfW < 0) {
          rawIntervals.push({
            startDist: Math.max(0, totalLen + (bestArcDist - halfW)),
            endDist: totalLen,
            startCap: sCap,
            endCap: eCap,
          });
          rawIntervals.push({
            startDist: 0,
            endDist: Math.min(totalLen, bestArcDist + halfW),
            startCap: sCap,
            endCap: eCap,
          });
        } else {
          rawIntervals.push({
            startDist: Math.max(0, bestArcDist - halfW),
            endDist: totalLen,
            startCap: sCap,
            endCap: eCap,
          });
          rawIntervals.push({
            startDist: 0,
            endDist: Math.min(totalLen, bestArcDist + halfW - totalLen),
            startCap: sCap,
            endCap: eCap,
          });
        }
      } else {
        const a = Math.max(0, bestArcDist - halfW);
        const b = Math.min(totalLen, bestArcDist + halfW);
        if (b - a > 1e-5) {
          rawIntervals.push({ startDist: a, endDist: b, startCap: sCap, endCap: eCap });
        }
      }
    } else if ('box' in gap || 'boxXZ' in gap) {
      const bx: SkirtingGapBoxBounds = ('boxXZ' in gap && gap.boxXZ ? gap.boxXZ : (gap as { readonly box: SkirtingGapBoxBounds }).box);
      const minX = bx instanceof THREE.Box3 ? bx.min.x : bx.minX;
      const maxX = bx instanceof THREE.Box3 ? bx.max.x : bx.maxX;
      const minY = bx instanceof THREE.Box3 ? bx.min.y : (bx.minY ?? -1e9);
      const maxY = bx instanceof THREE.Box3 ? bx.max.y : (bx.maxY ?? 1e9);
      const minZ = bx instanceof THREE.Box3 ? bx.min.z : bx.minZ;
      const maxZ = bx instanceof THREE.Box3 ? bx.max.z : bx.maxZ;

      for (const seg of pathData.segments) {
        const hit = clipSegmentToAABB(
          seg.from,
          seg.to,
          minX,
          maxX,
          minY,
          maxY,
          minZ,
          maxZ
        );
        if (hit) {
          const a = seg.cumulativeDist + hit[0] * seg.length;
          const b = seg.cumulativeDist + hit[1] * seg.length;
          if (b - a > 1e-5) {
            rawIntervals.push({ startDist: a, endDist: b, startCap: sCap, endCap: eCap });
          }
        }
      }
    }
  }

  if (rawIntervals.length <= 1) {
    return rawIntervals;
  }
  rawIntervals.sort((a, b) => a.startDist - b.startDist);
  const merged: ResolvedGapInterval[] = [rawIntervals[0]!];
  for (let i = 1; i < rawIntervals.length; i++) {
    const curr = rawIntervals[i]!;
    const prev = merged[merged.length - 1]!;
    if (curr.startDist <= prev.endDist + 1e-5) {
      if (curr.endDist > prev.endDist) {
        prev.endDist = curr.endDist;
        prev.endCap = curr.endCap;
      }
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

export interface CornerJointInfo {
  readonly miterNormal: THREE.Vector3;
  readonly prevSeg: MouldingPathSegment | undefined;
  readonly nextSeg: MouldingPathSegment | undefined;
  readonly smooth: boolean;
  readonly avgUAxis: THREE.Vector3;
  readonly avgVAxis: THREE.Vector3;
}

export interface SubSegmentPiece {
  readonly segIndex: number;
  readonly seg: MouldingPathSegment;
  readonly t0: number;
  readonly t1: number;
  readonly p0: THREE.Vector3;
  readonly p1: THREE.Vector3;
  readonly arcStart: number;
  readonly arcEnd: number;
  readonly startJoint: CornerJointInfo | null;
  readonly endJoint: CornerJointInfo | null;
  readonly startCap: SkirtingEndCap | null;
  readonly endCap: SkirtingEndCap | null;
  readonly cutaway: CutawayWallDescriptor | null;
}

function matchCutawaySlicesForPiece(
  seg: MouldingPathSegment,
  t0: number,
  t1: number,
  cutawayWalls: readonly CutawayWallDescriptor[] | undefined,
  floor: string | undefined,
  toleranceM: number
): Array<{ readonly t0: number; readonly t1: number; readonly cutaway: CutawayWallDescriptor | null }> {
  if (!cutawayWalls || cutawayWalls.length === 0 || seg.kind === 'vertical') {
    return [{ t0, t1, cutaway: null }];
  }

  const absTx = Math.abs(seg.horizTangent[0]);
  const absTz = Math.abs(seg.horizTangent[2]);
  let wallAxis: 'x' | 'z' | null = null;
  if (absTx >= 0.98 && absTz <= 0.2) {
    wallAxis = 'z';
  } else if (absTz >= 0.98 && absTx <= 0.2) {
    wallAxis = 'x';
  }
  if (!wallAxis) {
    return [{ t0, t1, cutaway: null }];
  }

  const segCoord =
    wallAxis === 'z'
      ? (seg.from[2] + seg.to[2]) * 0.5
      : (seg.from[0] + seg.to[0]) * 0.5;
  const sFrom = wallAxis === 'z' ? seg.from[0] : seg.from[2];
  const sTo = wallAxis === 'z' ? seg.to[0] : seg.to[2];
  const sDelta = sTo - sFrom;
  if (Math.abs(sDelta) <= 1e-6) {
    return [{ t0, t1, cutaway: null }];
  }

  const candidates = cutawayWalls.filter((d) => {
    if (floor && d.floor !== floor) return false;
    if (d.axis !== wallAxis) return false;
    return Math.abs(segCoord - d.coord) <= toleranceM;
  });
  if (candidates.length === 0) {
    return [{ t0, t1, cutaway: null }];
  }

  const splitTs = new Set<number>([t0, t1]);
  for (const d of candidates) {
    for (const bound of [d.minSpan, d.maxSpan]) {
      const t = (bound - sFrom) / sDelta;
      if (t > t0 + 1e-5 && t < t1 - 1e-5) {
        splitTs.add(t);
      }
    }
  }

  const sortedTs = [...splitTs].sort((a, b) => a - b);
  const slices: Array<{
    readonly t0: number;
    readonly t1: number;
    readonly cutaway: CutawayWallDescriptor | null;
  }> = [];

  for (let i = 0; i + 1 < sortedTs.length; i++) {
    const a = sortedTs[i]!;
    const b = sortedTs[i + 1]!;
    if (b - a <= 1e-6) continue;
    const tMid = (a + b) * 0.5;
    const spanMid = sFrom + sDelta * tMid;

    let bestDesc: CutawayWallDescriptor | null = null;
    let bestDist = Infinity;
    for (const d of candidates) {
      if (spanMid >= d.minSpan - 1e-4 && spanMid <= d.maxSpan + 1e-4) {
        const dist = Math.abs(segCoord - d.coord);
        if (dist < bestDist) {
          bestDist = dist;
          bestDesc = d;
        }
      }
    }

    const prev = slices.length > 0 ? slices[slices.length - 1] : undefined;
    if (prev && prev.cutaway === bestDesc) {
      slices[slices.length - 1] = { t0: prev.t0, t1: b, cutaway: bestDesc };
    } else {
      slices.push({ t0: a, t1: b, cutaway: bestDesc });
    }
  }

  return slices.length > 0 ? slices : [{ t0, t1, cutaway: null }];
}

export interface MeshAccumulator {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

export function createMeshAccumulator(): MeshAccumulator {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

export function emitOrientedTri(
  acc: MeshAccumulator,
  i0: number,
  i1: number,
  i2: number,
  expectedNormal: THREE.Vector3
): void {
  const p0x = acc.positions[i0 * 3]!;
  const p0y = acc.positions[i0 * 3 + 1]!;
  const p0z = acc.positions[i0 * 3 + 2]!;
  const e1x = acc.positions[i1 * 3]! - p0x;
  const e1y = acc.positions[i1 * 3 + 1]! - p0y;
  const e1z = acc.positions[i1 * 3 + 2]! - p0z;
  const e2x = acc.positions[i2 * 3]! - p0x;
  const e2y = acc.positions[i2 * 3 + 1]! - p0y;
  const e2z = acc.positions[i2 * 3 + 2]! - p0z;
  const cx = e1y * e2z - e1z * e2y;
  const cy = e1z * e2x - e1x * e2z;
  const cz = e1x * e2y - e1y * e2x;
  if (cx * expectedNormal.x + cy * expectedNormal.y + cz * expectedNormal.z >= 0) {
    acc.indices.push(i0, i1, i2);
  } else {
    acc.indices.push(i0, i2, i1);
  }
}

export function emitQuad3D(
  acc: MeshAccumulator,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  outwardNormal: THREE.Vector3,
  uv0: readonly [number, number],
  uv1: readonly [number, number],
  uv2: readonly [number, number],
  uv3: readonly [number, number]
): void {
  const n = outwardNormal.clone().normalize();
  const base = acc.positions.length / 3;
  acc.positions.push(
    p0.x, p0.y, p0.z,
    p1.x, p1.y, p1.z,
    p2.x, p2.y, p2.z,
    p3.x, p3.y, p3.z
  );
  acc.normals.push(
    n.x, n.y, n.z,
    n.x, n.y, n.z,
    n.x, n.y, n.z,
    n.x, n.y, n.z
  );
  acc.uvs.push(uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1], uv3[0], uv3[1]);
  emitOrientedTri(acc, base, base + 1, base + 2, n);
  emitOrientedTri(acc, base, base + 2, base + 3, n);
}

export interface HiddenProfileEdgeRule {
  readonly omitWallBack?: boolean;
  readonly omitBottomAtZero?: boolean;
  readonly omitTopAtZero?: boolean;
  readonly wallBackThresholdU?: number;
  readonly topCeilingThresholdV?: number;
}

interface PreparedProfileEdge {
  readonly i0: number;
  readonly i1: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly arc0: number;
  readonly arc1: number;
  readonly nu0: number;
  readonly nv0: number;
  readonly nu1: number;
  readonly nv1: number;
  readonly faceNu: number;
  readonly faceNv: number;
  readonly isHiddenEdge: boolean;
}

function prepareProfileEdges(
  profile: readonly SkirtingProfilePoint[],
  hiddenRule: HiddenProfileEdgeRule = { omitWallBack: true, omitBottomAtZero: true }
): {
  readonly edges: readonly PreparedProfileEdge[];
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
  readonly capTriangles: readonly (readonly [number, number, number])[];
} {
  const n = profile.length;
  let maxU = 0;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of profile) {
    if (p.u > maxU) maxU = p.u;
    if (p.v < minV) minV = p.v;
    if (p.v > maxV) maxV = p.v;
  }

  const backThresh = hiddenRule.wallBackThresholdU ?? 1e-6;
  const faceNormals: [number, number][] = [];
  const arcs: number[] = [0];
  for (let i = 0; i < n; i++) {
    const p0 = profile[i]!;
    const p1 = profile[(i + 1) % n]!;
    const du = p1.u - p0.u;
    const dv = p1.v - p0.v;
    const len = Math.hypot(du, dv) || 1;
    faceNormals.push([dv / len, -du / len]);
    arcs.push(arcs[i]! + len);
  }

  const edges: PreparedProfileEdge[] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const prev = (i + n - 1) % n;
    const p0 = profile[i]!;
    const p1 = profile[next]!;
    const [fnu, fnv] = faceNormals[i]!;

    let nu0 = fnu;
    let nv0 = fnv;
    if (!p0.sharp) {
      const [pnu, pnv] = faceNormals[prev]!;
      const su = pnu + fnu;
      const sv = pnv + fnv;
      const sl = Math.hypot(su, sv);
      if (sl > 1e-6) {
        nu0 = su / sl;
        nv0 = sv / sl;
      }
    }

    let nu1 = fnu;
    let nv1 = fnv;
    if (!p1.sharp) {
      const [nnu, nnv] = faceNormals[next]!;
      const su = fnu + nnu;
      const sv = fnv + nnv;
      const sl = Math.hypot(su, sv);
      if (sl > 1e-6) {
        nu1 = su / sl;
        nv1 = sv / sl;
      }
    }

    const isBackWallFace =
      Boolean(hiddenRule.omitWallBack) && p0.u <= backThresh && p1.u <= backThresh && fnu < -0.9;
    const isBottomFloorFace =
      Boolean(hiddenRule.omitBottomAtZero) && Math.abs(p0.v) <= 1e-6 && Math.abs(p1.v) <= 1e-6 && fnv < -0.9;
    const topThresh = hiddenRule.topCeilingThresholdV ?? 1e-6;
    const isTopCeilingFace =
      Boolean(hiddenRule.omitTopAtZero) && p0.v >= -topThresh && p1.v >= -topThresh && fnv > 0.9;

    edges.push({
      i0: i,
      i1: next,
      u0: p0.u,
      v0: p0.v,
      u1: p1.u,
      v1: p1.v,
      arc0: arcs[i]!,
      arc1: arcs[i + 1]!,
      nu0,
      nv0,
      nu1,
      nv1,
      faceNu: fnu,
      faceNv: fnv,
      isHiddenEdge: isBackWallFace || isBottomFloorFace || isTopCeilingFace,
    });
  }

  const contourV2 = profile.map((p) => new THREE.Vector2(p.u, p.v));
  const rawTris = THREE.ShapeUtils.triangulateShape(contourV2, []);
  const reversed =
    contourV2.length === n &&
    Math.hypot(contourV2[0]!.x - profile[0]!.u, contourV2[0]!.y - profile[0]!.v) > 1e-8;
  const mapIdx = (k: number): number => (reversed ? n - 1 - k : k);
  const capTriangles: [number, number, number][] = rawTris.map((tri) => [
    mapIdx(tri[0]!),
    mapIdx(tri[1]!),
    mapIdx(tri[2]!),
  ]);

  return { edges, maxU, minV, maxV, capTriangles };
}

export function evaluateJointMiterPoint(
  corner: THREE.Vector3,
  seg: MouldingPathSegment,
  joint: CornerJointInfo,
  u: number,
  v: number,
  maxMiterRatio: number,
  isSegEnd: boolean
): { readonly point: THREE.Vector3; readonly shift: number } {
  const projectOnSeg = (
    s: MouldingPathSegment
  ): { readonly pt: THREE.Vector3; readonly shift: number } => {
    const uVec = new THREE.Vector3(s.wallNormal[0], s.wallNormal[1], s.wallNormal[2]);
    const vVec = new THREE.Vector3(s.vAxis[0], s.vAxis[1], s.vAxis[2]);
    // For scribed step segments (where vAxis is locked plumb [0, 1, 0]), project horizontal
    // corner miters along horizTangent + vertical slope dy/hLen so top/bottom landings join flush!
    const hVec = new THREE.Vector3(s.horizTangent[0], 0, s.horizTangent[2]);
    const tVec = s.scribedSteps
      ? (() => {
          const hLen = Math.hypot(s.to[0] - s.from[0], s.to[2] - s.from[2]) || 1;
          const slopeY = (s.to[1] - s.from[1]) / hLen;
          return new THREE.Vector3(hVec.x, slopeY, hVec.z);
        })()
      : new THREE.Vector3(s.tangent[0], s.tangent[1], s.tangent[2]);

    const offset = new THREE.Vector3().addScaledVector(uVec, u).addScaledVector(vVec, v);
    const miterN = s.scribedSteps
      ? new THREE.Vector3(joint.miterNormal.x, 0, joint.miterNormal.z).normalize()
      : joint.miterNormal;
    const denom = (s.scribedSteps ? hVec : tVec).dot(miterN);
    let shift = 0;
    if (Math.abs(denom) > 1e-4) {
      const raw = -offset.dot(miterN) / denom;
      const lim = Math.max(0.02, Math.hypot(u, v)) * maxMiterRatio;
      shift = Math.max(-lim, Math.min(lim, raw));
    }
    return {
      pt: corner.clone().add(offset).addScaledVector(tVec, shift),
      shift,
    };
  };

  const currRes = projectOnSeg(seg);
  const neighbor = isSegEnd ? joint.nextSeg : joint.prevSeg;
  if (!neighbor) {
    return { point: currRes.pt, shift: currRes.shift };
  }
  const neighRes = projectOnSeg(neighbor);
  return {
    point: new THREE.Vector3().addVectors(currRes.pt, neighRes.pt).multiplyScalar(0.5),
    shift: currRes.shift,
  };
}

function emitSweptRingPair(
  acc: MeshAccumulator,
  profileEdges: readonly PreparedProfileEdge[],
  startRing: readonly THREE.Vector3[],
  endRing: readonly THREE.Vector3[],
  startShifts: readonly number[],
  endShifts: readonly number[],
  startUAxis: THREE.Vector3,
  startVAxis: THREE.Vector3,
  endUAxis: THREE.Vector3,
  endVAxis: THREE.Vector3,
  midUAxis: THREE.Vector3,
  midVAxis: THREE.Vector3,
  arcStart: number,
  arcEnd: number,
  includeHiddenFaces: boolean,
  uvScale: number
): void {
  const faceNormal = new THREE.Vector3();
  const nA0 = new THREE.Vector3();
  const nB0 = new THREE.Vector3();
  const nB1 = new THREE.Vector3();
  const nA1 = new THREE.Vector3();

  for (const edge of profileEdges) {
    if (!includeHiddenFaces && edge.isHiddenEdge) {
      continue;
    }

    faceNormal
      .set(0, 0, 0)
      .addScaledVector(midUAxis, edge.faceNu)
      .addScaledVector(midVAxis, edge.faceNv)
      .normalize();

    nA0
      .set(0, 0, 0)
      .addScaledVector(startUAxis, edge.nu0)
      .addScaledVector(startVAxis, edge.nv0)
      .normalize();
    nA1
      .set(0, 0, 0)
      .addScaledVector(startUAxis, edge.nu1)
      .addScaledVector(startVAxis, edge.nv1)
      .normalize();
    nB0
      .set(0, 0, 0)
      .addScaledVector(endUAxis, edge.nu0)
      .addScaledVector(endVAxis, edge.nv0)
      .normalize();
    nB1
      .set(0, 0, 0)
      .addScaledVector(endUAxis, edge.nu1)
      .addScaledVector(endVAxis, edge.nv1)
      .normalize();

    const a0 = startRing[edge.i0]!;
    const b0 = endRing[edge.i0]!;
    const b1 = endRing[edge.i1]!;
    const a1 = startRing[edge.i1]!;

    const base = acc.positions.length / 3;
    acc.positions.push(
      a0.x, a0.y, a0.z,
      b0.x, b0.y, b0.z,
      b1.x, b1.y, b1.z,
      a1.x, a1.y, a1.z
    );
    acc.normals.push(
      nA0.x, nA0.y, nA0.z,
      nB0.x, nB0.y, nB0.z,
      nB1.x, nB1.y, nB1.z,
      nA1.x, nA1.y, nA1.z
    );

    const uA0 = (arcStart + startShifts[edge.i0]!) * uvScale;
    const uB0 = (arcEnd + endShifts[edge.i0]!) * uvScale;
    const uB1 = (arcEnd + endShifts[edge.i1]!) * uvScale;
    const uA1 = (arcStart + startShifts[edge.i1]!) * uvScale;
    const v0 = edge.arc0 * uvScale;
    const v1 = edge.arc1 * uvScale;
    acc.uvs.push(uA0, v0, uB0, v0, uB1, v1, uA1, v1);

    emitOrientedTri(acc, base, base + 1, base + 2, faceNormal);
    emitOrientedTri(acc, base, base + 2, base + 3, faceNormal);
  }
}

function emitPlanarProfileCap(
  acc: MeshAccumulator,
  profile: readonly SkirtingProfilePoint[],
  capTriangles: readonly (readonly [number, number, number])[],
  ring: readonly THREE.Vector3[],
  outwardNormal: THREE.Vector3,
  uvScale: number
): void {
  const n = outwardNormal.clone().normalize();
  const base = acc.positions.length / 3;
  for (let i = 0; i < profile.length; i++) {
    const p = ring[i]!;
    const prof = profile[i]!;
    acc.positions.push(p.x, p.y, p.z);
    acc.normals.push(n.x, n.y, n.z);
    acc.uvs.push(prof.u * uvScale, prof.v * uvScale);
  }
  for (const [a, b, c] of capTriangles) {
    emitOrientedTri(acc, base + a, base + b, base + c, n);
  }
}

function findPlinthSplitV(profile: readonly SkirtingProfilePoint[], maxU: number, maxV: number): number {
  // Find highest v on the flat front fascia (u === maxU) before the upper moulding begins
  let bestV = 0;
  for (const p of profile) {
    if (Math.abs(p.u - maxU) <= 1e-4 && p.v > bestV && p.v < maxV * 0.85) {
      bestV = p.v;
    }
  }
  return bestV > 0.01 ? bestV : maxV * 0.55;
}

function emitScribedStepPieceIntoAccumulator(
  acc: MeshAccumulator,
  piece: SubSegmentPiece,
  profile: readonly SkirtingProfilePoint[],
  includeHiddenFaces: boolean,
  maxMiterRatio: number,
  uvScale: number
): void {
  const seg = piece.seg;
  const scribed = seg.scribedSteps!;
  const clearance = scribed.nosingClearanceM ?? 0.0005;

  const hDx = seg.to[0] - seg.from[0];
  const hDz = seg.to[2] - seg.from[2];
  const fullHLen = Math.hypot(hDx, hDz);
  if (fullHLen <= EPS) return;

  const hVec = new THREE.Vector3(seg.horizTangent[0], 0, seg.horizTangent[2]);
  const uVec = new THREE.Vector3(seg.wallNormal[0], seg.wallNormal[1], seg.wallNormal[2]);
  const upVec = new THREE.Vector3(0, 1, 0);

  let maxU = 0;
  let maxV = 0;
  for (const p of profile) {
    if (p.u > maxU) maxU = p.u;
    if (p.v > maxV) maxV = p.v;
  }
  const splitV = findPlinthSplitV(profile, maxU, maxV);

  // Build upper moulding cap profile [splitV .. maxV] omitting its bottom seam at v = splitV
  // because the scribed lower plinth web joins directly below v = splitV.
  const upperRaw: SkirtingProfilePoint[] = [
    { u: 0, v: splitV, sharp: true },
    { u: maxU, v: splitV, sharp: true },
  ];
  for (const p of profile) {
    if (p.v > splitV + 1e-5) {
      upperRaw.push(p);
    }
  }
  const upperProfile = normalizeMouldingProfilePoints(upperRaw);
  const upperInfo = prepareProfileEdges(upperProfile, { omitWallBack: true, omitBottomAtZero: false });
  // Mark the bottom seam edge (v0 === splitV && v1 === splitV) hidden so upper cap & lower plinth share zero internal faces
  const upperEdgesFiltered = upperInfo.edges.map((e) =>
    Math.abs(e.v0 - splitV) <= 1e-5 && Math.abs(e.v1 - splitV) <= 1e-5 && e.faceNv < -0.9
      ? { ...e, isHiddenEdge: true }
      : e
  );

  const s0 = piece.t0 * fullHLen;
  const s1 = piece.t1 * fullHLen;
  if (s1 - s0 <= EPS) return;

  const slopeY = (seg.to[1] - seg.from[1]) / fullHLen;
  const rakedT = new THREE.Vector3(hVec.x, slopeY, hVec.z);

  const startRing: THREE.Vector3[] = [];
  const startShifts: number[] = [];
  for (const pt of upperProfile) {
    if (piece.startJoint) {
      const res = evaluateJointMiterPoint(
        piece.p0,
        seg,
        piece.startJoint,
        pt.u,
        pt.v,
        maxMiterRatio,
        false
      );
      startRing.push(res.point);
      startShifts.push(res.shift);
    } else {
      startRing.push(piece.p0.clone().addScaledVector(uVec, pt.u).addScaledVector(upVec, pt.v));
      startShifts.push(0);
    }
  }

  const endRing: THREE.Vector3[] = [];
  const endShifts: number[] = [];
  for (const pt of upperProfile) {
    if (piece.endJoint) {
      const res = evaluateJointMiterPoint(
        piece.p1,
        seg,
        piece.endJoint,
        pt.u,
        pt.v,
        maxMiterRatio,
        true
      );
      endRing.push(res.point);
      endShifts.push(res.shift);
    } else {
      endRing.push(piece.p1.clone().addScaledVector(uVec, pt.u).addScaledVector(upVec, pt.v));
      endShifts.push(0);
    }
  }

  emitSweptRingPair(
    acc,
    upperEdgesFiltered,
    startRing,
    endRing,
    startShifts,
    endShifts,
    uVec,
    upVec,
    uVec,
    upVec,
    uVec,
    upVec,
    piece.arcStart,
    piece.arcEnd,
    includeHiddenFaces,
    uvScale
  );

  if (piece.startCap === 'butt') {
    emitPlanarProfileCap(
      acc,
      upperProfile,
      upperInfo.capTriangles,
      startRing,
      hVec.clone().negate(),
      uvScale
    );
  }
  if (piece.endCap === 'butt') {
    emitPlanarProfileCap(
      acc,
      upperProfile,
      upperInfo.capTriangles,
      endRing,
      hVec,
      uvScale
    );
  }

  // Resolve sorted step intervals along horizontal distance s in [0, fullHLen]
  const parsedSteps = scribed.steps
    .map((st) => {
      let d = st.atDist ?? 0;
      if (st.atDist === undefined && st.atXZ) {
        d = (st.atXZ[0] - seg.from[0]) * hVec.x + (st.atXZ[1] - seg.from[2]) * hVec.z;
      }
      return { d: Math.max(0, Math.min(fullHLen, d)), y: st.y };
    })
    .sort((a, b) => a.d - b.d);

  // Build piecewise tread spans [a, b, treadY] across [s0, s1]
  interface TreadSpan {
    sA: number;
    sB: number;
    yFloor: number;
  }

  const rawSpans: TreadSpan[] = [];
  let curS = 0;
  let curY = seg.from[1];
  for (const st of parsedSteps) {
    if (st.d <= 1e-6) {
      curY = st.y;
      continue;
    }
    if (st.d - curS > 1e-5) {
      rawSpans.push({ sA: curS, sB: st.d, yFloor: curY });
    }
    curS = st.d;
    curY = st.y;
  }
  if (fullHLen - curS > 1e-5) {
    rawSpans.push({ sA: curS, sB: fullHLen, yFloor: curY });
  }

  // Apply riser horizontal clearance so vertical scribed edges never coplanar-overlap stair risers
  const adjustedSpans: TreadSpan[] = rawSpans.map((sp) => ({ ...sp }));
  for (let i = 0; i + 1 < adjustedSpans.length; i++) {
    const left = adjustedSpans[i]!;
    const right = adjustedSpans[i + 1]!;
    if (Math.abs(right.yFloor - left.yFloor) <= 1e-5) continue;
    if (right.yFloor > left.yFloor) {
      // Going UP: riser faces -hVec into left span -> pull left span end back by clearance
      left.sB = Math.max(left.sA, left.sB - clearance);
      right.sA = left.sB;
    } else {
      // Going DOWN: riser faces +hVec into right span -> push right span start forward by clearance
      right.sA = Math.min(right.sB, right.sA + clearance);
      left.sB = right.sA;
    }
  }

  const miterShiftAt = (u: number, isEnd: boolean): number => {
    const joint = isEnd ? piece.endJoint : piece.startJoint;
    if (!joint) return 0;
    const corner = isEnd ? piece.p1 : piece.p0;
    return evaluateJointMiterPoint(corner, seg, joint, u, 0, maxMiterRatio, isEnd).shift;
  };

  const shiftBackStart = miterShiftAt(0, false);
  const shiftFrontStart = miterShiftAt(maxU, false);
  const shiftBackEnd = miterShiftAt(0, true);
  const shiftFrontEnd = miterShiftAt(maxU, true);

  const worldAtSUY = (s: number, u: number, y: number): THREE.Vector3 =>
    new THREE.Vector3(
      seg.from[0] + hVec.x * s + uVec.x * u,
      y,
      seg.from[2] + hVec.z * s + uVec.z * u
    );

  const activeSpans = adjustedSpans
    .map((sp) => ({
      sA: Math.max(s0, sp.sA),
      sB: Math.min(s1, sp.sB),
      yFloor: sp.yFloor + clearance,
    }))
    .filter((sp) => sp.sB - sp.sA > 1e-5);

  for (let idx = 0; idx < activeSpans.length; idx++) {
    const sp = activeSpans[idx]!;
    const atPieceStart = Math.abs(sp.sA - s0) <= 1e-5;
    const atPieceEnd = Math.abs(sp.sB - s1) <= 1e-5;

    const sFrontA = sp.sA + (atPieceStart ? shiftFrontStart : 0);
    const sFrontB = sp.sB + (atPieceEnd ? shiftFrontEnd : 0);
    const sBackA = sp.sA + (atPieceStart ? shiftBackStart : 0);
    const sBackB = sp.sB + (atPieceEnd ? shiftBackEnd : 0);

    const yTopFrontA = seg.from[1] + slopeY * sFrontA + splitV;
    const yTopFrontB = seg.from[1] + slopeY * sFrontB + splitV;
    const yTopBackA = seg.from[1] + slopeY * sBackA + splitV;
    const yTopBackB = seg.from[1] + slopeY * sBackB + splitV;

    const yBotA = Math.min(sp.yFloor, yTopFrontA - 0.002);
    const yBotB = Math.min(sp.yFloor, yTopFrontB - 0.002);

    const fBotA = worldAtSUY(sFrontA, maxU, yBotA);
    const fBotB = worldAtSUY(sFrontB, maxU, yBotB);
    const fTopB = worldAtSUY(sFrontB, maxU, yTopFrontB);
    const fTopA = worldAtSUY(sFrontA, maxU, yTopFrontA);

    // Front room-facing scribed plinth quad
    emitQuad3D(
      acc,
      fBotA,
      fBotB,
      fTopB,
      fTopA,
      uVec,
      [sFrontA * uvScale, yBotA * uvScale],
      [sFrontB * uvScale, yBotB * uvScale],
      [sFrontB * uvScale, yTopFrontB * uvScale],
      [sFrontA * uvScale, yTopFrontA * uvScale]
    );

    if (includeHiddenFaces) {
      const bBotA = worldAtSUY(sBackA, 0, yBotA);
      const bBotB = worldAtSUY(sBackB, 0, yBotB);
      const bTopB = worldAtSUY(sBackB, 0, yTopBackB);
      const bTopA = worldAtSUY(sBackA, 0, yTopBackA);
      emitQuad3D(
        acc,
        bBotB,
        bBotA,
        bTopA,
        bTopB,
        uVec.clone().negate(),
        [sBackB * uvScale, yBotB * uvScale],
        [sBackA * uvScale, yBotA * uvScale],
        [sBackA * uvScale, yTopBackA * uvScale],
        [sBackB * uvScale, yTopBackB * uvScale]
      );
    }

    // End cap at start of span (either butt open end or vertical riser notch step)
    if (atPieceStart && piece.startCap === 'butt') {
      const bBotA = worldAtSUY(sBackA, 0, yBotA);
      const bTopA = worldAtSUY(sBackA, 0, yTopBackA);
      emitQuad3D(
        acc,
        bBotA,
        fBotA,
        fTopA,
        bTopA,
        hVec.clone().negate(),
        [0, yBotA * uvScale],
        [maxU * uvScale, yBotA * uvScale],
        [maxU * uvScale, yTopFrontA * uvScale],
        [0, yTopBackA * uvScale]
      );
    } else if (idx > 0) {
      const prev = activeSpans[idx - 1]!;
      if (prev.yFloor > sp.yFloor + 1e-5) {
        // Going DOWN: vertical return face facing -hVec between yBotA and prev.yFloor
        const yStepTop = Math.min(prev.yFloor, yTopFrontA);
        emitQuad3D(
          acc,
          worldAtSUY(sp.sA, 0, yBotA),
          worldAtSUY(sp.sA, maxU, yBotA),
          worldAtSUY(sp.sA, maxU, yStepTop),
          worldAtSUY(sp.sA, 0, yStepTop),
          hVec.clone().negate(),
          [0, yBotA * uvScale],
          [maxU * uvScale, yBotA * uvScale],
          [maxU * uvScale, yStepTop * uvScale],
          [0, yStepTop * uvScale]
        );
      }
    }

    if (atPieceEnd && piece.endCap === 'butt') {
      const bBotB = worldAtSUY(sBackB, 0, yBotB);
      const bTopB = worldAtSUY(sBackB, 0, yTopBackB);
      emitQuad3D(
        acc,
        fBotB,
        bBotB,
        bTopB,
        fTopB,
        hVec,
        [maxU * uvScale, yBotB * uvScale],
        [0, yBotB * uvScale],
        [0, yTopBackB * uvScale],
        [maxU * uvScale, yTopFrontB * uvScale]
      );
    } else if (idx + 1 < activeSpans.length) {
      const next = activeSpans[idx + 1]!;
      if (next.yFloor > sp.yFloor + 1e-5) {
        // Going UP: vertical return face facing +hVec between yBotB and next.yFloor
        const yStepTop = Math.min(next.yFloor, yTopFrontB);
        emitQuad3D(
          acc,
          worldAtSUY(sp.sB, maxU, yBotB),
          worldAtSUY(sp.sB, 0, yBotB),
          worldAtSUY(sp.sB, 0, yStepTop),
          worldAtSUY(sp.sB, maxU, yStepTop),
          hVec,
          [maxU * uvScale, yBotB * uvScale],
          [0, yBotB * uvScale],
          [0, yStepTop * uvScale],
          [maxU * uvScale, yStepTop * uvScale]
        );
      }
    }
  }
  void rakedT;
}

function emitPieceIntoAccumulator(
  acc: MeshAccumulator,
  piece: SubSegmentPiece,
  profile: readonly SkirtingProfilePoint[],
  profileInfo: ReturnType<typeof prepareProfileEdges>,
  includeHiddenFaces: boolean,
  maxMiterRatio: number,
  uvScale: number
): void {
  if (piece.seg.scribedSteps) {
    emitScribedStepPieceIntoAccumulator(
      acc,
      piece,
      profile,
      includeHiddenFaces,
      maxMiterRatio,
      uvScale
    );
    return;
  }

  const seg = piece.seg;
  const tVec = new THREE.Vector3(seg.tangent[0], seg.tangent[1], seg.tangent[2]);
  const uVec = new THREE.Vector3(seg.wallNormal[0], seg.wallNormal[1], seg.wallNormal[2]);
  const vVec = new THREE.Vector3(seg.vAxis[0], seg.vAxis[1], seg.vAxis[2]);

  const pieceLen = piece.p0.distanceTo(piece.p1);
  if (pieceLen <= EPS) return;

  const returnDepth = Math.min(profileInfo.maxU, pieceLen * 0.45);

  const startRing: THREE.Vector3[] = [];
  const startShifts: number[] = [];
  for (const pt of profile) {
    if (piece.startJoint) {
      const res = evaluateJointMiterPoint(
        piece.p0,
        seg,
        piece.startJoint,
        pt.u,
        pt.v,
        maxMiterRatio,
        false
      );
      startRing.push(res.point);
      startShifts.push(res.shift);
    } else if (piece.startCap === 'selfReturn' || piece.startCap === 'miter') {
      const shift = Math.max(
        0,
        (profileInfo.maxU - pt.u) * (returnDepth / Math.max(1e-6, profileInfo.maxU))
      );
      startRing.push(
        piece.p0
          .clone()
          .addScaledVector(tVec, shift)
          .addScaledVector(uVec, pt.u)
          .addScaledVector(vVec, pt.v)
      );
      startShifts.push(shift);
    } else {
      startRing.push(piece.p0.clone().addScaledVector(uVec, pt.u).addScaledVector(vVec, pt.v));
      startShifts.push(0);
    }
  }

  const endRing: THREE.Vector3[] = [];
  const endShifts: number[] = [];
  for (const pt of profile) {
    if (piece.endJoint) {
      const res = evaluateJointMiterPoint(
        piece.p1,
        seg,
        piece.endJoint,
        pt.u,
        pt.v,
        maxMiterRatio,
        true
      );
      endRing.push(res.point);
      endShifts.push(res.shift);
    } else if (piece.endCap === 'selfReturn' || piece.endCap === 'miter') {
      const shift = -Math.max(
        0,
        (profileInfo.maxU - pt.u) * (returnDepth / Math.max(1e-6, profileInfo.maxU))
      );
      endRing.push(
        piece.p1
          .clone()
          .addScaledVector(tVec, shift)
          .addScaledVector(uVec, pt.u)
          .addScaledVector(vVec, pt.v)
      );
      endShifts.push(shift);
    } else {
      endRing.push(piece.p1.clone().addScaledVector(uVec, pt.u).addScaledVector(vVec, pt.v));
      endShifts.push(0);
    }
  }

  const startUAxis = piece.startJoint?.smooth ? piece.startJoint.avgUAxis : uVec;
  const startVAxis = piece.startJoint?.smooth ? piece.startJoint.avgVAxis : vVec;
  const endUAxis = piece.endJoint?.smooth ? piece.endJoint.avgUAxis : uVec;
  const endVAxis = piece.endJoint?.smooth ? piece.endJoint.avgVAxis : vVec;

  emitSweptRingPair(
    acc,
    profileInfo.edges,
    startRing,
    endRing,
    startShifts,
    endShifts,
    startUAxis,
    startVAxis,
    endUAxis,
    endVAxis,
    uVec,
    vVec,
    piece.arcStart,
    piece.arcEnd,
    includeHiddenFaces,
    uvScale
  );

  if (piece.startCap === 'butt') {
    emitPlanarProfileCap(
      acc,
      profile,
      profileInfo.capTriangles,
      startRing,
      tVec.clone().negate(),
      uvScale
    );
  } else if (piece.startCap === 'miter') {
    const miterOut = new THREE.Vector3().subVectors(uVec, tVec).normalize();
    emitPlanarProfileCap(acc, profile, profileInfo.capTriangles, startRing, miterOut, uvScale);
  } else if (piece.startCap === 'selfReturn') {
    const wallReturnRing = profile.map((pt) => {
      const shift = Math.max(
        0,
        (profileInfo.maxU - pt.u) * (returnDepth / Math.max(1e-6, profileInfo.maxU))
      );
      return piece.p0
        .clone()
        .addScaledVector(tVec, shift)
        .addScaledVector(vVec, pt.v);
    });
    const zeroShifts = profile.map(() => 0);
    const retOutUAxis = tVec.clone().negate();
    emitSweptRingPair(
      acc,
      profileInfo.edges,
      wallReturnRing,
      startRing,
      zeroShifts,
      profile.map((pt) => pt.u),
      retOutUAxis,
      vVec,
      retOutUAxis,
      vVec,
      retOutUAxis,
      vVec,
      piece.arcStart - returnDepth,
      piece.arcStart,
      includeHiddenFaces,
      uvScale
    );
  }

  if (piece.endCap === 'butt') {
    emitPlanarProfileCap(acc, profile, profileInfo.capTriangles, endRing, tVec, uvScale);
  } else if (piece.endCap === 'miter') {
    const miterOut = new THREE.Vector3().addVectors(tVec, uVec).normalize();
    emitPlanarProfileCap(acc, profile, profileInfo.capTriangles, endRing, miterOut, uvScale);
  } else if (piece.endCap === 'selfReturn') {
    const wallReturnRing = profile.map((pt) => {
      const shift = -Math.max(
        0,
        (profileInfo.maxU - pt.u) * (returnDepth / Math.max(1e-6, profileInfo.maxU))
      );
      return piece.p1
        .clone()
        .addScaledVector(tVec, shift)
        .addScaledVector(vVec, pt.v);
    });
    const zeroShifts = profile.map(() => 0);
    const retOutUAxis = tVec.clone();
    emitSweptRingPair(
      acc,
      profileInfo.edges,
      endRing,
      wallReturnRing,
      profile.map((pt) => -pt.u),
      zeroShifts,
      retOutUAxis,
      vVec,
      retOutUAxis,
      vVec,
      retOutUAxis,
      vVec,
      piece.arcEnd,
      piece.arcEnd + returnDepth,
      includeHiddenFaces,
      uvScale
    );
  }
}

export function buildGeometryFromAcc(acc: MeshAccumulator): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  if (acc.positions.length === 0 || acc.indices.length === 0) {
    return geo;
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uvs, 2));
  geo.setIndex(acc.indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function computeActiveMouldingPieces(options: {
  readonly pathData: MouldingPathData;
  readonly gaps?: readonly SkirtingGapSpec[];
  readonly defaultCap: SkirtingEndCap;
  readonly openStartCap: SkirtingEndCap;
  readonly openEndCap: SkirtingEndCap;
  readonly cutawayWalls?: readonly CutawayWallDescriptor[];
  readonly floor?: string;
  readonly cutawayToleranceM: number;
}): { readonly pieces: readonly SubSegmentPiece[]; readonly activeTotalLen: number } {
  const {
    pathData,
    defaultCap,
    openStartCap,
    openEndCap,
    cutawayWalls,
    floor,
    cutawayToleranceM,
  } = options;
  const segs = pathData.segments;
  const segCount = segs.length;
  const segStartJoints: (CornerJointInfo | null)[] = [];
  const segEndJoints: (CornerJointInfo | null)[] = [];

  const makeJoint = (
    prev: MouldingPathSegment,
    curr: MouldingPathSegment,
    smooth: boolean
  ): CornerJointInfo => {
    // When joining horizontal & scribed-step segments, compute horizontal corner miter normal
    const useHoriz = Boolean(prev.scribedSteps || curr.scribedSteps);
    const tPrev = useHoriz
      ? new THREE.Vector3(prev.horizTangent[0], 0, prev.horizTangent[2])
      : new THREE.Vector3(prev.tangent[0], prev.tangent[1], prev.tangent[2]);
    const tCurr = useHoriz
      ? new THREE.Vector3(curr.horizTangent[0], 0, curr.horizTangent[2])
      : new THREE.Vector3(curr.tangent[0], curr.tangent[1], curr.tangent[2]);
    const sumT = new THREE.Vector3().addVectors(tPrev, tCurr);
    const miterNormal = sumT.lengthSq() > 1e-8 ? sumT.normalize() : tCurr.clone();

    const uPrev = new THREE.Vector3(prev.wallNormal[0], prev.wallNormal[1], prev.wallNormal[2]);
    const uCurr = new THREE.Vector3(curr.wallNormal[0], curr.wallNormal[1], curr.wallNormal[2]);
    const avgUAxis = new THREE.Vector3().addVectors(uPrev, uCurr);
    if (avgUAxis.lengthSq() > 1e-8) avgUAxis.normalize();
    else avgUAxis.copy(uCurr);

    const vPrev = new THREE.Vector3(prev.vAxis[0], prev.vAxis[1], prev.vAxis[2]);
    const vCurr = new THREE.Vector3(curr.vAxis[0], curr.vAxis[1], curr.vAxis[2]);
    const avgVAxis = new THREE.Vector3().addVectors(vPrev, vCurr);
    if (avgVAxis.lengthSq() > 1e-8) avgVAxis.normalize();
    else avgVAxis.copy(vCurr);

    return {
      miterNormal,
      prevSeg: prev,
      nextSeg: curr,
      smooth,
      avgUAxis,
      avgVAxis,
    };
  };

  for (let i = 0; i < segCount; i++) {
    const curr = segs[i]!;
    const prev = pathData.closed
      ? segs[(i + segCount - 1) % segCount]!
      : i > 0
        ? segs[i - 1]
        : undefined;
    const next = pathData.closed
      ? segs[(i + 1) % segCount]!
      : i + 1 < segCount
        ? segs[i + 1]
        : undefined;

    segStartJoints.push(
      prev ? makeJoint(prev, curr, Boolean(prev.smoothEnd && curr.smoothStart)) : null
    );
    segEndJoints.push(
      next ? makeJoint(curr, next, Boolean(curr.smoothEnd && next.smoothStart)) : null
    );
  }

  const gaps = resolveMouldingGaps(pathData, options.gaps, defaultCap);

  interface ActiveArcSpan {
    readonly arc0: number;
    readonly arc1: number;
    readonly capAtArc0: SkirtingEndCap | null;
    readonly capAtArc1: SkirtingEndCap | null;
  }

  const activeSpans: ActiveArcSpan[] = [];
  let cursor = 0;
  let pendingStartCap: SkirtingEndCap | null = pathData.closed ? null : openStartCap;

  for (const g of gaps) {
    if (g.startDist - cursor > 1e-5) {
      activeSpans.push({
        arc0: cursor,
        arc1: g.startDist,
        capAtArc0: pendingStartCap,
        capAtArc1: g.startCap,
      });
    }
    cursor = g.endDist;
    pendingStartCap = g.endCap;
  }
  if (pathData.totalLengthM - cursor > 1e-5) {
    let endCapAtTotal: SkirtingEndCap | null = pathData.closed ? null : openEndCap;
    if (pathData.closed && gaps.length > 0 && gaps[0]!.startDist <= 1e-5) {
      endCapAtTotal = gaps[0]!.startCap;
    }
    if (
      pathData.closed &&
      gaps.length > 0 &&
      gaps[gaps.length - 1]!.endDist >= pathData.totalLengthM - 1e-5 &&
      activeSpans.length > 0 &&
      activeSpans[0]!.arc0 <= 1e-5
    ) {
      activeSpans[0] = {
        ...activeSpans[0]!,
        capAtArc0: gaps[gaps.length - 1]!.endCap,
      };
    }
    activeSpans.push({
      arc0: cursor,
      arc1: pathData.totalLengthM,
      capAtArc0: pendingStartCap,
      capAtArc1: endCapAtTotal,
    });
  }

  const pieces: SubSegmentPiece[] = [];
  let activeTotalLen = 0;

  for (const span of activeSpans) {
    for (let i = 0; i < segCount; i++) {
      const seg = segs[i]!;
      const segA0 = seg.cumulativeDist;
      const segA1 = seg.cumulativeDist + seg.length;
      const inter0 = Math.max(span.arc0, segA0);
      const inter1 = Math.min(span.arc1, segA1);
      if (inter1 - inter0 <= 1e-5) continue;

      const t0 = (inter0 - segA0) / seg.length;
      const t1 = (inter1 - segA0) / seg.length;
      const atSpanStart = Math.abs(inter0 - span.arc0) <= 1e-5;
      const atSpanEnd = Math.abs(inter1 - span.arc1) <= 1e-5;
      const atSegStart = t0 <= 1e-5;
      const atSegEnd = t1 >= 1 - 1e-5;

      const cutawaySlices = matchCutawaySlicesForPiece(
        seg,
        t0,
        t1,
        cutawayWalls,
        floor,
        cutawayToleranceM
      );

      for (let sIdx = 0; sIdx < cutawaySlices.length; sIdx++) {
        const sl = cutawaySlices[sIdx]!;
        const isFirstSlice = sIdx === 0;
        const isLastSlice = sIdx === cutawaySlices.length - 1;

        const pFrom = new THREE.Vector3(
          seg.from[0] + (seg.to[0] - seg.from[0]) * sl.t0,
          seg.from[1] + (seg.to[1] - seg.from[1]) * sl.t0,
          seg.from[2] + (seg.to[2] - seg.from[2]) * sl.t0
        );
        const pTo = new THREE.Vector3(
          seg.from[0] + (seg.to[0] - seg.from[0]) * sl.t1,
          seg.from[1] + (seg.to[1] - seg.from[1]) * sl.t1,
          seg.from[2] + (seg.to[2] - seg.from[2]) * sl.t1
        );

        const sliceStartCap = isFirstSlice && atSpanStart ? span.capAtArc0 : null;
        const sliceEndCap = isLastSlice && atSpanEnd ? span.capAtArc1 : null;
        const sliceStartJoint =
          isFirstSlice && atSegStart && sliceStartCap === null ? segStartJoints[i]! : null;
        const sliceEndJoint =
          isLastSlice && atSegEnd && sliceEndCap === null ? segEndJoints[i]! : null;

        const arcStart = segA0 + sl.t0 * seg.length;
        const arcEnd = segA0 + sl.t1 * seg.length;
        activeTotalLen += arcEnd - arcStart;

        pieces.push({
          segIndex: i,
          seg,
          t0: sl.t0,
          t1: sl.t1,
          p0: pFrom,
          p1: pTo,
          arcStart,
          arcEnd,
          startJoint: sliceStartJoint,
          endJoint: sliceEndJoint,
          startCap: sliceStartCap,
          endCap: sliceEndCap,
          cutaway: sl.cutaway,
        });
      }
    }
  }

  return { pieces, activeTotalLen };
}

export function cutawayDescriptorKey(d: CutawayWallDescriptor): string {
  return `${d.floor}|${d.axis}|${d.coord.toFixed(5)}|${d.minSpan.toFixed(5)}|${d.maxSpan.toFixed(5)}|${d.outwardSide ?? ''}|${d.includeInFirstFloorCutaway ? '1' : '0'}`;
}

export interface SweepMouldingProfileRunOptions {
  readonly baseName: string;
  readonly pathData: MouldingPathData;
  readonly profile: readonly SkirtingProfilePoint[];
  readonly hiddenRule?: HiddenProfileEdgeRule;
  readonly material: THREE.Material;
  readonly gaps?: readonly SkirtingGapSpec[];
  readonly cap?: SkirtingEndCap;
  readonly startCap?: SkirtingEndCap;
  readonly endCap?: SkirtingEndCap;
  readonly cutawayWalls?: CutawayWallsInput;
  readonly floor?: string;
  readonly cutawayToleranceM?: number;
  readonly includeHiddenFaces?: boolean;
  readonly maxMiterRatio?: number;
  readonly uvScale?: number;
  readonly zone?: string;
  readonly collisionRole?: CollisionRole;
}

export function sweepMouldingProfileRun(options: SweepMouldingProfileRunOptions): SkirtingRunResult {
  const rootGroup = new THREE.Group();
  rootGroup.name = options.baseName;
  if (options.zone) {
    rootGroup.userData.zoneId = options.zone;
  }

  const { pathData, profile } = options;
  if (pathData.segments.length === 0 || profile.length < 3) {
    tagCollisionRole(rootGroup, options.collisionRole ?? 'ignore');
    return Object.assign(rootGroup, {
      cutawayMeshes: [] as readonly THREE.Mesh[],
      interiorMeshes: [] as readonly THREE.Mesh[],
      totalLengthM: 0,
    });
  }

  const profileInfo = prepareProfileEdges(profile, options.hiddenRule);
  const defaultCap: SkirtingEndCap = options.cap ?? 'butt';
  const openStartCap: SkirtingEndCap = options.startCap ?? defaultCap;
  const openEndCap: SkirtingEndCap = options.endCap ?? defaultCap;
  const includeHiddenFaces = options.includeHiddenFaces ?? false;
  const maxMiterRatio = options.maxMiterRatio ?? 4.0;
  const uvScale = options.uvScale ?? 1.0;
  const cutawayToleranceM = options.cutawayToleranceM ?? 0.18;
  const cutawayList = resolveCutawayWallsInput(options.cutawayWalls);

  const { pieces, activeTotalLen } = computeActiveMouldingPieces({
    pathData,
    gaps: options.gaps,
    defaultCap,
    openStartCap,
    openEndCap,
    cutawayWalls: cutawayList,
    floor: options.floor,
    cutawayToleranceM,
  });

  const interiorAcc = createMeshAccumulator();
  const cutawayAccMap = new Map<
    string,
    { readonly desc: CutawayWallDescriptor; readonly acc: MeshAccumulator }
  >();

  for (const piece of pieces) {
    let targetAcc: MeshAccumulator;
    if (piece.cutaway) {
      const key = cutawayDescriptorKey(piece.cutaway);
      let entry = cutawayAccMap.get(key);
      if (!entry) {
        entry = { desc: piece.cutaway, acc: createMeshAccumulator() };
        cutawayAccMap.set(key, entry);
      }
      targetAcc = entry.acc;
    } else {
      targetAcc = interiorAcc;
    }

    emitPieceIntoAccumulator(
      targetAcc,
      piece,
      profile,
      profileInfo,
      includeHiddenFaces,
      maxMiterRatio,
      uvScale
    );
  }

  const cutawayMeshes: THREE.Mesh[] = [];
  const interiorMeshes: THREE.Mesh[] = [];

  const interiorGeo = buildGeometryFromAcc(interiorAcc);
  if (interiorGeo.getAttribute('position')) {
    const mesh = new THREE.Mesh(interiorGeo, options.material);
    mesh.name = `${options.baseName}.interior`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (options.zone) {
      mesh.userData.zoneId = options.zone;
    }
    rootGroup.add(mesh);
    interiorMeshes.push(mesh);
  }

  let cutIdx = 0;
  for (const { desc, acc } of cutawayAccMap.values()) {
    const geo = buildGeometryFromAcc(acc);
    if (!geo.getAttribute('position')) continue;
    cutIdx += 1;
    const mesh = new THREE.Mesh(geo, options.material);
    mesh.name = `${options.baseName}.cutaway_${cutIdx}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (options.zone) {
      mesh.userData.zoneId = options.zone;
    }
    tagCutaway(mesh, desc);
    rootGroup.add(mesh);
    cutawayMeshes.push(mesh);
  }

  tagCollisionRole(rootGroup, options.collisionRole ?? 'ignore');

  return Object.assign(rootGroup, {
    cutawayMeshes: cutawayMeshes as readonly THREE.Mesh[],
    interiorMeshes: interiorMeshes as readonly THREE.Mesh[],
    totalLengthM: activeTotalLen,
  });
}

/**
 * Sweeps a 3D architectural skirting / moulding run along a `MouldingPathBuilder` or polyline,
 * with exact corner miters, zero-roll vertical `.stepTo` & `.rakeTo` wall-locked frames,
 * scribed step stringers (`.scribedStepsTo`), smooth curve normals, doorway/obstacle `gaps`,
 * hidden wall/floor face omission (zero z-fighting), and automatic `CutawayWallDescriptor` mesh splitting.
 */
export function createSkirtingRun(options: CreateSkirtingRunOptions): SkirtingRunResult {
  const baseName = options.name ?? (options.zone ? `${options.zone}.skirting` : 'skirtingRun');
  const pathData = resolveMouldingPathData(options);
  const profile = normalizeProfilePoints(options.profile, {
    height: options.height,
    thickness: options.thickness,
  });

  return sweepMouldingProfileRun({
    baseName,
    pathData,
    profile,
    hiddenRule: { omitWallBack: true, omitBottomAtZero: true },
    material: options.material,
    gaps: options.gaps,
    cap: options.cap,
    startCap: options.startCap,
    endCap: options.endCap,
    cutawayWalls: options.cutawayWalls,
    floor: options.floor,
    cutawayToleranceM: options.cutawayToleranceM,
    includeHiddenFaces: options.includeHiddenBackAndBottomFaces,
    maxMiterRatio: options.maxMiterRatio,
    uvScale: options.uvScale,
    zone: options.zone,
    collisionRole: options.collisionRole,
  });
}

/**
 * Convenience builder for a single scribed stair-stringer skirting flight from `from` `[x, y, z]`
 * to `to` `[x, y, z]` notched around `steps`.
 */
export function createScribedStepSkirting(
  options: CreateScribedStepSkirtingOptions
): SkirtingRunResult {
  if (options.path || options.points) {
    return createSkirtingRun(options);
  }
  if (!options.from || !options.to || !options.steps) {
    throw new Error(
      'createScribedStepSkirting: requires either options.path / options.points or { from, to, steps }.'
    );
  }
  const path = new MouldingPathBuilder(options.from[0], options.from[2], {
    y: options.from[1],
    roomSide: options.roomSide ?? 'left',
  }).scribedStepsTo(options.to[0], options.to[1], options.to[2], {
    steps: options.steps,
    nosingClearanceM: options.nosingClearanceM,
  });

  return createSkirtingRun({
    ...options,
    path,
  });
}
