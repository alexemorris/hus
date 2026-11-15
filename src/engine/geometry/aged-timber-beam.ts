import * as THREE from 'three';
import {
  hashTimberSeed,
  resolveMaterialTextureGrainAxis,
  sampleTimberSliceTransform,
  type TimberSeedInput,
} from './timber-piece-uvs.ts';

export type AgedTimberProfileId =
  | 'cottage-ceiling-joist'
  | 'cottage-spine-beam'
  | 'inglenook-bressummer'
  | 'embedded-wall-plate'
  | 'exposed-roof-truss'
  | 'cambered-cruck-blade';

export type TimberFaceId = 'top' | 'bottom' | 'left' | 'right';

export interface AgedTimberProfileSpec {
  readonly id: AgedTimberProfileId;
  /** Max restrained centerline / inward-camber deflection (metres; strictly <= 0.005 m). */
  readonly maxBowM: number;
  /** Max gentle longitudinal twist (radians; damped to 0 at both ends). */
  readonly maxTwistRad: number;
  /** Base waney corner chamfer range `[min, max]` in metres. */
  readonly chamferRangeM: readonly [number, number];
  /** Localized arris chip/knick depth range `[min, max]` in metres (capped to `<= 0.14 * minDim`). */
  readonly chipDepthRangeM: readonly [number, number];
  /** Average localized chips per linear metre across exposed arrises. */
  readonly chipsPerMeter: number;
  /** Localized chip physical length range `[min, max]` in metres. */
  readonly chipLengthRangeM: readonly [number, number];
  /** Subtle adze / hand-planed face undulation amplitude in metres (strictly inward when AABB-locked). */
  readonly adzeFacetM: number;
  /** Whether to carve `0–2` narrow partial-length drying-check grooves (`minDim >= 0.13 m`). */
  readonly enableChecks: boolean;
  /** Check groove width & max depth in metres. */
  readonly checkWidthM: number;
  readonly checkDepthM: number;
  /** Default AABB-preservation mode. */
  readonly defaultPreserveOuterAabb: boolean;
}

export const AGED_TIMBER_PROFILES: Readonly<Record<AgedTimberProfileId, AgedTimberProfileSpec>> =
  Object.freeze({
    'cottage-ceiling-joist': Object.freeze<AgedTimberProfileSpec>({
      id: 'cottage-ceiling-joist',
      maxBowM: 0.0025,
      maxTwistRad: 0.008,
      chamferRangeM: [0.0025, 0.0055],
      chipDepthRangeM: [0.003, 0.007],
      chipsPerMeter: 0.85,
      chipLengthRangeM: [0.03, 0.075],
      adzeFacetM: 0.0009,
      enableChecks: false,
      checkWidthM: 0.003,
      checkDepthM: 0.0035,
      defaultPreserveOuterAabb: true,
    }),
    'cottage-spine-beam': Object.freeze<AgedTimberProfileSpec>({
      id: 'cottage-spine-beam',
      maxBowM: 0.0035,
      maxTwistRad: 0.014,
      chamferRangeM: [0.004, 0.009],
      chipDepthRangeM: [0.004, 0.011],
      chipsPerMeter: 1.15,
      chipLengthRangeM: [0.038, 0.092],
      adzeFacetM: 0.0014,
      enableChecks: true,
      checkWidthM: 0.0036,
      checkDepthM: 0.0048,
      defaultPreserveOuterAabb: true,
    }),
    'inglenook-bressummer': Object.freeze<AgedTimberProfileSpec>({
      id: 'inglenook-bressummer',
      maxBowM: 0.0042,
      maxTwistRad: 0.016,
      chamferRangeM: [0.005, 0.011],
      chipDepthRangeM: [0.005, 0.012],
      chipsPerMeter: 1.35,
      chipLengthRangeM: [0.042, 0.1],
      adzeFacetM: 0.0018,
      enableChecks: true,
      checkWidthM: 0.0042,
      checkDepthM: 0.0056,
      defaultPreserveOuterAabb: true,
    }),
    'embedded-wall-plate': Object.freeze<AgedTimberProfileSpec>({
      id: 'embedded-wall-plate',
      maxBowM: 0.0048,
      maxTwistRad: 0.018,
      chamferRangeM: [0.0055, 0.014],
      chipDepthRangeM: [0.005, 0.013],
      chipsPerMeter: 1.45,
      chipLengthRangeM: [0.045, 0.11],
      adzeFacetM: 0.002,
      enableChecks: true,
      checkWidthM: 0.004,
      checkDepthM: 0.005,
      defaultPreserveOuterAabb: false,
    }),
    'exposed-roof-truss': Object.freeze<AgedTimberProfileSpec>({
      id: 'exposed-roof-truss',
      maxBowM: 0.004,
      maxTwistRad: 0.014,
      chamferRangeM: [0.004, 0.0085],
      chipDepthRangeM: [0.004, 0.01],
      chipsPerMeter: 1.05,
      chipLengthRangeM: [0.038, 0.088],
      adzeFacetM: 0.0014,
      enableChecks: true,
      checkWidthM: 0.0038,
      checkDepthM: 0.005,
      defaultPreserveOuterAabb: false,
    }),
    'cambered-cruck-blade': Object.freeze<AgedTimberProfileSpec>({
      id: 'cambered-cruck-blade',
      maxBowM: 0.0045,
      maxTwistRad: 0.02,
      chamferRangeM: [0.005, 0.013],
      chipDepthRangeM: [0.005, 0.012],
      chipsPerMeter: 1.25,
      chipLengthRangeM: [0.04, 0.095],
      adzeFacetM: 0.0018,
      enableChecks: true,
      checkWidthM: 0.004,
      checkDepthM: 0.005,
      defaultPreserveOuterAabb: false,
    }),
  });

export interface AgedTimberBeamGeometryOptions {
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
  readonly width: number;
  readonly height: number;
  readonly endWidth?: number;
  readonly endHeight?: number;
  readonly upHint?: readonly [number, number, number];
  readonly seed: TimberSeedInput;
  readonly profile?: AgedTimberProfileId;
  /** Guarantees `geometry.boundingBox` equals exact nominal envelope (`0.000 mm` outer drift). */
  readonly preserveOuterAabb?: boolean;
  /** Fine-tune overrides (clamped internally so `maxBowM <= 0.005`). */
  readonly maxBowM?: number;
  readonly maxTwistRad?: number;
  readonly structuralCamberU?: number;
  readonly structuralCamberV?: number;
  readonly chamferRangeM?: readonly [number, number];
  readonly chipDepthRangeM?: readonly [number, number];
  readonly chipsPerMeter?: number;
  readonly adzeFacetM?: number;
  readonly enableChecks?: boolean;
  /** Exposed longitudinal arrises `[topRight, bottomRight, bottomLeft, topLeft]` (`default: [true, true, true, true]`). */
  readonly exposedCorners?: readonly [boolean, boolean, boolean, boolean];
  /** Faces omitted because they sit flush inside ceiling/wall masonry (zero coplanar z-fighting). */
  readonly omitEmbeddedFaces?: readonly TimberFaceId[];
  /** UV tiling density along grain (`default: 1 / 2.2` metres per tile). */
  readonly scalePerMetre?: number;
  readonly crossScalePerMetre?: number;
  /** Optional material inspected via `resolveMaterialTextureGrainAxis(material)` for `'u'` vs `'v'` grain alignment. */
  readonly material?: THREE.Material | null;
  readonly materialGrainAxis?: 'u' | 'v';
  /** Optional angled miter plane normals at `start` / `end` for roof-truss rafters & braces. */
  readonly startMiterNormal?: readonly [number, number, number];
  readonly endMiterNormal?: readonly [number, number, number];
}

export type AgedTimberBoxBeamOptions = Omit<
  AgedTimberBeamGeometryOptions,
  'start' | 'end' | 'width' | 'height' | 'upHint' | 'seed'
> & {
  readonly axis?: 'x' | 'y' | 'z';
};

export interface PlasterBeamHaunchGeometryOptions {
  /** Start point `[x, y, z]` along the plaster-to-timber junction line. */
  readonly start: readonly [number, number, number];
  /** End point `[x, y, z]` along the plaster-to-timber junction line. */
  readonly end: readonly [number, number, number];
  /** Unit normal pointing out of the plaster surface into the room. */
  readonly surfaceNormal: readonly [number, number, number];
  /** Unit vector along the plaster surface pointing INTO the timber face. */
  readonly intoTimberDir: readonly [number, number, number];
  /** Average reach of the lime-plaster feathering away from the timber (`default: 0.015` = `15 mm`). */
  readonly reachM?: number;
  /** Average climb of the lime-plaster haunch onto the timber cheek (`default: 0.013` = `13 mm`). */
  readonly climbM?: number;
  readonly seed: TimberSeedInput;
  readonly segments?: number;
  /** World-space plaster UV tile span in metres (`default: 2.4`). */
  readonly tileM?: number;
}

interface LocalizedEdgeChip {
  readonly cornerIdx: 0 | 1 | 2 | 3;
  readonly tCenter: number;
  readonly tHalfWidth: number;
  readonly skew: number;
  readonly depthU: number;
  readonly depthV: number;
}

interface DryingCheckSpec {
  readonly face: 'bottom' | 'right' | 'left';
  readonly lateralFrac: number;
  readonly tStart: number;
  readonly tEnd: number;
  readonly widthM: number;
  readonly depthM: number;
}

function prngFloat(ix: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise1D(x: number, seed: number): number {
  const i0 = Math.floor(x);
  const f = x - i0;
  const u = f * f * (3 - 2 * f);
  return prngFloat(i0, seed) * (1 - u) + prngFloat(i0 + 1, seed) * u;
}

function evaluateSkewedChipEnvelope(t: number, chip: LocalizedEdgeChip): number {
  const rel = (t - chip.tCenter) / Math.max(1e-5, chip.tHalfWidth);
  if (rel <= -1 || rel >= 1) return 0;
  const peak = chip.skew;
  const norm =
    rel <= peak
      ? (rel - peak) / Math.max(0.2, 1 + peak)
      : (rel - peak) / Math.max(0.2, 1 - peak);
  const clamped = Math.max(-1, Math.min(1, norm));
  return Math.pow(0.5 + 0.5 * Math.cos(Math.PI * clamped), 1.25);
}

function buildAdaptiveLongitudinalStations(
  span: number,
  chips: readonly LocalizedEdgeChip[],
  checks: readonly DryingCheckSpec[]
): readonly number[] {
  const baseSegs = THREE.MathUtils.clamp(Math.round(span / 0.28), 8, 18);
  const raw: number[] = [0, 1];
  for (let i = 1; i < baseSegs; i++) {
    raw.push(i / baseSegs);
  }
  for (const chip of chips) {
    const dt = chip.tHalfWidth;
    const candidates = [
      chip.tCenter - dt,
      chip.tCenter - 0.35 * dt,
      chip.tCenter + chip.skew * dt,
      chip.tCenter + 0.35 * dt,
      chip.tCenter + dt,
    ];
    for (const c of candidates) {
      if (c > 0.002 && c < 0.998) raw.push(c);
    }
  }
  for (const chk of checks) {
    const taper = Math.min(0.04, (chk.tEnd - chk.tStart) * 0.22);
    for (const c of [chk.tStart, chk.tStart + taper, chk.tEnd - taper, chk.tEnd]) {
      if (c > 0.002 && c < 0.998) raw.push(c);
    }
  }

  raw.sort((a, b) => a - b);
  const minStep = Math.min(0.045, 0.012 / Math.max(0.15, span));
  const merged: number[] = [0];
  for (let i = 1; i < raw.length - 1; i++) {
    const t = raw[i]!;
    if (t - merged[merged.length - 1]! >= minStep && 1 - t >= minStep * 0.75) {
      merged.push(t);
    }
  }
  merged.push(1);
  return merged;
}

/**
 * Builds a deterministic, chamfer-isolated, aged structural timber beam `THREE.BufferGeometry`.
 *
 * Enforces:
 * - Restrained straightness (`maxBowM <= 5 mm` on standard presets).
 * - `preserveOuterAabb: true` exact `0.000 mm` outer envelope invariance via inward-only carving.
 * - 16-vertex chamfer-isolated cross-section ring (+ optional 3-vertex narrow V-groove drying checks).
 * - Adaptive longitudinal stations around localized asymmetric edge chips.
 * - Stochastic per-beam carpenter UVs via `sampleTimberSliceTransform` & `resolveMaterialTextureGrainAxis`.
 * - Zero `color` vertex attribute (`position` + `normal` + `uv` only for `28 B/vert` `FastGeometryMerger`).
 */
export function createAgedTimberBeamGeometry(
  options: AgedTimberBeamGeometryOptions
): THREE.BufferGeometry {
  const profileId: AgedTimberProfileId = options.profile ?? 'cottage-spine-beam';
  const spec = AGED_TIMBER_PROFILES[profileId];
  const seedNum = hashTimberSeed(options.seed);

  const pStart = new THREE.Vector3(options.start[0], options.start[1], options.start[2]);
  const pEnd = new THREE.Vector3(options.end[0], options.end[1], options.end[2]);
  const axisVec = new THREE.Vector3().subVectors(pEnd, pStart);
  const span = Math.max(0.02, axisVec.length());
  const tDir =
    axisVec.lengthSq() > 1e-12
      ? axisVec.clone().divideScalar(span)
      : new THREE.Vector3(1, 0, 0);

  const upRef = options.upHint
    ? new THREE.Vector3(options.upHint[0], options.upHint[1], options.upHint[2]).normalize()
    : new THREE.Vector3(0, 1, 0);
  if (Math.abs(tDir.dot(upRef)) > 0.98) {
    upRef.set(0, 0, 1);
    if (Math.abs(tDir.dot(upRef)) > 0.98) {
      upRef.set(1, 0, 0);
    }
  }
  // Right-handed orthonormal basis (uDir, vDir, tDir): uDir x vDir = tDir, vDir aligned with +upRef
  const uDir = new THREE.Vector3().crossVectors(upRef, tDir).normalize();
  const vDir = new THREE.Vector3().crossVectors(tDir, uDir).normalize();

  const w0 = Math.max(0.016, options.width);
  const w1 = Math.max(0.016, options.endWidth ?? w0);
  const h0 = Math.max(0.016, options.height);
  const h1 = Math.max(0.016, options.endHeight ?? h0);
  const minDim = Math.min(w0, w1, h0, h1);

  const preserveOuterAabb = options.preserveOuterAabb ?? spec.defaultPreserveOuterAabb;
  const maxBowM = THREE.MathUtils.clamp(options.maxBowM ?? spec.maxBowM, 0, 0.005);
  const maxTwistRad = preserveOuterAabb
    ? 0
    : THREE.MathUtils.clamp(options.maxTwistRad ?? spec.maxTwistRad, 0, 0.035);

  const omittedSet = new Set<TimberFaceId>(options.omitEmbeddedFaces ?? []);
  const omitTop = omittedSet.has('top');
  const omitRight = omittedSet.has('right');
  const omitBottom = omittedSet.has('bottom');
  const omitLeft = omittedSet.has('left');

  // Corner indices: 0 = TopRight (+u,+v), 1 = BottomRight (+u,-v), 2 = BottomLeft (-u,-v), 3 = TopLeft (-u,+v)
  const cornerAdjOmitted: readonly [boolean, boolean, boolean, boolean] = [
    omitTop || omitRight,
    omitRight || omitBottom,
    omitBottom || omitLeft,
    omitLeft || omitTop,
  ];
  const rawExposed = options.exposedCorners ?? [true, true, true, true];
  const exposedCorners: readonly [boolean, boolean, boolean, boolean] = [
    rawExposed[0] && !cornerAdjOmitted[0],
    rawExposed[1] && !cornerAdjOmitted[1],
    rawExposed[2] && !cornerAdjOmitted[2],
    rawExposed[3] && !cornerAdjOmitted[3],
  ];

  const [chamMin, chamMax] = options.chamferRangeM ?? spec.chamferRangeM;
  const maxAllowedChamfer = minDim * 0.2;
  const baseChamferMin = Math.min(maxAllowedChamfer, Math.max(0.001, chamMin));
  const baseChamferMax = Math.min(maxAllowedChamfer, Math.max(baseChamferMin, chamMax));

  const [chipMin, chipMax] = options.chipDepthRangeM ?? spec.chipDepthRangeM;
  const maxAllowedChip = minDim * 0.14;
  const chipDepthMin = Math.min(maxAllowedChip, Math.max(0.0015, chipMin));
  const chipDepthMax = Math.min(maxAllowedChip, Math.max(chipDepthMin, chipMax));
  const chipsPerMeter = Math.max(0, options.chipsPerMeter ?? spec.chipsPerMeter);
  const adzeFacetM = Math.min(minDim * 0.04, Math.max(0, options.adzeFacetM ?? spec.adzeFacetM));

  // Generate localized asymmetric arris chips on exposed corners
  const exposedIndices: (0 | 1 | 2 | 3)[] = [];
  for (let c = 0; c < 4; c++) {
    if (exposedCorners[c as 0 | 1 | 2 | 3]) {
      exposedIndices.push(c as 0 | 1 | 2 | 3);
    }
  }

  const chips: LocalizedEdgeChip[] = [];
  if (exposedIndices.length > 0 && chipsPerMeter > 0 && span >= 0.25) {
    const targetCount = THREE.MathUtils.clamp(
      Math.round(span * chipsPerMeter * (0.75 + 0.5 * prngFloat(7, seedNum))),
      1,
      10
    );
    const [lenMin, lenMax] = spec.chipLengthRangeM;
    for (let k = 0; k < targetCount; k++) {
      const cornerIdx =
        exposedIndices[Math.floor(prngFloat(20 + k * 11, seedNum) * exposedIndices.length)]!;
      const tCenter = THREE.MathUtils.clamp(
        0.07 + 0.86 * ((k + 0.2 + 0.6 * prngFloat(21 + k * 11, seedNum)) / targetCount),
        0.06,
        0.94
      );
      const physLen = THREE.MathUtils.lerp(lenMin, lenMax, prngFloat(22 + k * 11, seedNum));
      const tHalfWidth = THREE.MathUtils.clamp((physLen * 0.5) / span, 0.008, 0.16);
      const skew = (prngFloat(23 + k * 11, seedNum) - 0.5) * 0.56; // [-0.28, +0.28]
      const depthBase = THREE.MathUtils.lerp(
        chipDepthMin,
        chipDepthMax,
        prngFloat(24 + k * 11, seedNum)
      );
      const asym = 0.72 + 0.56 * prngFloat(25 + k * 11, seedNum);
      chips.push({
        cornerIdx,
        tCenter,
        tHalfWidth,
        skew,
        depthU: Math.min(maxAllowedChip, depthBase * asym),
        depthV: Math.min(maxAllowedChip, depthBase * (1.42 - 0.42 * asym)),
      });
    }
  }

  // Generate 0..2 dedicated 3-vertex narrow V-groove drying checks on beams with minDim >= 0.13 m
  const enableChecks =
    (options.enableChecks ?? spec.enableChecks) && minDim >= 0.13 && span >= 1.05;
  const checks: DryingCheckSpec[] = [];
  if (enableChecks) {
    const candidateFaces: ('bottom' | 'right' | 'left')[] = [];
    if (!omitBottom) candidateFaces.push('bottom');
    if (!omitRight) candidateFaces.push('right');
    if (!omitLeft) candidateFaces.push('left');
    if (candidateFaces.length > 0) {
      const firstFace =
        candidateFaces[Math.floor(prngFloat(81, seedNum) * candidateFaces.length)]!;
      const tLen1 = Math.min(span * 0.52, 0.38 + 0.85 * prngFloat(82, seedNum)) / span;
      const tStart1 = 0.12 + (0.76 - tLen1) * prngFloat(83, seedNum);
      checks.push({
        face: firstFace,
        lateralFrac: (prngFloat(84, seedNum) - 0.5) * 0.44,
        tStart: tStart1,
        tEnd: tStart1 + tLen1,
        widthM: THREE.MathUtils.clamp(
          spec.checkWidthM * (0.88 + 0.26 * prngFloat(85, seedNum)),
          0.003,
          0.005
        ),
        depthM: THREE.MathUtils.clamp(
          spec.checkDepthM * (0.85 + 0.3 * prngFloat(86, seedNum)),
          0.003,
          0.006
        ),
      });

      const remainingFaces = candidateFaces.filter((f) => f !== firstFace);
      if (span >= 3.4 && remainingFaces.length > 0 && prngFloat(87, seedNum) > 0.35) {
        const secondFace =
          remainingFaces[Math.floor(prngFloat(88, seedNum) * remainingFaces.length)]!;
        const tLen2 = Math.min(span * 0.42, 0.35 + 0.75 * prngFloat(89, seedNum)) / span;
        const tStart2 = 0.14 + (0.72 - tLen2) * prngFloat(90, seedNum);
        checks.push({
          face: secondFace,
          lateralFrac: (prngFloat(91, seedNum) - 0.5) * 0.44,
          tStart: tStart2,
          tEnd: tStart2 + tLen2,
          widthM: THREE.MathUtils.clamp(
            spec.checkWidthM * (0.86 + 0.25 * prngFloat(92, seedNum)),
            0.003,
            0.005
          ),
          depthM: THREE.MathUtils.clamp(
            spec.checkDepthM * (0.82 + 0.28 * prngFloat(93, seedNum)),
            0.003,
            0.006
          ),
        });
      }
    }
  }

  const checkByFace = {
    bottom: checks.find((c) => c.face === 'bottom') ?? null,
    right: checks.find((c) => c.face === 'right') ?? null,
    left: checks.find((c) => c.face === 'left') ?? null,
  };

  const stations = buildAdaptiveLongitudinalStations(span, chips, checks);
  const stationCount = stations.length;

  // Bow & camber amplitudes
  const bowSignU = prngFloat(3, seedNum) >= 0.5 ? 1 : -1;
  const bowSignV = prngFloat(4, seedNum) >= 0.35 ? -1 : 1;
  const bowAmpU =
    maxBowM * (0.55 + 0.45 * prngFloat(5, seedNum)) * bowSignU +
    (preserveOuterAabb ? 0 : (options.structuralCamberU ?? 0));
  const bowAmpV =
    maxBowM * (0.6 + 0.4 * prngFloat(6, seedNum)) * bowSignV +
    (preserveOuterAabb ? 0 : (options.structuralCamberV ?? 0));
  const latPhase = prngFloat(8, seedNum) * Math.PI * 0.65;
  const twistAmp =
    maxTwistRad * (0.5 + 0.5 * prngFloat(9, seedNum)) * (prngFloat(10, seedNum) >= 0.5 ? 1 : -1);

  // Optional start / end miter plane normals
  let startMiterN: THREE.Vector3 | null = null;
  if (options.startMiterNormal) {
    const n = new THREE.Vector3(
      options.startMiterNormal[0],
      options.startMiterNormal[1],
      options.startMiterNormal[2]
    );
    if (n.lengthSq() > 1e-8) {
      n.normalize();
      if (n.dot(tDir) > 0) n.negate(); // outward at start points roughly along -tDir
      if (Math.abs(n.dot(tDir)) >= 0.15) startMiterN = n;
    }
  }
  let endMiterN: THREE.Vector3 | null = null;
  if (options.endMiterNormal) {
    const n = new THREE.Vector3(
      options.endMiterNormal[0],
      options.endMiterNormal[1],
      options.endMiterNormal[2]
    );
    if (n.lengthSq() > 1e-8) {
      n.normalize();
      if (n.dot(tDir) < 0) n.negate(); // outward at end points roughly along +tDir
      if (Math.abs(n.dot(tDir)) >= 0.15) endMiterN = n;
    }
  }

  // Build perimeter segment inclusion table around the 16-vertex (+2 per check) clockwise ring
  // Segment kind tags allow omitting concealed faces and zero-width embedded corner chamfers cleanly.
  type SegTag =
    | 'top'
    | 'cornerTR'
    | 'right'
    | 'cornerBR'
    | 'bottom'
    | 'cornerBL'
    | 'left'
    | 'cornerTL';

  const segTags: SegTag[] = [];
  // Top face: 3 segments (v_top0 -> v_top1 -> v_top2 -> v_top3)
  segTags.push('top', 'top', 'top');
  segTags.push('cornerTR');
  // Right face: 3 segments (or 5 with 3-vertex check triplet)
  if (checkByFace.right) {
    segTags.push('right', 'right', 'right', 'right', 'right');
  } else {
    segTags.push('right', 'right', 'right');
  }
  segTags.push('cornerBR');
  // Bottom face: 3 segments (or 5 with 3-vertex check triplet)
  if (checkByFace.bottom) {
    segTags.push('bottom', 'bottom', 'bottom', 'bottom', 'bottom');
  } else {
    segTags.push('bottom', 'bottom', 'bottom');
  }
  segTags.push('cornerBL');
  // Left face: 3 segments (or 5 with 3-vertex check triplet)
  if (checkByFace.left) {
    segTags.push('left', 'left', 'left', 'left', 'left');
  } else {
    segTags.push('left', 'left', 'left');
  }
  segTags.push('cornerTL');

  const basePerimeterVerts = segTags.length; // 16 + 2 * activeChecks
  const ringVertStride = basePerimeterVerts + 1; // +1 UV wrap seam vertex

  const isSegActive = (tag: SegTag): boolean => {
    switch (tag) {
      case 'top':
        return !omitTop;
      case 'right':
        return !omitRight;
      case 'bottom':
        return !omitBottom;
      case 'left':
        return !omitLeft;
      case 'cornerTR':
        return !cornerAdjOmitted[0];
      case 'cornerBR':
        return !cornerAdjOmitted[1];
      case 'cornerBL':
        return !cornerAdjOmitted[2];
      case 'cornerTL':
        return !cornerAdjOmitted[3];
    }
  };

  const rings3D: THREE.Vector3[][] = [];
  const ringsArc: number[][] = [];
  const ringsS: number[][] = [];

  for (let sIdx = 0; sIdx < stationCount; sIdx++) {
    const t = stations[sIdx]!;
    const sinEnd = Math.sin(Math.PI * t);
    const endEase = Math.min(1, Math.min(t, 1 - t) / 0.07);

    const wNom = THREE.MathUtils.lerp(w0, w1, t);
    const hNom = THREE.MathUtils.lerp(h0, h1, t);
    const halfU = wNom * 0.5;
    const halfV = hNom * 0.5;

    // Corner waney chamfers + localized asymmetric edge chips (strictly inward: >= 0)
    const cu: [number, number, number, number] = [0, 0, 0, 0];
    const cv: [number, number, number, number] = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      if (cornerAdjOmitted[c as 0 | 1 | 2 | 3]) {
        cu[c as 0 | 1 | 2 | 3] = 0;
        cv[c as 0 | 1 | 2 | 3] = 0;
        continue;
      }
      const waney = smoothNoise1D(t * 7.2 + c * 11.7, seedNum + 500 + c * 23);
      const waneyCross = smoothNoise1D(t * 6.4 + c * 7.9 + 3.1, seedNum + 509 + c * 23);
      const expScale = exposedCorners[c as 0 | 1 | 2 | 3] ? 1.0 : 0.45;
      cu[c as 0 | 1 | 2 | 3] = Math.min(
        halfU * 0.36,
        THREE.MathUtils.lerp(baseChamferMin, baseChamferMax, waney) * expScale
      );
      cv[c as 0 | 1 | 2 | 3] = Math.min(
        halfV * 0.36,
        THREE.MathUtils.lerp(baseChamferMin, baseChamferMax, waneyCross) * expScale
      );
    }

    for (const chip of chips) {
      const env = evaluateSkewedChipEnvelope(t, chip) * endEase;
      if (env > 1e-5) {
        const c = chip.cornerIdx;
        cu[c] = Math.min(halfU * 0.46, cu[c] + chip.depthU * env);
        cv[c] = Math.min(halfV * 0.46, cv[c] + chip.depthV * env);
      }
    }

    // Face planes & subtle inward adze planing facets
    let uRightFace: number;
    let uLeftFace: number;
    let vTopFace: number;
    let vBottomFace: number;
    let centerShiftU = 0;
    let centerShiftV = 0;

    // Adze facets are strictly inward (<= 0 magnitude toward centerline) when preserveOuterAabb is true
    const rawAdzeTopA = smoothNoise1D(t * 8.6 + 0.4, seedNum + 601) * endEase;
    const rawAdzeTopB = smoothNoise1D(t * 8.6 + 2.1, seedNum + 607) * endEase;
    const rawAdzeRightA = smoothNoise1D(t * 9.1 + 1.2, seedNum + 613) * endEase;
    const rawAdzeRightB = smoothNoise1D(t * 9.1 + 3.3, seedNum + 619) * endEase;
    const rawAdzeBottomA = smoothNoise1D(t * 8.4 + 0.8, seedNum + 631) * endEase;
    const rawAdzeBottomB = smoothNoise1D(t * 8.4 + 2.7, seedNum + 641) * endEase;
    const rawAdzeLeftA = smoothNoise1D(t * 8.9 + 1.6, seedNum + 647) * endEase;
    const rawAdzeLeftB = smoothNoise1D(t * 8.9 + 3.8, seedNum + 653) * endEase;

    if (preserveOuterAabb) {
      // Asymmetric opposing-side inward lateral weave & soffit crown:
      // Every vertex stays strictly inside [-halfU, +halfU] x [-halfV, +halfV], and endpoints t=0,1 touch exact bounds!
      const latWave = Math.abs(bowAmpU) * Math.sin(2 * Math.PI * t + latPhase) * sinEnd;
      uLeftFace = -halfU + Math.max(0, latWave);
      uRightFace = halfU - Math.max(0, -latWave);
      const soffitCrown = Math.abs(bowAmpV) * 0.75 * sinEnd;
      vBottomFace = -halfV + soffitCrown;
      vTopFace = omitTop ? halfV : halfV - Math.abs(bowAmpV) * 0.35 * sinEnd;
    } else {
      const driftU = (smoothNoise1D(t * 5.7, seedNum + 401) - 0.5) * 0.0014 * endEase;
      const driftV = (smoothNoise1D(t * 5.3, seedNum + 409) - 0.5) * 0.0014 * endEase;
      centerShiftU = bowAmpU * sinEnd + driftU;
      centerShiftV = bowAmpV * sinEnd + driftV;
      const swellU = (smoothNoise1D(t * 3.9 + 1.3, seedNum + 301) - 0.5) * 0.002 * endEase;
      const swellV = (smoothNoise1D(t * 3.6 + 4.7, seedNum + 307) - 0.5) * 0.002 * endEase;
      uLeftFace = -(halfU + swellU * 0.5);
      uRightFace = halfU + swellU * 0.5;
      vBottomFace = -(halfV + swellV * 0.5);
      vTopFace = halfV + swellV * 0.5;
    }

    // Strictly inward adze deltas (toward 0)
    const adzeTopA = -adzeFacetM * rawAdzeTopA;
    const adzeTopB = -adzeFacetM * rawAdzeTopB;
    const adzeRightA = -adzeFacetM * rawAdzeRightA;
    const adzeRightB = -adzeFacetM * rawAdzeRightB;
    const adzeBottomA = adzeFacetM * rawAdzeBottomA;
    const adzeBottomB = adzeFacetM * rawAdzeBottomB;
    const adzeLeftA = adzeFacetM * rawAdzeLeftA;
    const adzeLeftB = adzeFacetM * rawAdzeLeftB;

    // Chamfer-isolated inner shoulder coordinates (strictly inside chamfer endpoints)
    const uTopMin = uLeftFace + cu[3];
    const uTopMax = uRightFace - cu[0];
    const topSpan = Math.max(0.004, uTopMax - uTopMin);
    const uTopInnerL = uTopMin + topSpan * 0.24;
    const uTopInnerR = uTopMax - topSpan * 0.24;

    const vRightMax = vTopFace - cv[0];
    const vRightMin = vBottomFace + cv[1];
    const rightSpan = Math.max(0.004, vRightMax - vRightMin);
    const vRightInnerT = vRightMax - rightSpan * 0.24;
    const vRightInnerB = vRightMin + rightSpan * 0.24;

    const uBotMax = uRightFace - cu[1];
    const uBotMin = uLeftFace + cu[2];
    const botSpan = Math.max(0.004, uBotMax - uBotMin);
    const uBotInnerR = uBotMax - botSpan * 0.24;
    const uBotInnerL = uBotMin + botSpan * 0.24;

    const vLeftMin = vBottomFace + cv[2];
    const vLeftMax = vTopFace - cv[3];
    const leftSpan = Math.max(0.004, vLeftMax - vLeftMin);
    const vLeftInnerB = vLeftMin + leftSpan * 0.24;
    const vLeftInnerT = vLeftMax - leftSpan * 0.24;

    const evalCheckDepth = (chk: DryingCheckSpec): number => {
      if (t <= chk.tStart || t >= chk.tEnd) return 0;
      const frac = (t - chk.tStart) / Math.max(1e-5, chk.tEnd - chk.tStart);
      return chk.depthM * Math.pow(Math.sin(Math.PI * frac), 0.85);
    };

    const pts2D: [number, number][] = [];

    // 1. Top face (+v): Left -> Right
    pts2D.push(
      [uTopMin, vTopFace],
      [uTopInnerL, vTopFace + (omitTop ? 0 : adzeTopA)],
      [uTopInnerR, vTopFace + (omitTop ? 0 : adzeTopB)],
      [uTopMax, vTopFace]
    );

    // 2. Right face (+u): Top -> Bottom
    pts2D.push(
      [uRightFace, vRightMax],
      [uRightFace + (omitRight ? 0 : adzeRightA), vRightInnerT]
    );
    if (checkByFace.right) {
      const chk = checkByFace.right;
      const d = evalCheckDepth(chk);
      const halfW = Math.min(chk.widthM * 0.5, (vRightInnerT - vRightInnerB) * 0.22);
      const vc = THREE.MathUtils.clamp(
        (vRightInnerT + vRightInnerB) * 0.5 + chk.lateralFrac * rightSpan * 0.35,
        vRightInnerB + halfW * 1.4,
        vRightInnerT - halfW * 1.4
      );
      const baseAdze = omitRight ? 0 : (adzeRightA + adzeRightB) * 0.5;
      pts2D.push(
        [uRightFace + baseAdze, vc + halfW],
        [uRightFace + baseAdze - d, vc],
        [uRightFace + baseAdze, vc - halfW]
      );
    }
    pts2D.push(
      [uRightFace + (omitRight ? 0 : adzeRightB), vRightInnerB],
      [uRightFace, vRightMin]
    );

    // 3. Bottom face (-v): Right -> Left
    pts2D.push(
      [uBotMax, vBottomFace],
      [uBotInnerR, vBottomFace + (omitBottom ? 0 : adzeBottomA)]
    );
    if (checkByFace.bottom) {
      const chk = checkByFace.bottom;
      const d = evalCheckDepth(chk);
      const halfW = Math.min(chk.widthM * 0.5, (uBotInnerR - uBotInnerL) * 0.22);
      const uc = THREE.MathUtils.clamp(
        (uBotInnerL + uBotInnerR) * 0.5 + chk.lateralFrac * botSpan * 0.35,
        uBotInnerL + halfW * 1.4,
        uBotInnerR - halfW * 1.4
      );
      const baseAdze = omitBottom ? 0 : (adzeBottomA + adzeBottomB) * 0.5;
      pts2D.push(
        [uc + halfW, vBottomFace + baseAdze],
        [uc, vBottomFace + baseAdze + d],
        [uc - halfW, vBottomFace + baseAdze]
      );
    }
    pts2D.push(
      [uBotInnerL, vBottomFace + (omitBottom ? 0 : adzeBottomB)],
      [uBotMin, vBottomFace]
    );

    // 4. Left face (-u): Bottom -> Top
    pts2D.push(
      [uLeftFace, vLeftMin],
      [uLeftFace + (omitLeft ? 0 : adzeLeftA), vLeftInnerB]
    );
    if (checkByFace.left) {
      const chk = checkByFace.left;
      const d = evalCheckDepth(chk);
      const halfW = Math.min(chk.widthM * 0.5, (vLeftInnerT - vLeftInnerB) * 0.22);
      const vc = THREE.MathUtils.clamp(
        (vLeftInnerT + vLeftInnerB) * 0.5 + chk.lateralFrac * leftSpan * 0.35,
        vLeftInnerB + halfW * 1.4,
        vLeftInnerT - halfW * 1.4
      );
      const baseAdze = omitLeft ? 0 : (adzeLeftA + adzeLeftB) * 0.5;
      pts2D.push(
        [uLeftFace + baseAdze, vc - halfW],
        [uLeftFace + baseAdze + d, vc],
        [uLeftFace + baseAdze, vc + halfW]
      );
    }
    pts2D.push(
      [uLeftFace + (omitLeft ? 0 : adzeLeftB), vLeftInnerT],
      [uLeftFace, vLeftMax]
    );

    // Twist angle damped smoothly to 0 at both ends
    const theta = twistAmp * sinEnd * (t - 0.5) * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const ring: THREE.Vector3[] = [];
    const arcs: number[] = [0];
    const sCoords: number[] = [];

    for (let i = 0; i < basePerimeterVerts; i++) {
      const [rawU, rawV] = pts2D[i]!;
      const rotU = rawU * cosT - rawV * sinT + centerShiftU;
      const rotV = rawU * sinT + rawV * cosT + centerShiftV;
      const offsetVec = new THREE.Vector3()
        .addScaledVector(uDir, rotU)
        .addScaledVector(vDir, rotV);

      const dStart = startMiterN ? -offsetVec.dot(startMiterN) / tDir.dot(startMiterN) : 0;
      const dEnd = endMiterN ? -offsetVec.dot(endMiterN) / tDir.dot(endMiterN) : 0;
      const sAlong = THREE.MathUtils.lerp(dStart, span + dEnd, t);

      const wp = pStart.clone().addScaledVector(tDir, sAlong).add(offsetVec);
      ring.push(wp);
      sCoords.push(sAlong);
      if (i > 0) {
        arcs.push(arcs[i - 1]! + Math.hypot(rawU - pts2D[i - 1]![0], rawV - pts2D[i - 1]![1]));
      }
    }
    // Seam wrap vertex (index === basePerimeterVerts)
    ring.push(ring[0]!.clone());
    sCoords.push(sCoords[0]!);
    arcs.push(
      arcs[basePerimeterVerts - 1]! +
        Math.hypot(
          pts2D[0]![0] - pts2D[basePerimeterVerts - 1]![0],
          pts2D[0]![1] - pts2D[basePerimeterVerts - 1]![1]
        )
    );

    rings3D.push(ring);
    ringsArc.push(arcs);
    ringsS.push(sCoords);
  }

  // Stochastic carpenter UVs via timber-piece-uvs.ts
  const scaleAlong = options.scalePerMetre ?? 1 / 2.2;
  const scaleAcross = options.crossScalePerMetre ?? scaleAlong;
  const texAxis = resolveMaterialTextureGrainAxis(options.material, options.materialGrainAxis);
  const slice = sampleTimberSliceTransform(options.seed, true);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushUv = (alongM: number, acrossM: number): void => {
    const fiberCoord = alongM * scaleAlong * slice.uSign + slice.uOffset;
    const crossCoord = acrossM * scaleAcross * slice.vSign + slice.vOffset;
    if (texAxis === 'u') {
      uvs.push(fiberCoord, crossCoord);
    } else {
      uvs.push(crossCoord, fiberCoord);
    }
  };

  for (let sIdx = 0; sIdx < stationCount; sIdx++) {
    const ring = rings3D[sIdx]!;
    const arcs = ringsArc[sIdx]!;
    const sCoords = ringsS[sIdx]!;
    for (let i = 0; i < ringVertStride; i++) {
      const p = ring[i]!;
      positions.push(p.x, p.y, p.z);
      pushUv(sCoords[i]!, arcs[i]!);
    }
  }

  // Emit longitudinal quads for all active perimeter segments (outward normal = dT x dP)
  for (let sIdx = 0; sIdx < stationCount - 1; sIdx++) {
    const row0 = sIdx * ringVertStride;
    const row1 = (sIdx + 1) * ringVertStride;
    for (let i = 0; i < basePerimeterVerts; i++) {
      if (!isSegActive(segTags[i]!)) continue;
      const a = row0 + i;
      const b = row1 + i;
      const c = row1 + i + 1;
      const d = row0 + i + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  // End caps at start (sIdx = 0, outward -tDir) and end (sIdx = stationCount - 1, outward +tDir)
  const addEndCap = (sIdx: number, outwardSign: -1 | 1): void => {
    const ring = rings3D[sIdx]!;
    // Deduplicate adjacent vertices that collapsed when an embedded corner chamfer was set to 0
    const capPts: THREE.Vector3[] = [];
    for (let i = 0; i < basePerimeterVerts; i++) {
      const p = ring[i]!;
      if (capPts.length === 0 || p.distanceToSquared(capPts[capPts.length - 1]!) > 1e-12) {
        capPts.push(p);
      }
    }
    if (capPts.length > 2 && capPts[0]!.distanceToSquared(capPts[capPts.length - 1]!) <= 1e-12) {
      capPts.pop();
    }
    if (capPts.length < 3) return;

    const centroid = new THREE.Vector3();
    for (const p of capPts) centroid.add(p);
    centroid.divideScalar(capPts.length);

    const cVertIdx = positions.length / 3;
    positions.push(centroid.x, centroid.y, centroid.z);
    pushUv(outwardSign < 0 ? 0 : span, 0);

    const ringStart = positions.length / 3;
    const rel = new THREE.Vector3();
    for (let i = 0; i < capPts.length; i++) {
      const p = capPts[i]!;
      positions.push(p.x, p.y, p.z);
      rel.subVectors(p, centroid);
      pushUv(rel.dot(uDir), rel.dot(vDir) * 0.65);
    }

    // Clockwise ring in (uDir, vDir) where uDir x vDir = +tDir:
    // (p_i - c) x (p_{i+1} - c) points along -tDir!
    for (let i = 0; i < capPts.length; i++) {
      const v0 = ringStart + i;
      const v1 = ringStart + ((i + 1) % capPts.length);
      if (outwardSign < 0) {
        indices.push(cVertIdx, v0, v1);
      } else {
        indices.push(cVertIdx, v1, v0);
      }
    }
  };

  addEndCap(0, -1);
  addEndCap(stationCount - 1, 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Synchronize seam vertex normal (index 0 & basePerimeterVerts) when both top and cornerTL are active
  if (!omitTop && !cornerAdjOmitted[3]) {
    const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
    const n0 = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    for (let sIdx = 0; sIdx < stationCount; sIdx++) {
      const idxA = sIdx * ringVertStride;
      const idxB = idxA + basePerimeterVerts;
      n0.fromBufferAttribute(normAttr, idxA);
      n1.fromBufferAttribute(normAttr, idxB);
      n0.add(n1);
      if (n0.lengthSq() > 1e-10) {
        n0.normalize();
        normAttr.setXYZ(idxA, n0.x, n0.y, n0.z);
        normAttr.setXYZ(idxB, n0.x, n0.y, n0.z);
      }
    }
    normAttr.needsUpdate = true;
  }

  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.isSculpted = true;
  return geo;
}

/**
 * Axis-aligned local-centered aged timber beam geometry helper (drop-in replacement for `THREE.BoxGeometry(sizeX, sizeY, sizeZ)`).
 */
export function createAgedTimberBoxBeamGeometry(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  seed: TimberSeedInput,
  options: AgedTimberBoxBeamOptions = {}
): THREE.BufferGeometry {
  const { axis: explicitAxis, ...rest } = options;
  const axis: 'x' | 'y' | 'z' =
    explicitAxis ??
    (sizeX >= sizeY && sizeX >= sizeZ ? 'x' : sizeZ >= sizeX && sizeZ >= sizeY ? 'z' : 'y');

  if (axis === 'x') {
    return createAgedTimberBeamGeometry({
      start: [-sizeX * 0.5, 0, 0],
      end: [sizeX * 0.5, 0, 0],
      width: sizeZ,
      height: sizeY,
      upHint: [0, 1, 0],
      seed,
      ...rest,
    });
  }
  if (axis === 'z') {
    return createAgedTimberBeamGeometry({
      start: [0, 0, -sizeZ * 0.5],
      end: [0, 0, sizeZ * 0.5],
      width: sizeX,
      height: sizeY,
      upHint: [0, 1, 0],
      seed,
      ...rest,
    });
  }
  return createAgedTimberBeamGeometry({
    start: [0, -sizeY * 0.5, 0],
    end: [0, sizeY * 0.5, 0],
    width: sizeX,
    height: sizeZ,
    upHint: [0, 0, 1],
    seed,
    ...rest,
  });
}

/**
 * Builds an angled (`28°–52°`), hand-trowelled lime-plaster haunch / cove fillet strip along a
 * plaster-to-timber junction.
 *
 * Mathematical guarantees:
 * - Toe stands `+0.8 mm` proud of the base plaster plane (`> 0.35 mm` z-fight detector epsilon).
 * - Tucks `+3.5 mm` inside the timber cheek so localized arris chips never leak daylight.
 * - Every triangle normal deviates `>= 28°` (`|n · nPlaster| < 0.90` and `|n · nTimber| < 0.90`),
 *   mathematically guaranteeing `0` coplanar z-fighting overlaps.
 */
export function createPlasterBeamHaunchGeometry(
  options: PlasterBeamHaunchGeometryOptions
): THREE.BufferGeometry {
  const seedNum = hashTimberSeed(options.seed);
  const p0 = new THREE.Vector3(options.start[0], options.start[1], options.start[2]);
  const p1 = new THREE.Vector3(options.end[0], options.end[1], options.end[2]);
  const spanVec = new THREE.Vector3().subVectors(p1, p0);
  const span = Math.max(0.02, spanVec.length());

  const nSurf = new THREE.Vector3(
    options.surfaceNormal[0],
    options.surfaceNormal[1],
    options.surfaceNormal[2]
  ).normalize();
  const dTimber = new THREE.Vector3(
    options.intoTimberDir[0],
    options.intoTimberDir[1],
    options.intoTimberDir[2]
  ).normalize();

  const baseReach = THREE.MathUtils.clamp(options.reachM ?? 0.015, 0.008, 0.028);
  const baseClimb = THREE.MathUtils.clamp(options.climbM ?? 0.013, 0.006, 0.026);
  const tileM = Math.max(0.25, options.tileM ?? 2.4);
  const segments =
    options.segments ?? THREE.MathUtils.clamp(Math.round(span * 7.5), 10, 26);

  // Outward room normal of strip has positive dot with (nSurf - dTimber)
  const crossCheck = new THREE.Vector3().crossVectors(spanVec, dTimber).dot(nSurf);
  const flipWinding = crossCheck < 0;

  const PROF_COUNT = 4;
  const TUCK_INTO_TIMBER_M = 0.0035;
  const TOE_PROUD_M = 0.0008;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const endFade = Math.min(1, Math.min(t, 1 - t) / 0.06);
    const waveA = smoothNoise1D(t * 7.1 + 0.8, seedNum + 17) - 0.5;
    const waveB = smoothNoise1D(t * 14.8 + 3.2, seedNum + 37) - 0.5;

    const reach = THREE.MathUtils.clamp(
      baseReach * (1 + (waveA * 0.34 + waveB * 0.14) * endFade),
      0.009,
      0.025
    );
    const totalDx = reach + TUCK_INTO_TIMBER_M;
    // Clamp overall climb/dx ratio into [0.74, 1.08] so every sub-segment stays within 29°..53° (|dot| < 0.90)
    const targetSlope = THREE.MathUtils.clamp(
      (baseClimb * (1 + (waveA * 0.38 - waveB * 0.16) * endFade)) / totalDx,
      0.74,
      1.08
    );

    const dx0 = totalDx * 0.42;
    const dx1 = totalDx * 0.36;
    const dx2 = totalDx * 0.22;

    const dy0 = dx0 * Math.max(0.56, targetSlope * 0.72); // >= 29.2°
    const dy1 = dx1 * THREE.MathUtils.clamp(targetSlope * 0.98, 0.65, 1.25); // ~38°..45°
    const dy2 = dx2 * Math.min(1.38, Math.max(0.85, targetSlope * 1.24)); // <= 54.0°

    const x0 = -reach;
    const y0 = TOE_PROUD_M;
    const x1 = x0 + dx0;
    const y1 = y0 + dy0;
    const x2 = x1 + dx1;
    const y2 = y1 + dy1;
    const x3 = TUCK_INTO_TIMBER_M;
    const y3 = y2 + dy2;

    const profilePts: readonly (readonly [number, number])[] = [
      [x0, y0],
      [x1, y1],
      [x2, y2],
      [x3, y3],
    ];

    const basePt = p0.clone().lerp(p1, t);
    for (let k = 0; k < PROF_COUNT; k++) {
      const [alongTimber, alongNormal] = profilePts[k]!;
      const wp = basePt
        .clone()
        .addScaledVector(dTimber, alongTimber)
        .addScaledVector(nSurf, alongNormal);
      positions.push(wp.x, wp.y, wp.z);
      uvs.push((t * span) / tileM, (k * 0.008) / tileM);
    }
  }

  for (let s = 0; s < segments; s++) {
    const r0 = s * PROF_COUNT;
    const r1 = (s + 1) * PROF_COUNT;
    for (let k = 0; k < PROF_COUNT - 1; k++) {
      const a = r0 + k;
      const b = r1 + k;
      const c = r1 + k + 1;
      const d = r0 + k + 1;
      if (flipWinding) {
        indices.push(a, b, c, a, c, d);
      } else {
        indices.push(a, c, b, a, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.isSculpted = true;
  return geo;
}
