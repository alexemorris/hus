import * as THREE from 'three';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import type {
  VegetationExposure,
  VegetationOrganKind,
} from '../../core/geo/climate-phenology.ts';
import type { VegetationUniforms } from '../../engine/vegetation/vegetation-uniforms.ts';
import {
  OrganCollector,
  assembleBotanicalMeshes,
  buildPlanterAssembly,
  createBotanicalRng,
  resolveReactivity,
  type LeafShapeProfile,
  type PlanterStyle,
} from './organ-geometry.ts';
import {
  createSoilBed,
  type SoilBedHandle,
  type SoilBedPoint2D,
  type SoilPlantingAnchor,
} from './soil-bed.ts';

export type TopiaryForm =
  | 'bay-standard'
  | 'buxus-ball'
  | 'buxus-cone'
  | 'buxus-spiral'
  | 'olive-planter';

export interface CreateTopiaryOptions {
  readonly form: TopiaryForm;
  readonly height?: number;
  readonly radius?: number;
  readonly planter?: PlanterStyle | 'none';
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

export function createTopiary(options: CreateTopiaryOptions): THREE.Group {
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const seedVal = options.seed ?? 307 + options.form.length * 19;
  const rng = createBotanicalRng(seedVal);
  const namePrefix = options.name ?? `topiary.${options.form}`;
  const group = new THREE.Group();
  group.name = namePrefix;

  const defaultPlanter: PlanterStyle | 'none' =
    options.planter ?? (options.form === 'bay-standard' ? 'lead-cube' : 'terracotta');

  const totalHeight =
    options.height ??
    (options.form === 'buxus-ball'
      ? 0.85
      : options.form === 'bay-standard'
        ? 1.65
        : options.form === 'buxus-cone'
          ? 1.55
          : options.form === 'buxus-spiral'
            ? 1.7
            : 1.85);

  const crownR =
    options.radius ??
    (options.form === 'buxus-ball' || options.form === 'bay-standard'
      ? 0.34
      : options.form === 'olive-planter'
        ? 0.46
        : 0.32);

  let baseY = 0;
  if (defaultPlanter !== 'none') {
    const potH = THREE.MathUtils.clamp(totalHeight * 0.26, 0.26, 0.46);
    const potR = THREE.MathUtils.clamp(crownR * 0.78, 0.18, 0.32);
    const pot = buildPlanterAssembly({
      style: defaultPlanter,
      radiusTop: potR,
      radiusBottom: potR * 0.78,
      height: potH,
      namePrefix,
      exposure,
      uniforms: options.uniforms,
      seed: seedVal,
    });
    group.add(pot.group);
    baseY = pot.soilY;
  }

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const barkCol = new THREE.Color(options.form === 'olive-planter' ? 0x766e61 : 0x5c4c3d);
  const leafCol = new THREE.Color(
    options.form === 'bay-standard' ? 0x2d5424 : options.form === 'olive-planter' ? 0x5d7250 : 0x376428
  );
  const plantH = Math.max(0.35, totalHeight - baseY);

  const populateClippedShellPoint = (pt: THREE.Vector3, normal: THREE.Vector3, leafSize = 0.052): void => {
    foliage.addLeafCluster({
      pivot: pt,
      normal,
      leafCount: 6,
      leafLength: leafSize,
      leafWidth: leafSize * (options.form === 'olive-planter' ? 0.38 : 0.64),
      shape: options.form === 'olive-planter' ? 'lanceolate' : 'ovate',
      color: leafCol,
      droop: 0.1,
      rng,
      meta: { organ: 'evergreen-leaf', jitter: rng.next(), reactivity, variant: 0.2 },
    });
  };

  if (options.form === 'bay-standard' || options.form === 'olive-planter') {
    const ballCenterY = baseY + plantH - crownR;
    const stemTop = new THREE.Vector3(0, ballCenterY, 0);
    bark.addTaperedTube({
      points: [
        new THREE.Vector3(0, baseY, 0),
        new THREE.Vector3(rng.signed() * 0.015, baseY + (ballCenterY - baseY) * 0.5, rng.signed() * 0.015),
        stemTop,
      ],
      radii: [0.028, 0.023, 0.018],
      radialSegments: 7,
      color: barkCol,
      rootFlare: 0.2,
      jitter: rng.next(),
      reactivity,
    });

    const samples = options.form === 'olive-planter' ? 96 : 120;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < samples; i++) {
      const yNorm = 1 - (i / (samples - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
      const theta = golden * i;
      const n = new THREE.Vector3(Math.cos(theta) * rad, yNorm, Math.sin(theta) * rad);
      const rJit = crownR * (options.form === 'olive-planter' ? rng.range(0.75, 1.08) : rng.range(0.92, 1.02));
      const pt = new THREE.Vector3(n.x * rJit, ballCenterY + n.y * rJit * 0.96, n.z * rJit);
      if (i % 5 === 0) {
        bark.addTaperedTube({
          points: [stemTop, pt.clone().lerp(stemTop, 0.25)],
          radii: [0.012, 0.005],
          radialSegments: 4,
          color: barkCol,
          jitter: rng.next(),
          reactivity,
        });
      }
      populateClippedShellPoint(pt, n, options.form === 'olive-planter' ? 0.14 : 0.115);
    }
  } else if (options.form === 'buxus-ball') {
    const centerY = baseY + crownR * 0.92;
    bark.addTaperedTube({
      points: [new THREE.Vector3(0, baseY, 0), new THREE.Vector3(0, centerY, 0)],
      radii: [0.024, 0.012],
      radialSegments: 5,
      color: barkCol,
      jitter: rng.next(),
      reactivity,
    });
    const samples = 110;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < samples; i++) {
      const yNorm = 1 - (i / (samples - 1)) * 1.85;
      const rad = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
      const theta = golden * i;
      const n = new THREE.Vector3(Math.cos(theta) * rad, Math.max(-0.35, yNorm), Math.sin(theta) * rad).normalize();
      const rJit = crownR * rng.range(0.93, 1.02);
      populateClippedShellPoint(new THREE.Vector3(n.x * rJit, centerY + n.y * rJit * 0.94, n.z * rJit), n, 0.105);
    }
  } else if (options.form === 'buxus-cone') {
    bark.addTaperedTube({
      points: [new THREE.Vector3(0, baseY, 0), new THREE.Vector3(0, baseY + plantH * 0.88, 0)],
      radii: [0.026, 0.008],
      radialSegments: 5,
      color: barkCol,
      jitter: rng.next(),
      reactivity,
    });
    const rings = 11;
    for (let r = 0; r < rings; r++) {
      const t = r / (rings - 1);
      const ringY = baseY + 0.04 + t * (plantH - 0.06);
      const ringR = Math.max(0.03, crownR * (1 - t * 0.92));
      const count = Math.max(4, Math.round(14 * (1 - t * 0.72)));
      for (let k = 0; k < count; k++) {
        const az = r * 0.5 + (k / count) * Math.PI * 2;
        const n = new THREE.Vector3(Math.cos(az), 0.32, Math.sin(az)).normalize();
        populateClippedShellPoint(new THREE.Vector3(Math.cos(az) * ringR, ringY, Math.sin(az) * ringR), n, 0.048);
      }
    }
  } else {
    bark.addTaperedTube({
      points: [new THREE.Vector3(0, baseY, 0), new THREE.Vector3(0, baseY + plantH * 0.92, 0)],
      radii: [0.028, 0.01],
      radialSegments: 6,
      color: barkCol,
      jitter: rng.next(),
      reactivity,
    });
    const steps = 64;
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      const y = baseY + 0.05 + t * (plantH - 0.08);
      const helixAz = t * 3.2 * Math.PI * 2;
      const envR = crownR * (1 - t * 0.58);
      const cx = Math.cos(helixAz) * envR * 0.42;
      const cz = Math.sin(helixAz) * envR * 0.42;
      const tubeR = envR * 0.56;
      for (let c = 0; c < 4; c++) {
        const subAz = helixAz + (c / 4) * Math.PI * 2;
        const n = new THREE.Vector3(Math.cos(subAz), 0.25 + 0.35 * Math.sin(subAz), Math.sin(subAz)).normalize();
        populateClippedShellPoint(new THREE.Vector3(cx + Math.cos(subAz) * tubeR, y + n.y * tubeR * 0.35, cz + Math.sin(subAz) * tubeR), n, 0.046);
      }
    }
  }

  return assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    barkCollector: bark,
    foliageCollector: foliage,
    barkStyle: options.form === 'olive-planter' ? 'gnarled-olive' : 'smooth-beech',
    uniforms: options.uniforms,
    castCanopyShadow: options.castShadow ?? true,
    solidTrunkCollision: false,
    metadata: {
      name: `Architectural Topiary (${options.form})`,
      collection: 'husjs/vegetation Topiary',
      dimensionsMm: [Math.round(crownR * 2000), Math.round(crownR * 2000), Math.round(totalHeight * 1000)],
      ...options.metadata,
    },
  });
}

export type HedgeSpecies =
  | 'yew'
  | 'boxwood'
  | 'copper-beech'
  | 'privet'
  | 'laurel'
  | 'mixed-field-hedgerow'
  | 'blackthorn-sloe'
  | 'bramble';

export interface CreateHedgeOptions {
  readonly species: HedgeSpecies;
  readonly length?: number;
  readonly path?: readonly (readonly [number, number] | THREE.Vector2)[];
  readonly height?: number;
  readonly thickness?: number;
  readonly natural?: boolean;
  readonly mulchStrip?: boolean;
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

interface HedgeSpec {
  readonly label: string;
  readonly botanical: string;
  readonly defaultNatural: boolean;
  readonly organ: VegetationOrganKind;
  readonly color: number;
  readonly leafLen: number;
  readonly autumnVariant: number;
}

const HEDGE_SPECS: Readonly<Record<HedgeSpecies, HedgeSpec>> = {
  yew: { label: 'Clipped English Yew Hedge', botanical: 'Taxus baccata', defaultNatural: false, organ: 'evergreen-leaf', color: 0x1e3c20, leafLen: 0.14, autumnVariant: 0.1 },
  boxwood: { label: 'Clipped Boxwood Parterre Hedge', botanical: 'Buxus sempervirens', defaultNatural: false, organ: 'evergreen-leaf', color: 0x386327, leafLen: 0.13, autumnVariant: 0.1 },
  'copper-beech': { label: 'Clipped Copper Beech Hedge', botanical: 'Fagus sylvatica f. purpurea', defaultNatural: false, organ: 'marcescent-leaf', color: 0x4b222c, leafLen: 0.16, autumnVariant: 0.72 },
  privet: { label: 'Garden Privet Hedge', botanical: 'Ligustrum ovalifolium', defaultNatural: false, organ: 'evergreen-leaf', color: 0x3b682a, leafLen: 0.15, autumnVariant: 0.25 },
  laurel: { label: 'Cherry Laurel Hedge', botanical: 'Prunus laurocerasus', defaultNatural: false, organ: 'evergreen-leaf', color: 0x2e5c21, leafLen: 0.18, autumnVariant: 0.15 },
  'mixed-field-hedgerow': { label: 'British Mixed Field Hedgerow', botanical: 'Crataegus monogyna / Prunus spinosa / Corylus / Rubus', defaultNatural: true, organ: 'deciduous-leaf', color: 0x366424, leafLen: 0.15, autumnVariant: 0.56 },
  'blackthorn-sloe': { label: 'Blackthorn Sloe Hedgerow', botanical: 'Prunus spinosa', defaultNatural: true, organ: 'deciduous-leaf', color: 0x335d25, leafLen: 0.13, autumnVariant: 0.42 },
  bramble: { label: 'Wild Bramble Hedgerow', botanical: 'Rubus fruticosus', defaultNatural: true, organ: 'deciduous-leaf', color: 0x2d5822, leafLen: 0.16, autumnVariant: 0.84 },
};

function buildPolylineRibbonPolygon(pts: readonly THREE.Vector2[], halfWidth: number): SoilBedPoint2D[] {
  const leftSide: SoilBedPoint2D[] = [];
  const rightSide: SoilBedPoint2D[] = [];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const nPrev = i > 0 ? new THREE.Vector2(-(p.y - pts[i - 1]!.y), p.x - pts[i - 1]!.x).normalize() : null;
    const nNext = i < pts.length - 1 ? new THREE.Vector2(-(pts[i + 1]!.y - p.y), pts[i + 1]!.x - p.x).normalize() : null;
    const miter = nPrev && nNext ? nPrev.clone().add(nNext).normalize() : (nNext ?? nPrev ?? new THREE.Vector2(0, 1));
    const scale = nPrev && nNext ? THREE.MathUtils.clamp(1 / Math.max(0.35, miter.dot(nNext)), 1, 2.2) : 1;
    leftSide.push({ x: p.x + miter.x * halfWidth * scale, z: p.y + miter.y * halfWidth * scale });
    rightSide.push({ x: p.x - miter.x * halfWidth * scale, z: p.y - miter.y * halfWidth * scale });
  }
  rightSide.reverse();
  return [...leftSide, ...rightSide];
}

export function createHedge(options: CreateHedgeOptions): THREE.Group {
  const spec = HEDGE_SPECS[options.species];
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const natural = options.natural ?? spec.defaultNatural;
  const height = Math.max(0.3, options.height ?? (natural ? 1.55 : 1.4));
  const thickness = Math.max(0.24, options.thickness ?? (natural ? 0.95 : 0.55));
  const halfT = thickness * 0.5;
  const seedVal = options.seed ?? 503 + options.species.length * 29;
  const rng = createBotanicalRng(seedVal);
  const namePrefix = options.name ?? `hedge.${options.species}`;
  const group = new THREE.Group();
  group.name = namePrefix;

  const pts2d: THREE.Vector2[] =
    options.path && options.path.length >= 2
      ? options.path.map((p) => (p instanceof THREE.Vector2 ? p.clone() : new THREE.Vector2(p[0], p[1])))
      : [new THREE.Vector2(-(options.length ?? 3.0) * 0.5, 0), new THREE.Vector2((options.length ?? 3.0) * 0.5, 0)];

  const stemAnchors: SoilPlantingAnchor[] = [];
  for (let seg = 0; seg < pts2d.length - 1; seg++) {
    const a = pts2d[seg]!;
    const b = pts2d[seg + 1]!;
    const segLen = a.distanceTo(b);
    if (segLen < 1e-3) continue;
    const stemCount = Math.max(2, Math.ceil(segLen / (natural ? 0.45 : 0.55)));
    for (let s = 0; s <= stemCount; s++) {
      const f = s / stemCount;
      stemAnchors.push({
        x: THREE.MathUtils.lerp(a.x, b.x, f),
        z: THREE.MathUtils.lerp(a.y, b.y, f),
        stemRadius: 0.028,
        moundRadius: Math.min(0.16, thickness * 0.24),
        moundHeight: 0.015,
      });
    }
  }

  const useMulchStrip = options.mulchStrip ?? exposure === 'outdoor';
  let soilBed: SoilBedHandle | null = null;
  if (useMulchStrip) {
    const stripWidth = Math.max(0.18, thickness * 0.72);
    const isAxisStraight = pts2d.length === 2 && Math.abs(pts2d[0]!.y - pts2d[1]!.y) < 1e-4;
    soilBed = createSoilBed({
      substrate: natural ? 'garden-loam' : 'bark-mulch',
      exposure,
      ...(isAxisStraight
        ? {
            width: Math.max(0.2, Math.abs(pts2d[1]!.x - pts2d[0]!.x)),
            depth: stripWidth,
            center: { x: (pts2d[0]!.x + pts2d[1]!.x) * 0.5, z: pts2d[0]!.y },
          }
        : { polygon: buildPolylineRibbonPolygon(pts2d, stripWidth * 0.5) }),
      crownHeightM: 0.028,
      edgeRecessM: 0.008,
      plantings: stemAnchors.slice(0, 36),
      seasonalLitter: natural && exposure === 'outdoor' ? 'autumn-leaves' : false,
      uniforms: options.uniforms,
      seed: seedVal,
      name: `${namePrefix}.mulchStrip`,
    });
    group.add(soilBed.group);
  }

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const barkCol = new THREE.Color(options.species === 'blackthorn-sloe' ? 0x3b312a : options.species === 'bramble' ? 0x4c362e : 0x524438);
  const leafCol = new THREE.Color(spec.color);
  const blossomWhite = new THREE.Color(0xfaf8f2);
  const blossomCream = new THREE.Color(0xefe6c8);
  const sloeBlue = new THREE.Color(0x242a48);
  const blackberryDark = new THREE.Color(0x1f1122);

  let totalLen = 0;
  let runningDist = 0;

  for (let seg = 0; seg < pts2d.length - 1; seg++) {
    const a = pts2d[seg]!;
    const b = pts2d[seg + 1]!;
    const segVec = new THREE.Vector2().subVectors(b, a);
    const segLen = segVec.length();
    if (segLen < 1e-3) continue;
    const segStartDist = runningDist;
    totalLen += segLen;
    runningDist += segLen;
    const tangent = segVec.clone().divideScalar(segLen);
    const normal2 = new THREE.Vector2(-tangent.y, tangent.x);

    if (natural) {
      const moundSpacing = 0.52;
      const moundCount = Math.max(3, Math.ceil(segLen / moundSpacing));

      for (let m = 0; m <= moundCount; m++) {
        const fm = m / moundCount;
        const alongM = segStartDist + fm * segLen;
        const cx = THREE.MathUtils.lerp(a.x, b.x, fm);
        const cz = THREE.MathUtils.lerp(a.y, b.y, fm);
        const rootY = soilBed ? soilBed.samplePlantingY(cx, cz) : -0.015;

        const crownMult = THREE.MathUtils.clamp(
          0.98 + 0.16 * Math.sin(alongM * 1.9 + seedVal * 0.1) + 0.1 * Math.cos(alongM * 3.7 - seedVal * 0.2) + rng.signed() * 0.08,
          0.78,
          1.24
        );
        const billowMult = THREE.MathUtils.clamp(0.96 + 0.18 * Math.cos(alongM * 2.3 + seedVal * 0.3) + rng.signed() * 0.1, 0.76, 1.26);
        const localH = height * crownMult;
        const localR = halfT * billowMult;

        const stemsHere = options.species === 'bramble' ? 4 : 3;
        for (let st = 0; st < stemsHere; st++) {
          const leanSide = rng.signed() * localR * 0.85;
          const leanAlong = rng.signed() * 0.28;
          const basePt = new THREE.Vector3(cx + normal2.x * rng.signed() * 0.08, rootY, cz + normal2.y * rng.signed() * 0.08);
          const midPt = new THREE.Vector3(
            cx + normal2.x * leanSide * 0.55 + tangent.x * leanAlong * 0.5,
            localH * rng.range(0.45, 0.65),
            cz + normal2.y * leanSide * 0.55 + tangent.y * leanAlong * 0.5
          );
          const isArchingCane = options.species === 'bramble' || (options.species === 'mixed-field-hedgerow' && st === stemsHere - 1);
          const tipPt = isArchingCane
            ? new THREE.Vector3(
                cx + normal2.x * (leanSide >= 0 ? 1 : -1) * localR * rng.range(0.92, 1.18) + tangent.x * leanAlong,
                localH * rng.range(0.32, 0.72),
                cz + normal2.y * (leanSide >= 0 ? 1 : -1) * localR * rng.range(0.92, 1.18) + tangent.y * leanAlong
              )
            : new THREE.Vector3(cx + normal2.x * leanSide + tangent.x * leanAlong, localH * rng.range(0.78, 0.96), cz + normal2.y * leanSide + tangent.y * leanAlong);

          bark.addTaperedTube({
            points: [basePt, midPt, tipPt],
            radii: isArchingCane ? [0.015, 0.009, 0.004] : [0.026, 0.016, 0.007],
            radialSegments: 5,
            color: barkCol,
            jitter: rng.next(),
            reactivity,
          });
        }

        const samples = Math.max(12, Math.round(16 * billowMult));
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (let k = 0; k < samples; k++) {
          const yFrac = 0.1 + 0.9 * (k / (samples - 1));
          const domeProfile = Math.sin(Math.pow(yFrac, 0.72) * Math.PI * 0.94);
          const az = k * golden + m * 1.3;
          const rShell = localR * (0.45 + 0.62 * domeProfile) * rng.range(0.84, 1.12);
          const offSide = Math.sin(az) * rShell;
          const offAlong = Math.cos(az) * Math.min(moundSpacing * 0.68, rShell * 0.85);
          const px = cx + normal2.x * offSide + tangent.x * offAlong;
          const py = localH * yFrac * rng.range(0.92, 1.06);
          const pz = cz + normal2.y * offSide + tangent.y * offAlong;
          const nrm = new THREE.Vector3(
            normal2.x * Math.sin(az) + tangent.x * Math.cos(az) * 0.45,
            0.25 + yFrac * 0.55,
            normal2.y * Math.sin(az) + tangent.y * Math.cos(az) * 0.45
          ).normalize();
          const piv = new THREE.Vector3(px, py, pz);
          const jitter = rng.next();

          let clusterOrgan: VegetationOrganKind = 'deciduous-leaf';
          let clusterShape: LeafShapeProfile = 'ovate';
          let clusterCol = leafCol.clone();
          let autumnVar = spec.autumnVariant;

          if (options.species === 'mixed-field-hedgerow') {
            const pick = k % 5;
            if (pick === 0) {
              clusterOrgan = 'evergreen-leaf';
              clusterShape = 'ivy-palmate';
              clusterCol = new THREE.Color(0x1f491f);
              autumnVar = 0.2;
            } else if (pick === 1) {
              clusterShape = 'lobed-oak';
              clusterCol = new THREE.Color(0x3a6a26);
              autumnVar = 0.34;
            } else if (pick === 2) {
              clusterShape = 'cordate';
              clusterCol = new THREE.Color(0x46742b);
              autumnVar = 0.18;
            } else if (pick === 3) {
              clusterShape = 'serrated-vine';
              clusterCol = new THREE.Color(0x2f5a22);
              autumnVar = 0.86;
            } else {
              clusterShape = 'ovate';
              clusterCol = new THREE.Color(0x335f25);
              autumnVar = 0.68;
            }
          } else if (options.species === 'blackthorn-sloe') {
            clusterShape = 'ovate';
            autumnVar = rng.range(0.32, 0.55);
          } else if (options.species === 'bramble') {
            clusterOrgan = k % 5 === 0 ? 'evergreen-leaf' : 'deciduous-leaf';
            clusterShape = 'serrated-vine';
            autumnVar = rng.range(0.76, 0.94);
          }

          foliage.addLeafCluster({
            pivot: piv,
            normal: nrm,
            leafCount: 5,
            leafLength: spec.leafLen * rng.range(0.85, 1.15),
            leafWidth: spec.leafLen * 0.68,
            shape: clusterShape,
            color: clusterCol,
            droop: options.species === 'bramble' ? 0.28 : 0.18,
            rng,
            meta: { organ: clusterOrgan, jitter, reactivity, variant: autumnVar },
          });

          const blossomChance = options.species === 'blackthorn-sloe' ? 0.58 : options.species === 'mixed-field-hedgerow' ? 0.42 : 0.28;
          if (yFrac > 0.28 && rng.next() < blossomChance) {
            for (let bf = 0, driftFlowers = options.species === 'blackthorn-sloe' ? 2 : 1; bf < driftFlowers; bf++) {
              const bPiv = piv.clone().addScaledVector(nrm, 0.022).add(new THREE.Vector3(rng.signed() * 0.035, rng.signed() * 0.025, rng.signed() * 0.035));
              foliage.addFlowerRosette({
                pivot: bPiv,
                normal: nrm,
                radius: rng.range(0.022, 0.034),
                petalCount: 5,
                layers: 1,
                cupFactor: 0.24,
                petalColor: blossomWhite,
                centerColor: blossomCream,
                rng,
                meta: { organ: 'spring-blossom', jitter: THREE.MathUtils.clamp(jitter + bf * 0.04, 0, 1), reactivity, variant: rng.range(0.35, 0.58) },
              });
            }
          }

          if (yFrac > 0.22 && rng.next() < 0.36) {
            const isSloe = options.species === 'blackthorn-sloe' || (options.species === 'mixed-field-hedgerow' && k % 2 === 0);
            const berryCol = isSloe ? sloeBlue : blackberryDark;
            for (let bIdx = 0, berryCount = isSloe ? rng.int(2, 4) : rng.int(3, 5); bIdx < berryCount; bIdx++) {
              foliage.addSpheroidOrgan({
                pivot: piv,
                centerOffset: new THREE.Vector3(nrm.x * 0.024 + rng.signed() * 0.022, -0.01 + rng.signed() * 0.018, nrm.z * 0.024 + rng.signed() * 0.022),
                radiusXZ: isSloe ? 0.011 : 0.012,
                radiusY: isSloe ? 0.012 : 0.014,
                latSegments: 4,
                lonSegments: 5,
                color: berryCol.clone().offsetHSL(rng.signed() * 0.015, rng.signed() * 0.04, rng.signed() * 0.03),
                meta: { organ: 'fruit', jitter: THREE.MathUtils.clamp(jitter + bIdx * 0.03, 0, 1), reactivity, variant: 0.28 },
              });
            }
          }
        }
      }
      continue;
    }

    const stemCount = Math.max(2, Math.ceil(segLen / 0.55));
    for (let s = 0; s <= stemCount; s++) {
      const f = s / stemCount;
      const sx = THREE.MathUtils.lerp(a.x, b.x, f);
      const sz = THREE.MathUtils.lerp(a.y, b.y, f);
      const rootY = soilBed ? soilBed.samplePlantingY(sx, sz) : 0;
      bark.addTaperedTube({
        points: [
          new THREE.Vector3(sx, rootY, sz),
          new THREE.Vector3(sx + rng.signed() * 0.04, height * 0.5, sz + rng.signed() * 0.04),
          new THREE.Vector3(sx + rng.signed() * 0.06, height * 0.88, sz + rng.signed() * 0.06),
        ],
        radii: [0.028, 0.018, 0.008],
        radialSegments: 5,
        color: barkCol,
        jitter: rng.next(),
        reactivity,
      });
    }

    const spacing = 0.15;
    const nAlong = Math.max(2, Math.ceil(segLen / spacing));
    const nVert = Math.max(2, Math.ceil(height / spacing));
    const nAcross = Math.max(2, Math.ceil(thickness / spacing));

    const emitShellCluster = (px: number, py: number, pz: number, nx: number, ny: number, nz: number): void => {
      foliage.addLeafCluster({
        pivot: new THREE.Vector3(px + rng.signed() * 0.018, py + rng.signed() * 0.018, pz + rng.signed() * 0.018),
        normal: new THREE.Vector3(nx, ny, nz).normalize(),
        leafCount: 6,
        leafLength: spec.leafLen,
        leafWidth: spec.leafLen * (options.species === 'yew' ? 0.52 : 0.72),
        shape: options.species === 'yew' ? 'needle-spray' : 'ovate',
        color: leafCol,
        droop: 0.12,
        rng,
        meta: { organ: spec.organ, jitter: rng.next(), reactivity, variant: spec.autumnVariant },
      });
    };

    for (let ia = 0; ia <= nAlong; ia++) {
      const fa = ia / nAlong;
      const cx = THREE.MathUtils.lerp(a.x, b.x, fa);
      const cz = THREE.MathUtils.lerp(a.y, b.y, fa);

      for (let iv = 0; iv <= nVert; iv++) {
        const y = 0.05 + (iv / nVert) * (height - 0.08);
        const taper = THREE.MathUtils.lerp(1.0, 0.92, iv / nVert);
        emitShellCluster(cx + normal2.x * halfT * taper, y, cz + normal2.y * halfT * taper, normal2.x, 0.18, normal2.y);
        emitShellCluster(cx - normal2.x * halfT * taper, y, cz - normal2.y * halfT * taper, -normal2.x, 0.18, -normal2.y);
      }

      for (let ic = 0; ic <= nAcross; ic++) {
        const off = THREE.MathUtils.lerp(-halfT * 0.9, halfT * 0.9, ic / nAcross);
        emitShellCluster(cx + normal2.x * off, height - 0.02, cz + normal2.y * off, normal2.x * (off / halfT) * 0.25, 1, normal2.y * (off / halfT) * 0.25);
      }
    }

    const addCap = (endPt: THREE.Vector2, dirSign: number): void => {
      for (let iv = 0; iv <= nVert; iv++) {
        const y = 0.05 + (iv / nVert) * (height - 0.08);
        for (let ic = 0; ic <= nAcross; ic++) {
          const off = THREE.MathUtils.lerp(-halfT * 0.9, halfT * 0.9, ic / nAcross);
          emitShellCluster(endPt.x + normal2.x * off, y, endPt.y + normal2.y * off, tangent.x * dirSign, 0.15, tangent.y * dirSign);
        }
      }
    };
    if (seg === 0) addCap(a, -1);
    if (seg === pts2d.length - 2) addCap(b, 1);
  }

  return assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    barkCollector: bark,
    foliageCollector: foliage,
    barkStyle: natural ? 'fissured-oak' : 'smooth-beech',
    uniforms: options.uniforms,
    castCanopyShadow: options.castShadow ?? true,
    solidTrunkCollision: false,
    metadata: {
      name: `${spec.label} (${spec.botanical})`,
      collection: 'husjs/vegetation Hedges',
      dimensionsMm: [Math.round(totalLen * 1000), Math.round(thickness * 1000), Math.round(height * 1000)],
      ...options.metadata,
    },
  });
}
