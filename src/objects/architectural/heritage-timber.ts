import * as THREE from 'three';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import {
  AGED_TIMBER_PROFILES,
  type AgedTimberBeamGeometryOptions,
  type AgedTimberBoxBeamOptions,
  type AgedTimberProfileId,
  type AgedTimberProfileSpec,
  createAgedTimberBeamGeometry,
  createAgedTimberBoxBeamGeometry,
  createPlasterBeamHaunchGeometry,
  type PlasterBeamHaunchGeometryOptions,
  type TimberFaceId,
} from '../../engine/geometry/aged-timber-beam.ts';
import { tagCutaway } from '../../engine/geometry/mesh-traits.ts';
import type { TimberSeedInput } from '../../engine/geometry/timber-piece-uvs.ts';
import { getCharacterOakMaterial } from '../shared/neptune-and-georgian-materials.ts';

export {
  AGED_TIMBER_PROFILES,
  createAgedTimberBeamGeometry,
  createAgedTimberBoxBeamGeometry,
  createPlasterBeamHaunchGeometry,
  type AgedTimberBeamGeometryOptions,
  type AgedTimberBoxBeamOptions,
  type AgedTimberProfileId,
  type AgedTimberProfileSpec,
  type PlasterBeamHaunchGeometryOptions,
  type TimberFaceId,
};

export interface PlasterBeamHaunchAttachment {
  /** Which junction faces/sides along the beam receive a lime-plaster haunch strip. */
  readonly sides: readonly ('left' | 'right' | 'top' | 'bottom')[];
  /** Which host face of the beam meets the plaster plane (`default: 'top'` for ceiling beams). */
  readonly hostFace?: TimberFaceId;
  readonly material: THREE.Material;
  readonly reachM?: number;
  readonly climbM?: number;
  readonly segments?: number;
  readonly tileM?: number;
}

export interface CreateAgedTimberBeamOptions extends Omit<AgedTimberBeamGeometryOptions, 'material'> {
  readonly name?: string;
  readonly parent?: THREE.Object3D;
  readonly material?: THREE.Material;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  readonly zone?: string;
  readonly cutawayWall?: CutawayWallDescriptor;
  readonly isArchitecturalShell?: boolean;
  readonly plasterHaunch?: PlasterBeamHaunchAttachment;
}

export interface AgedTimberBeamBuildResult {
  readonly mesh: THREE.Mesh;
  readonly haunches: readonly THREE.Mesh[];
  /** Root node added to `parent` (`mesh` when no haunches are attached, or a container `THREE.Group` holding `mesh` + `haunches`). */
  readonly root: THREE.Object3D;
}

export interface AgedJoistSpecOverride {
  /** Center coordinate along `layoutAxis` (`X` when joists span `Z`, or `Z` when joists span `X`). */
  readonly coord?: number;
  /** Optional per-joist start coordinate along `spanAxis` (overrides bay `spanStart`). */
  readonly spanStart?: number;
  /** Optional per-joist end coordinate along `spanAxis` (overrides bay `spanEnd`). */
  readonly spanEnd?: number;
  /** Optional per-joist center Y override (overrides bay `centerY`). */
  readonly centerY?: number;
  /** Optional per-joist width override. */
  readonly width?: number;
  /** Optional per-joist height override. */
  readonly height?: number;
  /** Optional explicit mesh name (defaults to `formatName(index)` or `${namePrefix}.${index + 1}`). */
  readonly name?: string;
  /** Optional explicit seed override (defaults to `${bayId}:${index}`). */
  readonly seed?: TimberSeedInput;
}

export interface CreateAgedJoistBayOptions {
  /** Unique bay identifier used to derive distinct deterministic per-joist seeds `${bayId}:${index}`. */
  readonly bayId: string;
  /** Axis along which each individual joist spans (`'z'` -> joists run parallel to Z, spaced along X; `'x'` -> joists run parallel to X, spaced along Z). */
  readonly spanAxis: 'x' | 'z';
  /** Start coordinate along `spanAxis` (metres). */
  readonly spanStart: number;
  /** End coordinate along `spanAxis` (metres). */
  readonly spanEnd: number;
  /** Joist cross-sectional horizontal width (metres). */
  readonly joistWidth: number;
  /** Joist cross-sectional vertical depth/height (metres). */
  readonly joistHeight: number;
  /** Center Y elevation of joists (or pass `topY` instead). */
  readonly centerY?: number;
  /** Optional top Y elevation of joists (`centerY = topY - joistHeight * 0.5`). */
  readonly topY?: number;
  /** Explicit joist coordinates along the perpendicular layout axis (or specify `layoutStart` + `layoutEnd` + `count` / `spacing`). */
  readonly coords?: readonly number[];
  readonly layoutStart?: number;
  readonly layoutEnd?: number;
  readonly count?: number;
  readonly spacing?: number;
  /** Optional per-joist overrides (for chimney-breast trimmers, stairwell cut-backs, or angled wall tapers). */
  readonly overrides?: Readonly<Record<number, AgedJoistSpecOverride>> | readonly (AgedJoistSpecOverride | undefined)[];
  readonly profile?: AgedTimberProfileId;
  /** Defaults to `true` so nominal bounding boxes match exact IEEE-754 bounds (`0.000 mm` outer drift). */
  readonly preserveOuterAabb?: boolean;
  /** Defaults to `['top']` for ceiling joists embedded into plasterboard/lath above. */
  readonly omitEmbeddedFaces?: readonly TimberFaceId[];
  readonly exposedCorners?: readonly [boolean, boolean, boolean, boolean];
  readonly material?: THREE.Material;
  readonly parent?: THREE.Object3D;
  readonly namePrefix?: string;
  readonly formatName?: (index: number) => string;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  readonly zone?: string;
  readonly cutawayWall?: CutawayWallDescriptor;
}

export interface AgedJoistBayResult {
  readonly group: THREE.Group;
  readonly joists: readonly THREE.Mesh[];
}

export type AgedRoofTrussKind = 'king-post' | 'collar' | 'simple-a-frame';

export interface CreateAgedRoofTrussOptions {
  readonly id?: string;
  readonly name?: string;
  readonly kind?: AgedRoofTrussKind;
  /** Clear or outer span of the truss tie-beam in metres. */
  readonly span: number;
  /** Vertical rise from tie-beam top (or soffit) to ridge apex in metres. */
  readonly rise: number;
  /** Local/world placement of truss center at tie-beam soffit (`default: [0, 0, 0]`). */
  readonly position?: readonly [number, number, number];
  /** Truss plane axis: `'x'` means truss spans along X (`[-span/2, +span/2]`); `'z'` means truss spans along Z (`[-span/2, +span/2]`). Default `'x'`. */
  readonly spanAxis?: 'x' | 'z';
  readonly rotationY?: number;
  readonly tieBeamSize?: readonly [number, number]; // [thickness, height]
  readonly rafterSize?: readonly [number, number]; // [thickness, depth]
  readonly kingPostSize?: readonly [number, number]; // [thickness, widthInPlane]
  readonly strutSize?: readonly [number, number]; // [thickness, depth]
  readonly collarElevationFrac?: number; // for 'collar' kind, default 0.52
  readonly includeStruts?: boolean;
  readonly includeKneeBraces?: boolean;
  readonly kneeBraceDropM?: number;
  readonly profile?: AgedTimberProfileId;
  /** Defaults to `true` on `tieBeam` so top-mounted track/spotlights seat flush to `0.000 mm`. */
  readonly preserveTieBeamOuterAabb?: boolean;
  readonly seed?: TimberSeedInput;
  readonly material?: THREE.Material;
  readonly parent?: THREE.Object3D;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  readonly zone?: string;
  readonly cutawayWall?: CutawayWallDescriptor;
}

export interface AgedRoofTrussResult {
  readonly group: THREE.Group;
  readonly tieBeam?: THREE.Mesh;
  readonly leftRafter: THREE.Mesh;
  readonly rightRafter: THREE.Mesh;
  readonly kingPost?: THREE.Mesh;
  readonly collarBeam?: THREE.Mesh;
  readonly struts: readonly THREE.Mesh[];
  readonly kneeBraces: readonly THREE.Mesh[];
  readonly members: readonly THREE.Mesh[];
}

function buildBeamFrameAxes(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  upHint?: readonly [number, number, number]
): {
  readonly pStart: THREE.Vector3;
  readonly pEnd: THREE.Vector3;
  readonly tDir: THREE.Vector3;
  readonly uDir: THREE.Vector3;
  readonly vDir: THREE.Vector3;
} {
  const pStart = new THREE.Vector3(start[0], start[1], start[2]);
  const pEnd = new THREE.Vector3(end[0], end[1], end[2]);
  const axisVec = new THREE.Vector3().subVectors(pEnd, pStart);
  const span = Math.max(0.02, axisVec.length());
  const tDir =
    axisVec.lengthSq() > 1e-12
      ? axisVec.clone().divideScalar(span)
      : new THREE.Vector3(1, 0, 0);
  const upRef = upHint
    ? new THREE.Vector3(upHint[0], upHint[1], upHint[2]).normalize()
    : new THREE.Vector3(0, 1, 0);
  if (Math.abs(tDir.dot(upRef)) > 0.98) {
    upRef.set(0, 0, 1);
    if (Math.abs(tDir.dot(upRef)) > 0.98) upRef.set(1, 0, 0);
  }
  const uDir = new THREE.Vector3().crossVectors(upRef, tDir).normalize();
  const vDir = new THREE.Vector3().crossVectors(tDir, uDir).normalize();
  return { pStart, pEnd, tDir, uDir, vDir };
}

/**
 * Creates a procedural aged structural timber beam `THREE.Mesh` (plus optional angled
 * lime-plaster haunch strips) with deterministic per-beam grain UVs and localized edge character.
 */
export function createAgedTimberBeam(
  options: CreateAgedTimberBeamOptions
): AgedTimberBeamBuildResult {
  const profile: AgedTimberProfileId = options.profile ?? 'cottage-spine-beam';
  const mat = options.material ?? getCharacterOakMaterial();
  const beamName = options.name ?? 'agedTimberBeam';

  const geo = createAgedTimberBeamGeometry({
    ...options,
    profile,
    material: mat,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = beamName;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.userData.heritageFabric = {
    role: 'aged-timber',
    profile,
    seed: options.seed,
  };
  if (options.isArchitecturalShell) {
    mesh.userData.isArchitecturalShell = true;
  }
  if (options.zone) {
    mesh.userData.zone = options.zone;
  }
  if (options.cutawayWall) {
    tagCutaway(mesh, options.cutawayWall);
  }

  const haunches: THREE.Mesh[] = [];
  if (options.plasterHaunch && options.plasterHaunch.sides.length > 0) {
    const haunchCfg = options.plasterHaunch;
    const hostFace: TimberFaceId = haunchCfg.hostFace ?? 'top';
    const { pStart, pEnd, uDir, vDir } = buildBeamFrameAxes(
      options.start,
      options.end,
      options.upHint
    );
    const halfU0 = options.width * 0.5;
    const halfU1 = (options.endWidth ?? options.width) * 0.5;
    const halfV0 = options.height * 0.5;
    const halfV1 = (options.endHeight ?? options.height) * 0.5;

    // Room-facing surface normal of the host plaster plane
    const hostSurfaceNormal =
      hostFace === 'top'
        ? vDir.clone().negate()
        : hostFace === 'bottom'
          ? vDir.clone()
          : hostFace === 'right'
            ? uDir.clone().negate()
            : uDir.clone();

    for (const side of haunchCfg.sides) {
      let edgeStart: THREE.Vector3;
      let edgeEnd: THREE.Vector3;
      let intoTimber: THREE.Vector3;

      if (hostFace === 'top' || hostFace === 'bottom') {
        const vSign = hostFace === 'top' ? 1 : -1;
        const uSign = side === 'right' ? 1 : -1;
        edgeStart = pStart
          .clone()
          .addScaledVector(vDir, vSign * halfV0)
          .addScaledVector(uDir, uSign * halfU0);
        edgeEnd = pEnd
          .clone()
          .addScaledVector(vDir, vSign * halfV1)
          .addScaledVector(uDir, uSign * halfU1);
        intoTimber = uDir.clone().multiplyScalar(-uSign);
      } else {
        const uSign = hostFace === 'right' ? 1 : -1;
        const vSign = side === 'top' ? 1 : -1;
        edgeStart = pStart
          .clone()
          .addScaledVector(uDir, uSign * halfU0)
          .addScaledVector(vDir, vSign * halfV0);
        edgeEnd = pEnd
          .clone()
          .addScaledVector(uDir, uSign * halfU1)
          .addScaledVector(vDir, vSign * halfV1);
        intoTimber = vDir.clone().multiplyScalar(-vSign);
      }

      const hGeo = createPlasterBeamHaunchGeometry({
        start: [edgeStart.x, edgeStart.y, edgeStart.z],
        end: [edgeEnd.x, edgeEnd.y, edgeEnd.z],
        surfaceNormal: [hostSurfaceNormal.x, hostSurfaceNormal.y, hostSurfaceNormal.z],
        intoTimberDir: [intoTimber.x, intoTimber.y, intoTimber.z],
        seed: [options.seed, 'haunch', hostFace, side],
        ...(haunchCfg.reachM !== undefined ? { reachM: haunchCfg.reachM } : {}),
        ...(haunchCfg.climbM !== undefined ? { climbM: haunchCfg.climbM } : {}),
        ...(haunchCfg.segments !== undefined ? { segments: haunchCfg.segments } : {}),
        ...(haunchCfg.tileM !== undefined ? { tileM: haunchCfg.tileM } : {}),
      });
      const hMesh = new THREE.Mesh(hGeo, haunchCfg.material);
      hMesh.name = `${beamName}.plasterHaunch.${side}`;
      hMesh.castShadow = false;
      hMesh.receiveShadow = options.receiveShadow ?? true;
      hMesh.userData.heritageFabric = {
        role: 'plaster-haunch',
        side,
        seed: options.seed,
      };
      if (options.isArchitecturalShell) {
        hMesh.userData.isArchitecturalShell = true;
      }
      if (options.zone) {
        hMesh.userData.zone = options.zone;
      }
      if (options.cutawayWall) {
        tagCutaway(hMesh, options.cutawayWall);
      }
      haunches.push(hMesh);
    }
  }

  let root: THREE.Object3D = mesh;
  if (haunches.length > 0) {
    const group = new THREE.Group();
    group.name = `${beamName}.assembly`;
    if (options.zone) group.userData.zone = options.zone;
    if (options.isArchitecturalShell) group.userData.isArchitecturalShell = true;
    group.add(mesh);
    for (const h of haunches) group.add(h);
    root = group;
  }

  if (options.parent) {
    options.parent.add(root);
  }

  return { mesh, haunches, root };
}

function resolveJoistLayoutCoords(options: CreateAgedJoistBayOptions): readonly number[] {
  if (options.coords && options.coords.length > 0) {
    return options.coords;
  }
  const start = options.layoutStart ?? 0;
  const end = options.layoutEnd ?? start;
  if (options.count !== undefined && options.count > 0) {
    if (options.count === 1) return [(start + end) * 0.5];
    const out: number[] = [];
    for (let i = 0; i < options.count; i++) {
      out.push(THREE.MathUtils.lerp(start, end, i / (options.count - 1)));
    }
    return out;
  }
  const step = Math.max(0.08, options.spacing ?? 0.42);
  const span = Math.abs(end - start);
  const n = Math.max(1, Math.round(span / step) + 1);
  if (n === 1) return [start];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(THREE.MathUtils.lerp(start, end, i / (n - 1)));
  }
  return out;
}

/**
 * Builds a bay of exposed ceiling joists where every joist receives a distinct deterministic
 * seed (`${bayId}:${i}`), distinct grain UV offset, and distinct localized edge knicks while
 * preserving exact nominal outer bounding boxes (`preserveOuterAabb: true` default).
 */
export function createAgedJoistBay(options: CreateAgedJoistBayOptions): AgedJoistBayResult {
  const coords = resolveJoistLayoutCoords(options);
  const profile: AgedTimberProfileId = options.profile ?? 'cottage-ceiling-joist';
  const preserveOuterAabb = options.preserveOuterAabb ?? true;
  const omitEmbeddedFaces = options.omitEmbeddedFaces ?? (['top'] as const);
  const mat = options.material ?? getCharacterOakMaterial();
  const baseCenterY =
    options.centerY ??
    (options.topY !== undefined ? options.topY - options.joistHeight * 0.5 : 2.4);
  const namePrefix = options.namePrefix ?? `${options.bayId}.joist`;

  const group = new THREE.Group();
  group.name = `${options.bayId}.joistBay`;
  if (options.zone) group.userData.zone = options.zone;

  const joists: THREE.Mesh[] = [];
  for (let i = 0; i < coords.length; i++) {
    const ov = Array.isArray(options.overrides)
      ? options.overrides[i]
      : options.overrides?.[i];
    const layoutCoord = ov?.coord ?? coords[i]!;
    const s0 = ov?.spanStart ?? options.spanStart;
    const s1 = ov?.spanEnd ?? options.spanEnd;
    const w = ov?.width ?? options.joistWidth;
    const h = ov?.height ?? options.joistHeight;
    const cy = ov?.centerY ?? baseCenterY;
    const len = Math.abs(s1 - s0);
    if (len <= 0.02) continue;

    const midS = (s0 + s1) * 0.5;
    const joistSeed: TimberSeedInput = ov?.seed ?? `${options.bayId}:${i}`;
    const joistName =
      ov?.name ?? (options.formatName ? options.formatName(i) : `${namePrefix}.${i + 1}`);

    const sizeX = options.spanAxis === 'x' ? len : w;
    const sizeY = h;
    const sizeZ = options.spanAxis === 'z' ? len : w;

    const geo = createAgedTimberBoxBeamGeometry(sizeX, sizeY, sizeZ, joistSeed, {
      axis: options.spanAxis,
      profile,
      preserveOuterAabb,
      omitEmbeddedFaces,
      material: mat,
      ...(options.exposedCorners ? { exposedCorners: options.exposedCorners } : {}),
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = joistName;
    if (options.spanAxis === 'x') {
      mesh.position.set(midS, cy, layoutCoord);
    } else {
      mesh.position.set(layoutCoord, cy, midS);
    }
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.userData.heritageFabric = {
      role: 'aged-joist',
      bayId: options.bayId,
      index: i,
      profile,
      seed: joistSeed,
    };
    if (options.zone) mesh.userData.zone = options.zone;
    if (options.cutawayWall) tagCutaway(mesh, options.cutawayWall);

    group.add(mesh);
    joists.push(mesh);
  }

  if (options.parent) {
    options.parent.add(group);
  }

  return { group, joists };
}

/**
 * Builds a traditional exposed oak roof truss (`'king-post'`, `'collar'`, or `'simple-a-frame'`)
 * with plane-mitered rafter, king-post, strut, and knee-brace joints, distinct per-member grain UVs,
 * and an AABB-locked tie-beam (`preserveTieBeamOuterAabb: true` default).
 */
export function createAgedRoofTruss(options: CreateAgedRoofTrussOptions): AgedRoofTrussResult {
  const kind: AgedRoofTrussKind = options.kind ?? 'king-post';
  const trussId = options.id ?? options.name ?? 'roofTruss';
  const span = Math.max(0.8, options.span);
  const rise = Math.max(0.25, options.rise);
  const spanAxis = options.spanAxis ?? 'x';
  const profile: AgedTimberProfileId = options.profile ?? 'exposed-roof-truss';
  const mat = options.material ?? getCharacterOakMaterial();
  const baseSeed = options.seed ?? trussId;

  const [tieThick, tieH] = options.tieBeamSize ?? [0.16, 0.2];
  const [rafThick, rafDepth] = options.rafterSize ?? [0.14, 0.16];
  const [kpThick, kpWidth] = options.kingPostSize ?? [0.15, 0.16];
  const [strutThick, strutDepth] = options.strutSize ?? [0.11, 0.12];

  const group = new THREE.Group();
  group.name = options.name ?? trussId;
  if (options.position) {
    group.position.set(options.position[0], options.position[1], options.position[2]);
  }
  if (options.rotationY !== undefined) {
    group.rotation.y = options.rotationY;
  }
  if (options.zone) group.userData.zone = options.zone;

  const toTrussPoint = (inPlaneU: number, y: number): readonly [number, number, number] =>
    spanAxis === 'x' ? [inPlaneU, y, 0] : [0, y, inPlaneU];
  const toTrussVec = (inPlaneU: number, y: number): readonly [number, number, number] =>
    spanAxis === 'x' ? [inPlaneU, y, 0] : [0, y, inPlaneU];

  const members: THREE.Mesh[] = [];
  const struts: THREE.Mesh[] = [];
  const kneeBraces: THREE.Mesh[] = [];

  const halfSpan = span * 0.5;
  let tieBeam: THREE.Mesh | undefined;
  let collarBeam: THREE.Mesh | undefined;
  let kingPost: THREE.Mesh | undefined;

  const addMember = (
    memberKey: string,
    start: readonly [number, number, number],
    end: readonly [number, number, number],
    widthOutOfPlane: number,
    depthInPlane: number,
    extra: Partial<Omit<AgedTimberBeamGeometryOptions, 'material'>> = {}
  ): THREE.Mesh => {
    const res = createAgedTimberBeam({
      name: `${trussId}.${memberKey}`,
      start,
      end,
      width: widthOutOfPlane,
      height: depthInPlane,
      upHint: [0, 1, 0],
      seed: [baseSeed, memberKey],
      profile,
      material: mat,
      castShadow: options.castShadow ?? true,
      receiveShadow: options.receiveShadow ?? true,
      ...(options.zone ? { zone: options.zone } : {}),
      ...(options.cutawayWall ? { cutawayWall: options.cutawayWall } : {}),
      ...extra,
    });
    group.add(res.mesh);
    members.push(res.mesh);
    return res.mesh;
  };

  // 1. Tie-beam (for 'king-post') or raised collar (for 'collar')
  const rafterBaseY = kind === 'king-post' ? tieH * 0.85 : 0;
  const apexY = (kind === 'king-post' ? tieH : 0) + rise;

  if (kind === 'king-post') {
    const preserveTie = options.preserveTieBeamOuterAabb ?? true;
    const tieGeo = createAgedTimberBoxBeamGeometry(
      spanAxis === 'x' ? span : tieThick,
      tieH,
      spanAxis === 'z' ? span : tieThick,
      [baseSeed, 'tieBeam'],
      {
        axis: spanAxis,
        profile: preserveTie ? 'cottage-spine-beam' : profile,
        preserveOuterAabb: preserveTie,
        material: mat,
      }
    );
    tieBeam = new THREE.Mesh(tieGeo, mat);
    tieBeam.name = `${trussId}.tieBeam`;
    tieBeam.position.set(0, tieH * 0.5, 0);
    tieBeam.castShadow = options.castShadow ?? true;
    tieBeam.receiveShadow = options.receiveShadow ?? true;
    tieBeam.userData.heritageFabric = {
      role: 'aged-truss-member',
      member: 'tieBeam',
      seed: [baseSeed, 'tieBeam'],
    };
    if (options.zone) tieBeam.userData.zone = options.zone;
    if (options.cutawayWall) tagCutaway(tieBeam, options.cutawayWall);
    group.add(tieBeam);
    members.push(tieBeam);
  } else if (kind === 'collar') {
    const collarFrac = THREE.MathUtils.clamp(options.collarElevationFrac ?? 0.52, 0.25, 0.78);
    const collarY = apexY * collarFrac;
    const halfCollarSpan = Math.max(0.25, halfSpan * (1 - collarFrac) - rafDepth * 0.25);
    // Outward roof slope normals for mitering collar ends flush inside principal rafters
    const slopeLen = Math.hypot(halfSpan, apexY - rafterBaseY);
    const slopeNu = (apexY - rafterBaseY) / slopeLen;
    const slopeNy = halfSpan / slopeLen;
    collarBeam = addMember(
      'collarBeam',
      toTrussPoint(-halfCollarSpan, collarY),
      toTrussPoint(halfCollarSpan, collarY),
      tieThick,
      tieH * 0.85,
      {
        startMiterNormal: toTrussVec(-slopeNu, slopeNy),
        endMiterNormal: toTrussVec(slopeNu, slopeNy),
      }
    );
  }

  // 2. Principal rafters meeting at vertical plumb cut (or abutting king-post cheeks)
  const kpHalfU = kind === 'king-post' ? kpWidth * 0.46 : 0;
  const eaveInU = Math.max(0.2, halfSpan - rafDepth * 0.35);

  const leftRafter = addMember(
    'principalRafter.left',
    toTrussPoint(-eaveInU, rafterBaseY),
    toTrussPoint(-kpHalfU, apexY - rafDepth * 0.45),
    rafThick,
    rafDepth,
    {
      startMiterNormal: [0, -1, 0],
      endMiterNormal: toTrussVec(1, 0),
    }
  );

  const rightRafter = addMember(
    'principalRafter.right',
    toTrussPoint(eaveInU, rafterBaseY),
    toTrussPoint(kpHalfU, apexY - rafDepth * 0.45),
    rafThick,
    rafDepth,
    {
      startMiterNormal: [0, -1, 0],
      endMiterNormal: toTrussVec(-1, 0),
    }
  );

  // 3. King-post & diagonal raking struts
  if (kind === 'king-post') {
    const kpBotY = tieH - 0.004;
    const kpTopY = Math.max(kpBotY + 0.16, apexY - rafDepth * 0.12);
    // Vertical king-post: upHint along spanAxis so depthInPlane aligns along spanAxis
    const kpUpHint: readonly [number, number, number] =
      spanAxis === 'x' ? [1, 0, 0] : [0, 0, 1];
    kingPost = addMember(
      'kingPost',
      [0, kpBotY, 0],
      [0, kpTopY, 0],
      kpThick,
      kpWidth,
      {
        upHint: kpUpHint,
      }
    );

    if (options.includeStruts !== false && rise >= 0.55 && halfSpan >= 1.1) {
      const strutFootY = kpBotY + Math.min(0.16, (kpTopY - kpBotY) * 0.18);
      const midFrac = 0.52;
      const targetU = THREE.MathUtils.lerp(kpHalfU, eaveInU, midFrac);
      const targetY =
        THREE.MathUtils.lerp(apexY - rafDepth * 0.45, rafterBaseY, midFrac) - rafDepth * 0.35;
      if (targetY > strutFootY + 0.12 && targetU > kpWidth * 0.65) {
        const rafVecU = eaveInU - kpHalfU;
        const rafVecY = rafterBaseY - (apexY - rafDepth * 0.45);
        const rafLen = Math.hypot(rafVecU, rafVecY);
        // Normal pointing upward/outward into rafter soffit
        const rSoffitNu = -rafVecY / rafLen;
        const rSoffitNy = rafVecU / rafLen;

        const leftStrut = addMember(
          'strut.left',
          toTrussPoint(-kpWidth * 0.42, strutFootY),
          toTrussPoint(-targetU, targetY),
          strutThick,
          strutDepth,
          {
            startMiterNormal: toTrussVec(1, 0),
            endMiterNormal: toTrussVec(-rSoffitNu, rSoffitNy),
          }
        );
        const rightStrut = addMember(
          'strut.right',
          toTrussPoint(kpWidth * 0.42, strutFootY),
          toTrussPoint(targetU, targetY),
          strutThick,
          strutDepth,
          {
            startMiterNormal: toTrussVec(-1, 0),
            endMiterNormal: toTrussVec(rSoffitNu, rSoffitNy),
          }
        );
        struts.push(leftStrut, rightStrut);
      }
    }
  }

  // 4. Optional wall-post knee braces under tie-beam ends
  if (options.includeKneeBraces && kind === 'king-post') {
    const drop = Math.max(0.28, options.kneeBraceDropM ?? 0.55);
    const run = drop * 0.88;
    if (halfSpan > run + 0.25) {
      const leftKnee = addMember(
        'kneeBrace.left',
        toTrussPoint(-halfSpan + 0.06, -drop),
        toTrussPoint(-halfSpan + 0.06 + run, 0.004),
        strutThick,
        strutDepth,
        {
          startMiterNormal: toTrussVec(-1, 0),
          endMiterNormal: [0, 1, 0],
        }
      );
      const rightKnee = addMember(
        'kneeBrace.right',
        toTrussPoint(halfSpan - 0.06, -drop),
        toTrussPoint(halfSpan - 0.06 - run, 0.004),
        strutThick,
        strutDepth,
        {
          startMiterNormal: toTrussVec(1, 0),
          endMiterNormal: [0, 1, 0],
        }
      );
      kneeBraces.push(leftKnee, rightKnee);
    }
  }

  if (options.parent) {
    options.parent.add(group);
  }

  return {
    group,
    ...(tieBeam ? { tieBeam } : {}),
    leftRafter,
    rightRafter,
    ...(kingPost ? { kingPost } : {}),
    ...(collarBeam ? { collarBeam } : {}),
    struts,
    kneeBraces,
    members,
  };
}
