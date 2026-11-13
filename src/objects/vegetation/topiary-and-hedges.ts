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
  type PlanterStyle,
} from './organ-geometry.ts';

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
  const rng = createBotanicalRng(options.seed ?? 307 + options.form.length * 19);
  const namePrefix = options.name ?? `topiary.${options.form}`;
  const group = new THREE.Group();
  group.name = namePrefix;

  const defaultPlanter: PlanterStyle | 'none' =
    options.planter ??
    (options.form === 'bay-standard'
      ? 'lead-cube'
      : options.form === 'olive-planter'
        ? 'terracotta'
        : 'terracotta');

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
    (options.form === 'buxus-ball'
      ? 0.34
      : options.form === 'bay-standard'
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
    });
    group.add(pot.group);
    baseY = pot.soilY;
  }

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const barkCol = new THREE.Color(options.form === 'olive-planter' ? 0x766e61 : 0x5c4c3d);
  const leafCol = new THREE.Color(
    options.form === 'bay-standard'
      ? 0x2d5424
      : options.form === 'olive-planter'
        ? 0x5d7250
        : 0x376428
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
      meta: {
        organ: 'evergreen-leaf',
        jitter: rng.next(),
        reactivity,
        variant: 0.2,
      },
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
      const pt = new THREE.Vector3(n.x * rJit, centerY + n.y * rJit * 0.94, n.z * rJit);
      populateClippedShellPoint(pt, n, 0.105);
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
        const az = (r * 0.5) + (k / count) * Math.PI * 2;
        const n = new THREE.Vector3(Math.cos(az), 0.32, Math.sin(az)).normalize();
        const pt = new THREE.Vector3(Math.cos(az) * ringR, ringY, Math.sin(az) * ringR);
        populateClippedShellPoint(pt, n, 0.048);
      }
    }
  } else {
    // buxus-spiral
    bark.addTaperedTube({
      points: [new THREE.Vector3(0, baseY, 0), new THREE.Vector3(0, baseY + plantH * 0.92, 0)],
      radii: [0.028, 0.01],
      radialSegments: 6,
      color: barkCol,
      jitter: rng.next(),
      reactivity,
    });
    const turns = 3.2;
    const steps = 64;
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      const y = baseY + 0.05 + t * (plantH - 0.08);
      const helixAz = t * turns * Math.PI * 2;
      const envR = crownR * (1 - t * 0.58);
      const cx = Math.cos(helixAz) * envR * 0.42;
      const cz = Math.sin(helixAz) * envR * 0.42;
      const tubeR = envR * 0.56;
      for (let c = 0; c < 4; c++) {
        const subAz = helixAz + (c / 4) * Math.PI * 2;
        const n = new THREE.Vector3(Math.cos(subAz), 0.25 + 0.35 * Math.sin(subAz), Math.sin(subAz)).normalize();
        const pt = new THREE.Vector3(cx + Math.cos(subAz) * tubeR, y + n.y * tubeR * 0.35, cz + Math.sin(subAz) * tubeR);
        populateClippedShellPoint(pt, n, 0.046);
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
      dimensionsMm: [
        Math.round(crownR * 2000),
        Math.round(crownR * 2000),
        Math.round(totalHeight * 1000),
      ],
      ...options.metadata,
    },
  });
}

export type HedgeSpecies = 'yew' | 'boxwood' | 'copper-beech' | 'privet' | 'laurel';

export interface CreateHedgeOptions {
  readonly species: HedgeSpecies;
  readonly length?: number;
  readonly path?: readonly (readonly [number, number] | THREE.Vector2)[];
  readonly height?: number;
  readonly thickness?: number;
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

const HEDGE_SPECS: Readonly<
  Record<
    HedgeSpecies,
    {
      readonly label: string;
      readonly botanical: string;
      readonly organ: VegetationOrganKind;
      readonly color: number;
      readonly leafLen: number;
      readonly autumnVariant: number;
    }
  >
> = {
  yew: {
    label: 'Clipped English Yew Hedge',
    botanical: 'Taxus baccata',
    organ: 'evergreen-leaf',
    color: 0x1e3c20,
    leafLen: 0.14,
    autumnVariant: 0.1,
  },
  boxwood: {
    label: 'Clipped Boxwood Parterre Hedge',
    botanical: 'Buxus sempervirens',
    organ: 'evergreen-leaf',
    color: 0x386327,
    leafLen: 0.13,
    autumnVariant: 0.1,
  },
  'copper-beech': {
    label: 'Clipped Copper Beech Hedge',
    botanical: 'Fagus sylvatica f. purpurea',
    organ: 'marcescent-leaf',
    color: 0x4b222c,
    leafLen: 0.16,
    autumnVariant: 0.72,
  },
  privet: {
    label: 'Garden Privet Hedge',
    botanical: 'Ligustrum ovalifolium',
    organ: 'evergreen-leaf',
    color: 0x3b682a,
    leafLen: 0.15,
    autumnVariant: 0.25,
  },
  laurel: {
    label: 'Cherry Laurel Hedge',
    botanical: 'Prunus laurocerasus',
    organ: 'evergreen-leaf',
    color: 0x2e5c21,
    leafLen: 0.18,
    autumnVariant: 0.15,
  },
};

export function createHedge(options: CreateHedgeOptions): THREE.Group {
  const spec = HEDGE_SPECS[options.species];
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const height = Math.max(0.3, options.height ?? 1.4);
  const thickness = Math.max(0.24, options.thickness ?? 0.55);
  const halfT = thickness * 0.5;
  const rng = createBotanicalRng(options.seed ?? 503 + options.species.length * 29);

  const pts2d: THREE.Vector2[] =
    options.path && options.path.length >= 2
      ? options.path.map((p) => (p instanceof THREE.Vector2 ? p.clone() : new THREE.Vector2(p[0], p[1])))
      : [
          new THREE.Vector2(-(options.length ?? 3.0) * 0.5, 0),
          new THREE.Vector2((options.length ?? 3.0) * 0.5, 0),
        ];

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const barkCol = new THREE.Color(0x524438);
  const leafCol = new THREE.Color(spec.color);

  let totalLen = 0;
  for (let seg = 0; seg < pts2d.length - 1; seg++) {
    const a = pts2d[seg]!;
    const b = pts2d[seg + 1]!;
    const segVec = new THREE.Vector2().subVectors(b, a);
    const segLen = segVec.length();
    if (segLen < 1e-3) continue;
    totalLen += segLen;
    const tangent = segVec.clone().divideScalar(segLen);
    const normal2 = new THREE.Vector2(-tangent.y, tangent.x);

    // Woody interior stems spaced every ~0.55m so bare/marcescent structure has depth
    const stemStep = 0.55;
    const stemCount = Math.max(2, Math.ceil(segLen / stemStep));
    for (let s = 0; s <= stemCount; s++) {
      const f = s / stemCount;
      const sx = THREE.MathUtils.lerp(a.x, b.x, f);
      const sz = THREE.MathUtils.lerp(a.y, b.y, f);
      bark.addTaperedTube({
        points: [
          new THREE.Vector3(sx, 0, sz),
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

    // Dense outer leaf-cluster shell on front, back, top, and end caps
    const spacing = 0.15;
    const nAlong = Math.max(2, Math.ceil(segLen / spacing));
    const nVert = Math.max(2, Math.ceil(height / spacing));
    const nAcross = Math.max(2, Math.ceil(thickness / spacing));

    const emitShellCluster = (px: number, py: number, pz: number, nx: number, ny: number, nz: number): void => {
      const jitterPos = new THREE.Vector3(
        px + rng.signed() * 0.018,
        py + rng.signed() * 0.018,
        pz + rng.signed() * 0.018
      );
      foliage.addLeafCluster({
        pivot: jitterPos,
        normal: new THREE.Vector3(nx, ny, nz).normalize(),
        leafCount: 6,
        leafLength: spec.leafLen,
        leafWidth: spec.leafLen * (options.species === 'yew' ? 0.52 : 0.72),
        shape: options.species === 'yew' ? 'needle-spray' : 'ovate',
        color: leafCol,
        droop: 0.12,
        rng,
        meta: {
          organ: spec.organ,
          jitter: rng.next(),
          reactivity,
          variant: spec.autumnVariant,
        },
      });
    };

    for (let ia = 0; ia <= nAlong; ia++) {
      const fa = ia / nAlong;
      const cx = THREE.MathUtils.lerp(a.x, b.x, fa);
      const cz = THREE.MathUtils.lerp(a.y, b.y, fa);

      for (let iv = 0; iv <= nVert; iv++) {
        const y = 0.05 + (iv / nVert) * (height - 0.08);
        const taper = THREE.MathUtils.lerp(1.0, 0.92, iv / nVert);
        emitShellCluster(
          cx + normal2.x * halfT * taper,
          y,
          cz + normal2.y * halfT * taper,
          normal2.x,
          0.18,
          normal2.y
        );
        emitShellCluster(
          cx - normal2.x * halfT * taper,
          y,
          cz - normal2.y * halfT * taper,
          -normal2.x,
          0.18,
          -normal2.y
        );
      }

      for (let ic = 0; ic <= nAcross; ic++) {
        const off = THREE.MathUtils.lerp(-halfT * 0.9, halfT * 0.9, ic / nAcross);
        emitShellCluster(
          cx + normal2.x * off,
          height - 0.02,
          cz + normal2.y * off,
          normal2.x * (off / halfT) * 0.25,
          1,
          normal2.y * (off / halfT) * 0.25
        );
      }
    }

    // End caps on first & last segment
    const addCap = (endPt: THREE.Vector2, dirSign: number): void => {
      for (let iv = 0; iv <= nVert; iv++) {
        const y = 0.05 + (iv / nVert) * (height - 0.08);
        for (let ic = 0; ic <= nAcross; ic++) {
          const off = THREE.MathUtils.lerp(-halfT * 0.9, halfT * 0.9, ic / nAcross);
          emitShellCluster(
            endPt.x + normal2.x * off,
            y,
            endPt.y + normal2.y * off,
            tangent.x * dirSign,
            0.15,
            tangent.y * dirSign
          );
        }
      }
    };
    if (seg === 0) addCap(a, -1);
    if (seg === pts2d.length - 2) addCap(b, 1);
  }

  const namePrefix = options.name ?? `hedge.${options.species}`;
  const group = new THREE.Group();
  group.name = namePrefix;
  return assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    barkCollector: bark,
    foliageCollector: foliage,
    barkStyle: 'smooth-beech',
    uniforms: options.uniforms,
    castCanopyShadow: options.castShadow ?? true,
    solidTrunkCollision: false,
    metadata: {
      name: `${spec.label} (${spec.botanical})`,
      collection: 'husjs/vegetation Hedges',
      dimensionsMm: [
        Math.round(totalLen * 1000),
        Math.round(thickness * 1000),
        Math.round(height * 1000),
      ],
      ...options.metadata,
    },
  });
}
