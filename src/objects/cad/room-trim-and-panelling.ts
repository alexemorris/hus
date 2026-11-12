import * as THREE from 'three';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import type { Point2DInput } from '../../engine/geometry/cad-primitives.ts';
import { tagCollisionRole, tagCutaway, type CollisionRole } from '../../engine/geometry/mesh-traits.ts';
import {
  buildGeometryFromAcc,
  computeActiveMouldingPieces,
  createMeshAccumulator,
  createSkirtingProfile,
  cutawayDescriptorKey,
  emitOrientedTri,
  emitQuad3D,
  evaluateJointMiterPoint,
  normalizeMouldingProfilePoints,
  resolveCutawayWallsInput,
  resolveMouldingPathData,
  sweepMouldingProfileRun,
  type CutawayWallsInput,
  type MeshAccumulator,
  type MouldingPathInput,
  type RoomSide,
  type SkirtingEndCap,
  type SkirtingGapSpec,
  type SkirtingProfilePoint,
  type SkirtingRunResult,
  type SubSegmentPiece,
} from './skirting-run.ts';

export type CorniceProfilePreset =
  | 'georgian-cyma'
  | 'georgian-dentil'
  | 'cove'
  | 'stepped';

export type CorniceProfileInput =
  | CorniceProfilePreset
  | readonly (SkirtingProfilePoint | Point2DInput)[];

export type WallRailProfilePreset =
  | 'astragal-dado'
  | 'bullnose-dado'
  | 'picture-rail';

export type WallRailProfileInput =
  | WallRailProfilePreset
  | readonly (SkirtingProfilePoint | Point2DInput)[];

export type PanellingStyle =
  | 'tongue-and-groove'
  | 'fielded-georgian'
  | 'shaker-batten';

export interface CreateCorniceProfileOptions {
  readonly height?: number;
  readonly projection?: number;
  readonly wallInsetM?: number;
  readonly ceilingInsetM?: number;
}

export interface CorniceRunOptions {
  readonly path?: MouldingPathInput;
  readonly points?: readonly (readonly [number, number] | readonly [number, number, number])[];
  readonly closed?: boolean;
  readonly roomSide?: RoomSide;
  readonly ceilingY: number;
  readonly profile?: CorniceProfileInput;
  readonly height?: number;
  readonly projection?: number;
  readonly wallInsetM?: number;
  readonly ceilingInsetM?: number;
  readonly dentilPitchM?: number;
  readonly material?: THREE.Material;
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
  readonly collisionRole?: CollisionRole;
  readonly zone?: string;
  readonly name?: string;
}

export interface CreateWallRailProfileOptions {
  readonly height?: number;
  readonly projection?: number;
  readonly wallInsetM?: number;
}

export interface WallRailRunOptions {
  readonly path?: MouldingPathInput;
  readonly points?: readonly (readonly [number, number] | readonly [number, number, number])[];
  readonly closed?: boolean;
  readonly roomSide?: RoomSide;
  readonly floorY?: number;
  /** Height (metres) above `floorY` (defaults to `0.95 m` for dado, `2.15 m` for picture rail). */
  readonly elevationY?: number;
  /** Optional explicit world-space `Y` override. */
  readonly worldY?: number;
  readonly profile?: WallRailProfileInput;
  readonly height?: number;
  readonly projection?: number;
  readonly wallInsetM?: number;
  readonly material?: THREE.Material;
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
  readonly collisionRole?: CollisionRole;
  readonly zone?: string;
  readonly name?: string;
}

export interface PanellingRunOptions {
  readonly path?: MouldingPathInput;
  readonly points?: readonly (readonly [number, number] | readonly [number, number, number])[];
  readonly closed?: boolean;
  readonly roomSide?: RoomSide;
  readonly floorY?: number;
  readonly height?: number;
  readonly thickness?: number;
  readonly style?: PanellingStyle;
  readonly includeSkirting?: boolean;
  readonly includeDadoCap?: boolean;
  readonly skirtingHeight?: number;
  readonly dadoCapHeight?: number;
  readonly boardPitchM?: number;
  readonly bayTargetWidthM?: number;
  readonly stileWidthM?: number;
  readonly bottomRailHeightM?: number;
  readonly topRailHeightM?: number;
  readonly wallInsetM?: number;
  readonly floorClearanceM?: number;
  readonly material?: THREE.Material;
  readonly skirtingMaterial?: THREE.Material;
  readonly dadoMaterial?: THREE.Material;
  readonly gaps?: readonly SkirtingGapSpec[];
  readonly cap?: SkirtingEndCap;
  readonly startCap?: SkirtingEndCap;
  readonly endCap?: SkirtingEndCap;
  readonly cutawayWalls?: CutawayWallsInput;
  readonly floor?: string;
  readonly cutawayToleranceM?: number;
  readonly maxMiterRatio?: number;
  readonly uvScale?: number;
  readonly collisionRole?: CollisionRole;
  readonly zone?: string;
  readonly name?: string;
}

export type PanellingRunResult = SkirtingRunResult;

let defaultPlasterCorniceMat: THREE.MeshStandardMaterial | null = null;
let defaultPaintedJoineryMat: THREE.MeshStandardMaterial | null = null;

function getDefaultPlasterMaterial(): THREE.Material {
  if (!defaultPlasterCorniceMat) {
    defaultPlasterCorniceMat = new THREE.MeshStandardMaterial({
      name: 'roomTrim.plasterMoulding',
      color: 0xf7f5f0,
      roughness: 0.86,
      metalness: 0.0,
    });
  }
  return defaultPlasterCorniceMat;
}

function getDefaultJoineryMaterial(): THREE.Material {
  if (!defaultPaintedJoineryMat) {
    defaultPaintedJoineryMat = new THREE.MeshStandardMaterial({
      name: 'roomTrim.paintedJoinery',
      color: 0xf2efe8,
      roughness: 0.42,
      metalness: 0.01,
    });
  }
  return defaultPaintedJoineryMat;
}

/**
 * Generates an architectural ceiling cornice cross-section in `(u, v)` metres anchored at `ceilingY`:
 * - `u` projects from `wallInsetM` (`0.4 mm` clear of wall face) out to `wallInsetM + projection` into the room.
 * - `v` drops downward from `-ceilingInsetM` (`0.4 mm` below ceiling soffit) down to `-height`.
 */
export function createCorniceProfile(
  kind: CorniceProfilePreset,
  options: CreateCorniceProfileOptions = {}
): readonly SkirtingProfilePoint[] {
  const H = Math.max(0.03, options.height ?? 0.125);
  const P = Math.max(0.03, options.projection ?? 0.12);
  const u0 = Math.max(0, options.wallInsetM ?? 0.0004);
  const vTop = -Math.max(0, options.ceilingInsetM ?? 0.0004);
  const vBot = -H;
  const effH = Math.max(0.02, H + vTop);

  if (kind === 'stepped') {
    return normalizeMouldingProfilePoints([
      { u: u0, v: vBot, sharp: true },
      { u: u0 + P * 0.22, v: vBot, sharp: true },
      { u: u0 + P * 0.22, v: vBot + effH * 0.34, sharp: true },
      { u: u0 + P * 0.58, v: vBot + effH * 0.34, sharp: true },
      { u: u0 + P * 0.58, v: vBot + effH * 0.68, sharp: true },
      { u: u0 + P, v: vBot + effH * 0.68, sharp: true },
      { u: u0 + P, v: vTop, sharp: true },
      { u: u0, v: vTop, sharp: true },
    ]);
  }

  if (kind === 'cove') {
    const wallDrop = effH * 0.16;
    const ceilStep = P * 0.16;
    const pts: SkirtingProfilePoint[] = [
      { u: u0, v: vBot, sharp: true },
      { u: u0 + wallDrop, v: vBot, sharp: true },
      { u: u0 + wallDrop, v: vBot + wallDrop, sharp: true },
    ];
    const arcSegs = 12;
    const uStart = u0 + wallDrop;
    const vStart = vBot + wallDrop;
    const uEnd = u0 + P - ceilStep;
    const vEnd = vTop - wallDrop;
    const rU = Math.max(0.01, uEnd - uStart);
    const rV = Math.max(0.01, vEnd - vStart);
    for (let i = 1; i < arcSegs; i++) {
      const theta = (Math.PI * 0.5 * i) / arcSegs;
      // Quarter-ellipse concave cove hollow bowing inward toward (u0, vTop)
      const u = uEnd - rU * Math.cos(theta);
      const v = vStart + rV * (1 - Math.sin(Math.PI * 0.5 - theta));
      pts.push({ u, v, sharp: false });
    }
    pts.push(
      { u: uEnd, v: vEnd, sharp: true },
      { u: u0 + P, v: vEnd, sharp: true },
      { u: u0 + P, v: vTop, sharp: true },
      { u: u0, v: vTop, sharp: true }
    );
    return normalizeMouldingProfilePoints(pts);
  }

  if (kind === 'georgian-dentil') {
    // Classical Georgian dentil cornice: lower astragal & frieze fillet -> dentil bed recess -> corona soffit -> cyma recta crown
    const pts: SkirtingProfilePoint[] = [
      { u: u0, v: vBot, sharp: true },
      { u: u0 + P * 0.16, v: vBot, sharp: true },
      { u: u0 + P * 0.22, v: vBot + effH * 0.12, sharp: false },
      { u: u0 + P * 0.20, v: vBot + effH * 0.24, sharp: true },
      // Dentil bed band [0.24 .. 0.48 of effH] recessed at u0 + 0.34*P so discrete 3D dentils project cleanly to 0.52*P
      { u: u0 + P * 0.34, v: vBot + effH * 0.24, sharp: true },
      { u: u0 + P * 0.34, v: vBot + effH * 0.48, sharp: true },
      // Projecting corona drip soffit
      { u: u0 + P * 0.68, v: vBot + effH * 0.48, sharp: true },
      { u: u0 + P * 0.68, v: vBot + effH * 0.60, sharp: true },
    ];
    const samples = 8;
    for (let i = 1; i <= samples; i++) {
      const s = i / samples;
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * s);
      const wave = -Math.sin(Math.PI * 2 * s) * (P * 0.045);
      const u = u0 + P * (0.68 + 0.30 * ease) + wave;
      const v = vBot + effH * (0.60 + 0.32 * s);
      pts.push({ u, v, sharp: i === samples });
    }
    pts.push(
      { u: u0 + P, v: vBot + effH * 0.92, sharp: true },
      { u: u0 + P, v: vTop, sharp: true },
      { u: u0, v: vTop, sharp: true }
    );
    return normalizeMouldingProfilePoints(pts);
  }

  // Default: 'georgian-cyma' (lower scotia/astragal + corona fillet + sweeping cyma recta + top fascia)
  const pts: SkirtingProfilePoint[] = [
    { u: u0, v: vBot, sharp: true },
    { u: u0 + P * 0.16, v: vBot, sharp: true },
    { u: u0 + P * 0.16, v: vBot + effH * 0.10, sharp: true },
    { u: u0 + P * 0.28, v: vBot + effH * 0.22, sharp: false },
    { u: u0 + P * 0.42, v: vBot + effH * 0.38, sharp: true },
    { u: u0 + P * 0.56, v: vBot + effH * 0.38, sharp: true },
    { u: u0 + P * 0.56, v: vBot + effH * 0.48, sharp: true },
  ];
  const samples = 10;
  for (let i = 1; i <= samples; i++) {
    const s = i / samples;
    const ease = 0.5 - 0.5 * Math.cos(Math.PI * s);
    const wave = -Math.sin(Math.PI * 2 * s) * (P * 0.055);
    const u = u0 + P * (0.56 + 0.40 * ease) + wave;
    const v = vBot + effH * (0.48 + 0.42 * s);
    pts.push({ u, v, sharp: i === samples });
  }
  pts.push(
    { u: u0 + P, v: vBot + effH * 0.90, sharp: true },
    { u: u0 + P, v: vTop, sharp: true },
    { u: u0, v: vTop, sharp: true }
  );
  return normalizeMouldingProfilePoints(pts);
}

function appendDentilCourseBlocks(
  options: CorniceRunOptions,
  pathData: ReturnType<typeof resolveMouldingPathData>,
  material: THREE.Material,
  rootGroup: SkirtingRunResult
): void {
  const H = Math.max(0.03, options.height ?? 0.125);
  const P = Math.max(0.03, options.projection ?? 0.12);
  const u0 = Math.max(0, options.wallInsetM ?? 0.0004);
  const vTop = -Math.max(0, options.ceilingInsetM ?? 0.0004);
  const vBot = -H;
  const effH = Math.max(0.02, H + vTop);

  // Place dentil blocks proud of dentil bed (uBed = u0 + 0.34*P + 0.5mm -> uFront = u0 + 0.52*P)
  // and clear of bed bottom/corona soffit by 0.5mm so zero triangles coplanar-overlap the swept cornice!
  const uDentilBack = u0 + P * 0.34 + 0.0005;
  const uDentilFront = u0 + P * 0.53;
  const vDentilBot = vBot + effH * 0.24 + 0.0005;
  const vDentilTop = vBot + effH * 0.48 - 0.0005;
  if (uDentilFront - uDentilBack <= 0.002 || vDentilTop - vDentilBot <= 0.002) {
    return;
  }

  const pitch = Math.max(0.024, options.dentilPitchM ?? P * 0.36);
  const toothW = pitch * 0.58;
  const defaultCap: SkirtingEndCap = options.cap ?? 'butt';
  const cutawayList = resolveCutawayWallsInput(options.cutawayWalls);

  const { pieces } = computeActiveMouldingPieces({
    pathData,
    gaps: options.gaps,
    defaultCap,
    openStartCap: options.startCap ?? defaultCap,
    openEndCap: options.endCap ?? defaultCap,
    cutawayWalls: cutawayList,
    floor: options.floor,
    cutawayToleranceM: options.cutawayToleranceM ?? 0.18,
  });

  const interiorAcc = createMeshAccumulator();
  const cutawayAccMap = new Map<
    string,
    { readonly desc: CutawayWallDescriptor; readonly acc: MeshAccumulator }
  >();

  for (const piece of pieces) {
    if (piece.seg.kind !== 'horizontal') continue;
    const len = piece.p0.distanceTo(piece.p1);
    const margin = P * 0.55;
    const avail = len - margin * 2;
    if (avail < toothW) continue;

    let acc: MeshAccumulator;
    if (piece.cutaway) {
      const key = cutawayDescriptorKey(piece.cutaway);
      let entry = cutawayAccMap.get(key);
      if (!entry) {
        entry = { desc: piece.cutaway, acc: createMeshAccumulator() };
        cutawayAccMap.set(key, entry);
      }
      acc = entry.acc;
    } else {
      acc = interiorAcc;
    }

    const tVec = new THREE.Vector3(...piece.seg.tangent);
    const uVec = new THREE.Vector3(...piece.seg.wallNormal);
    const vVec = new THREE.Vector3(...piece.seg.vAxis);
    const count = Math.max(1, Math.floor(avail / pitch));
    const totalSpan = (count - 1) * pitch + toothW;
    const sStart = (len - totalSpan) * 0.5;

    const ptAt = (s: number, u: number, v: number): THREE.Vector3 =>
      piece.p0
        .clone()
        .addScaledVector(tVec, s)
        .addScaledVector(uVec, u)
        .addScaledVector(vVec, v);

    for (let i = 0; i < count; i++) {
      const sA = sStart + i * pitch;
      const sB = sA + toothW;
      const b00 = ptAt(sA, uDentilBack, vDentilBot);
      const b10 = ptAt(sB, uDentilBack, vDentilBot);
      const b11 = ptAt(sB, uDentilBack, vDentilTop);
      const b01 = ptAt(sA, uDentilBack, vDentilTop);
      const f00 = ptAt(sA, uDentilFront, vDentilBot);
      const f10 = ptAt(sB, uDentilFront, vDentilBot);
      const f11 = ptAt(sB, uDentilFront, vDentilTop);
      const f01 = ptAt(sA, uDentilFront, vDentilTop);

      // Front, bottom, left, right faces (back & top face into bed/corona)
      emitQuad3D(acc, f00, f10, f11, f01, uVec, [0, 0], [toothW, 0], [toothW, 1], [0, 1]);
      emitQuad3D(
        acc,
        b00,
        b10,
        f10,
        f00,
        vVec.clone().negate(),
        [0, 0],
        [toothW, 0],
        [toothW, 1],
        [0, 1]
      );
      emitQuad3D(
        acc,
        b00,
        f00,
        f01,
        b01,
        tVec.clone().negate(),
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      );
      emitQuad3D(acc, f10, b10, b11, f11, tVec, [0, 0], [1, 0], [1, 1], [0, 1]);
    }
  }

  const baseName = rootGroup.name;
  const intGeo = buildGeometryFromAcc(interiorAcc);
  if (intGeo.getAttribute('position')) {
    const m = new THREE.Mesh(intGeo, material);
    m.name = `${baseName}.dentils.interior`;
    m.castShadow = true;
    m.receiveShadow = true;
    tagCollisionRole(m, options.collisionRole ?? 'ignore');
    rootGroup.add(m);
  }
  let idx = 0;
  for (const { desc, acc } of cutawayAccMap.values()) {
    const geo = buildGeometryFromAcc(acc);
    if (!geo.getAttribute('position')) continue;
    idx += 1;
    const m = new THREE.Mesh(geo, material);
    m.name = `${baseName}.dentils.cutaway_${idx}`;
    m.castShadow = true;
    m.receiveShadow = true;
    tagCutaway(m, desc);
    tagCollisionRole(m, options.collisionRole ?? 'ignore');
    rootGroup.add(m);
  }
}

/**
 * Sweeps a 3D ceiling cornice run at `ceilingY` (`[ceilingY - height .. ceilingY]`) with
 * exact 45° internal/external corner miters, doorway/cupboard `gaps`, anti-z-fighting
 * wall/ceiling insets, and automatic per-segment `cutawayWalls` splitting.
 */
export function createCorniceRun(options: CorniceRunOptions): SkirtingRunResult {
  const baseName = options.name ?? (options.zone ? `${options.zone}.cornice` : 'corniceRun');
  const material = options.material ?? getDefaultPlasterMaterial();
  const wallInsetM = options.wallInsetM ?? 0.0004;
  const ceilingInsetM = options.ceilingInsetM ?? 0.0004;

  const rawPath = resolveMouldingPathData({
    path: options.path,
    points: options.points,
    applyElevationToBuilder: true,
    closed: options.closed,
    roomSide: options.roomSide ?? 'left',
    elevationY: options.ceilingY,
  });

  // Ensure path sits at ceilingY when caller supplied a 2D/builder path at y=0
  const pathData =
    rawPath.segments.length > 0 &&
    rawPath.segments.every(
      (s) => Math.abs(s.from[1]) <= 1e-7 && Math.abs(s.to[1]) <= 1e-7
    ) &&
    Math.abs(options.ceilingY) > 1e-7
      ? {
          ...rawPath,
          segments: rawPath.segments.map((s) => ({
            ...s,
            from: [s.from[0], options.ceilingY, s.from[2]] as const,
            to: [s.to[0], options.ceilingY, s.to[2]] as const,
          })),
        }
      : rawPath;

  const profile: readonly SkirtingProfilePoint[] =
    options.profile === undefined || typeof options.profile === 'string'
      ? createCorniceProfile(options.profile ?? 'georgian-cyma', {
          height: options.height,
          projection: options.projection,
          wallInsetM,
          ceilingInsetM,
        })
      : normalizeMouldingProfilePoints(options.profile);

  const run = sweepMouldingProfileRun({
    baseName,
    pathData,
    profile,
    hiddenRule: {
      omitWallBack: true,
      omitTopAtZero: true,
      wallBackThresholdU: wallInsetM + 1e-5,
      topCeilingThresholdV: ceilingInsetM + 1e-5,
    },
    material,
    gaps: options.gaps,
    cap: options.cap,
    startCap: options.startCap,
    endCap: options.endCap,
    cutawayWalls: options.cutawayWalls,
    floor: options.floor,
    cutawayToleranceM: options.cutawayToleranceM,
    includeHiddenFaces: options.includeHiddenFaces,
    maxMiterRatio: options.maxMiterRatio,
    uvScale: options.uvScale,
    zone: options.zone,
    collisionRole: options.collisionRole,
  });

  if (options.profile === 'georgian-dentil') {
    appendDentilCourseBlocks(options, pathData, material, run);
  }

  return run;
}

/**
 * Generates an architectural dado rail or picture rail cross-section in `(u, v)` metres
 * centered/anchored around `v = 0` (`[-height * 0.5 .. +height * 0.5]`) and projecting
 * from `wallInsetM` out to `wallInsetM + projection`.
 */
export function createWallRailProfile(
  kind: WallRailProfilePreset,
  options: CreateWallRailProfileOptions = {}
): readonly SkirtingProfilePoint[] {
  const u0 = Math.max(0, options.wallInsetM ?? 0.0004);

  if (kind === 'picture-rail') {
    const H = Math.max(0.025, options.height ?? 0.048);
    const P = Math.max(0.016, options.projection ?? 0.028);
    const vBot = -H * 0.5;
    const vTop = H * 0.5;
    // Traditional hook-lip picture rail with top picture-hook groove & lower ogee roll
    return normalizeMouldingProfilePoints([
      { u: u0, v: vBot, sharp: true },
      { u: u0 + P * 0.42, v: vBot, sharp: true },
      { u: u0 + P * 0.58, v: vBot + H * 0.22, sharp: false },
      { u: u0 + P * 0.88, v: vBot + H * 0.48, sharp: false },
      { u: u0 + P, v: vBot + H * 0.72, sharp: false },
      { u: u0 + P * 0.90, v: vTop, sharp: true },
      { u: u0 + P * 0.62, v: vTop, sharp: true },
      // Hook channel hollow behind lip
      { u: u0 + P * 0.50, v: vTop - H * 0.22, sharp: true },
      { u: u0 + P * 0.26, v: vTop - H * 0.22, sharp: true },
      { u: u0 + P * 0.20, v: vTop, sharp: true },
      { u: u0, v: vTop, sharp: true },
    ]);
  }

  if (kind === 'bullnose-dado') {
    const H = Math.max(0.03, options.height ?? 0.062);
    const P = Math.max(0.016, options.projection ?? 0.030);
    const vBot = -H * 0.5;
    const vTop = H * 0.5;
    const pts: SkirtingProfilePoint[] = [
      { u: u0, v: vBot, sharp: true },
      { u: u0 + P * 0.45, v: vBot, sharp: true },
      { u: u0 + P * 0.52, v: vBot + H * 0.20, sharp: true },
    ];
    const segs = 8;
    const cV = vBot + H * 0.58;
    const rV = H * 0.34;
    for (let i = 0; i <= segs; i++) {
      const th = -Math.PI * 0.5 + (Math.PI * i) / segs;
      pts.push({
        u: u0 + P * 0.54 + P * 0.46 * Math.cos(th),
        v: cV + rV * Math.sin(th),
        sharp: i === 0 || i === segs,
      });
    }
    pts.push(
      { u: u0 + P * 0.46, v: vTop, sharp: true },
      { u: u0, v: vTop, sharp: true }
    );
    return normalizeMouldingProfilePoints(pts);
  }

  // Default: 'astragal-dado' (Georgian central astragal bead flanked by upper & lower ogee/cove)
  const H = Math.max(0.035, options.height ?? 0.068);
  const P = Math.max(0.018, options.projection ?? 0.030);
  const vBot = -H * 0.5;
  const vTop = H * 0.5;
  const pts: SkirtingProfilePoint[] = [
    { u: u0, v: vBot, sharp: true },
    { u: u0 + P * 0.36, v: vBot, sharp: true },
    { u: u0 + P * 0.48, v: vBot + H * 0.16, sharp: false },
    { u: u0 + P * 0.66, v: vBot + H * 0.28, sharp: true },
  ];
  const beadSegs = 8;
  const rV = H * 0.20;
  for (let i = 0; i <= beadSegs; i++) {
    const th = -Math.PI * 0.5 + (Math.PI * i) / beadSegs;
    pts.push({
      u: u0 + P * 0.66 + P * 0.34 * Math.cos(th),
      v: rV * Math.sin(th),
      sharp: i === 0 || i === beadSegs,
    });
  }
  pts.push(
    { u: u0 + P * 0.54, v: vTop - H * 0.14, sharp: false },
    { u: u0 + P * 0.38, v: vTop, sharp: true },
    { u: u0, v: vTop, sharp: true }
  );
  return normalizeMouldingProfilePoints(pts);
}

function buildWallRailRunInternal(
  options: WallRailRunOptions,
  defaultElevationAboveFloorM: number,
  defaultPreset: WallRailProfilePreset,
  defaultSuffix: string
): SkirtingRunResult {
  const baseName =
    options.name ?? (options.zone ? `${options.zone}.${defaultSuffix}` : `${defaultSuffix}Run`);
  const material = options.material ?? getDefaultJoineryMaterial();
  const wallInsetM = options.wallInsetM ?? 0.0004;
  const floorY = options.floorY ?? 0;
  const targetY =
    options.worldY !== undefined
      ? options.worldY
      : floorY + (options.elevationY ?? defaultElevationAboveFloorM);

  const rawPath = resolveMouldingPathData({
    path: options.path,
    points: options.points,
    applyElevationToBuilder: true,
    closed: options.closed,
    roomSide: options.roomSide ?? 'left',
    elevationY: targetY,
  });

  const pathData =
    rawPath.segments.length > 0 &&
    rawPath.segments.every(
      (s) => Math.abs(s.from[1]) <= 1e-7 && Math.abs(s.to[1]) <= 1e-7
    ) &&
    Math.abs(targetY) > 1e-7
      ? {
          ...rawPath,
          segments: rawPath.segments.map((s) => ({
            ...s,
            from: [s.from[0], targetY, s.from[2]] as const,
            to: [s.to[0], targetY, s.to[2]] as const,
          })),
        }
      : rawPath;

  const profile: readonly SkirtingProfilePoint[] =
    options.profile === undefined || typeof options.profile === 'string'
      ? createWallRailProfile(options.profile ?? defaultPreset, {
          height: options.height,
          projection: options.projection,
          wallInsetM,
        })
      : normalizeMouldingProfilePoints(options.profile);

  return sweepMouldingProfileRun({
    baseName,
    pathData,
    profile,
    hiddenRule: {
      omitWallBack: true,
      wallBackThresholdU: wallInsetM + 1e-5,
    },
    material,
    gaps: options.gaps,
    cap: options.cap,
    startCap: options.startCap,
    endCap: options.endCap,
    cutawayWalls: options.cutawayWalls,
    floor: options.floor,
    cutawayToleranceM: options.cutawayToleranceM,
    includeHiddenFaces: options.includeHiddenFaces,
    maxMiterRatio: options.maxMiterRatio,
    uvScale: options.uvScale,
    zone: options.zone,
    collisionRole: options.collisionRole,
  });
}

/**
 * Sweeps a 3D dado rail run (default `0.95 m` above `floorY`) with `'butt'` / `'selfReturn'`
 * doorway & chimney stops and automatic per-segment `cutawayWalls` splitting.
 */
export function createDadoRun(options: WallRailRunOptions): SkirtingRunResult {
  return buildWallRailRunInternal(options, 0.95, 'astragal-dado', 'dado');
}

/**
 * Sweeps a 3D picture rail run (default `2.15 m` above `floorY`) with hook-lip moulding,
 * `'butt'` / `'selfReturn'` stops, and automatic per-segment `cutawayWalls` splitting.
 */
export function createPictureRailRun(options: WallRailRunOptions): SkirtingRunResult {
  return buildWallRailRunInternal(options, 2.15, 'picture-rail', 'pictureRail');
}

function pointOnPieceAt(
  piece: SubSegmentPiece,
  sLocal: number,
  pieceLen: number,
  u: number,
  yWorld: number,
  maxMiterRatio: number
): THREE.Vector3 {
  const seg = piece.seg;
  const tVec = new THREE.Vector3(seg.tangent[0], 0, seg.tangent[2]).normalize();
  const uVec = new THREE.Vector3(seg.wallNormal[0], 0, seg.wallNormal[2]).normalize();

  let shift0 = 0;
  if (piece.startJoint) {
    shift0 = evaluateJointMiterPoint(piece.p0, seg, piece.startJoint, u, 0, maxMiterRatio, false)
      .shift;
  }
  let shift1 = 0;
  if (piece.endJoint) {
    shift1 = evaluateJointMiterPoint(piece.p1, seg, piece.endJoint, u, 0, maxMiterRatio, true)
      .shift;
  }

  const frac = pieceLen > 1e-6 ? Math.max(0, Math.min(1, sLocal / pieceLen)) : 0;
  const sActual = (sLocal + shift0 * (1 - frac) + shift1 * frac);
  return new THREE.Vector3(
    piece.p0.x + tVec.x * sActual + uVec.x * u,
    yWorld,
    piece.p0.z + tVec.z * sActual + uVec.z * u
  );
}

function emitTongueAndGroovePiece(
  acc: MeshAccumulator,
  piece: SubSegmentPiece,
  yBot: number,
  yTop: number,
  uBack: number,
  uFront: number,
  boardPitchM: number,
  maxMiterRatio: number,
  uvScale: number
): void {
  const pieceLen = piece.p0.distanceTo(piece.p1);
  if (pieceLen <= 1e-4 || yTop - yBot <= 1e-4) return;

  const seg = piece.seg;
  const tVec = new THREE.Vector3(seg.tangent[0], 0, seg.tangent[2]).normalize();
  const uVec = new THREE.Vector3(seg.wallNormal[0], 0, seg.wallNormal[2]).normalize();
  const upVec = new THREE.Vector3(0, 1, 0);

  const grooveHalfW = Math.min(0.0035, boardPitchM * 0.08);
  const grooveDepth = Math.min(0.0045, Math.max(0.002, (uFront - uBack) * 0.28));
  const uGroove = uFront - grooveDepth;

  // Build 1D (s, u) front contour from s = 0 to s = pieceLen so every board + V-groove is a
  // single manifold non-overlapping corrugated ribbon!
  const profileSU: Array<{ readonly s: number; readonly u: number }> = [{ s: 0, u: uFront }];
  const nBoards = Math.max(1, Math.round(pieceLen / Math.max(0.04, boardPitchM)));
  const actualPitch = pieceLen / nBoards;

  for (let b = 1; b < nBoards; b++) {
    const sCenter = b * actualPitch;
    if (sCenter - grooveHalfW > 0.004 && sCenter + grooveHalfW < pieceLen - 0.004) {
      profileSU.push(
        { s: sCenter - grooveHalfW, u: uFront },
        { s: sCenter, u: uGroove },
        { s: sCenter + grooveHalfW, u: uFront }
      );
    }
  }
  profileSU.push({ s: pieceLen, u: uFront });

  for (let i = 0; i + 1 < profileSU.length; i++) {
    const a = profileSU[i]!;
    const b = profileSU[i + 1]!;
    const pA0 = pointOnPieceAt(piece, a.s, pieceLen, a.u, yBot, maxMiterRatio);
    const pB0 = pointOnPieceAt(piece, b.s, pieceLen, b.u, yBot, maxMiterRatio);
    const pB1 = pointOnPieceAt(piece, b.s, pieceLen, b.u, yTop, maxMiterRatio);
    const pA1 = pointOnPieceAt(piece, a.s, pieceLen, a.u, yTop, maxMiterRatio);

    const ds = b.s - a.s;
    const du = b.u - a.u;
    const nOut = new THREE.Vector3()
      .addScaledVector(uVec, ds)
      .addScaledVector(tVec, -du)
      .normalize();

    emitQuad3D(
      acc,
      pA0,
      pB0,
      pB1,
      pA1,
      nOut,
      [(piece.arcStart + a.s) * uvScale, yBot * uvScale],
      [(piece.arcStart + b.s) * uvScale, yBot * uvScale],
      [(piece.arcStart + b.s) * uvScale, yTop * uvScale],
      [(piece.arcStart + a.s) * uvScale, yTop * uvScale]
    );
  }

  // Top & bottom horizontal thickness ledges (when exposed without dado/skirting) + open end caps
  const back0Bot = pointOnPieceAt(piece, 0, pieceLen, uBack, yBot, maxMiterRatio);
  const back1Bot = pointOnPieceAt(piece, pieceLen, pieceLen, uBack, yBot, maxMiterRatio);
  const back1Top = pointOnPieceAt(piece, pieceLen, pieceLen, uBack, yTop, maxMiterRatio);
  const back0Top = pointOnPieceAt(piece, 0, pieceLen, uBack, yTop, maxMiterRatio);
  const front0Bot = pointOnPieceAt(piece, 0, pieceLen, uFront, yBot, maxMiterRatio);
  const front1Bot = pointOnPieceAt(piece, pieceLen, pieceLen, uFront, yBot, maxMiterRatio);
  const front1Top = pointOnPieceAt(piece, pieceLen, pieceLen, uFront, yTop, maxMiterRatio);
  const front0Top = pointOnPieceAt(piece, 0, pieceLen, uFront, yTop, maxMiterRatio);

  emitQuad3D(
    acc,
    back0Top,
    front0Top,
    front1Top,
    back1Top,
    upVec,
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  );

  if (piece.startCap !== null) {
    emitQuad3D(
      acc,
      back0Bot,
      front0Bot,
      front0Top,
      back0Top,
      tVec.clone().negate(),
      [0, yBot * uvScale],
      [uFront * uvScale, yBot * uvScale],
      [uFront * uvScale, yTop * uvScale],
      [0, yTop * uvScale]
    );
  }
  if (piece.endCap !== null) {
    emitQuad3D(
      acc,
      front1Bot,
      back1Bot,
      back1Top,
      front1Top,
      tVec,
      [uFront * uvScale, yBot * uvScale],
      [0, yBot * uvScale],
      [0, yTop * uvScale],
      [uFront * uvScale, yTop * uvScale]
    );
  }
}

function emitFramedPanellingPiece(
  acc: MeshAccumulator,
  piece: SubSegmentPiece,
  style: 'fielded-georgian' | 'shaker-batten',
  yBot: number,
  yTop: number,
  uBack: number,
  uFrame: number,
  bayTargetWidthM: number,
  stileW: number,
  botRailH: number,
  topRailH: number,
  maxMiterRatio: number,
  uvScale: number
): void {
  const pieceLen = piece.p0.distanceTo(piece.p1);
  const panelTotalH = yTop - yBot;
  if (pieceLen <= 1e-4 || panelTotalH <= 1e-4) return;

  const seg = piece.seg;
  const tVec = new THREE.Vector3(seg.tangent[0], 0, seg.tangent[2]).normalize();
  const uVec = new THREE.Vector3(seg.wallNormal[0], 0, seg.wallNormal[2]).normalize();
  const upVec = new THREE.Vector3(0, 1, 0);

  const pt = (s: number, u: number, y: number): THREE.Vector3 =>
    pointOnPieceAt(piece, s, pieceLen, u, y, maxMiterRatio);

  const emitFrontPatch = (sA: number, sB: number, yA: number, yB: number, u: number): void => {
    if (sB - sA <= 1e-5 || yB - yA <= 1e-5) return;
    emitQuad3D(
      acc,
      pt(sA, u, yA),
      pt(sB, u, yA),
      pt(sB, u, yB),
      pt(sA, u, yB),
      uVec,
      [(piece.arcStart + sA) * uvScale, yA * uvScale],
      [(piece.arcStart + sB) * uvScale, yA * uvScale],
      [(piece.arcStart + sB) * uvScale, yB * uvScale],
      [(piece.arcStart + sA) * uvScale, yB * uvScale]
    );
  };

  // Top & open-end caps of the frame
  emitQuad3D(
    acc,
    pt(0, uBack, yTop),
    pt(0, uFrame, yTop),
    pt(pieceLen, uFrame, yTop),
    pt(pieceLen, uBack, yTop),
    upVec,
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  );
  if (piece.startCap !== null) {
    emitQuad3D(
      acc,
      pt(0, uBack, yBot),
      pt(0, uFrame, yBot),
      pt(0, uFrame, yTop),
      pt(0, uBack, yTop),
      tVec.clone().negate(),
      [0, yBot * uvScale],
      [uFrame * uvScale, yBot * uvScale],
      [uFrame * uvScale, yTop * uvScale],
      [0, yTop * uvScale]
    );
  }
  if (piece.endCap !== null) {
    emitQuad3D(
      acc,
      pt(pieceLen, uFrame, yBot),
      pt(pieceLen, uBack, yBot),
      pt(pieceLen, uBack, yTop),
      pt(pieceLen, uFrame, yTop),
      tVec,
      [uFrame * uvScale, yBot * uvScale],
      [0, yBot * uvScale],
      [0, yTop * uvScale],
      [uFrame * uvScale, yTop * uvScale]
    );
  }

  const effBotRail = Math.min(botRailH, panelTotalH * 0.28);
  const effTopRail = Math.min(topRailH, panelTotalH * 0.25);
  const yOpen0 = yBot + effBotRail;
  const yOpen1 = yTop - effTopRail;
  const effStile = Math.min(stileW, pieceLen * 0.28);

  // If bay is too narrow or too short for recessed panels, emit solid mitred stile/rail fascia
  if (pieceLen < effStile * 2 + 0.08 || yOpen1 - yOpen0 < 0.08) {
    emitFrontPatch(0, pieceLen, yBot, yTop, uFrame);
    return;
  }

  // Bottom & top continuous rails at uFrame (disjoint from middle band [yOpen0 .. yOpen1]!)
  emitFrontPatch(0, pieceLen, yBot, yOpen0, uFrame);
  emitFrontPatch(0, pieceLen, yOpen1, yTop, uFrame);

  const innerSpan = pieceLen - effStile * 2;
  const bayCount = Math.max(1, Math.round(innerSpan / Math.max(0.22, bayTargetWidthM)));
  const totalInterStiles = (bayCount - 1) * effStile;
  const bayW = (innerSpan - totalInterStiles) / bayCount;

  if (bayW < 0.06) {
    emitFrontPatch(0, pieceLen, yOpen0, yOpen1, uFrame);
    return;
  }

  // Left outer stile
  emitFrontPatch(0, effStile, yOpen0, yOpen1, uFrame);
  // Right outer stile
  emitFrontPatch(pieceLen - effStile, pieceLen, yOpen0, yOpen1, uFrame);

  const depthAvail = Math.max(0.006, uFrame - uBack - 0.002);
  const uRecess = uFrame - Math.min(0.007, depthAvail * 0.65);

  for (let b = 0; b < bayCount; b++) {
    const sA = effStile + b * (bayW + effStile);
    const sB = sA + bayW;

    if (b > 0) {
      // Intermediate mullion stile in middle band [yOpen0 .. yOpen1]
      emitFrontPatch(sA - effStile, sA, yOpen0, yOpen1, uFrame);
    }

    if (style === 'shaker-batten') {
      // Crisp 90-degree Shaker recessed flat panel + 4 inner cheek returns (zero overlap!)
      emitFrontPatch(sA, sB, yOpen0, yOpen1, uRecess);

      // Left stile inner cheek (faces +tVec)
      emitQuad3D(
        acc,
        pt(sA, uRecess, yOpen0),
        pt(sA, uRecess, yOpen1),
        pt(sA, uFrame, yOpen1),
        pt(sA, uFrame, yOpen0),
        tVec,
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      );
      // Right stile inner cheek (faces -tVec)
      emitQuad3D(
        acc,
        pt(sB, uFrame, yOpen0),
        pt(sB, uFrame, yOpen1),
        pt(sB, uRecess, yOpen1),
        pt(sB, uRecess, yOpen0),
        tVec.clone().negate(),
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      );
      // Bottom rail inner cheek (faces +Y)
      emitQuad3D(
        acc,
        pt(sA, uFrame, yOpen0),
        pt(sB, uFrame, yOpen0),
        pt(sB, uRecess, yOpen0),
        pt(sA, uRecess, yOpen0),
        upVec,
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      );
      // Top rail inner cheek (faces -Y)
      emitQuad3D(
        acc,
        pt(sA, uRecess, yOpen1),
        pt(sB, uRecess, yOpen1),
        pt(sB, uFrame, yOpen1),
        pt(sA, uFrame, yOpen1),
        upVec.clone().negate(),
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      );
    } else {
      // 'fielded-georgian': outer frame bevel -> recessed margin -> raised fielding bevel -> raised central table
      const openW = sB - sA;
      const openH = yOpen1 - yOpen0;
      const mouldW = Math.min(0.016, openW * 0.12, openH * 0.12);
      const marginW = Math.min(0.010, openW * 0.08, openH * 0.08);
      const fieldBevelW = Math.min(0.036, openW * 0.18, openH * 0.18);
      const uTable = uFrame - Math.min(0.0018, (uFrame - uRecess) * 0.25);

      const s1 = sA + mouldW;
      const s2 = s1 + marginW;
      const s3 = s2 + fieldBevelW;
      const s6 = sB - mouldW;
      const s5 = s6 - marginW;
      const s4 = s5 - fieldBevelW;

      const y1 = yOpen0 + mouldW;
      const y2 = y1 + marginW;
      const y3 = y2 + fieldBevelW;
      const y6 = yOpen1 - mouldW;
      const y5 = y6 - marginW;
      const y4 = y5 - fieldBevelW;

      if (s4 - s3 <= 0.01 || y4 - y3 <= 0.01) {
        emitFrontPatch(sA, sB, yOpen0, yOpen1, uRecess);
        continue;
      }

      const emitRingBand = (
        oL: number,
        oR: number,
        oB: number,
        oT: number,
        uO: number,
        iL: number,
        iR: number,
        iB: number,
        iT: number,
        uI: number
      ): void => {
        const oBL = pt(oL, uO, oB);
        const oBR = pt(oR, uO, oB);
        const oTR = pt(oR, uO, oT);
        const oTL = pt(oL, uO, oT);
        const iBL = pt(iL, uI, iB);
        const iBR = pt(iR, uI, iB);
        const iTR = pt(iR, uI, iT);
        const iTL = pt(iL, uI, iT);

        const du = uI - uO;
        const dBot = Math.max(1e-5, iB - oB);
        const dTop = Math.max(1e-5, oT - iT);
        const dLeft = Math.max(1e-5, iL - oL);
        const dRight = Math.max(1e-5, oR - iR);

        // Bottom trapezoid
        emitQuad3D(
          acc,
          oBL,
          oBR,
          iBR,
          iBL,
          new THREE.Vector3().addScaledVector(uVec, dBot).addScaledVector(upVec, -du).normalize(),
          [oL * uvScale, oB * uvScale],
          [oR * uvScale, oB * uvScale],
          [iR * uvScale, iB * uvScale],
          [iL * uvScale, iB * uvScale]
        );
        // Right trapezoid
        emitQuad3D(
          acc,
          oBR,
          oTR,
          iTR,
          iBR,
          new THREE.Vector3().addScaledVector(uVec, dRight).addScaledVector(tVec, du).normalize(),
          [oR * uvScale, oB * uvScale],
          [oR * uvScale, oT * uvScale],
          [iR * uvScale, iT * uvScale],
          [iR * uvScale, iB * uvScale]
        );
        // Top trapezoid
        emitQuad3D(
          acc,
          oTR,
          oTL,
          iTL,
          iTR,
          new THREE.Vector3().addScaledVector(uVec, dTop).addScaledVector(upVec, du).normalize(),
          [oR * uvScale, oT * uvScale],
          [oL * uvScale, oT * uvScale],
          [iL * uvScale, iT * uvScale],
          [iR * uvScale, iT * uvScale]
        );
        // Left trapezoid
        emitQuad3D(
          acc,
          oTL,
          oBL,
          iBL,
          iTL,
          new THREE.Vector3().addScaledVector(uVec, dLeft).addScaledVector(tVec, -du).normalize(),
          [oL * uvScale, oT * uvScale],
          [oL * uvScale, oB * uvScale],
          [iL * uvScale, iB * uvScale],
          [iL * uvScale, iT * uvScale]
        );
      };

      // Outer bolection/ovolo bevel from frame (uFrame) down to margin (uRecess)
      emitRingBand(sA, sB, yOpen0, yOpen1, uFrame, s1, s6, y1, y6, uRecess);
      // Flat recessed margin channel at uRecess
      emitRingBand(s1, s6, y1, y6, uRecess, s2, s5, y2, y5, uRecess);
      // Raised fielding bevel from margin (uRecess) up to raised central table (uTable)
      emitRingBand(s2, s5, y2, y5, uRecess, s3, s4, y3, y4, uTable);
      // Central raised fielded table at uTable
      emitFrontPatch(s3, s4, y3, y4, uTable);
    }
  }
}

/**
 * Builds architectural wainscot / dado / full-height wall panelling along a `MouldingPath`
 * or 2D polyline (`'tongue-and-groove' | 'fielded-georgian' | 'shaker-batten'`), complete with
 * optional integrated bottom skirting, top dado cap, doorway/window `gaps`, zero-z-fighting
 * manifold relief steps, and automatic per-segment `cutawayWalls` splitting.
 */
export function createPanellingRun(options: PanellingRunOptions): PanellingRunResult {
  const baseName = options.name ?? (options.zone ? `${options.zone}.panelling` : 'panellingRun');
  const rootGroup = new THREE.Group();
  rootGroup.name = baseName;
  if (options.zone) {
    rootGroup.userData.zoneId = options.zone;
  }

  const style: PanellingStyle = options.style ?? 'fielded-georgian';
  const floorY = options.floorY ?? 0;
  const totalHeight = Math.max(0.2, options.height ?? 1.05);
  const thickness = Math.max(0.008, options.thickness ?? 0.018);
  const wallInsetM = Math.max(0.0004, options.wallInsetM ?? 0.0005);
  const floorClearanceM = Math.max(0.0004, options.floorClearanceM ?? 0.0005);
  const includeSkirting = options.includeSkirting !== false;
  const includeDadoCap = options.includeDadoCap !== false;
  const skirtingH = includeSkirting ? Math.min(options.skirtingHeight ?? 0.145, totalHeight * 0.32) : 0;
  const dadoH = includeDadoCap ? Math.min(options.dadoCapHeight ?? 0.058, totalHeight * 0.22) : 0;

  const mainMat = options.material ?? getDefaultJoineryMaterial();
  const skirtMat = options.skirtingMaterial ?? mainMat;
  const dadoMat = options.dadoMaterial ?? mainMat;
  const collisionRole: CollisionRole = options.collisionRole ?? 'ignore';

  const rawPath = resolveMouldingPathData({
    path: options.path,
    points: options.points,
    applyElevationToBuilder: true,
    closed: options.closed,
    roomSide: options.roomSide ?? 'left',
    elevationY: floorY,
  });

  const pathData =
    rawPath.segments.length > 0 &&
    rawPath.segments.every(
      (s) => Math.abs(s.from[1]) <= 1e-7 && Math.abs(s.to[1]) <= 1e-7
    ) &&
    Math.abs(floorY) > 1e-7
      ? {
          ...rawPath,
          segments: rawPath.segments.map((s) => ({
            ...s,
            from: [s.from[0], floorY, s.from[2]] as const,
            to: [s.to[0], floorY, s.to[2]] as const,
          })),
        }
      : rawPath;

  if (pathData.segments.length === 0) {
    tagCollisionRole(rootGroup, collisionRole);
    return Object.assign(rootGroup, {
      cutawayMeshes: [] as readonly THREE.Mesh[],
      interiorMeshes: [] as readonly THREE.Mesh[],
      totalLengthM: 0,
    });
  }

  const defaultCap: SkirtingEndCap = options.cap ?? 'butt';
  const cutawayList = resolveCutawayWallsInput(options.cutawayWalls);
  const maxMiterRatio = options.maxMiterRatio ?? 4.0;
  const uvScale = options.uvScale ?? 1.0;

  const { pieces, activeTotalLen } = computeActiveMouldingPieces({
    pathData,
    gaps: options.gaps,
    defaultCap,
    openStartCap: options.startCap ?? defaultCap,
    openEndCap: options.endCap ?? defaultCap,
    cutawayWalls: cutawayList,
    floor: options.floor,
    cutawayToleranceM: options.cutawayToleranceM ?? 0.18,
  });

  // Vertically partition skirting [floorY + floorClearanceM .. floorY + skirtingH],
  // panelling body [yBodyBot .. yBodyTop], and dado cap [yDadoBot .. floorY + totalHeight]
  // with 0.5 mm vertical seam separation so zero coplanar faces ever touch!
  const seamEps = 0.0005;
  const yBodyBot = includeSkirting ? floorY + skirtingH + seamEps : floorY + floorClearanceM;
  const yBodyTop = includeDadoCap
    ? floorY + totalHeight - dadoH - seamEps
    : floorY + totalHeight;

  const uPanelBack = wallInsetM;
  const uPanelFront = wallInsetM + thickness;

  const interiorAcc = createMeshAccumulator();
  const cutawayAccMap = new Map<
    string,
    { readonly desc: CutawayWallDescriptor; readonly acc: MeshAccumulator }
  >();

  for (const piece of pieces) {
    if (piece.seg.kind !== 'horizontal') continue;
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

    if (style === 'tongue-and-groove') {
      emitTongueAndGroovePiece(
        targetAcc,
        piece,
        yBodyBot,
        yBodyTop,
        uPanelBack,
        uPanelFront,
        options.boardPitchM ?? 0.1,
        maxMiterRatio,
        uvScale
      );
    } else {
      emitFramedPanellingPiece(
        targetAcc,
        piece,
        style,
        yBodyBot,
        yBodyTop,
        uPanelBack,
        uPanelFront,
        options.bayTargetWidthM ?? 0.65,
        options.stileWidthM ?? 0.095,
        options.bottomRailHeightM ?? 0.115,
        options.topRailHeightM ?? 0.095,
        maxMiterRatio,
        uvScale
      );
    }
  }

  const cutawayMeshes: THREE.Mesh[] = [];
  const interiorMeshes: THREE.Mesh[] = [];

  const bodyIntGeo = buildGeometryFromAcc(interiorAcc);
  if (bodyIntGeo.getAttribute('position')) {
    const mesh = new THREE.Mesh(bodyIntGeo, mainMat);
    mesh.name = `${baseName}.body.interior`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (options.zone) mesh.userData.zoneId = options.zone;
    rootGroup.add(mesh);
    interiorMeshes.push(mesh);
  }

  let cutIdx = 0;
  for (const { desc, acc } of cutawayAccMap.values()) {
    const geo = buildGeometryFromAcc(acc);
    if (!geo.getAttribute('position')) continue;
    cutIdx += 1;
    const mesh = new THREE.Mesh(geo, mainMat);
    mesh.name = `${baseName}.body.cutaway_${cutIdx}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (options.zone) mesh.userData.zoneId = options.zone;
    tagCutaway(mesh, desc);
    rootGroup.add(mesh);
    cutawayMeshes.push(mesh);
  }

  if (includeSkirting && skirtingH > 0.02) {
    // Shift skirting profile out by wallInsetM and up by floorClearanceM so it sits proud of the panelling
    // (`thickness + 6 mm`) and 0.5 mm clear of both wall plaster & finished floor slab!
    const rawSkirt = createSkirtingProfile(style === 'tongue-and-groove' ? 'torus' : 'ogee', {
      height: Math.max(0.03, skirtingH - floorClearanceM),
      thickness: thickness + 0.006,
    });
    const shiftedSkirt = rawSkirt.map((p) => ({
      u: p.u + wallInsetM,
      v: p.v + floorClearanceM,
      sharp: p.sharp,
    }));
    const skirtRun = sweepMouldingProfileRun({
      baseName: `${baseName}.skirting`,
      pathData,
      profile: shiftedSkirt,
      hiddenRule: {
        omitWallBack: true,
        wallBackThresholdU: wallInsetM + 1e-5,
      },
      material: skirtMat,
      gaps: options.gaps,
      cap: options.cap,
      startCap: options.startCap,
      endCap: options.endCap,
      cutawayWalls: options.cutawayWalls,
      floor: options.floor,
      cutawayToleranceM: options.cutawayToleranceM,
      maxMiterRatio,
      uvScale,
      zone: options.zone,
      collisionRole,
    });
    rootGroup.add(skirtRun);
    cutawayMeshes.push(...skirtRun.cutawayMeshes);
    interiorMeshes.push(...skirtRun.interiorMeshes);
  }

  if (includeDadoCap && dadoH > 0.02) {
    const yDadoCenter = floorY + totalHeight - dadoH * 0.5;
    const dadoRun = createDadoRun({
      path: pathData,
      worldY: yDadoCenter,
      // Note: pathData segments are at floorY, so shift pathData to yDadoCenter explicitly:
      profile: 'bullnose-dado',
      height: dadoH,
      projection: thickness + 0.012,
      wallInsetM,
      material: dadoMat,
      gaps: options.gaps,
      cap: options.cap,
      startCap: options.startCap,
      endCap: options.endCap,
      cutawayWalls: options.cutawayWalls,
      floor: options.floor,
      cutawayToleranceM: options.cutawayToleranceM,
      maxMiterRatio,
      uvScale,
      zone: options.zone,
      name: `${baseName}.dadoCap`,
      collisionRole,
    });
    // Ensure dadoRun sweeps at yDadoCenter even when floorY !== 0
    if (Math.abs(floorY) > 1e-7) {
      dadoRun.position.y = yDadoCenter - floorY;
    }
    rootGroup.add(dadoRun);
    cutawayMeshes.push(...dadoRun.cutawayMeshes);
    interiorMeshes.push(...dadoRun.interiorMeshes);
  }

  tagCollisionRole(rootGroup, collisionRole);
  void emitOrientedTri;

  return Object.assign(rootGroup, {
    cutawayMeshes: cutawayMeshes as readonly THREE.Mesh[],
    interiorMeshes: interiorMeshes as readonly THREE.Mesh[],
    totalLengthM: activeTotalLen,
  });
}
