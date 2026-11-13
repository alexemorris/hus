import * as THREE from 'three';
import {
  VEGETATION_ORGAN_CODES,
  type VegetationOrganKind,
} from '../../core/geo/climate-phenology.ts';
import { VEG_META_ATTR, VEG_PIVOT_ATTR } from './phenology-material.ts';

export interface BotanicalRng {
  next(): number;
  range(min: number, max: number): number;
  signed(): number;
  int(minInclusive: number, maxInclusive: number): number;
}

export function createBotanicalRng(seed = 1337): BotanicalRng {
  let state = (Math.imul(Math.round(seed * 1000) | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => THREE.MathUtils.lerp(min, max, next()),
    signed: () => next() * 2 - 1,
    int: (min, max) => Math.floor(THREE.MathUtils.lerp(min, max + 0.999, next())),
  };
}

export type LeafShapeProfile =
  | 'ovate'
  | 'lobed-oak'
  | 'lanceolate'
  | 'cordate'
  | 'lyrate-fiddle'
  | 'monstera'
  | 'needle-spray'
  | 'succulent-sword'
  | 'fern-frond'
  | 'palm-frond'
  | 'ivy-palmate'
  | 'serrated-vine'
  | 'elliptic-gloss'
  | 'pinwheel-petal';

export interface OrganMetaInput {
  readonly organ: VegetationOrganKind;
  readonly jitter: number;
  readonly reactivity: number;
  readonly variant: number;
}

/**
 * Accumulates multi-organ botanical geometry with `position`, `normal`, `uv`, `color`,
 * `aVegPivot`, and `aVegMeta` attributes into a single indexed `THREE.BufferGeometry`.
 */
export class OrganCollector {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly pivots: number[] = [];
  private readonly metas: number[] = [];
  private readonly indices: number[] = [];
  private vertexCount = 0;

  public isEmpty(): boolean {
    return this.vertexCount === 0 || this.indices.length === 0;
  }

  public getVertexCount(): number {
    return this.vertexCount;
  }

  public pushVertex(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    r: number, g: number, b: number,
    pivX: number, pivY: number, pivZ: number,
    organCode: number, jitter: number, reactivity: number, variant: number
  ): number {
    const idx = this.vertexCount++;
    this.positions.push(px, py, pz);
    const nLen = Math.hypot(nx, ny, nz) || 1;
    this.normals.push(nx / nLen, ny / nLen, nz / nLen);
    this.uvs.push(u, v);
    this.colors.push(
      THREE.MathUtils.clamp(r, 0, 1),
      THREE.MathUtils.clamp(g, 0, 1),
      THREE.MathUtils.clamp(b, 0, 1)
    );
    this.pivots.push(pivX, pivY, pivZ);
    this.metas.push(
      organCode,
      THREE.MathUtils.clamp(jitter, 0, 1),
      THREE.MathUtils.clamp(reactivity, 0, 1),
      THREE.MathUtils.clamp(variant, 0, 1)
    );
    return idx;
  }

  public pushTriangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  public pushQuad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  public addTaperedTube(opts: {
    readonly points: readonly THREE.Vector3[];
    readonly radii: readonly number[];
    readonly radialSegments?: number;
    readonly color: THREE.Color;
    readonly rootFlare?: number;
    readonly barkFluting?: number;
    readonly jitter?: number;
    readonly reactivity?: number;
  }): void {
    const pts = opts.points;
    if (pts.length < 2) return;
    const radSegs = Math.max(4, opts.radialSegments ?? 7);
    const organCode = VEGETATION_ORGAN_CODES.bark;
    const jitter = opts.jitter ?? 0.5;
    const reactivity = opts.reactivity ?? 1.0;
    const flare = opts.rootFlare ?? 0;
    const fluting = opts.barkFluting ?? 0;

    const baseVertex = this.vertexCount;
    let arcLen = 0;
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    const prevNormal = new THREE.Vector3(1, 0, 0);

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i > 0) arcLen += p.distanceTo(pts[i - 1]!);
      if (i < pts.length - 1) tangent.subVectors(pts[i + 1]!, p).normalize();
      else tangent.subVectors(p, pts[i - 1]!).normalize();
      if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0);

      if (i === 0) {
        const upRef = Math.abs(tangent.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
        normal.crossVectors(upRef, tangent).normalize();
      } else {
        normal.copy(prevNormal).addScaledVector(tangent, -prevNormal.dot(tangent));
        if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0).cross(tangent).normalize();
        else normal.normalize();
      }
      prevNormal.copy(normal);
      binormal.crossVectors(tangent, normal).normalize();

      const t = i / (pts.length - 1);
      const baseR = opts.radii[Math.min(i, opts.radii.length - 1)] ?? 0.02;
      const shade = THREE.MathUtils.lerp(0.84, 1.04, t);

      for (let s = 0; s <= radSegs; s++) {
        const u = s / radSegs;
        const theta = u * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const rootLobe =
          flare > 0 && t < 0.24 ? 1 + flare * Math.pow(1 - t / 0.24, 2) * (0.65 + 0.35 * Math.cos(theta * 5)) : 1;
        const fluteMod = fluting > 0 ? 1 + fluting * Math.sin(theta * 6 + arcLen * 3.5) : 1;
        const r = baseR * rootLobe * fluteMod;
        const nx = normal.x * cosT + binormal.x * sinT;
        const ny = normal.y * cosT + binormal.y * sinT;
        const nz = normal.z * cosT + binormal.z * sinT;
        const px = p.x + nx * r;
        const py = p.y + ny * r;
        const pz = p.z + nz * r;

        this.pushVertex(
          px, py, pz, nx, ny, nz, u, arcLen * 1.4,
          opts.color.r * shade, opts.color.g * shade, opts.color.b * shade,
          px, py, pz, organCode, jitter, reactivity, 0.5
        );
      }
    }

    const ringStride = radSegs + 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const r0 = baseVertex + i * ringStride;
      const r1 = r0 + ringStride;
      for (let s = 0; s < radSegs; s++) this.pushQuad(r0 + s, r0 + s + 1, r1 + s + 1, r1 + s);
    }

    const tipCenter = pts[pts.length - 1]!;
    const tipIdx = this.pushVertex(
      tipCenter.x, tipCenter.y, tipCenter.z, tangent.x, tangent.y, tangent.z,
      0.5, arcLen * 1.4, opts.color.r, opts.color.g, opts.color.b,
      tipCenter.x, tipCenter.y, tipCenter.z, organCode, jitter, reactivity, 0.5
    );
    const lastRing = baseVertex + (pts.length - 1) * ringStride;
    for (let s = 0; s < radSegs; s++) this.pushTriangle(lastRing + s, lastRing + s + 1, tipIdx);
  }

  public addCuppedLeafBlade(opts: {
    readonly pivot: THREE.Vector3;
    readonly direction: THREE.Vector3;
    readonly upHint?: THREE.Vector3;
    readonly length: number;
    readonly width: number;
    readonly archDrop?: number;
    readonly cupDepth?: number;
    readonly shape?: LeafShapeProfile;
    readonly segsLength?: number;
    readonly segsWidth?: number;
    readonly color: THREE.Color;
    readonly meta: OrganMetaInput;
  }): void {
    const shape = opts.shape ?? 'ovate';
    const defaultSegsT =
      shape === 'lyrate-fiddle' || shape === 'monstera'
        ? 6
        : shape === 'ivy-palmate' || shape === 'serrated-vine'
          ? 5
          : 3;
    const segsT = Math.max(2, opts.segsLength ?? defaultSegsT);
    const segsS = Math.max(2, opts.segsWidth ?? 2);
    const archDrop = opts.archDrop ?? opts.length * 0.22;
    const cupDepth = opts.cupDepth ?? opts.width * 0.16;
    const organCode = VEGETATION_ORGAN_CODES[opts.meta.organ];

    const zAxis = opts.direction.clone().normalize();
    if (zAxis.lengthSq() < 1e-6) zAxis.set(0, 0, 1);
    const upRef = opts.upHint ?? (Math.abs(zAxis.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
    const xAxis = new THREE.Vector3().crossVectors(upRef, zAxis);
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    const baseV = this.vertexCount;
    for (let it = 0; it <= segsT; it++) {
      const t = it / segsT;
      let widthEnv = Math.sin(Math.pow(t, 0.72) * Math.PI);
      if (shape === 'lobed-oak') {
        widthEnv *= 0.78 + 0.28 * Math.sin(t * Math.PI * 5.0);
      } else if (shape === 'lanceolate' || shape === 'needle-spray') {
        widthEnv = Math.sin(Math.pow(t, 0.85) * Math.PI) * 0.65;
      } else if (shape === 'cordate') {
        widthEnv = Math.sin(Math.pow(t, 0.55) * Math.PI) * (1.08 - 0.22 * t);
      } else if (shape === 'lyrate-fiddle') {
        const pinch = -0.28 * Math.exp(-Math.pow((t - 0.38) / 0.14, 2));
        const upper = 0.36 * Math.exp(-Math.pow((t - 0.74) / 0.2, 2));
        widthEnv = THREE.MathUtils.clamp(widthEnv * (0.78 + pinch + upper), 0.04, 1.2);
      } else if (shape === 'monstera') {
        widthEnv = Math.sin(Math.pow(t, 0.58) * Math.PI) * (0.88 + 0.18 * Math.cos(t * Math.PI * 6.0));
      } else if (shape === 'succulent-sword') {
        widthEnv = Math.pow(1 - t, 0.75) * (0.35 + 0.65 * THREE.MathUtils.smoothstep(t, 0, 0.14));
      } else if (shape === 'fern-frond' || shape === 'palm-frond') {
        widthEnv = Math.sin(Math.pow(t, 0.68) * Math.PI) * (0.85 + 0.15 * Math.sin(t * 22.0));
      } else if (shape === 'ivy-palmate') {
        const basalLobe = 0.52 * Math.exp(-Math.pow((t - 0.24) / 0.13, 2));
        const lateralLobe = 0.38 * Math.exp(-Math.pow((t - 0.5) / 0.12, 2));
        const sinusIndent = -0.34 * Math.exp(-Math.pow((t - 0.64) / 0.09, 2));
        const terminalSpur = Math.sin(Math.pow(t, 0.64) * Math.PI) * (0.82 - 0.16 * t);
        widthEnv = THREE.MathUtils.clamp(terminalSpur + basalLobe + lateralLobe + sinusIndent, 0.03, 1.34);
      } else if (shape === 'serrated-vine') {
        const cordateBase = Math.sin(Math.pow(t, 0.46) * Math.PI) * (1.16 - 0.22 * t);
        const fiveLobes = 0.85 + 0.24 * Math.sin(t * Math.PI * 4.5);
        const teeth = 0.93 + 0.09 * Math.sin(t * Math.PI * 13.0);
        widthEnv = THREE.MathUtils.clamp(cordateBase * fiveLobes * teeth, 0.03, 1.38);
      } else if (shape === 'elliptic-gloss') {
        widthEnv = Math.pow(Math.max(0, Math.sin(t * Math.PI)), 0.84) * 0.74;
      } else if (shape === 'pinwheel-petal') {
        const claw = THREE.MathUtils.smoothstep(t, 0.0, 0.28);
        widthEnv = THREE.MathUtils.clamp(0.18 + 0.56 * claw * Math.sin(Math.pow(t, 0.62) * Math.PI), 0.04, 0.72);
      }

      const halfW = opts.width * 0.5 * Math.max(0.02, widthEnv);
      const localZ = t * opts.length;
      const archY = (0.18 * t - t * t) * archDrop;

      for (let is = 0; is <= segsS; is++) {
        const s = (is / segsS) * 2 - 1;
        const absS = Math.abs(s);
        const cupY = absS * cupDepth * Math.sin(t * Math.PI);
        const twistY = shape === 'pinwheel-petal' ? s * opts.width * 0.22 * THREE.MathUtils.smoothstep(t, 0.15, 0.95) : 0;
        const localX = s * halfW;
        const localY = archY + cupY + twistY;

        const px = opts.pivot.x + xAxis.x * localX + yAxis.x * localY + zAxis.x * localZ;
        const py = opts.pivot.y + xAxis.y * localX + yAxis.y * localY + zAxis.y * localZ;
        const pz = opts.pivot.z + xAxis.z * localX + yAxis.z * localY + zAxis.z * localZ;

        const tiltX = -s * 0.36;
        const tiltZ = 2 * t * (archDrop / Math.max(0.05, opts.length)) * 0.45;
        const nx = xAxis.x * tiltX + yAxis.x + zAxis.x * tiltZ;
        const ny = xAxis.y * tiltX + yAxis.y + zAxis.y * tiltZ;
        const nz = xAxis.z * tiltX + yAxis.z + zAxis.z * tiltZ;

        const veinHighlight =
          shape === 'ivy-palmate' ? THREE.MathUtils.lerp(1.12, 0.94, THREE.MathUtils.smoothstep(absS, 0.0, 0.42)) : 1.0;
        const shade = THREE.MathUtils.lerp(0.88, 1.06, t) * THREE.MathUtils.lerp(0.94, 1.03, 1 - absS) * veinHighlight;
        this.pushVertex(
          px, py, pz, nx, ny, nz, is / segsS, t,
          opts.color.r * shade, opts.color.g * shade, opts.color.b * shade,
          opts.pivot.x, opts.pivot.y, opts.pivot.z,
          organCode, opts.meta.jitter, opts.meta.reactivity, opts.meta.variant
        );
      }
    }

    const rowStride = segsS + 1;
    for (let it = 0; it < segsT; it++) {
      const r0 = baseV + it * rowStride;
      const r1 = r0 + rowStride;
      for (let is = 0; is < segsS; is++) this.pushQuad(r0 + is, r1 + is, r1 + is + 1, r0 + is + 1);
    }
  }

  public addLeafCluster(opts: {
    readonly pivot: THREE.Vector3;
    readonly normal: THREE.Vector3;
    readonly leafCount: number;
    readonly leafLength: number;
    readonly leafWidth: number;
    readonly shape?: LeafShapeProfile;
    readonly color: THREE.Color;
    readonly meta: OrganMetaInput;
    readonly rng: BotanicalRng;
    readonly droop?: number;
  }): void {
    const count = Math.max(2, opts.leafCount);
    const outDir = opts.normal.clone().normalize();
    if (outDir.lengthSq() < 1e-6) outDir.set(0, 1, 0);
    const ref = Math.abs(outDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangentA = new THREE.Vector3().crossVectors(ref, outDir).normalize();
    const tangentB = new THREE.Vector3().crossVectors(outDir, tangentA).normalize();
    const baseAz = opts.rng.range(0, Math.PI * 2);
    const droop = opts.droop ?? 0.24;

    for (let i = 0; i < count; i++) {
      const az = baseAz + (i / count) * Math.PI * 2 + opts.rng.signed() * 0.28;
      const spread = opts.rng.range(0.55, 0.95);
      const dir = new THREE.Vector3()
        .copy(outDir)
        .multiplyScalar(0.58)
        .addScaledVector(tangentA, Math.cos(az) * spread)
        .addScaledVector(tangentB, Math.sin(az) * spread);
      dir.y -= droop * opts.rng.range(0.6, 1.25);
      dir.normalize();

      const scaleJit = opts.rng.range(0.84, 1.18);
      const leafCol = opts.color.clone().offsetHSL(
        opts.rng.signed() * 0.015,
        opts.rng.signed() * 0.04,
        opts.rng.signed() * 0.035
      );
      this.addCuppedLeafBlade({
        pivot: opts.pivot,
        direction: dir,
        length: opts.leafLength * scaleJit,
        width: opts.leafWidth * scaleJit,
        archDrop: opts.leafLength * scaleJit * (0.18 + droop * 0.45),
        shape: opts.shape,
        color: leafCol,
        meta: {
          ...opts.meta,
          jitter: THREE.MathUtils.clamp(opts.meta.jitter + opts.rng.signed() * 0.08, 0, 1),
        },
      });
    }
  }

  public addCompoundPalmateSpray(opts: {
    readonly pivot: THREE.Vector3;
    readonly normal: THREE.Vector3;
    readonly leafletLength: number;
    readonly leafletWidth?: number;
    readonly color: THREE.Color;
    readonly meta: OrganMetaInput;
    readonly rng: BotanicalRng;
    readonly droop?: number;
  }): void {
    const outDir = opts.normal.clone().normalize();
    if (outDir.lengthSq() < 1e-6) outDir.set(0, 0, 1);
    const ref = Math.abs(outDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangentX = new THREE.Vector3().crossVectors(ref, outDir).normalize();
    const tangentY = new THREE.Vector3().crossVectors(outDir, tangentX).normalize();
    const roll = opts.rng.signed() * 0.42;
    const axisX = new THREE.Vector3()
      .addScaledVector(tangentX, Math.cos(roll))
      .addScaledVector(tangentY, Math.sin(roll))
      .normalize();
    const axisY = new THREE.Vector3().crossVectors(outDir, axisX).normalize();

    const fanAngles = [-1.18, -0.58, 0.0, 0.58, 1.18];
    const sizeScales = [0.74, 0.92, 1.06, 0.92, 0.74];
    const baseW = opts.leafletWidth ?? opts.leafletLength * 0.44;
    const droop = opts.droop ?? 0.32;

    for (let i = 0; i < 5; i++) {
      const ang = fanAngles[i]! + opts.rng.signed() * 0.07;
      const sc = sizeScales[i]! * opts.rng.range(0.92, 1.08);
      const dir = new THREE.Vector3()
        .addScaledVector(axisX, Math.sin(ang) * 0.86)
        .addScaledVector(axisY, -Math.cos(ang) * 0.62 - droop * 0.45)
        .addScaledVector(outDir, 0.48)
        .normalize();
      const col = opts.color.clone().offsetHSL(
        opts.rng.signed() * 0.012,
        opts.rng.signed() * 0.035,
        opts.rng.signed() * 0.028
      );
      this.addCuppedLeafBlade({
        pivot: opts.pivot,
        direction: dir,
        upHint: outDir,
        length: opts.leafletLength * sc,
        width: baseW * sc,
        archDrop: opts.leafletLength * sc * (0.2 + droop * 0.35),
        cupDepth: baseW * sc * 0.14,
        segsLength: 4,
        segsWidth: 2,
        shape: 'lanceolate',
        color: col,
        meta: {
          ...opts.meta,
          jitter: THREE.MathUtils.clamp(opts.meta.jitter + opts.rng.signed() * 0.05, 0, 1),
        },
      });
    }
  }

  public addPinwheelStarFlower(opts: {
    readonly pivot: THREE.Vector3;
    readonly normal: THREE.Vector3;
    readonly radius: number;
    readonly petalColor: THREE.Color;
    readonly throatColor: THREE.Color;
    readonly meta: OrganMetaInput;
    readonly rng: BotanicalRng;
  }): void {
    const axis = opts.normal.clone().normalize();
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1);
    const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tA = new THREE.Vector3().crossVectors(ref, axis).normalize();
    const tB = new THREE.Vector3().crossVectors(axis, tA).normalize();
    const phase = opts.rng.range(0, Math.PI * 2);

    for (let p = 0; p < 5; p++) {
      const az = phase + (p / 5) * Math.PI * 2 + 0.08;
      const dir = new THREE.Vector3()
        .addScaledVector(tA, Math.cos(az) * 0.94)
        .addScaledVector(tB, Math.sin(az) * 0.94)
        .addScaledVector(axis, 0.22)
        .normalize();
      this.addCuppedLeafBlade({
        pivot: opts.pivot,
        direction: dir,
        upHint: axis,
        length: opts.radius,
        width: opts.radius * 0.44,
        archDrop: opts.radius * 0.12,
        cupDepth: opts.radius * 0.08,
        segsLength: 3,
        segsWidth: 2,
        shape: 'pinwheel-petal',
        color: opts.petalColor,
        meta: opts.meta,
      });
    }

    this.addSpheroidOrgan({
      pivot: opts.pivot,
      centerOffset: axis.clone().multiplyScalar(opts.radius * 0.08),
      radiusXZ: opts.radius * 0.16,
      radiusY: opts.radius * 0.14,
      latSegments: 3,
      lonSegments: 5,
      color: opts.throatColor,
      meta: opts.meta,
    });
  }

  public addConicalGrapeBunch(opts: {
    readonly pivot: THREE.Vector3;
    readonly berryCount?: number;
    readonly length?: number;
    readonly shoulderRadius?: number;
    readonly berryRadius?: number;
    readonly colors: readonly THREE.Color[];
    readonly peduncleColor?: THREE.Color;
    readonly bark?: OrganCollector;
    readonly meta: OrganMetaInput;
    readonly rng: BotanicalRng;
  }): void {
    const count = THREE.MathUtils.clamp(opts.berryCount ?? 22, 14, 30);
    const bunchLen = opts.length ?? 0.145;
    const shoulderR = opts.shoulderRadius ?? 0.034;
    const baseBerryR = opts.berryRadius ?? 0.013;

    if (opts.bark) {
      opts.bark.addTaperedTube({
        points: [
          opts.pivot.clone(),
          opts.pivot.clone().add(new THREE.Vector3(0, -0.024, 0.004)),
          opts.pivot.clone().add(new THREE.Vector3(0, -bunchLen * 0.62, 0.006)),
        ],
        radii: [0.0042, 0.003, 0.0016],
        radialSegments: 4,
        color: opts.peduncleColor ?? new THREE.Color(0x5c4c34),
        jitter: opts.meta.jitter,
        reactivity: opts.meta.reactivity,
      });
    }

    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const frac = count === 1 ? 1 : i / (count - 1);
      const yOff = -0.02 - frac * bunchLen;
      const shoulderProfile =
        frac < 0.18
          ? THREE.MathUtils.lerp(0.62, 1.0, frac / 0.18)
          : Math.pow(Math.max(0, 1 - (frac - 0.18) / 0.82), 0.78);
      const ringR = shoulderR * Math.max(0.04, shoulderProfile) * opts.rng.range(0.84, 1.08);
      const az = i * golden + opts.rng.signed() * 0.18;
      const rBerry = baseBerryR * THREE.MathUtils.lerp(1.06, 0.84, frac) * opts.rng.range(0.92, 1.08);
      const baseCol = opts.colors[i % opts.colors.length] ?? new THREE.Color(0x421834);
      const berryCol = baseCol.clone().offsetHSL(
        opts.rng.signed() * 0.014,
        opts.rng.signed() * 0.04,
        opts.rng.signed() * 0.03
      );

      this.addSpheroidOrgan({
        pivot: opts.pivot,
        centerOffset: new THREE.Vector3(Math.cos(az) * ringR, yOff, Math.sin(az) * ringR),
        radiusXZ: rBerry,
        radiusY: rBerry * 1.14,
        latSegments: 4,
        lonSegments: 6,
        color: berryCol,
        meta: {
          ...opts.meta,
          jitter: THREE.MathUtils.clamp(opts.meta.jitter + opts.rng.signed() * 0.04, 0, 1),
        },
      });
    }
  }

  public addFlowerRosette(opts: {
    readonly pivot: THREE.Vector3;
    readonly normal: THREE.Vector3;
    readonly radius: number;
    readonly petalCount?: number;
    readonly layers?: number;
    readonly cupFactor?: number;
    readonly petalColor: THREE.Color;
    readonly centerColor?: THREE.Color;
    readonly meta: OrganMetaInput;
    readonly rng: BotanicalRng;
  }): void {
    const petals = Math.max(4, opts.petalCount ?? 5);
    const layers = Math.max(1, opts.layers ?? 1);
    const cup = opts.cupFactor ?? 0.35;
    const axis = opts.normal.clone().normalize();
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tA = new THREE.Vector3().crossVectors(ref, axis).normalize();
    const tB = new THREE.Vector3().crossVectors(axis, tA).normalize();

    for (let layer = 0; layer < layers; layer++) {
      const layerFrac = layers === 1 ? 0 : layer / (layers - 1);
      const layerR = opts.radius * THREE.MathUtils.lerp(1.0, 0.52, layerFrac);
      const layerCup = THREE.MathUtils.lerp(cup, cup + 0.48, layerFrac);
      const phaseRot = layer * 0.62 + opts.rng.range(0, Math.PI * 2);
      const col = opts.petalColor.clone().lerp(opts.centerColor ?? opts.petalColor, layerFrac * 0.35);

      for (let p = 0; p < petals; p++) {
        const az = phaseRot + (p / petals) * Math.PI * 2;
        const dir = new THREE.Vector3()
          .addScaledVector(tA, Math.cos(az) * (1 - layerCup * 0.55))
          .addScaledVector(tB, Math.sin(az) * (1 - layerCup * 0.55))
          .addScaledVector(axis, layerCup)
          .normalize();
        this.addCuppedLeafBlade({
          pivot: opts.pivot,
          direction: dir,
          upHint: axis,
          length: layerR,
          width: layerR * 0.78,
          archDrop: -layerR * 0.14,
          cupDepth: layerR * 0.18,
          segsLength: 2,
          segsWidth: 2,
          shape: 'cordate',
          color: col,
          meta: opts.meta,
        });
      }
    }
  }

  public addSpheroidOrgan(opts: {
    readonly pivot: THREE.Vector3;
    readonly centerOffset: THREE.Vector3;
    readonly radiusXZ: number;
    readonly radiusY: number;
    readonly latSegments?: number;
    readonly lonSegments?: number;
    readonly color: THREE.Color;
    readonly meta: OrganMetaInput;
  }): void {
    const latSegs = Math.max(3, opts.latSegments ?? 5);
    const lonSegs = Math.max(5, opts.lonSegments ?? 7);
    const organCode = VEGETATION_ORGAN_CODES[opts.meta.organ];
    const cx = opts.pivot.x + opts.centerOffset.x;
    const cy = opts.pivot.y + opts.centerOffset.y;
    const cz = opts.pivot.z + opts.centerOffset.z;
    const baseV = this.vertexCount;

    for (let iy = 0; iy <= latSegs; iy++) {
      const v = iy / latSegs;
      const phi = v * Math.PI;
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);

      for (let ix = 0; ix <= lonSegs; ix++) {
        const u = ix / lonSegs;
        const theta = u * Math.PI * 2;
        const nx = -Math.cos(theta) * sinP;
        const ny = cosP;
        const nz = Math.sin(theta) * sinP;
        const px = cx + nx * opts.radiusXZ;
        const py = cy + ny * opts.radiusY;
        const pz = cz + nz * opts.radiusXZ;
        const shade = THREE.MathUtils.lerp(0.82, 1.08, 0.5 + 0.5 * ny);

        this.pushVertex(
          px, py, pz, nx, ny, nz, u, 1 - v,
          opts.color.r * shade, opts.color.g * shade, opts.color.b * shade,
          opts.pivot.x, opts.pivot.y, opts.pivot.z,
          organCode, opts.meta.jitter, opts.meta.reactivity, opts.meta.variant
        );
      }
    }

    const stride = lonSegs + 1;
    for (let iy = 0; iy < latSegs; iy++) {
      const r0 = baseV + iy * stride;
      const r1 = r0 + stride;
      for (let ix = 0; ix < lonSegs; ix++) this.pushQuad(r0 + ix, r1 + ix, r1 + ix + 1, r0 + ix + 1);
    }
  }

  public addGroundLitterScatter(opts: {
    readonly radiusMin: number;
    readonly radiusMax: number;
    readonly count: number;
    readonly flakeSize: number;
    readonly color: THREE.Color;
    readonly isAutumnLeaves: boolean;
    readonly reactivity: number;
    readonly rng: BotanicalRng;
    readonly groundY?: number;
  }): void {
    const yBase = opts.groundY ?? 0.012;
    for (let i = 0; i < opts.count; i++) {
      const angle = opts.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(opts.rng.next()) * (opts.radiusMax - opts.radiusMin) + opts.radiusMin;
      const piv = new THREE.Vector3(Math.cos(angle) * r, yBase + opts.rng.range(0, 0.008), Math.sin(angle) * r);
      const yaw = opts.rng.range(0, Math.PI * 2);
      const dir = new THREE.Vector3(Math.cos(yaw), opts.rng.range(0.02, 0.14), Math.sin(yaw)).normalize();
      const col = opts.color.clone().offsetHSL(opts.rng.signed() * 0.03, opts.rng.signed() * 0.06, opts.rng.signed() * 0.05);
      this.addCuppedLeafBlade({
        pivot: piv,
        direction: dir,
        length: opts.flakeSize * opts.rng.range(0.75, 1.3),
        width: opts.flakeSize * opts.rng.range(0.55, 0.95),
        archDrop: 0.003,
        cupDepth: 0.003,
        segsLength: 2,
        segsWidth: 2,
        color: col,
        meta: {
          organ: 'ground-litter',
          jitter: opts.rng.next(),
          reactivity: opts.reactivity,
          variant: opts.isAutumnLeaves ? 0.8 : 0.2,
        },
      });
    }
  }

  public toBufferGeometry(name = 'husjs.vegetation.organGeo'): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.name = name;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute(VEG_PIVOT_ATTR, new THREE.Float32BufferAttribute(this.pivots, 3));
    geo.setAttribute(VEG_META_ATTR, new THREE.Float32BufferAttribute(this.metas, 4));
    geo.setIndex(this.indices);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}

export * from './planter-assembly.ts';
