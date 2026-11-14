import * as THREE from 'three';
import type { AcousticPortalState } from '../../core/types/acoustics.ts';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import {
  type InteractionTarget,
  registerHingedDoor,
  tagCollisionRole,
  tagCutaway,
  tagHighLod,
} from '../../engine/geometry/mesh-traits.ts';
import type { Point2D } from '../../engine/geometry/period-house-primitives.ts';
import {
  createTimberBoxGeometry,
  resolveMaterialTextureGrainAxis,
  sampleTimberSliceTransform,
  type TimberGrainAxis,
  type TimberSeedInput,
} from '../../engine/geometry/timber-piece-uvs.ts';
import { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import {
  createGeorgianSashWindow,
  type CreateGeorgianSashWindowOptions,
  type GeorgianLintelStyle,
  type GeorgianSashWindowResult,
  type GeorgianSillStyle,
} from '../architectural/georgian-sash-window.ts';
import { sharedBoxGeometry, sharedCylinderGeometry } from '../shared/geometry-cache.ts';
import type { SkirtingGap } from './skirting-run.ts';

export type WallOpeningKind =
  | 'hinged-door'
  | 'double-door'
  | 'georgian-sash'
  | 'casement-window'
  | 'cased-portal'
  | 'raw-hole';

export type DoorLeafStyle =
  | 'four-panel'
  | 'six-panel'
  | 'glazed'
  | 'flush'
  | '4-panel'
  | '6-panel';

export type DoorThresholdStyle = 'oak' | 'marble' | 'yorkstone' | 'none';

export interface WallOpeningSpec {
  readonly id?: string;
  /** Target wall segment ID (required when passed at network level or via `populateWallOpenings`). */
  readonly wallId?: string;
  /** Center distance (metres) along the host wall from `wall.from` (legacy alias). */
  readonly centerOffset?: number;
  /** Center distance (metres) along the host wall from `wall.from`. */
  readonly centerAlongM?: number;
  /** Center distance (metres) along the host wall from `wall.from` (concise alias). */
  readonly offsetM?: number;
  readonly width: number;
  readonly height: number;
  /** Sill elevation above the host wall's `baseY` (default `0` for doorways/portals). */
  readonly sillY?: number;
  readonly archRiseM?: number;
  readonly kind?: WallOpeningKind;
  readonly label?: string;
  readonly zone?: string;

  // Door & cased-portal joinery options
  readonly leafStyle?: DoorLeafStyle;
  /** Hinge jamb side when facing the primary/interior side of the wall (default `'left'`). */
  readonly hingeSide?: 'left' | 'right';
  /** Room side toward which hinged door leaves swing open (default `'interior'`). */
  readonly swingTowards?: 'interior' | 'exterior';
  /** Maximum open swing angle in radians (default `Math.PI * 0.48` ≈ `86.4°`). */
  readonly openAngle?: number;
  readonly initialAngle?: number;
  readonly threshold?: DoorThresholdStyle;
  readonly architraveSides?: 'both' | 'interior' | 'none';
  readonly architraveWidthM?: number;
  readonly architraveThicknessM?: number;
  readonly plinthHeightM?: number;
  readonly plinthThicknessM?: number;

  // Window options (`'georgian-sash'` & `'casement-window'`)
  readonly lintel?: GeorgianLintelStyle;
  readonly sill?: GeorgianSillStyle;
  readonly panesCols?: number;
  readonly panesTopRows?: number;
  readonly panesBottomRows?: number;
  readonly initialOpenRatio?: number;
  readonly sashOptions?: Partial<CreateGeorgianSashWindowOptions>;

  // Optional material overrides
  readonly frameMaterial?: THREE.Material;
  readonly architraveMaterial?: THREE.Material;
  readonly doorMaterial?: THREE.Material;
  readonly glassMaterial?: THREE.Material;
  readonly hardwareMaterial?: THREE.Material;
  readonly thresholdMaterial?: THREE.Material;
}

export interface BuiltWallOpening {
  readonly id: string;
  readonly wallId: string;
  readonly kind: WallOpeningKind;
  readonly centerAlongM: number;
  readonly width: number;
  readonly height: number;
  readonly sillY: number;
  readonly group: THREE.Group;
  readonly doorPivots: readonly THREE.Group[];
  readonly sashWindow?: GeorgianSashWindowResult;
  readonly skirtingGap?: SkirtingGap;
  readonly dadoGap?: SkirtingGap;
  readonly cutawayWall?: CutawayWallDescriptor;
  getAcousticPortalState(): AcousticPortalState | null;
}

/**
 * Internal host-wall descriptor supplied by `BuiltWallNetwork` so `populateWallOpenings`
 * can resolve exact face frames, corner-proximity architrave ripping, cutaway descriptors,
 * and on-demand wall aperture rebuilding without circular imports.
 */
export interface OpeningHostWallInfo {
  readonly id: string;
  readonly kind: 'exterior' | 'partition';
  readonly from: Point2D;
  readonly to: Point2D;
  readonly length: number;
  readonly tx: number;
  readonly tz: number;
  readonly outwardNormal: Point2D;
  readonly offsetOuter: number;
  readonly offsetInner: number;
  readonly thickness: number;
  readonly baseY: number;
  readonly height: number;
  readonly zone?: string;
  /** Clear `[uMin, uMax]` span along `from -> to` available on the inner (`-outwardNormal`) face. */
  readonly innerFaceClearSpanAt: (uCenter: number) => readonly [number, number];
  /** Clear `[uMin, uMax]` span along `from -> to` available on the outer (`+outwardNormal`) face. */
  readonly outerFaceClearSpanAt: (uCenter: number) => readonly [number, number];
}

export interface PopulateOpeningsNetworkHost {
  readonly group: THREE.Group;
  getWallCutaway(wallId: string, alongOffsetM?: number): CutawayWallDescriptor | undefined;
  readonly _getOpeningHostWall?: (wallId: string) => OpeningHostWallInfo | undefined;
  readonly _ensureAperturesCut?: (specs: readonly ResolvedWallApertureRequest[]) => void;
  readonly _registerBuiltOpenings?: (
    built: readonly BuiltWallOpening[],
    skirtingGaps: readonly SkirtingGap[],
    dadoGaps: readonly SkirtingGap[]
  ) => void;
}

export interface ResolvedWallApertureRequest {
  readonly id: string;
  readonly wallId: string;
  readonly centerOffset: number;
  readonly width: number;
  readonly sillY: number;
  readonly height: number;
  readonly archRiseM?: number;
  readonly suppressRawReveals: boolean;
}

const EPS_M = 0.0006; // 0.6 mm (> 0.35 mm detectZFighting threshold)
const GAP_CLEARANCE_M = 0.0005; // +0.5 mm butt-joint clearance around plinths & architraves
const DEFAULT_ARCHITRAVE_WIDTH_M = 0.075;
const DEFAULT_ARCHITRAVE_THICKNESS_M = 0.018;
const DEFAULT_PLINTH_HEIGHT_M = 0.168;
const DEFAULT_PLINTH_THICKNESS_M = 0.028;
const PLINTH_PROUD_WIDTH_M = 0.004;
const REVEAL_LINING_THICKNESS_M = 0.018;
const DOOR_LEAF_THICKNESS_M = 0.044;

let defaultJoineryMat: THREE.MeshStandardMaterial | null = null;
let defaultDoorLeafMat: THREE.MeshStandardMaterial | null = null;
let defaultOakMat: THREE.MeshStandardMaterial | null = null;
let defaultMarbleMat: THREE.MeshStandardMaterial | null = null;
let defaultYorkstoneMat: THREE.MeshStandardMaterial | null = null;
let defaultBrassMat: THREE.MeshStandardMaterial | null = null;
let defaultGlassMat: THREE.MeshPhysicalMaterial | null = null;

function getJoineryMaterial(): THREE.Material {
  if (!defaultJoineryMat) {
    defaultJoineryMat = new THREE.MeshStandardMaterial({
      name: 'WallOpening_PaintedJoinery',
      color: 0xf1ede4,
      roughness: 0.42,
      metalness: 0.0,
    });
  }
  return defaultJoineryMat;
}

function getDoorLeafMaterial(): THREE.Material {
  if (!defaultDoorLeafMat) {
    defaultDoorLeafMat = new THREE.MeshStandardMaterial({
      name: 'WallOpening_DoorLeaf',
      color: 0xede8dd,
      roughness: 0.4,
      metalness: 0.0,
    });
  }
  return defaultDoorLeafMat;
}

function getThresholdMaterial(style: Exclude<DoorThresholdStyle, 'none'>): THREE.Material {
  if (style === 'marble') {
    if (!defaultMarbleMat) {
      defaultMarbleMat = new THREE.MeshStandardMaterial({
        name: 'WallOpening_MarbleThreshold',
        color: 0xe6e4df,
        roughness: 0.28,
        metalness: 0.0,
      });
    }
    return defaultMarbleMat;
  }
  if (style === 'yorkstone') {
    if (!defaultYorkstoneMat) {
      defaultYorkstoneMat = new THREE.MeshStandardMaterial({
        name: 'WallOpening_YorkstoneThreshold',
        color: 0xb9ae99,
        roughness: 0.82,
        metalness: 0.0,
      });
    }
    return defaultYorkstoneMat;
  }
  if (!defaultOakMat) {
    defaultOakMat = new THREE.MeshStandardMaterial({
      name: 'WallOpening_OakThreshold',
      color: 0x8d6742,
      roughness: 0.52,
      metalness: 0.0,
    });
  }
  return defaultOakMat;
}

function getBrassHardwareMaterial(): THREE.Material {
  if (!defaultBrassMat) {
    defaultBrassMat = new THREE.MeshStandardMaterial({
      name: 'WallOpening_AgedBrass',
      color: 0xb59449,
      roughness: 0.28,
      metalness: 0.88,
    });
  }
  return defaultBrassMat;
}

function getOpeningGlassMaterial(): THREE.Material {
  if (!defaultGlassMat) {
    defaultGlassMat = new THREE.MeshPhysicalMaterial({
      name: 'WallOpening_ClearGlass',
      color: 0xdce8ec,
      transparent: true,
      opacity: 0.28,
      roughness: 0.08,
      metalness: 0.0,
      ior: 1.52,
      depthWrite: false,
    });
  }
  return defaultGlassMat;
}

function resolveInteractionRegistryOptional(
  ctx: InteractionTarget | null | undefined
): InteractionRegistry | null {
  if (!ctx) return null;
  if (ctx instanceof InteractionRegistry) return ctx;
  if (typeof ctx === 'object' && 'interactions' in ctx && ctx.interactions) {
    return ctx.interactions;
  }
  return null;
}

export function resolveOpeningCenterAlongM(spec: WallOpeningSpec, wallLengthM: number): number {
  if (spec.centerOffset !== undefined) return spec.centerOffset;
  if (spec.centerAlongM !== undefined) return spec.centerAlongM;
  if (spec.offsetM !== undefined) return spec.offsetM;
  return wallLengthM * 0.5;
}

function buildGapBoxXZ(
  wall: OpeningHostWallInfo,
  uMin: number,
  uMax: number,
  normalPadM: number
): SkirtingGap {
  const w0 = wall.offsetInner - normalPadM;
  const w1 = wall.offsetOuter + normalPadM;
  const corners: [number, number][] = [
    [
      wall.from[0] + wall.tx * uMin + wall.outwardNormal[0] * w0,
      wall.from[1] + wall.tz * uMin + wall.outwardNormal[1] * w0,
    ],
    [
      wall.from[0] + wall.tx * uMax + wall.outwardNormal[0] * w0,
      wall.from[1] + wall.tz * uMax + wall.outwardNormal[1] * w0,
    ],
    [
      wall.from[0] + wall.tx * uMax + wall.outwardNormal[0] * w1,
      wall.from[1] + wall.tz * uMax + wall.outwardNormal[1] * w1,
    ],
    [
      wall.from[0] + wall.tx * uMin + wall.outwardNormal[0] * w1,
      wall.from[1] + wall.tz * uMin + wall.outwardNormal[1] * w1,
    ],
  ];
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
  return {
    box: bounds,
    boxXZ: bounds,
    cap: 'butt',
  };
}

/**
 * Builds a single unified, non-overlapping 3-sided mitred architrave surround mesh
 * (left leg, 45°/ripped top mitres, horizontal head, right leg) on face `faceSign` (`+1` = `+Z`, `-1` = `-Z`).
 * Because all three legs are welded along exact corner miter lines into one closed prism shell,
 * there are zero overlapping triangles at the mitred corners.
 */
function buildMitredArchitraveGeometry(params: {
  readonly innerHalfW: number;
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly headWidth: number;
  readonly legBottomY: number;
  readonly innerTopY: number;
  readonly zBack: number;
  readonly zFront: number;
  readonly material?: THREE.Material;
  readonly seed?: TimberSeedInput;
}): THREE.BufferGeometry {
  const {
    innerHalfW,
    leftWidth,
    rightWidth,
    headWidth,
    legBottomY,
    innerTopY,
    zBack,
    zFront,
  } = params;

  const zMin = Math.min(zBack, zFront);
  const zMax = Math.max(zBack, zFront);

  const xInL = -innerHalfW;
  const xOutL = -(innerHalfW + leftWidth);
  const xInR = innerHalfW;
  const xOutR = innerHalfW + rightWidth;
  const yBot = legBottomY;
  const yInTop = innerTopY;
  const yOutTop = innerTopY + headWidth;

  // Decompose the 3-sided mitred architrave into 3 non-overlapping trapezoids in XY extruded [zMin, zMax]:
  // Left leg: (xOutL, yBot) -> (xInL, yBot) -> (xInL, yInTop) -> (xOutL, yOutTop)
  // Head:     (xInL, yInTop) -> (xInR, yInTop) -> (xOutR, yOutTop) -> (xOutL, yOutTop)
  // Right leg:(xInR, yBot) -> (xOutR, yBot) -> (xOutR, yOutTop) -> (xInR, yInTop)
  // Notice internal miter seams are SHARED (not emitted as duplicate internal end-caps), so zero internal faces!
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const texAxis = resolveMaterialTextureGrainAxis(params.material);
  const uvScale = 1 / 2.2;
  const pieceSlices = [
    sampleTimberSliceTransform([params.seed ?? 'mitredArch', 'leftLeg']),
    sampleTimberSliceTransform([params.seed ?? 'mitredArch', 'head']),
    sampleTimberSliceTransform([params.seed ?? 'mitredArch', 'rightLeg']),
  ] as const;
  const pieceHorizontal = [false, true, false] as const;

  const emitQuad = (
    p0: readonly [number, number, number],
    p1: readonly [number, number, number],
    p2: readonly [number, number, number],
    p3: readonly [number, number, number],
    nx: number,
    ny: number,
    nz: number,
    pieceIdx: 0 | 1 | 2
  ): void => {
    const e1x = p1[0] - p0[0];
    const e1y = p1[1] - p0[1];
    const e1z = p1[2] - p0[2];
    const e2x = p2[0] - p0[0];
    const e2y = p2[1] - p0[1];
    const e2z = p2[2] - p0[2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const dot = cx * nx + cy * ny + cz * nz;

    const slice = pieceSlices[pieceIdx];
    const isHoriz = pieceHorizontal[pieceIdx];
    const base = positions.length / 3;
    const pts = [p0, p1, p2, p3];
    for (const p of pts) {
      positions.push(p[0], p[1], p[2]);
      normals.push(nx, ny, nz);
      let along: number;
      let across: number;
      if (isHoriz) {
        along = p[0];
        across = Math.abs(nz) > 0.5 ? p[1] : p[2];
      } else {
        along = p[1];
        across = Math.abs(nz) > 0.5 ? p[0] : p[2];
      }
      const fiberU = along * uvScale * slice.uSign + slice.uOffset;
      const crossV = across * uvScale * slice.vSign + slice.vOffset;
      if (texAxis === 'u') {
        uvs.push(fiberU, crossV);
      } else {
        uvs.push(crossV, fiberU);
      }
    }
    if (dot >= 0) {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  };

  const trapQuads: Array<readonly [[number, number], [number, number], [number, number], [number, number]]> = [
    [
      [xOutL, yBot],
      [xInL, yBot],
      [xInL, yInTop],
      [xOutL, yOutTop],
    ],
    [
      [xInL, yInTop],
      [xInR, yInTop],
      [xOutR, yOutTop],
      [xOutL, yOutTop],
    ],
    [
      [xInR, yBot],
      [xOutR, yBot],
      [xOutR, yOutTop],
      [xInR, yInTop],
    ],
  ];

  // Front (+Z) and Back (-Z) faces
  for (let pIdx = 0; pIdx < trapQuads.length; pIdx++) {
    const [a, b, c, d] = trapQuads[pIdx]!;
    const pieceIdx = pIdx as 0 | 1 | 2;
    emitQuad(
      [a[0], a[1], zMax],
      [b[0], b[1], zMax],
      [c[0], c[1], zMax],
      [d[0], d[1], zMax],
      0,
      0,
      1,
      pieceIdx
    );
    emitQuad(
      [a[0], a[1], zMin],
      [b[0], b[1], zMin],
      [c[0], c[1], zMin],
      [d[0], d[1], zMin],
      0,
      0,
      -1,
      pieceIdx
    );
  }

  // Outer perimeter & inner aperture perimeter side faces
  const perimeterEdges: Array<{
    readonly a: readonly [number, number];
    readonly b: readonly [number, number];
    readonly nx: number;
    readonly ny: number;
    readonly pieceIdx: 0 | 1 | 2;
  }> = [
    // Outer left (-X)
    { a: [xOutL, yBot], b: [xOutL, yOutTop], nx: -1, ny: 0, pieceIdx: 0 },
    // Outer top (+Y)
    { a: [xOutL, yOutTop], b: [xOutR, yOutTop], nx: 0, ny: 1, pieceIdx: 1 },
    // Outer right (+X)
    { a: [xOutR, yOutTop], b: [xOutR, yBot], nx: 1, ny: 0, pieceIdx: 2 },
    // Right bottom (-Y)
    { a: [xOutR, yBot], b: [xInR, yBot], nx: 0, ny: -1, pieceIdx: 2 },
    // Inner right (-X)
    { a: [xInR, yBot], b: [xInR, yInTop], nx: -1, ny: 0, pieceIdx: 2 },
    // Inner top (-Y)
    { a: [xInR, yInTop], b: [xInL, yInTop], nx: 0, ny: -1, pieceIdx: 1 },
    // Inner left (+X)
    { a: [xInL, yInTop], b: [xInL, yBot], nx: 1, ny: 0, pieceIdx: 0 },
    // Left bottom (-Y)
    { a: [xInL, yBot], b: [xOutL, yBot], nx: 0, ny: -1, pieceIdx: 0 },
  ];

  for (const edge of perimeterEdges) {
    emitQuad(
      [edge.a[0], edge.a[1], zMin],
      [edge.b[0], edge.b[1], zMin],
      [edge.b[0], edge.b[1], zMax],
      [edge.a[0], edge.a[1], zMax],
      edge.nx,
      edge.ny,
      0,
      edge.pieceIdx
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a zero-z-fighting architectural panelled or glazed door leaf centered at `X = 0`,
 * `Y in [0, leafHeight]`, `Z in [-leafThickness/2, +leafThickness/2]`.
 * Every stile, rail, muntin, recessed panel, and handle occupies strictly disjoint 3D regions
 * separated by `>= 0.6 mm` at internal recesses so `detectZFighting` reports `0` overlaps.
 */
function buildArchitecturalDoorLeaf(params: {
  readonly namePrefix: string;
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly style: DoorLeafStyle;
  readonly handleSide: 'left' | 'right';
  readonly isExteriorGlazed: boolean;
  readonly doorMat: THREE.Material;
  readonly glassMat: THREE.Material;
  readonly hardwareMat: THREE.Material;
  readonly seed?: TimberSeedInput;
}): THREE.Group {
  const leafSeed: TimberSeedInput = params.seed ?? params.namePrefix;
  const {
    namePrefix,
    width,
    height,
    thickness,
    style,
    handleSide,
    isExteriorGlazed,
    doorMat,
    glassMat,
    hardwareMat,
  } = params;

  const leaf = new THREE.Group();
  leaf.name = namePrefix;

  const normalizedStyle =
    style === '4-panel' ? 'four-panel' : style === '6-panel' ? 'six-panel' : style;

  if (normalizedStyle === 'flush') {
    const slab = new THREE.Mesh(
      createTimberBoxGeometry(width, height, thickness, {
        grainAxis: 'y',
        material: doorMat,
        seed: [leafSeed, 'slab'],
      }),
      doorMat
    );
    slab.name = `${namePrefix}.slab`;
    slab.position.set(0, height * 0.5, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    leaf.add(slab);
  } else {
    const stileW = Math.min(0.115, Math.max(0.065, width * 0.145));
    const bottomRailH = Math.min(0.22, height * 0.11);
    const lockRailH = Math.min(0.18, height * 0.09);
    const topRailH = Math.min(0.115, height * 0.06);
    const muntinW = Math.min(0.095, stileW * 0.85);

    const addFramePiece = (
      partName: string,
      x0: number,
      x1: number,
      y0: number,
      y1: number,
      grainAxis: TimberGrainAxis,
      zThickness = thickness
    ): void => {
      const pw = x1 - x0;
      const ph = y1 - y0;
      if (pw <= 1e-4 || ph <= 1e-4) return;
      const m = new THREE.Mesh(
        createTimberBoxGeometry(pw, ph, zThickness, {
          grainAxis,
          material: doorMat,
          seed: [leafSeed, partName],
        }),
        doorMat
      );
      m.name = `${namePrefix}.${partName}`;
      m.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      leaf.add(m);
    };

    const halfW = width * 0.5;
    const innerX0 = -halfW + stileW;
    const innerX1 = halfW - stileW;

    // Outer left & right stiles run full height [0, height]
    addFramePiece('stile_left', -halfW, innerX0 - EPS_M, 0, height, 'y');
    addFramePiece('stile_right', innerX1 + EPS_M, halfW, 0, height, 'y');

    // Bottom & top rails span strictly between stiles [innerX0, innerX1]
    addFramePiece('rail_bottom', innerX0, innerX1, 0, bottomRailH, 'x');
    addFramePiece('rail_top', innerX0, innerX1, height - topRailH, height, 'x');

    const addFieldedPanel = (
      panelName: string,
      px0: number,
      px1: number,
      py0: number,
      py1: number
    ): void => {
      const w0 = px1 - px0 - 2 * EPS_M;
      const h0 = py1 - py0 - 2 * EPS_M;
      if (w0 <= 0.02 || h0 <= 0.02) return;
      const cx = (px0 + px1) * 0.5;
      const cy = (py0 + py1) * 0.5;

      const recessDepth = Math.max(0.014, thickness * 0.36);
      const backing = new THREE.Mesh(
        createTimberBoxGeometry(w0, h0, recessDepth, {
          grainAxis: 'y',
          material: doorMat,
          seed: [leafSeed, panelName, 'field'],
        }),
        doorMat
      );
      backing.name = `${namePrefix}.${panelName}_field`;
      backing.position.set(cx, cy, 0);
      backing.castShadow = true;
      backing.receiveShadow = true;
      leaf.add(backing);

      const margin = Math.min(0.032, Math.min(w0, h0) * 0.22);
      const tableW = w0 - 2 * margin;
      const tableH = h0 - 2 * margin;
      if (tableW > 0.02 && tableH > 0.02) {
        const raisedDepth = Math.max(recessDepth + 0.008, thickness * 0.64);
        const table = new THREE.Mesh(
          createTimberBoxGeometry(tableW, tableH, raisedDepth, {
            grainAxis: 'y',
            material: doorMat,
            seed: [leafSeed, panelName, 'raised'],
          }),
          doorMat
        );
        table.name = `${namePrefix}.${panelName}_raised`;
        table.position.set(cx, cy, 0);
        table.castShadow = true;
        table.receiveShadow = true;
        leaf.add(table);
      }
    };

    if (normalizedStyle === 'glazed') {
      const lockY0 = Math.min(height * 0.4, 0.82);
      const lockY1 = lockY0 + lockRailH;
      addFramePiece('rail_lock', innerX0, innerX1, lockY0, lockY1, 'x');

      // Lower fielded timber panel(s)
      const cols = width >= 0.62 ? 2 : 1;
      if (cols === 2) {
        const m0 = -muntinW * 0.5;
        const m1 = muntinW * 0.5;
        addFramePiece('muntin_lower', m0, m1, bottomRailH + EPS_M, lockY0 - EPS_M, 'y');
        addFieldedPanel('panel_bl', innerX0, m0, bottomRailH, lockY0);
        addFieldedPanel('panel_br', m1, innerX1, bottomRailH, lockY0);
      } else {
        addFieldedPanel('panel_bottom', innerX0, innerX1, bottomRailH, lockY0);
      }

      // Upper glazed aperture with slender glazing bars
      const gy0 = lockY1 + EPS_M;
      const gy1 = height - topRailH - EPS_M;
      const gx0 = innerX0 + EPS_M;
      const gx1 = innerX1 - EPS_M;
      if (gx1 - gx0 > 0.04 && gy1 - gy0 > 0.04) {
        const pane = new THREE.Mesh(
          sharedBoxGeometry(gx1 - gx0, gy1 - gy0, 0.008),
          glassMat
        );
        pane.name = `${namePrefix}.glassPane`;
        pane.position.set((gx0 + gx1) * 0.5, (gy0 + gy1) * 0.5, 0);
        if (isExteriorGlazed) {
          pane.userData.isExteriorGlazedPortal = true;
        }
        leaf.add(pane);

        // Astragal glazing bars proud of 8 mm glass (thickness 20 mm)
        const barW = 0.018;
        const barD = 0.02;
        if (gx1 - gx0 > 0.28) {
          const vBar = new THREE.Mesh(
            createTimberBoxGeometry(barW, gy1 - gy0, barD, {
              grainAxis: 'y',
              material: doorMat,
              seed: [leafSeed, 'glazingBar_v'],
            }),
            doorMat
          );
          vBar.name = `${namePrefix}.glazingBar_v`;
          vBar.position.set((gx0 + gx1) * 0.5, (gy0 + gy1) * 0.5, 0);
          leaf.add(vBar);
        }
        if (gy1 - gy0 > 0.45) {
          const midY = (gy0 + gy1) * 0.5;
          const halfSpan = (gx1 - gx0 - barW) * 0.5 - EPS_M;
          if (gx1 - gx0 > 0.28 && halfSpan > 0.02) {
            for (const s of [-1, 1] as const) {
              const hBar = new THREE.Mesh(
                createTimberBoxGeometry(halfSpan, barW, barD, {
                  grainAxis: 'x',
                  material: doorMat,
                  seed: [leafSeed, 'glazingBar_h', s],
                }),
                doorMat
              );
              hBar.name = `${namePrefix}.glazingBar_h_${s < 0 ? 'l' : 'r'}`;
              hBar.position.set((gx0 + gx1) * 0.5 + s * (barW * 0.5 + EPS_M + halfSpan * 0.5), midY, 0);
              leaf.add(hBar);
            }
          } else {
            const hBar = new THREE.Mesh(
              createTimberBoxGeometry(gx1 - gx0, barW, barD, {
                grainAxis: 'x',
                material: doorMat,
                seed: [leafSeed, 'glazingBar_h_full'],
              }),
              doorMat
            );
            hBar.name = `${namePrefix}.glazingBar_h`;
            hBar.position.set((gx0 + gx1) * 0.5, midY, 0);
            leaf.add(hBar);
          }
        }
      }
    } else if (normalizedStyle === 'six-panel') {
      const lockY0 = Math.min(height * 0.42, 0.88);
      const lockY1 = lockY0 + lockRailH;
      const friezeH = topRailH;
      const friezeY0 = height - topRailH - Math.max(0.24, (height - lockY1 - topRailH) * 0.34);
      const friezeY1 = friezeY0 + friezeH;

      addFramePiece('rail_lock', innerX0, innerX1, lockY0, lockY1, 'x');
      addFramePiece('rail_frieze', innerX0, innerX1, friezeY0, friezeY1, 'x');

      const m0 = -muntinW * 0.5;
      const m1 = muntinW * 0.5;
      if (innerX1 - innerX0 > muntinW + 0.12) {
        addFramePiece('muntin_low', m0, m1, bottomRailH + EPS_M, lockY0 - EPS_M, 'y');
        addFramePiece('muntin_mid', m0, m1, lockY1 + EPS_M, friezeY0 - EPS_M, 'y');
        addFramePiece('muntin_top', m0, m1, friezeY1 + EPS_M, height - topRailH - EPS_M, 'y');

        addFieldedPanel('panel_bl', innerX0, m0, bottomRailH, lockY0);
        addFieldedPanel('panel_br', m1, innerX1, bottomRailH, lockY0);
        addFieldedPanel('panel_ml', innerX0, m0, lockY1, friezeY0);
        addFieldedPanel('panel_mr', m1, innerX1, lockY1, friezeY0);
        addFieldedPanel('panel_tl', innerX0, m0, friezeY1, height - topRailH);
        addFieldedPanel('panel_tr', m1, innerX1, friezeY1, height - topRailH);
      } else {
        addFieldedPanel('panel_low', innerX0, innerX1, bottomRailH, lockY0);
        addFieldedPanel('panel_mid', innerX0, innerX1, lockY1, friezeY0);
        addFieldedPanel('panel_top', innerX0, innerX1, friezeY1, height - topRailH);
      }
    } else {
      // Classic 4-panel Georgian door
      const lockY0 = Math.min(height * 0.42, 0.88);
      const lockY1 = lockY0 + lockRailH;
      addFramePiece('rail_lock', innerX0, innerX1, lockY0, lockY1, 'x');

      const m0 = -muntinW * 0.5;
      const m1 = muntinW * 0.5;
      if (innerX1 - innerX0 > muntinW + 0.12) {
        addFramePiece('muntin_low', m0, m1, bottomRailH + EPS_M, lockY0 - EPS_M, 'y');
        addFramePiece('muntin_top', m0, m1, lockY1 + EPS_M, height - topRailH - EPS_M, 'y');

        addFieldedPanel('panel_bl', innerX0, m0, bottomRailH, lockY0);
        addFieldedPanel('panel_br', m1, innerX1, bottomRailH, lockY0);
        addFieldedPanel('panel_tl', innerX0, m0, lockY1, height - topRailH);
        addFieldedPanel('panel_tr', m1, innerX1, lockY1, height - topRailH);
      } else {
        addFieldedPanel('panel_low', innerX0, innerX1, bottomRailH, lockY0);
        addFieldedPanel('panel_top', innerX0, innerX1, lockY1, height - topRailH);
      }
    }
  }

  // Brass rose & lever handle on both faces of latch stile
  const hSign = handleSide === 'right' ? 1 : -1;
  const handleX = hSign * (width * 0.5 - Math.min(0.058, width * 0.12));
  const handleY = Math.min(height - 0.15, 0.98);
  for (const zSign of [-1, 1] as const) {
    const rose = new THREE.Mesh(
      sharedCylinderGeometry(0.026, 0.026, 0.008, 14),
      hardwareMat
    );
    rose.name = `${namePrefix}.rose_${zSign > 0 ? 'int' : 'ext'}`;
    rose.rotation.x = Math.PI * 0.5;
    rose.position.set(handleX, handleY, zSign * (thickness * 0.5 + 0.004 + EPS_M));
    tagHighLod(rose, 14);
    leaf.add(rose);

    const neck = new THREE.Mesh(
      sharedCylinderGeometry(0.009, 0.009, 0.036, 10),
      hardwareMat
    );
    neck.name = `${namePrefix}.spindle_${zSign > 0 ? 'int' : 'ext'}`;
    neck.rotation.x = Math.PI * 0.5;
    neck.position.set(handleX, handleY, zSign * (thickness * 0.5 + 0.026 + 2 * EPS_M));
    tagHighLod(neck, 14);
    leaf.add(neck);

    const leverLen = 0.105;
    const lever = new THREE.Mesh(
      sharedBoxGeometry(leverLen, 0.016, 0.014),
      hardwareMat
    );
    lever.name = `${namePrefix}.lever_${zSign > 0 ? 'int' : 'ext'}`;
    lever.position.set(
      handleX - hSign * (leverLen * 0.5 - 0.01),
      handleY,
      zSign * (thickness * 0.5 + 0.052 + 3 * EPS_M)
    );
    tagHighLod(lever, 14);
    leaf.add(lever);
  }

  return leaf;
}

/**
 * Populates rich architectural wall openings (`'hinged-door'`, `'double-door'`,
 * `'georgian-sash'`, `'casement-window'`, `'cased-portal'`, `'raw-hole'`) onto a
 * `BuiltWallNetwork`, cutting exact wall apertures when not already present, building
 * non-coplanar reveal linings, 3-sided mitred architraves with corner-ripped legs &
 * `168 × 28 mm` pedestal plinth blocks, interactive hinged doors / sash windows,
 * cutaway tagging, acoustic portals, and automatic `skirtingGaps` & `dadoGaps`.
 */
export function populateWallOpenings(
  ctx: InteractionTarget | null | undefined,
  network: PopulateOpeningsNetworkHost,
  specs: readonly WallOpeningSpec[]
): readonly BuiltWallOpening[] {
  if (specs.length === 0) {
    return [];
  }

  const interactions = resolveInteractionRegistryOptional(ctx);

  // First ensure all apertures are cut in host walls (and suppress raw wall reveals for lined joinery openings)
  const apertureRequests: ResolvedWallApertureRequest[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const wallId = spec.wallId;
    if (!wallId) {
      throw new Error(
        `populateWallOpenings: opening spec at index ${i} (${spec.id ?? 'unnamed'}) is missing required 'wallId'.`
      );
    }
    const hostWall = network._getOpeningHostWall?.(wallId);
    if (!hostWall) {
      throw new Error(`populateWallOpenings: unknown wallId '${wallId}'.`);
    }
    const kind: WallOpeningKind = spec.kind ?? 'raw-hole';
    const centerOffset = resolveOpeningCenterAlongM(spec, hostWall.length);
    const sillY = spec.sillY ?? 0;
    const id = spec.id ?? `${wallId}.opening_${i + 1}`;
    apertureRequests.push({
      id,
      wallId,
      centerOffset,
      width: spec.width,
      sillY,
      height: spec.height,
      ...(spec.archRiseM !== undefined ? { archRiseM: spec.archRiseM } : {}),
      suppressRawReveals: kind !== 'raw-hole' && kind !== 'georgian-sash',
    });
  }

  network._ensureAperturesCut?.(apertureRequests);

  const builtOpenings: BuiltWallOpening[] = [];
  const emittedSkirtingGaps: SkirtingGap[] = [];
  const emittedDadoGaps: SkirtingGap[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const req = apertureRequests[i]!;
    const wall = network._getOpeningHostWall!(req.wallId)!;
    const kind: WallOpeningKind = spec.kind ?? 'raw-hole';
    const sillY = req.sillY;
    const uCenter = req.centerOffset;
    const width = spec.width;
    const height = spec.height;
    const halfW = width * 0.5;
    const halfT = wall.thickness * 0.5;
    const cutawayWall =
      wall.kind === 'exterior' ? network.getWallCutaway(wall.id, uCenter) : undefined;

    const midOffset = (wall.offsetOuter + wall.offsetInner) * 0.5;
    const worldX = wall.from[0] + wall.tx * uCenter + wall.outwardNormal[0] * midOffset;
    const worldY = wall.baseY + sillY;
    const worldZ = wall.from[1] + wall.tz * uCenter + wall.outwardNormal[1] * midOffset;

    // Local +Z points into room (-outwardNormal); local -Z points toward +outwardNormal (exterior)
    const inX = -wall.outwardNormal[0];
    const inZ = -wall.outwardNormal[1];
    const rotY = Math.atan2(inX, inZ);
    const localXVec: [number, number] = [Math.cos(rotY), -Math.sin(rotY)];
    const xAlongSign = localXVec[0] * wall.tx + localXVec[1] * wall.tz >= 0 ? 1 : -1;

    if (kind === 'raw-hole') {
      const emptyGroup = new THREE.Group();
      emptyGroup.name = req.id;
      emptyGroup.position.set(worldX, worldY, worldZ);
      emptyGroup.rotation.y = rotY;
      network.group.add(emptyGroup);

      const u0 = uCenter - halfW;
      const u1 = uCenter + halfW;
      let skirtingGap: SkirtingGap | undefined;
      let dadoGap: SkirtingGap | undefined;
      if (sillY <= 0.2) {
        skirtingGap = buildGapBoxXZ(wall, u0 - GAP_CLEARANCE_M, u1 + GAP_CLEARANCE_M, 0.05);
        emittedSkirtingGaps.push(skirtingGap);
      }
      if (sillY <= 1.25) {
        dadoGap = buildGapBoxXZ(wall, u0 - GAP_CLEARANCE_M, u1 + GAP_CLEARANCE_M, 0.06);
        emittedDadoGaps.push(dadoGap);
      }

      builtOpenings.push({
        id: req.id,
        wallId: wall.id,
        kind,
        centerAlongM: uCenter,
        width,
        height,
        sillY,
        group: emptyGroup,
        doorPivots: [],
        ...(skirtingGap ? { skirtingGap } : {}),
        ...(dadoGap ? { dadoGap } : {}),
        ...(cutawayWall ? { cutawayWall } : {}),
        getAcousticPortalState: () => null,
      });
      continue;
    }

    if (kind === 'georgian-sash') {
      // Inset structural box width by 2 * EPS_M so pulley stiles & timber cill sit 0.6 mm clear of raw wall jambs
      const sashFitWidth = Math.max(0.45, width - 2 * EPS_M);
      const sashRes = createGeorgianSashWindow({
        ...spec.sashOptions,
        id: req.id,
        ...(spec.label ? { label: spec.label } : {}),
        width: sashFitWidth,
        height,
        wallThickness: wall.thickness,
        position: [worldX, worldY, worldZ],
        rotationY: rotY,
        ...(spec.lintel ? { lintel: spec.lintel } : {}),
        ...(spec.sill ? { sill: spec.sill } : {}),
        ...(spec.panesCols !== undefined ? { panesCols: spec.panesCols } : {}),
        ...(spec.panesTopRows !== undefined ? { panesTopRows: spec.panesTopRows } : {}),
        ...(spec.panesBottomRows !== undefined ? { panesBottomRows: spec.panesBottomRows } : {}),
        ...(spec.initialOpenRatio !== undefined
          ? { initialOpenRatio: spec.initialOpenRatio }
          : {}),
        ...(spec.frameMaterial ? { frameMaterial: spec.frameMaterial } : {}),
        ...(spec.architraveMaterial ? { architraveMaterial: spec.architraveMaterial } : {}),
        ...(spec.glassMaterial ? { glassMaterial: spec.glassMaterial } : {}),
        ...(spec.hardwareMaterial ? { hardwareMaterial: spec.hardwareMaterial } : {}),
        ...(cutawayWall ? { cutawayWall } : {}),
        ...(interactions ? { interactions } : {}),
        ...(spec.zone ?? wall.zone ? { zone: spec.zone ?? wall.zone } : {}),
      });
      // Ensure 0.5 mm anti-z-fighting clearance on sash staff beads & interior reveal linings
      for (const side of ['left', 'right'] as const) {
        const sign = side === 'left' ? -1 : 1;
        const staff = sashRes.group.getObjectByName(`${req.id}.staffBead_${side}`);
        if (staff instanceof THREE.Mesh) {
          const params = (staff.geometry as THREE.BoxGeometry).parameters;
          if (params) {
            staff.geometry = sharedBoxGeometry(
              params.width,
              Math.max(0.05, params.height - 2 * EPS_M),
              params.depth
            );
          }
          staff.position.x -= sign * EPS_M;
        }
        const rev = sashRes.group.getObjectByName(`${req.id}.revealLining_${side}`);
        if (rev instanceof THREE.Mesh) {
          const trimBot = 0.025 + 2 * EPS_M;
          const trimTop = height - 0.018 - 2 * EPS_M;
          const newH = Math.max(0.1, trimTop - trimBot);
          rev.geometry = createTimberBoxGeometry(
            0.018,
            newH,
            Math.max(0.012, (rev.geometry as THREE.BoxGeometry).parameters?.depth ?? 0.06),
            {
              grainAxis: 'y',
              material: rev.material as THREE.Material,
              seed: [worldX, worldY, worldZ, req.id, 'sashRev', side],
            }
          );
          rev.position.y = (trimBot + trimTop) * 0.5;
        }
      }
      network.group.add(sashRes.group);
      sashRes.group.updateMatrixWorld(true);

      // Georgian sash interior window board extends 2 * 0.068 + 0.04 wider than sashFitWidth
      const boardHalfReach = sashFitWidth * 0.5 + 0.068 + 0.02;
      let skirtingGap: SkirtingGap | undefined;
      let dadoGap: SkirtingGap | undefined;
      if (sillY <= 0.2) {
        skirtingGap = buildGapBoxXZ(
          wall,
          uCenter - boardHalfReach - GAP_CLEARANCE_M,
          uCenter + boardHalfReach + GAP_CLEARANCE_M,
          0.06
        );
        emittedSkirtingGaps.push(skirtingGap);
      }
      if (sillY <= 1.35) {
        dadoGap = buildGapBoxXZ(
          wall,
          uCenter - boardHalfReach - GAP_CLEARANCE_M,
          uCenter + boardHalfReach + GAP_CLEARANCE_M,
          0.06
        );
        emittedDadoGaps.push(dadoGap);
      }

      builtOpenings.push({
        id: req.id,
        wallId: wall.id,
        kind,
        centerAlongM: uCenter,
        width,
        height,
        sillY,
        group: sashRes.group,
        doorPivots: [],
        sashWindow: sashRes,
        ...(skirtingGap ? { skirtingGap } : {}),
        ...(dadoGap ? { dadoGap } : {}),
        ...(cutawayWall ? { cutawayWall } : {}),
        getAcousticPortalState: () =>
          sashRes.controller ? sashRes.controller.getAcousticPortalState() : null,
      });
      continue;
    }

    // Joinery-lined openings: 'hinged-door' | 'double-door' | 'cased-portal' | 'casement-window'
    const openingGroup = new THREE.Group();
    openingGroup.name = req.id;
    openingGroup.position.set(worldX, worldY, worldZ);
    openingGroup.rotation.y = rotY;
    if (spec.zone ?? wall.zone) {
      openingGroup.userData.zoneId = spec.zone ?? wall.zone;
    }
    network.group.add(openingGroup);

    const frameMat = spec.frameMaterial ?? getJoineryMaterial();
    const archMat = spec.architraveMaterial ?? frameMat;
    const doorMat = spec.doorMaterial ?? getDoorLeafMaterial();
    const glassMat = spec.glassMaterial ?? getOpeningGlassMaterial();
    const hardwareMat = spec.hardwareMaterial ?? getBrassHardwareMaterial();

    const liningT = REVEAL_LINING_THICKNESS_M;
    const liningDepth = Math.max(0.02, wall.thickness - 2 * EPS_M);

    if (kind === 'casement-window') {
      // Timber outer/inner casement sub-frame, bullnose window board, 3-sided mitred architrave, and glazed casement leaf(s)
      const boardT = 0.024;
      const archW = spec.architraveWidthM ?? 0.068;
      const archT = spec.architraveThicknessM ?? DEFAULT_ARCHITRAVE_THICKNESS_M;

      // Exterior stone/timber sill if exterior wall
      if (wall.kind === 'exterior' && spec.sill !== 'none') {
        const sillMat = getThresholdMaterial('yorkstone');
        const extSill = new THREE.Mesh(
          sharedBoxGeometry(width + 0.08, 0.055, halfT + 0.045),
          sillMat
        );
        extSill.name = `${req.id}.exteriorSill`;
        extSill.position.set(0, -0.0275 - EPS_M, -(halfT + 0.045) * 0.5 + 0.02);
        extSill.castShadow = true;
        extSill.receiveShadow = true;
        openingGroup.add(extSill);
      }

      // Interior projecting window board
      const boardSpan = width + 2 * (archW - liningT) + 0.04;
      const zBoardBack = -halfT + EPS_M;
      const zBoardFront = halfT + 0.034;
      const openingSeed = [worldX, worldY, worldZ, req.id] as const;
      const windowBoard = new THREE.Mesh(
        createTimberBoxGeometry(boardSpan, boardT, zBoardFront - zBoardBack, {
          grainAxis: 'x',
          material: archMat,
          seed: [...openingSeed, 'windowBoard'],
        }),
        archMat
      );
      windowBoard.name = `${req.id}.windowBoard`;
      windowBoard.position.set(0, boardT * 0.5 + EPS_M, (zBoardBack + zBoardFront) * 0.5);
      windowBoard.castShadow = true;
      windowBoard.receiveShadow = true;
      openingGroup.add(windowBoard);

      // Jamb & head reveal linings (non-overlapping)
      const jambY0 = boardT + 2 * EPS_M;
      const jambY1 = height - EPS_M;
      const jambH = Math.max(0.1, jambY1 - jambY0);
      for (const s of [-1, 1] as const) {
        const jamb = new THREE.Mesh(
          createTimberBoxGeometry(liningT, jambH, liningDepth, {
            grainAxis: 'y',
            material: frameMat,
            seed: [...openingSeed, 'casementJamb', s],
          }),
          frameMat
        );
        jamb.name = `${req.id}.revealLining_${s < 0 ? 'left' : 'right'}`;
        jamb.position.set(s * (halfW - EPS_M - liningT * 0.5), (jambY0 + jambY1) * 0.5, 0);
        openingGroup.add(jamb);
      }
      const innerClearW = Math.max(0.15, width - 2 * (liningT + EPS_M));
      const headLining = new THREE.Mesh(
        createTimberBoxGeometry(innerClearW - 2 * EPS_M, liningT, liningDepth, {
          grainAxis: 'x',
          material: frameMat,
          seed: [...openingSeed, 'casementHead'],
        }),
        frameMat
      );
      headLining.name = `${req.id}.revealLining_head`;
      headLining.position.set(0, jambY1 - liningT * 0.5, 0);
      openingGroup.add(headLining);

      // Interior 3-sided mitred architrave (with corner-proximity leg ripping)
      const [uInMin, uInMax] = wall.innerFaceClearSpanAt(uCenter);
      const marginNegU = Math.max(0.012, uCenter - halfW - uInMin - GAP_CLEARANCE_M);
      const marginPosU = Math.max(0.012, uInMax - (uCenter + halfW) - GAP_CLEARANCE_M);
      const clearLeft = xAlongSign > 0 ? marginNegU : marginPosU;
      const clearRight = xAlongSign > 0 ? marginPosU : marginNegU;
      const leftArchW = Math.max(0.016, Math.min(archW, clearLeft + liningT + EPS_M));
      const rightArchW = Math.max(0.016, Math.min(archW, clearRight + liningT + EPS_M));

      const archGeo = buildMitredArchitraveGeometry({
        innerHalfW: halfW - EPS_M - liningT,
        leftWidth: leftArchW,
        rightWidth: rightArchW,
        headWidth: archW,
        legBottomY: boardT + 2 * EPS_M,
        innerTopY: jambY1 - liningT,
        zBack: halfT + EPS_M,
        zFront: halfT + EPS_M + archT,
        material: archMat,
        seed: [...openingSeed, 'casementArch'],
      });
      const archMesh = new THREE.Mesh(archGeo, archMat);
      archMesh.name = `${req.id}.architrave_int`;
      archMesh.castShadow = true;
      openingGroup.add(archMesh);

      // Glazed casement leaf(s)
      const casementY0 = jambY0 + 0.003;
      const casementY1 = jambY1 - liningT - 0.003;
      const casementH = Math.max(0.2, casementY1 - casementY0);
      const twoLeaves = innerClearW >= 0.85;
      const casementPivots: THREE.Group[] = [];
      const zCasement = -halfT * 0.25;

      const buildCasementLeaf = (leafName: string, lw: number, lh: number): THREE.Group => {
        const cg = new THREE.Group();
        cg.name = leafName;
        const st = 0.044;
        const th = 0.038;
        const hw = lw * 0.5;
        const addBar = (
          n: string,
          x0: number,
          x1: number,
          y0: number,
          y1: number,
          grainAxis: TimberGrainAxis
        ): void => {
          const m = new THREE.Mesh(
            createTimberBoxGeometry(x1 - x0, y1 - y0, th, {
              grainAxis,
              material: frameMat,
              seed: [...openingSeed, leafName, n],
            }),
            frameMat
          );
          m.name = `${leafName}.${n}`;
          m.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, 0);
          cg.add(m);
        };
        addBar('stileL', -hw, -hw + st, 0, lh, 'y');
        addBar('stileR', hw - st, hw, 0, lh, 'y');
        addBar('railB', -hw + st + EPS_M, hw - st - EPS_M, 0, st, 'x');
        addBar('railT', -hw + st + EPS_M, hw - st - EPS_M, lh - st, lh, 'x');
        const gw = Math.max(0.04, lw - 2 * st - 2 * EPS_M);
        const gh = Math.max(0.04, lh - 2 * st - 2 * EPS_M);
        const glass = new THREE.Mesh(sharedBoxGeometry(gw, gh, 0.008), glassMat);
        glass.name = `${leafName}.glass`;
        glass.position.set(0, lh * 0.5, 0);
        if (wall.kind === 'exterior') {
          glass.userData.isExteriorGlazedPortal = true;
        }
        cg.add(glass);
        if (gh > 0.55) {
          const hBar = new THREE.Mesh(
            createTimberBoxGeometry(gw, 0.016, 0.018, {
              grainAxis: 'x',
              material: frameMat,
              seed: [...openingSeed, leafName, 'astragal'],
            }),
            frameMat
          );
          hBar.name = `${leafName}.astragal`;
          hBar.position.set(0, lh * 0.5, 0);
          cg.add(hBar);
        }
        return cg;
      };

      if (twoLeaves) {
        const lw = innerClearW * 0.5 - 0.004;
        const leftLeaf = buildCasementLeaf(`${req.id}.casement_left`, lw, casementH);
        leftLeaf.position.set(-(lw * 0.5 + 0.001), casementY0, zCasement);
        openingGroup.add(leftLeaf);

        const rightLeaf = buildCasementLeaf(`${req.id}.casement_right`, lw, casementH);
        rightLeaf.position.set(lw * 0.5 + 0.001, casementY0, zCasement);
        openingGroup.add(rightLeaf);

        if (cutawayWall) {
          tagCutaway(openingGroup, cutawayWall, { recursive: true });
        }
        openingGroup.updateMatrixWorld(true);

        if (interactions) {
          const pL = registerHingedDoor(interactions, {
            parent: openingGroup,
            door: leftLeaf,
            hingeOffset: [-lw * 0.5, 0, 0],
            axis: 'y',
            openAngle: Math.PI * 0.42,
          });
          const pR = registerHingedDoor(interactions, {
            parent: openingGroup,
            door: rightLeaf,
            hingeOffset: [lw * 0.5, 0, 0],
            axis: 'y',
            openAngle: -Math.PI * 0.42,
          });
          interactions.linkDoorPair(pL, pR);
          casementPivots.push(pL, pR);
        }
      } else {
        const lw = innerClearW - 0.006;
        const singleLeaf = buildCasementLeaf(`${req.id}.casement`, lw, casementH);
        singleLeaf.position.set(0, casementY0, zCasement);
        openingGroup.add(singleLeaf);

        if (cutawayWall) {
          tagCutaway(openingGroup, cutawayWall, { recursive: true });
        }
        openingGroup.updateMatrixWorld(true);

        if (interactions) {
          const p = registerHingedDoor(interactions, {
            parent: openingGroup,
            door: singleLeaf,
            hingeOffset: [-lw * 0.5, 0, 0],
            axis: 'y',
            openAngle: Math.PI * 0.42,
          });
          casementPivots.push(p);
        }
      }

      const boardHalfReach = boardSpan * 0.5;
      let dadoGap: SkirtingGap | undefined;
      if (sillY <= 1.35) {
        dadoGap = buildGapBoxXZ(
          wall,
          uCenter - boardHalfReach - GAP_CLEARANCE_M,
          uCenter + boardHalfReach + GAP_CLEARANCE_M,
          0.06
        );
        emittedDadoGaps.push(dadoGap);
      }

      builtOpenings.push({
        id: req.id,
        wallId: wall.id,
        kind,
        centerAlongM: uCenter,
        width,
        height,
        sillY,
        group: openingGroup,
        doorPivots: casementPivots,
        ...(dadoGap ? { dadoGap } : {}),
        ...(cutawayWall ? { cutawayWall } : {}),
        getAcousticPortalState: () => {
          if (wall.kind !== 'exterior') return null;
          const piv = casementPivots[0];
          const openness = piv ? Math.min(1, Math.abs(piv.rotation.y) / (Math.PI * 0.42)) : 0;
          return {
            id: req.id,
            position: [worldX, worldY + height * 0.5, worldZ],
            areaM2: innerClearW * casementH,
            openness,
          };
        },
      });
      continue;
    }

    // Doorways & Cased Portals: 'hinged-door' | 'double-door' | 'cased-portal'
    const archW = spec.architraveWidthM ?? DEFAULT_ARCHITRAVE_WIDTH_M;
    const archT = spec.architraveThicknessM ?? DEFAULT_ARCHITRAVE_THICKNESS_M;
    const plinthH = spec.plinthHeightM ?? DEFAULT_PLINTH_HEIGHT_M;
    const plinthT = spec.plinthThicknessM ?? DEFAULT_PLINTH_THICKNESS_M;

    const defaultThresholdStyle: DoorThresholdStyle =
      sillY <= 1e-4 ? (kind === 'cased-portal' ? 'none' : 'oak') : 'none';
    const thresholdStyle = spec.threshold ?? defaultThresholdStyle;
    const hasThreshold = sillY <= 1e-4 && thresholdStyle !== 'none';
    const thresholdH = hasThreshold ? 0.014 : 0;

    const doorOpeningSeed = [worldX, worldY, worldZ, req.id] as const;
    if (hasThreshold) {
      const threshMat =
        spec.thresholdMaterial ??
        getThresholdMaterial(thresholdStyle as Exclude<DoorThresholdStyle, 'none'>);
      const saddleClearW = Math.max(0.18, width - 2 * (liningT + 2 * EPS_M));
      const saddle = new THREE.Mesh(
        createTimberBoxGeometry(
          saddleClearW,
          thresholdH,
          Math.max(0.04, wall.thickness - 2 * EPS_M),
          {
            grainAxis: 'x',
            material: threshMat,
            seed: [...doorOpeningSeed, 'thresholdSaddle'],
          }
        ),
        threshMat
      );
      saddle.name = `${req.id}.thresholdSaddle`;
      saddle.position.set(0, EPS_M + thresholdH * 0.5, 0);
      saddle.receiveShadow = true;
      saddle.castShadow = false;
      tagCollisionRole(saddle, 'ignore');
      openingGroup.add(saddle);
    }

    // Plaster/timber reveal linings across jambs & head (+0.6 mm inset from raw wall cut & ±wall faces)
    const jambY0 = hasThreshold ? EPS_M + thresholdH + EPS_M : EPS_M;
    const jambY1 = height - EPS_M;
    const jambH = Math.max(0.2, jambY1 - jambY0);
    for (const s of [-1, 1] as const) {
      const jamb = new THREE.Mesh(
        createTimberBoxGeometry(liningT, jambH, liningDepth, {
          grainAxis: 'y',
          material: frameMat,
          seed: [...doorOpeningSeed, 'revealJamb', s],
        }),
        frameMat
      );
      jamb.name = `${req.id}.revealLining_${s < 0 ? 'left' : 'right'}`;
      jamb.position.set(s * (halfW - EPS_M - liningT * 0.5), (jambY0 + jambY1) * 0.5, 0);
      jamb.castShadow = true;
      jamb.receiveShadow = true;
      tagCollisionRole(jamb, 'ignore');
      openingGroup.add(jamb);
    }

    const innerHalfW = halfW - EPS_M - liningT;
    const clearW = Math.max(0.2, innerHalfW * 2);
    const headLining = new THREE.Mesh(
      createTimberBoxGeometry(clearW - 2 * EPS_M, liningT, liningDepth, {
        grainAxis: 'x',
        material: frameMat,
        seed: [...doorOpeningSeed, 'revealHead'],
      }),
      frameMat
    );
    headLining.name = `${req.id}.revealLining_head`;
    headLining.position.set(0, jambY1 - liningT * 0.5, 0);
    headLining.castShadow = true;
    tagCollisionRole(headLining, 'ignore');
    openingGroup.add(headLining);

    // 3-sided mitred architraves + 168 x 28 mm pedestal plinth blocks on both wall faces
    // with automatic leg-width ripping when < architraveWidth from an intersecting perpendicular corner!
    const archSidesMode = spec.architraveSides ?? 'both';
    const faceSigns: readonly (1 | -1)[] =
      archSidesMode === 'none' ? [] : archSidesMode === 'interior' ? [1] : [1, -1];

    let maxLeftPlinthOuterFromCenter = halfW;
    let maxRightPlinthOuterFromCenter = halfW;
    let maxLeftArchOuterFromCenter = halfW;
    let maxRightArchOuterFromCenter = halfW;

    for (const faceSign of faceSigns) {
      const [uFaceMin, uFaceMax] =
        faceSign > 0 ? wall.innerFaceClearSpanAt(uCenter) : wall.outerFaceClearSpanAt(uCenter);

      // Clear distance from raw jambs (uCenter ± halfW) to nearest perpendicular wall face
      const clearNegU = Math.max(0.008, uCenter - halfW - uFaceMin - GAP_CLEARANCE_M);
      const clearPosU = Math.max(0.008, uFaceMax - (uCenter + halfW) - GAP_CLEARANCE_M);
      const clearLocalLeft = xAlongSign > 0 ? clearNegU : clearPosU;
      const clearLocalRight = xAlongSign > 0 ? clearPosU : clearNegU;

      // Full architrave leg spans from x = innerHalfW outward by archW (so outer reach past halfW is archW - liningT - EPS_M)
      const maxLeftLegW = clearLocalLeft + (halfW - innerHalfW);
      const maxRightLegW = clearLocalRight + (halfW - innerHalfW);
      const rippedLeftArchW = Math.max(0.012, Math.min(archW, maxLeftLegW));
      const rippedRightArchW = Math.max(0.012, Math.min(archW, maxRightLegW));

      const fullPlinthW = archW + PLINTH_PROUD_WIDTH_M;
      const rippedLeftPlinthW = Math.max(rippedLeftArchW, Math.min(fullPlinthW, maxLeftLegW));
      const rippedRightPlinthW = Math.max(rippedRightArchW, Math.min(fullPlinthW, maxRightLegW));

      const sideLabel = faceSign > 0 ? 'int' : 'ext';
      const zBack = faceSign * (halfT + EPS_M);
      const zPlinthFront = faceSign * (halfT + EPS_M + plinthT);
      const zArchFront = faceSign * (halfT + EPS_M + archT);

      // Left & Right 168 x 28 mm pedestal plinth blocks (sitting at Y in [EPS_M, plinthH])
      const plinthSpanY = Math.max(0.04, plinthH - EPS_M);
      const leftPlinth = new THREE.Mesh(
        createTimberBoxGeometry(rippedLeftPlinthW, plinthSpanY, plinthT, {
          grainAxis: 'y',
          material: archMat,
          seed: [...doorOpeningSeed, 'plinthL', faceSign],
        }),
        archMat
      );
      leftPlinth.name = `${req.id}.plinthBlock_${sideLabel}_left`;
      leftPlinth.position.set(
        -(innerHalfW + rippedLeftPlinthW * 0.5),
        EPS_M + plinthSpanY * 0.5,
        (zBack + zPlinthFront) * 0.5
      );
      leftPlinth.castShadow = true;
      leftPlinth.receiveShadow = true;
      tagCollisionRole(leftPlinth, 'ignore');
      openingGroup.add(leftPlinth);

      const rightPlinth = new THREE.Mesh(
        createTimberBoxGeometry(rippedRightPlinthW, plinthSpanY, plinthT, {
          grainAxis: 'y',
          material: archMat,
          seed: [...doorOpeningSeed, 'plinthR', faceSign],
        }),
        archMat
      );
      rightPlinth.name = `${req.id}.plinthBlock_${sideLabel}_right`;
      rightPlinth.position.set(
        innerHalfW + rippedRightPlinthW * 0.5,
        EPS_M + plinthSpanY * 0.5,
        (zBack + zPlinthFront) * 0.5
      );
      rightPlinth.castShadow = true;
      rightPlinth.receiveShadow = true;
      tagCollisionRole(rightPlinth, 'ignore');
      openingGroup.add(rightPlinth);

      // 3-sided mitred architrave starting 0.6 mm above plinth blocks
      const archGeo = buildMitredArchitraveGeometry({
        innerHalfW,
        leftWidth: rippedLeftArchW,
        rightWidth: rippedRightArchW,
        headWidth: archW,
        legBottomY: plinthH + EPS_M,
        innerTopY: jambY1 - liningT,
        zBack,
        zFront: zArchFront,
        material: archMat,
        seed: [...doorOpeningSeed, 'arch', faceSign],
      });
      const archMesh = new THREE.Mesh(archGeo, archMat);
      archMesh.name = `${req.id}.architrave_${sideLabel}`;
      archMesh.castShadow = true;
      archMesh.receiveShadow = true;
      tagCollisionRole(archMesh, 'ignore');
      openingGroup.add(archMesh);

      maxLeftPlinthOuterFromCenter = Math.max(
        maxLeftPlinthOuterFromCenter,
        innerHalfW + rippedLeftPlinthW
      );
      maxRightPlinthOuterFromCenter = Math.max(
        maxRightPlinthOuterFromCenter,
        innerHalfW + rippedRightPlinthW
      );
      maxLeftArchOuterFromCenter = Math.max(
        maxLeftArchOuterFromCenter,
        innerHalfW + rippedLeftPlinthW
      );
      maxRightArchOuterFromCenter = Math.max(
        maxRightArchOuterFromCenter,
        innerHalfW + rippedRightPlinthW
      );
    }

    // Door leaves, rebate stops, hinge registration & acoustic portal wiring
    const doorPivots: THREE.Group[] = [];
    const swingTowards = spec.swingTowards ?? 'interior';
    const swingFaceSign = swingTowards === 'interior' ? 1 : -1;
    const leafStyle: DoorLeafStyle = spec.leafStyle ?? 'four-panel';
    const openAngleMag = Math.abs(spec.openAngle ?? Math.PI * 0.48);

    if (kind === 'hinged-door' || kind === 'double-door') {
      // Flush-mounted door plane on the swing side of the reveal
      const maxLeafCenterZ = Math.max(0, halfT - DOOR_LEAF_THICKNESS_M * 0.5 - 0.012);
      const zLeafCenter = swingFaceSign * maxLeafCenterZ;

      // Rebate door stops behind closed leaf (+0.6 mm clear of leaf back & reveal linings)
      const stopT = 0.012;
      const stopD = 0.032;
      const zStopCenter =
        zLeafCenter - swingFaceSign * (DOOR_LEAF_THICKNESS_M * 0.5 + stopD * 0.5 + EPS_M);
      if (Math.abs(zStopCenter) + stopD * 0.5 < halfT - EPS_M) {
        const stopTopY = jambY1 - liningT - EPS_M;
        const stopH = Math.max(0.2, stopTopY - jambY0);
        for (const s of [-1, 1] as const) {
          const jStop = new THREE.Mesh(
            createTimberBoxGeometry(stopT, stopH, stopD, {
              grainAxis: 'y',
              material: frameMat,
              seed: [...doorOpeningSeed, 'doorStop', s],
            }),
            frameMat
          );
          jStop.name = `${req.id}.doorStop_${s < 0 ? 'left' : 'right'}`;
          jStop.position.set(s * (innerHalfW - EPS_M - stopT * 0.5), (jambY0 + stopTopY) * 0.5, zStopCenter);
          tagCollisionRole(jStop, 'ignore');
          openingGroup.add(jStop);
        }
        const hStopSpan = Math.max(0.1, clearW - 2 * (stopT + 2 * EPS_M));
        const hStop = new THREE.Mesh(
          createTimberBoxGeometry(hStopSpan, stopT, stopD, {
            grainAxis: 'x',
            material: frameMat,
            seed: [...doorOpeningSeed, 'doorStopHead'],
          }),
          frameMat
        );
        hStop.name = `${req.id}.doorStop_head`;
        hStop.position.set(0, stopTopY - stopT * 0.5, zStopCenter);
        tagCollisionRole(hStop, 'ignore');
        openingGroup.add(hStop);
      }

      const leafY0 = hasThreshold ? EPS_M + thresholdH + 0.002 : 0.006;
      const leafTopY = jambY1 - liningT - 0.003;
      const leafH = Math.max(0.4, leafTopY - leafY0);
      const isExteriorDoor = wall.kind === 'exterior';

      if (kind === 'hinged-door') {
        const hingeSide = spec.hingeSide ?? 'left';
        const leafW = Math.max(0.25, clearW - 0.006);
        const leafGroup = buildArchitecturalDoorLeaf({
          namePrefix: `${req.id}.doorLeaf`,
          width: leafW,
          height: leafH,
          thickness: DOOR_LEAF_THICKNESS_M,
          style: leafStyle,
          handleSide: hingeSide === 'left' ? 'right' : 'left',
          isExteriorGlazed: isExteriorDoor,
          doorMat,
          glassMat,
          hardwareMat,
          seed: [...doorOpeningSeed, 'singleLeaf'],
        });
        leafGroup.position.set(0, leafY0, zLeafCenter);
        openingGroup.add(leafGroup);

        if (cutawayWall) {
          tagCutaway(openingGroup, cutawayWall, { recursive: true });
        }
        network.group.updateMatrixWorld(true);
        openingGroup.updateMatrixWorld(true);

        // Hinge rotation sign:
        // In openingGroup local frame (+Z = interior, +X = right):
        // Rotating by +theta around +Y moves (+X, 0) -> (+X cos, -X sin) (towards -Z!).
        // So for left-hinged door (leaf extends along +X from hinge at -leafW/2):
        //   swinging toward +Z (swingFaceSign = +1) requires NEGATIVE rotation.y (-openAngleMag)!
        // For right-hinged door (leaf extends along -X from hinge at +leafW/2):
        //   swinging toward +Z (swingFaceSign = +1) requires POSITIVE rotation.y (+openAngleMag)!
        const hingeX = hingeSide === 'left' ? -leafW * 0.5 : leafW * 0.5;
        const hingeZ = swingFaceSign * (DOOR_LEAF_THICKNESS_M * 0.5);
        const signedOpenAngle =
          (hingeSide === 'left' ? -1 : 1) * swingFaceSign * openAngleMag;

        if (interactions) {
          const pivot = registerHingedDoor(interactions, {
            parent: openingGroup,
            door: leafGroup,
            hingeOffset: [hingeX, 0, hingeZ],
            axis: 'y',
            openAngle: signedOpenAngle,
            ...(spec.initialAngle !== undefined ? { initialAngle: spec.initialAngle } : {}),
          });
          pivot.name = `${req.id}.pivot`;
          pivot.updateMatrixWorld(true);
          doorPivots.push(pivot);
        }
      } else {
        // 'double-door': synchronized French / Georgian double leaves
        const leafW = Math.max(0.2, clearW * 0.5 - 0.004);
        const leftLeaf = buildArchitecturalDoorLeaf({
          namePrefix: `${req.id}.doorLeaf_left`,
          width: leafW,
          height: leafH,
          thickness: DOOR_LEAF_THICKNESS_M,
          style: leafStyle,
          handleSide: 'right',
          isExteriorGlazed: isExteriorDoor,
          doorMat,
          glassMat,
          hardwareMat,
          seed: [...doorOpeningSeed, 'leftLeaf'],
        });
        leftLeaf.position.set(-(leafW * 0.5 + 0.001), leafY0, zLeafCenter);
        openingGroup.add(leftLeaf);

        const rightLeaf = buildArchitecturalDoorLeaf({
          namePrefix: `${req.id}.doorLeaf_right`,
          width: leafW,
          height: leafH,
          thickness: DOOR_LEAF_THICKNESS_M,
          style: leafStyle,
          handleSide: 'left',
          isExteriorGlazed: isExteriorDoor,
          doorMat,
          glassMat,
          hardwareMat,
          seed: [...doorOpeningSeed, 'rightLeaf'],
        });
        rightLeaf.position.set(leafW * 0.5 + 0.001, leafY0, zLeafCenter);
        openingGroup.add(rightLeaf);

        if (cutawayWall) {
          tagCutaway(openingGroup, cutawayWall, { recursive: true });
        }
        network.group.updateMatrixWorld(true);
        openingGroup.updateMatrixWorld(true);

        const hingeZ = swingFaceSign * (DOOR_LEAF_THICKNESS_M * 0.5);
        if (interactions) {
          const pivotL = registerHingedDoor(interactions, {
            parent: openingGroup,
            door: leftLeaf,
            hingeOffset: [-leafW * 0.5, 0, hingeZ],
            axis: 'y',
            openAngle: -swingFaceSign * openAngleMag,
            ...(spec.initialAngle !== undefined ? { initialAngle: spec.initialAngle } : {}),
          });
          pivotL.name = `${req.id}.pivot_left`;

          const pivotR = registerHingedDoor(interactions, {
            parent: openingGroup,
            door: rightLeaf,
            hingeOffset: [leafW * 0.5, 0, hingeZ],
            axis: 'y',
            openAngle: swingFaceSign * openAngleMag,
            ...(spec.initialAngle !== undefined
              ? { initialAngle: -spec.initialAngle }
              : {}),
          });
          pivotR.name = `${req.id}.pivot_right`;

          interactions.linkDoorPair(pivotL, pivotR);
          pivotL.updateMatrixWorld(true);
          pivotR.updateMatrixWorld(true);
          doorPivots.push(pivotL, pivotR);
        }
      }
    } else if (cutawayWall) {
      // 'cased-portal' on an exterior wall
      tagCutaway(openingGroup, cutawayWall, { recursive: true });
      openingGroup.updateMatrixWorld(true);
    }

    // Compute exact outer uMin / uMax of plinth blocks (+ 0.5 mm clearance) for skirtingGaps & dadoGaps
    const negUPlinthReach =
      xAlongSign > 0 ? maxLeftPlinthOuterFromCenter : maxRightPlinthOuterFromCenter;
    const posUPlinthReach =
      xAlongSign > 0 ? maxRightPlinthOuterFromCenter : maxLeftPlinthOuterFromCenter;
    const negUArchReach =
      xAlongSign > 0 ? maxLeftArchOuterFromCenter : maxRightArchOuterFromCenter;
    const posUArchReach =
      xAlongSign > 0 ? maxRightArchOuterFromCenter : maxLeftArchOuterFromCenter;

    let skirtingGap: SkirtingGap | undefined;
    let dadoGap: SkirtingGap | undefined;
    if (sillY <= 0.2) {
      skirtingGap = buildGapBoxXZ(
        wall,
        uCenter - negUPlinthReach - GAP_CLEARANCE_M,
        uCenter + posUPlinthReach + GAP_CLEARANCE_M,
        plinthT + 0.03
      );
      emittedSkirtingGaps.push(skirtingGap);
    }
    if (sillY <= 1.25) {
      dadoGap = buildGapBoxXZ(
        wall,
        uCenter - negUArchReach - GAP_CLEARANCE_M,
        uCenter + posUArchReach + GAP_CLEARANCE_M,
        plinthT + 0.03
      );
      emittedDadoGaps.push(dadoGap);
    }

    builtOpenings.push({
      id: req.id,
      wallId: wall.id,
      kind,
      centerAlongM: uCenter,
      width,
      height,
      sillY,
      group: openingGroup,
      doorPivots,
      ...(skirtingGap ? { skirtingGap } : {}),
      ...(dadoGap ? { dadoGap } : {}),
      ...(cutawayWall ? { cutawayWall } : {}),
      getAcousticPortalState: () => {
        if (wall.kind !== 'exterior') return null;
        if (kind === 'cased-portal') {
          return {
            id: req.id,
            position: [worldX, worldY + height * 0.5, worldZ],
            areaM2: clearW * jambH,
            openness: 1,
          };
        }
        const primaryPivot = doorPivots[0];
        const closedRot = spec.initialAngle ?? 0;
        const currentRot = primaryPivot ? primaryPivot.rotation.y : closedRot;
        const openness =
          openAngleMag > 1e-4
            ? Math.min(1, Math.max(0, Math.abs(currentRot - closedRot) / openAngleMag))
            : 0;
        return {
          id: req.id,
          position: [worldX, worldY + height * 0.5, worldZ],
          areaM2: clearW * jambH,
          openness,
        };
      },
    });
  }

  network._registerBuiltOpenings?.(builtOpenings, emittedSkirtingGaps, emittedDadoGaps);
  return builtOpenings;
}
