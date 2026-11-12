import * as THREE from 'three';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import {
  createSkirtingRun,
  type RoomSide,
  type SkirtingGapSpec,
  type SkirtingProfilePoint,
  type SkirtingRunResult,
} from '../cad/skirting-run.ts';
import { sharedCylinderGeometry, sharedTorusGeometry } from '../shared/geometry-cache.ts';
import { prepGeo, tagHighLod } from '../shared/scene-helpers.ts';

let cachedLimePlasterMouldingMat: THREE.MeshStandardMaterial | null = null;

export function getGeorgianPlasterMouldingMaterial(): THREE.MeshStandardMaterial {
  if (!cachedLimePlasterMouldingMat) {
    cachedLimePlasterMouldingMat = new THREE.MeshStandardMaterial({
      name: 'georgianLimePlasterMoulding',
      color: 0xf5f2ea,
      roughness: 0.72,
      metalness: 0.0,
    });
  }
  return cachedLimePlasterMouldingMat;
}

export interface GeorgianCeilingCorniceOptions {
  readonly name?: string;
  /** Closed or open room perimeter path `[x, z]` along interior plaster wall faces. */
  readonly path: readonly (readonly [number, number] | readonly [number, number, number])[];
  readonly closed?: boolean;
  /** Which side of the directed path faces into the room (`'left'` for CCW `[x, z]` loops in X-right, Z-down/south). */
  readonly roomSide?: RoomSide;
  /** Finished ceiling soffit Y in world/floor coordinates (cornice hangs `[ceilingY - heightM, ceilingY]`). */
  readonly ceilingY: number;
  /** Vertical drop of the cornice (default `0.125` m = `125 mm`). */
  readonly heightM?: number;
  /** Horizontal projection onto ceiling soffit (default `0.120` m = `120 mm`). */
  readonly projectionM?: number;
  readonly material?: THREE.Material;
  readonly gaps?: readonly SkirtingGapSpec[];
  readonly cutawayWalls?: readonly CutawayWallDescriptor[];
  readonly floor?: string;
  readonly cutawayToleranceM?: number;
  readonly zone?: string;
}

/**
 * Creates a classical Georgian plaster cornice profile (`125 mm H × 120 mm D` default):
 * lower astragal bead, dentil/fillet step, deep scotia cove, and upper cyma-recta crown fillet.
 * Offset by `0.8 mm` from wall (`u >= 0.0008`) and `0.6 mm` from ceiling (`v <= H - 0.0006`)
 * so swept runs never z-fight with host wall or ceiling planes.
 */
export function createGeorgianCorniceProfile(
  heightM = 0.125,
  projectionM = 0.12
): readonly SkirtingProfilePoint[] {
  const h = Math.max(0.06, heightM);
  const d = Math.max(0.05, projectionM);
  const u0 = 0.0008;
  const v0 = 0.0006;
  const vTop = h - 0.0006;

  return [
    { u: u0, v: v0, sharp: true },
    { u: d * 0.14, v: v0, sharp: true },
    { u: d * 0.18, v: h * 0.07 },
    { u: d * 0.15, v: h * 0.14, sharp: true },
    // Dentil / fillet projection step
    { u: d * 0.28, v: h * 0.16, sharp: true },
    { u: d * 0.28, v: h * 0.28, sharp: true },
    { u: d * 0.23, v: h * 0.30, sharp: true },
    // Deep Georgian cove (scotia) sweeping upward & outward
    { u: d * 0.30, v: h * 0.44 },
    { u: d * 0.43, v: h * 0.58 },
    { u: d * 0.60, v: h * 0.69 },
    //Quirk fillet before upper cyma-recta
    { u: d * 0.68, v: h * 0.72, sharp: true },
    { u: d * 0.68, v: h * 0.77, sharp: true },
    // Upper cyma-recta ogee & ceiling fascia fillet
    { u: d * 0.80, v: h * 0.83 },
    { u: d * 0.92, v: h * 0.90 },
    { u: d, v: h * 0.94, sharp: true },
    { u: d, v: vTop, sharp: true },
    { u: u0, v: vTop, sharp: true },
  ];
}

/**
 * Sweeps a 45°-mitred Georgian plaster ceiling cornice (`125 mm H × 120 mm D` default) around a room
 * perimeter (including external chimney-breast returns), automatically splitting exterior-wall runs
 * so exterior cornice segments cut away cleanly with their host `cutawayWall`.
 */
export function buildGeorgianCeilingCornice(
  opts: GeorgianCeilingCorniceOptions
): SkirtingRunResult {
  const heightM = opts.heightM ?? 0.125;
  const projectionM = opts.projectionM ?? 0.12;
  const profile = createGeorgianCorniceProfile(heightM, projectionM);

  return createSkirtingRun({
    name: opts.name ?? 'georgianCeilingCornice',
    path: opts.path,
    closed: opts.closed ?? true,
    roomSide: opts.roomSide ?? 'left',
    elevationY: opts.ceilingY - heightM,
    profile,
    material: opts.material ?? getGeorgianPlasterMouldingMaterial(),
    gaps: opts.gaps,
    cutawayWalls: opts.cutawayWalls,
    floor: opts.floor,
    cutawayToleranceM: opts.cutawayToleranceM ?? 0.24,
    zone: opts.zone,
  });
}

export interface GeorgianCeilingPanelMouldingOptions {
  readonly name?: string;
  /** World/local position of panel center on ceiling soffit (`[cx, ceilingY, cz]`). */
  readonly position?: readonly [number, number, number];
  /** Outer width of inset panel along X in metres. */
  readonly widthM: number;
  /** Outer depth of inset panel along Z in metres. */
  readonly depthM: number;
  /** Astragal rail width in metres (default `0.038`). */
  readonly mouldingWidthM?: number;
  /** Downward relief depth in metres (default `0.016`). */
  readonly reliefDepthM?: number;
  readonly includeCornerRosettes?: boolean;
  readonly material?: THREE.Material;
  readonly zone?: string;
}

/**
 * Inset Georgian plaster astragal ceiling panel moulding (`y = 0` at ceiling soffit, projecting `-Y`
 * with `0.8 mm` soffit clearance so zero z-fighting occurs), suitable for parenting to `ceilingGroup`
 * around a central `buildGeorgianCeilingRose`.
 */
export function buildGeorgianCeilingPanelMoulding(
  opts: GeorgianCeilingPanelMouldingOptions
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianCeilingPanelMoulding';
  const mat = opts.material ?? getGeorgianPlasterMouldingMaterial();
  const w = Math.max(0.6, opts.widthM);
  const d = Math.max(0.6, opts.depthM);
  const rw = opts.mouldingWidthM ?? 0.038;
  const rd = opts.reliefDepthM ?? 0.016;

  // Rectangular closed loop at y = -rd - 0.0008, swept upward to -0.0008
  const halfW = w * 0.5;
  const halfD = d * 0.5;
  const profile: readonly SkirtingProfilePoint[] = [
    { u: 0.0005, v: 0.0004, sharp: true },
    { u: rw * 0.22, v: 0.0004, sharp: true },
    { u: rw * 0.5, v: rd * 0.35 },
    { u: rw * 0.78, v: 0.0004, sharp: true },
    { u: rw, v: rd * 0.45, sharp: true },
    { u: rw, v: rd, sharp: true },
    { u: 0.0005, v: rd, sharp: true },
  ];

  const root = new THREE.Group();
  root.name = namePrefix;
  if (opts.zone) {
    root.userData.zone = opts.zone;
  }

  // CCW in (X, -Z) -> (-halfW, -halfD) -> (-halfW, +halfD) -> (+halfW, +halfD) -> (+halfW, -halfD)
  // Check normal for (-halfW, -halfD) -> (-halfW, +halfD): tangent = [0, 0, +1].
  // With roomSide = 'left', normal = [hz, 0, -hx] = [+1, 0, 0] (inward +X!).
  const panelRails = createSkirtingRun({
    name: `${namePrefix}.astragalFrame`,
    path: [
      [-halfW, -halfD],
      [-halfW, halfD],
      [halfW, halfD],
      [halfW, -halfD],
    ],
    closed: true,
    roomSide: 'left',
    elevationY: -(rd + 0.0008),
    profile,
    material: mat,
    zone: opts.zone,
  });
  root.add(panelRails);

  if (opts.includeCornerRosettes ?? true) {
    const inset = rw + 0.075;
    for (const [tag, sx, sz] of [
      ['NW', -1, -1],
      ['SW', -1, 1],
      ['SE', 1, 1],
      ['NE', 1, -1],
    ] as const) {
      const cx = sx * (halfW - inset);
      const cz = sz * (halfD - inset);
      const ring = new THREE.Mesh(
        prepGeo(sharedTorusGeometry(0.036, 0.0055, 8, 20)),
        mat
      );
      ring.name = `${namePrefix}.cornerRing_${tag}`;
      ring.rotation.x = Math.PI * 0.5;
      ring.position.set(cx, -0.007, cz);
      tagHighLod(ring);
      root.add(ring);

      const boss = new THREE.Mesh(
        prepGeo(sharedCylinderGeometry(0.014, 0.018, 0.011, 14)),
        mat
      );
      boss.name = `${namePrefix}.cornerBoss_${tag}`;
      boss.position.set(cx, -0.0065, cz);
      tagHighLod(boss);
      root.add(boss);
    }
  }

  if (opts.position) {
    root.position.set(opts.position[0], opts.position[1], opts.position[2]);
  }
  return root;
}

export { buildGeorgianCeilingRose, type GeorgianCeilingRoseOptions } from './georgian-facade-and-fireplace.ts';
