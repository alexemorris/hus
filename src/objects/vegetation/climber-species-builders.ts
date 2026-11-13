import * as THREE from 'three';
import {
  OrganCollector,
  type BotanicalRng,
  type LeafShapeProfile,
  type OrganMetaInput,
} from './organ-geometry.ts';

export type ClimberSupportKind =
  | 'wall-plane'
  | 'pier-column'
  | 'pergola-wire'
  | 'arch-trellis';

export interface ClimberSupportFrame {
  readonly pos: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly tangentU: THREE.Vector3;
  readonly tangentV: THREE.Vector3;
}

export interface ClimberBuildContext {
  readonly support: ClimberSupportKind;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly colRadius: number;
  readonly density: number;
  readonly reactivity: number;
  readonly bark: OrganCollector;
  readonly foliage: OrganCollector;
  readonly rng: BotanicalRng;
  sampleFrame(uNorm: number, vNorm: number): ClimberSupportFrame;
}

function evalOrganicEnvelope(u: number, v: number, seedPhase: number): number {
  const dx = (u - 0.5) * 2.0;
  const dy = (v - 0.48) * 1.92;
  const radial = Math.hypot(dx * 0.94, dy * 0.92);
  const ang = Math.atan2(dy, dx);
  const scallop =
    0.14 * Math.sin(ang * 5 + seedPhase) +
    0.09 * Math.cos(ang * 8 - seedPhase * 1.7) +
    0.06 * Math.sin(ang * 13 + seedPhase * 0.6);
  const rootAnchor = v < 0.22 ? (1 - v / 0.22) * Math.max(0, 0.42 - Math.abs(dx)) * 0.85 : 0;
  return 1.04 + scallop + rootAnchor - radial;
}

function addFineTendril(opts: {
  readonly foliage: OrganCollector;
  readonly pivot: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly length: number;
  readonly color: THREE.Color;
  readonly meta: OrganMetaInput;
  readonly rng: BotanicalRng;
}): void {
  const segs = 4;
  const side = new THREE.Vector3().crossVectors(opts.normal, opts.forward).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  const phase = opts.rng.range(0, Math.PI * 2);

  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const curl = phase + t0 * Math.PI * 3.1;
    const curlR = opts.length * 0.16 * t0;
    const segDir = new THREE.Vector3()
      .copy(opts.forward)
      .multiplyScalar(0.75)
      .addScaledVector(side, Math.cos(curl) * 0.65)
      .addScaledVector(opts.normal, Math.sin(curl) * 0.25 + 0.12)
      .normalize();
    const segPiv = opts.pivot.clone().addScaledVector(opts.forward, opts.length * t0 * 0.68).addScaledVector(side, Math.sin(curl) * curlR);
    opts.foliage.addCuppedLeafBlade({
      pivot: segPiv,
      direction: segDir,
      upHint: opts.normal,
      length: (opts.length / segs) * 1.25,
      width: 0.007,
      archDrop: 0.004,
      cupDepth: 0.002,
      segsLength: 2,
      segsWidth: 2,
      shape: 'lanceolate',
      color: opts.color,
      meta: opts.meta,
    });
  }
}

function addPinnateCompoundFrond(opts: {
  readonly foliage: OrganCollector;
  readonly pivot: THREE.Vector3;
  readonly rachisDir: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly leafletPairs: number;
  readonly frondLength: number;
  readonly leafletLength: number;
  readonly leafletWidth: number;
  readonly shape: LeafShapeProfile;
  readonly color: THREE.Color;
  readonly meta: OrganMetaInput;
  readonly rng: BotanicalRng;
}): void {
  const dir = opts.rachisDir.clone().normalize();
  const nrm = opts.normal.clone().normalize();
  const side = new THREE.Vector3().crossVectors(nrm, dir).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);

  for (let p = 0; p < opts.leafletPairs; p++) {
    const f = (p + 0.65) / (opts.leafletPairs + 0.8);
    const scale = THREE.MathUtils.lerp(0.76, 1.04, Math.sin(f * Math.PI * 0.85));
    for (const sgn of [-1, 1]) {
      const lDir = new THREE.Vector3().addScaledVector(dir, 0.52).addScaledVector(side, sgn * 0.82).addScaledVector(nrm, 0.18).normalize();
      const col = opts.color.clone().offsetHSL(opts.rng.signed() * 0.01, opts.rng.signed() * 0.03, opts.rng.signed() * 0.025);
      opts.foliage.addCuppedLeafBlade({
        pivot: opts.pivot,
        direction: lDir,
        upHint: nrm,
        length: opts.leafletLength * scale,
        width: opts.leafletWidth * scale,
        archDrop: opts.leafletLength * scale * 0.22 + f * opts.frondLength * 0.06,
        cupDepth: opts.leafletWidth * scale * 0.14,
        segsLength: 2,
        segsWidth: 2,
        shape: opts.shape,
        color: col,
        meta: opts.meta,
      });
    }
  }

  opts.foliage.addCuppedLeafBlade({
    pivot: opts.pivot,
    direction: dir.clone().addScaledVector(nrm, 0.14).normalize(),
    upHint: nrm,
    length: opts.leafletLength * 1.12,
    width: opts.leafletWidth * 1.08,
    archDrop: opts.leafletLength * 0.26,
    cupDepth: opts.leafletWidth * 0.15,
    segsLength: 2,
    segsWidth: 2,
    shape: opts.shape,
    color: opts.color,
    meta: opts.meta,
  });
}

export function buildEnglishIvyClimber(ctx: ClimberBuildContext): void {
  const { bark, foliage, rng, density, reactivity, width, height } = ctx;
  const stemCol = new THREE.Color(0x4c3d30);
  const rootletCol = new THREE.Color(0x5d4c3c);
  const matureDarkA = new THREE.Color(0x1d441c);
  const matureDarkB = new THREE.Color(0x285724);
  const youngLime = new THREE.Color(0x589632);
  const phase = rng.range(0, Math.PI * 2);

  const mainTrunks = Math.max(5, Math.round((6 + width * 1.6) * Math.sqrt(density)));
  for (let i = 0; i < mainTrunks; i++) {
    const startU = THREE.MathUtils.clamp(0.22 + (i / Math.max(1, mainTrunks - 1)) * 0.56 + rng.signed() * 0.06, 0.08, 0.92);
    const targetU = THREE.MathUtils.clamp(0.06 + (i / Math.max(1, mainTrunks - 1)) * 0.88 + rng.signed() * 0.1, 0.04, 0.96);
    const maxV = rng.range(0.72, 0.98);
    const steps = 11;
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = THREE.MathUtils.clamp(THREE.MathUtils.lerp(startU, targetU, Math.pow(t, 0.72)) + Math.sin(t * 7.5 + i * 1.9) * 0.045, 0.03, 0.97);
      const fr = ctx.sampleFrame(u, t * maxV);
      const p = fr.pos.clone().addScaledVector(fr.normal, 0.012 + (1 - t) * 0.012);
      pts.push(p);
      radii.push(THREE.MathUtils.lerp(0.019, 0.0045, t));

      if (s > 0 && s < steps && s % 2 === 0) {
        const spurEnd = p
          .clone()
          .addScaledVector(fr.tangentU, (s % 4 === 0 ? 1 : -1) * rng.range(0.045, 0.085))
          .addScaledVector(fr.tangentV, rng.range(0.015, 0.04))
          .addScaledVector(fr.normal, -0.004);
        bark.addTaperedTube({ points: [p, spurEnd], radii: [0.005, 0.0018], radialSegments: 4, color: rootletCol, jitter: rng.next(), reactivity });
      }
    }
    bark.addTaperedTube({ points: pts, radii, radialSegments: 5, color: stemCol, jitter: rng.next(), reactivity });
  }

  const area = Math.max(0.6, width * height);
  const shingleNodes = Math.round(THREE.MathUtils.clamp(area * 42 * density, 75, 560));
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let n = 0; n < shingleNodes; n++) {
    const u = ((n * 0.6180339887 + rng.signed() * 0.035) % 1 + 1) % 1;
    const v = THREE.MathUtils.clamp((n + 0.5) / shingleNodes + rng.signed() * 0.04, 0.01, 0.99);
    const margin = evalOrganicEnvelope(u, v, phase);
    if (margin < 0) continue;

    const isFringe = margin < 0.19 || v > 0.86;
    const fr = ctx.sampleFrame(u, v);
    const layerCount = isFringe ? 2 : 3;

    for (let layer = 0; layer < layerCount; layer++) {
      const zLift = 0.014 + layer * 0.022 + rng.range(0, 0.014);
      const piv = fr.pos.clone().addScaledVector(fr.tangentU, rng.signed() * 0.045).addScaledVector(fr.tangentV, rng.signed() * 0.045).addScaledVector(fr.normal, zLift);
      const az = n * golden + layer * 2.1 + rng.signed() * 0.45;
      const shingleDir = new THREE.Vector3()
        .addScaledVector(fr.tangentU, Math.cos(az) * 0.72)
        .addScaledVector(fr.tangentV, Math.sin(az) * 0.45 - 0.44)
        .addScaledVector(fr.normal, 0.24 + layer * 0.07)
        .normalize();

      const isYoungShoot = isFringe && (layer === layerCount - 1 || rng.next() < 0.62);
      const baseCol = isYoungShoot ? youngLime.clone().lerp(matureDarkB, rng.range(0.0, 0.32)) : matureDarkA.clone().lerp(matureDarkB, rng.next());
      baseCol.offsetHSL(rng.signed() * 0.014, rng.signed() * 0.04, rng.signed() * 0.03);
      const leafLen = (isYoungShoot ? rng.range(0.085, 0.125) : rng.range(0.115, 0.168)) * THREE.MathUtils.lerp(0.92, 1.08, layer / 2);

      foliage.addCuppedLeafBlade({
        pivot: piv,
        direction: shingleDir,
        upHint: fr.normal,
        length: leafLen,
        width: leafLen * rng.range(0.86, 1.06),
        archDrop: leafLen * 0.16,
        cupDepth: leafLen * 0.11,
        segsLength: 5,
        segsWidth: 2,
        shape: 'ivy-palmate',
        color: baseCol,
        meta: { organ: 'evergreen-leaf', jitter: rng.next(), reactivity, variant: isYoungShoot ? 0.48 : 0.14 },
      });
    }
  }
}

export function buildVirginiaCreeperClimber(ctx: ClimberBuildContext): void {
  const { bark, foliage, rng, density, reactivity, width, height } = ctx;
  const woodyCol = new THREE.Color(0x6d655c);
  const summerGreen = new THREE.Color(0x3b6e28);
  const tendrilCol = new THREE.Color(0x5d7a3a);
  const phase = rng.range(0, Math.PI * 2);

  const mainLeaders = Math.max(5, Math.round((5 + width * 1.5) * Math.sqrt(density)));
  const sprayNodes: { pos: THREE.Vector3; frame: ClimberSupportFrame; isTrailing: boolean }[] = [];

  for (let l = 0; l < mainLeaders; l++) {
    const rootU = THREE.MathUtils.clamp(0.28 + (l / Math.max(1, mainLeaders - 1)) * 0.44 + rng.signed() * 0.05, 0.1, 0.9);
    const fanU = THREE.MathUtils.clamp(0.06 + (l / Math.max(1, mainLeaders - 1)) * 0.88 + rng.signed() * 0.08, 0.04, 0.96);
    const steps = 13;
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = THREE.MathUtils.clamp(THREE.MathUtils.lerp(rootU, fanU, Math.pow(t, 0.65)) + Math.sin(t * 6.4 + l * 1.5) * 0.055, 0.03, 0.97);
      const v = THREE.MathUtils.clamp(t * rng.range(0.86, 0.98), 0.01, 0.99);
      const fr = ctx.sampleFrame(u, v);
      const p = fr.pos.clone().addScaledVector(fr.normal, 0.014 + (1 - t) * 0.01);
      pts.push(p);
      radii.push(THREE.MathUtils.lerp(0.016, 0.0035, t));
      if (s >= 2) sprayNodes.push({ pos: p, frame: fr, isTrailing: false });

      if (s >= 3 && s % 2 === 1) {
        const sideSign = (s + l) % 2 === 0 ? 1 : -1;
        const latFr = ctx.sampleFrame(
          THREE.MathUtils.clamp(u + sideSign * rng.range(0.08, 0.17), 0.03, 0.97),
          THREE.MathUtils.clamp(v + rng.range(-0.08, 0.05), 0.05, 0.98)
        );
        const latMid = p.clone().lerp(latFr.pos, 0.55).addScaledVector(fr.normal, 0.016);
        const latTip = latFr.pos.clone().addScaledVector(latFr.normal, 0.022);
        const dropTip = latTip.clone().addScaledVector(latFr.tangentV, -rng.range(0.12, 0.24)).addScaledVector(latFr.normal, 0.014);
        bark.addTaperedTube({ points: [p, latMid, latTip, dropTip], radii: [0.006, 0.004, 0.0028, 0.0016], radialSegments: 4, color: woodyCol, jitter: rng.next(), reactivity });
        sprayNodes.push({ pos: latMid, frame: latFr, isTrailing: false }, { pos: latTip, frame: latFr, isTrailing: true }, { pos: dropTip, frame: latFr, isTrailing: true });
      }
    }
    bark.addTaperedTube({ points: pts, radii, radialSegments: 5, color: woodyCol, jitter: rng.next(), reactivity });
  }

  const extraCurtainNodes = Math.round(THREE.MathUtils.clamp(width * height * 16 * density, 24, 190));
  for (let k = 0; k < extraCurtainNodes; k++) {
    const u = rng.range(0.05, 0.95);
    const v = rng.range(0.12, 0.95);
    if (evalOrganicEnvelope(u, v, phase) < -0.05) continue;
    const fr = ctx.sampleFrame(u, v);
    sprayNodes.push({ pos: fr.pos.clone().addScaledVector(fr.normal, rng.range(0.02, 0.055)), frame: fr, isTrailing: v < 0.35 || rng.next() < 0.35 });
  }

  for (const node of sprayNodes) {
    const jitter = rng.next();
    const outNormal = node.frame.normal.clone().multiplyScalar(0.65).addScaledVector(node.frame.tangentV, node.isTrailing ? -0.52 : -0.18).addScaledVector(node.frame.tangentU, rng.signed() * 0.28).normalize();
    foliage.addCompoundPalmateSpray({
      pivot: node.pos,
      normal: outNormal,
      leafletLength: rng.range(0.105, 0.155),
      leafletWidth: rng.range(0.042, 0.062),
      color: summerGreen,
      droop: node.isTrailing ? 0.46 : 0.28,
      rng,
      meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.92 },
    });

    if (node.isTrailing && rng.next() < 0.42) {
      addFineTendril({
        foliage,
        pivot: node.pos,
        forward: node.frame.tangentV.clone().multiplyScalar(-0.85).addScaledVector(node.frame.normal, 0.22).normalize(),
        normal: node.frame.normal,
        length: rng.range(0.08, 0.13),
        color: tendrilCol,
        rng,
        meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.88 },
      });
    }
  }
}

export function buildStarJasmineClimber(ctx: ClimberBuildContext): void {
  const { bark, foliage, rng, density, reactivity, width, height } = ctx;
  const stemCol = new THREE.Color(0x4d3b2c);
  const glossyLeafCol = new THREE.Color(0x1e4b1d);
  const petalWhite = new THREE.Color(0xfbfaf2);
  const throatGold = new THREE.Color(0xe5cf78);

  const twiners = Math.max(6, Math.round((6 + width * 1.8) * Math.sqrt(density)));
  const nodes: { pos: THREE.Vector3; frame: ClimberSupportFrame; stemDir: THREE.Vector3 }[] = [];

  for (let w = 0; w < twiners; w++) {
    const baseU = twiners === 1 ? 0.5 : 0.08 + (w / (twiners - 1)) * 0.84;
    const steps = 16;
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = THREE.MathUtils.clamp(baseU + Math.sin(t * Math.PI * 5.5 + w * 1.3) * 0.065, 0.03, 0.97);
      const fr = ctx.sampleFrame(u, t * rng.range(0.92, 1.0));
      pts.push(fr.pos.clone().addScaledVector(fr.normal, 0.015 + 0.01 * Math.cos(t * 14 + w)));
      radii.push(THREE.MathUtils.lerp(0.013, 0.0032, t));
    }
    bark.addTaperedTube({ points: pts, radii, radialSegments: 5, color: stemCol, jitter: rng.next(), reactivity });
    for (let s = 1; s <= steps; s++) {
      nodes.push({ pos: pts[s]!, frame: ctx.sampleFrame(baseU, s / steps), stemDir: pts[s]!.clone().sub(pts[s - 1]!).normalize() });
    }
  }

  const fillPairs = Math.round(THREE.MathUtils.clamp(width * height * 22 * density, 32, 240));
  for (let f = 0; f < fillPairs; f++) {
    const fr = ctx.sampleFrame(rng.range(0.06, 0.94), rng.range(0.06, 0.96));
    nodes.push({ pos: fr.pos.clone().addScaledVector(fr.normal, rng.range(0.016, 0.048)), frame: fr, stemDir: fr.tangentV.clone().addScaledVector(fr.tangentU, rng.signed() * 0.45).normalize() });
  }

  for (const nd of nodes) {
    const jitter = rng.next();
    const pairSide = new THREE.Vector3().crossVectors(nd.frame.normal, nd.stemDir).normalize();
    if (pairSide.lengthSq() < 1e-6) pairSide.copy(nd.frame.tangentU);

    for (const sgn of [-1, 1]) {
      const leafDir = new THREE.Vector3().addScaledVector(pairSide, sgn * 0.82).addScaledVector(nd.stemDir, rng.range(0.18, 0.45)).addScaledVector(nd.frame.normal, 0.24).normalize();
      const leafLen = rng.range(0.072, 0.108);
      foliage.addCuppedLeafBlade({
        pivot: nd.pos,
        direction: leafDir,
        upHint: nd.frame.normal,
        length: leafLen,
        width: leafLen * 0.46,
        archDrop: leafLen * 0.15,
        cupDepth: leafLen * 0.09,
        segsLength: 3,
        segsWidth: 2,
        shape: 'elliptic-gloss',
        color: glossyLeafCol.clone().offsetHSL(rng.signed() * 0.012, rng.signed() * 0.035, rng.signed() * 0.03),
        meta: { organ: 'evergreen-leaf', jitter, reactivity, variant: 0.35 },
      });
    }

    if (rng.next() < THREE.MathUtils.clamp(0.54 * Math.sqrt(density), 0.35, 0.85)) {
      const cymeFlowers = rng.int(2, 4);
      for (let c = 0; c < cymeFlowers; c++) {
        const flwPiv = nd.pos.clone().addScaledVector(nd.frame.normal, rng.range(0.022, 0.052)).addScaledVector(nd.frame.tangentU, rng.signed() * 0.038).addScaledVector(nd.frame.tangentV, rng.signed() * 0.038);
        const flwNrm = nd.frame.normal.clone().addScaledVector(nd.frame.tangentU, rng.signed() * 0.35).addScaledVector(nd.frame.tangentV, rng.signed() * 0.35).normalize();
        foliage.addPinwheelStarFlower({
          pivot: flwPiv,
          normal: flwNrm,
          radius: rng.range(0.025, 0.035),
          petalColor: petalWhite,
          throatColor: throatGold,
          rng,
          meta: { organ: 'summer-flower', jitter: THREE.MathUtils.clamp(jitter + c * 0.03, 0, 1), reactivity, variant: 0.62 },
        });
      }
    }
  }
}

export function buildGrapevineClimber(ctx: ClimberBuildContext): void {
  const { bark, foliage, rng, density, reactivity, support, width, height, depth } = ctx;
  const trunkBarkCol = new THREE.Color(0x554233);
  const cordonBarkCol = new THREE.Color(0x634d3b);
  const vineGreenDark = new THREE.Color(0x3d7026);
  const vineGreenSun = new THREE.Color(0x4e8530);
  const tendrilCol = new THREE.Color(0x638a38);
  const burgundyPalette = [new THREE.Color(0x3c142e), new THREE.Color(0x4d1a38), new THREE.Color(0x562848)];
  const muscatPalette = [new THREE.Color(0x9d9840), new THREE.Color(0xb5a44b), new THREE.Color(0x888a38)];

  const trunkCount = width > 3.2 ? 2 : 1;
  const cordonAnchors: { pos: THREE.Vector3; frame: ClimberSupportFrame }[] = [];
  const canopySites: { pos: THREE.Vector3; frame: ClimberSupportFrame; isUpperCanopy: boolean }[] = [];

  for (let tr = 0; tr < trunkCount; tr++) {
    const trunkU = trunkCount === 1 ? 0.5 : tr === 0 ? 0.28 : 0.72;
    const baseR = rng.range(0.044, 0.056);
    const climbTopV = support === 'pergola-wire' ? 0.34 : 0.72;
    const trunkSteps = 9;
    const trunkPts: THREE.Vector3[] = [];
    const trunkRadii: number[] = [];

    for (let s = 0; s <= trunkSteps; s++) {
      const t = s / trunkSteps;
      const fr = ctx.sampleFrame(THREE.MathUtils.clamp(trunkU + Math.sin(t * 5.2 + tr * 2.1) * 0.035, 0.08, 0.92), t * climbTopV);
      const zOff = support === 'wall-plane' ? 0.054 * THREE.MathUtils.lerp(1, 0.65, t) : 0.035;
      trunkPts.push(fr.pos.clone().addScaledVector(fr.normal, zOff));
      trunkRadii.push(THREE.MathUtils.lerp(baseR, baseR * 0.44, t));
      if (s >= 4) canopySites.push({ pos: trunkPts[s]!, frame: fr, isUpperCanopy: false });
    }
    bark.addTaperedTube({ points: trunkPts, radii: trunkRadii, radialSegments: 8, color: trunkBarkCol, rootFlare: 0.26, barkFluting: 0.22, jitter: rng.next(), reactivity });

    const headPt = trunkPts[trunkPts.length - 1]!;
    const cordonCount = Math.max(4, Math.round((4 + width * 1.1) * Math.sqrt(density)));

    for (let c = 0; c < cordonCount; c++) {
      const targetU = cordonCount === 1 ? 0.5 : 0.05 + (c / (cordonCount - 1)) * 0.9;
      const cordonSteps = 10;
      const cPts: THREE.Vector3[] = [headPt.clone()];
      const cRadii: number[] = [baseR * 0.4];

      for (let s = 1; s <= cordonSteps; s++) {
        const f = s / cordonSteps;
        const u = THREE.MathUtils.clamp(THREE.MathUtils.lerp(trunkU, targetU, Math.pow(f, 0.75)) + Math.sin(f * 6.0 + c) * 0.03, 0.03, 0.97);
        const v = support === 'pergola-wire' ? THREE.MathUtils.lerp(0.35, 0.98, f) : THREE.MathUtils.clamp(0.28 + ((c % 3) * 0.24 + f * 0.24) + Math.sin(f * Math.PI) * 0.08, 0.22, 0.96);
        const fr = ctx.sampleFrame(u, v);
        const pt = fr.pos.clone().addScaledVector(fr.normal, support === 'wall-plane' ? 0.028 : 0.022);
        cPts.push(pt);
        cRadii.push(THREE.MathUtils.lerp(baseR * 0.36, 0.007, f));
        canopySites.push({ pos: pt, frame: fr, isUpperCanopy: support === 'pergola-wire' });
        if (s >= 2 && s <= cordonSteps - 1) cordonAnchors.push({ pos: pt, frame: fr });
      }
      bark.addTaperedTube({ points: cPts, radii: cRadii, radialSegments: 6, color: cordonBarkCol, barkFluting: 0.16, jitter: rng.next(), reactivity });
    }
  }

  const spanArea = support === 'pergola-wire' ? width * depth : width * height;
  const extraCanopyCount = Math.round(THREE.MathUtils.clamp(spanArea * 26 * density, 55, 380));
  for (let i = 0; i < extraCanopyCount; i++) {
    const u = rng.range(0.03, 0.97);
    const v = support === 'pergola-wire' ? rng.range(0.33, 0.99) : rng.range(0.18, 0.97);
    const fr = ctx.sampleFrame(u, v);
    const layerOffset = support === 'pergola-wire' ? rng.range(-0.03, 0.085) : rng.range(0.018, 0.075);
    canopySites.push({ pos: fr.pos.clone().addScaledVector(fr.normal, layerOffset), frame: fr, isUpperCanopy: layerOffset > 0.035 });
    if (i % 6 === 0 && v > 0.34) cordonAnchors.push({ pos: fr.pos.clone().addScaledVector(fr.normal, 0.024), frame: fr });
  }

  for (const site of canopySites) {
    const jitter = rng.next();
    const leavesHere = site.isUpperCanopy ? 3 : 2;
    for (let l = 0; l < leavesHere; l++) {
      const az = rng.range(0, Math.PI * 2);
      const leafLen = rng.range(0.17, 0.25);
      const dir =
        support === 'wall-plane'
          ? new THREE.Vector3().addScaledVector(site.frame.tangentU, Math.cos(az) * 0.78).addScaledVector(site.frame.tangentV, Math.sin(az) * 0.45 - 0.38).addScaledVector(site.frame.normal, rng.range(0.18, 0.34)).normalize()
          : new THREE.Vector3().addScaledVector(site.frame.tangentU, Math.cos(az) * 0.82).addScaledVector(site.frame.tangentV, Math.sin(az) * 0.82).addScaledVector(site.frame.normal, rng.range(0.28, 0.68)).normalize();
      const col = vineGreenDark.clone().lerp(vineGreenSun, site.isUpperCanopy ? rng.range(0.45, 1.0) : rng.range(0.0, 0.6)).offsetHSL(rng.signed() * 0.015, rng.signed() * 0.04, rng.signed() * 0.03);

      foliage.addCuppedLeafBlade({
        pivot: site.pos,
        direction: dir,
        upHint: site.frame.normal,
        length: leafLen,
        width: leafLen * rng.range(0.88, 1.06),
        archDrop: leafLen * 0.24,
        cupDepth: leafLen * 0.14,
        segsLength: 5,
        segsWidth: 2,
        shape: 'serrated-vine',
        color: col,
        meta: { organ: 'deciduous-leaf', jitter: THREE.MathUtils.clamp(jitter + l * 0.04, 0, 1), reactivity, variant: 0.26 },
      });
    }

    if (rng.next() < 0.22) {
      addFineTendril({
        foliage,
        pivot: site.pos,
        forward: site.frame.tangentU.clone().multiplyScalar(rng.signed()).addScaledVector(site.frame.tangentV, -0.5).normalize(),
        normal: site.frame.normal,
        length: rng.range(0.085, 0.14),
        color: tendrilCol,
        rng,
        meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.26 },
      });
    }
  }

  const targetBunches = Math.round(THREE.MathUtils.clamp((8 + spanArea * 1.45) * density, 8, 28));
  if (cordonAnchors.length > 0) {
    const stride = Math.max(1, Math.floor(cordonAnchors.length / targetBunches));
    let placed = 0;
    for (let idx = 0; idx < cordonAnchors.length && placed < targetBunches; idx += stride) {
      const anchor = cordonAnchors[(idx + placed * 3) % cordonAnchors.length]!;
      placed++;
      const hangPivot =
        support === 'pergola-wire'
          ? anchor.pos.clone().add(new THREE.Vector3(rng.signed() * 0.05, -0.025, rng.signed() * 0.05))
          : support === 'wall-plane'
            ? new THREE.Vector3(anchor.pos.x + rng.signed() * 0.04, anchor.pos.y - 0.02, rng.range(0.052, 0.088))
            : anchor.pos.clone().addScaledVector(anchor.frame.normal, 0.035).add(new THREE.Vector3(0, -0.02, 0));

      foliage.addConicalGrapeBunch({
        pivot: hangPivot,
        berryCount: rng.int(18, 26),
        length: rng.range(0.125, 0.165),
        shoulderRadius: support === 'wall-plane' ? rng.range(0.026, 0.033) : rng.range(0.03, 0.04),
        berryRadius: rng.range(0.011, 0.015),
        colors: placed % 6 === 0 ? muscatPalette : burgundyPalette,
        peduncleColor: cordonBarkCol,
        bark,
        rng,
        meta: { organ: 'fruit', jitter: rng.next(), reactivity, variant: 0.22 },
      });
    }
  }
}

export function buildClimbingRoseClimber(ctx: ClimberBuildContext): void {
  const { bark, foliage, rng, density, reactivity, width, height } = ctx;
  const caneCol = new THREE.Color(0x4c5832);
  const woodyBaseCol = new THREE.Color(0x5c4c3b);
  const roseLeafCol = new THREE.Color(0x2e5823);
  const blushOuter = new THREE.Color(0xf6d4de);
  const blushHeart = new THREE.Color(0xeb9bb3);
  const creamApricot = new THREE.Color(0xf9efe6);
  const apricotCenter = new THREE.Color(0xf0c39e);

  const caneCount = Math.max(6, Math.round((6 + width * 1.8) * Math.sqrt(density)));
  const shootNodes: { pos: THREE.Vector3; frame: ClimberSupportFrame; caneDir: THREE.Vector3; t: number }[] = [];

  for (let c = 0; c < caneCount; c++) {
    const fanFrac = caneCount === 1 ? 0.5 : c / (caneCount - 1);
    const rootU = THREE.MathUtils.clamp(0.42 + (fanFrac - 0.5) * 0.22, 0.2, 0.8);
    const archTargetU = THREE.MathUtils.clamp(0.04 + fanFrac * 0.92 + rng.signed() * 0.06, 0.03, 0.97);
    const peakV = rng.range(0.55, 0.98);
    const steps = 13;
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = THREE.MathUtils.clamp(THREE.MathUtils.lerp(rootU, archTargetU, Math.pow(t, 0.82)), 0.03, 0.97);
      const v = THREE.MathUtils.clamp(peakV * THREE.MathUtils.lerp(t, Math.sin(t * Math.PI * 0.72), 0.35), 0.01, 0.98);
      const fr = ctx.sampleFrame(u, v);
      const p = fr.pos.clone().addScaledVector(fr.normal, 0.018 + 0.014 * Math.sin(t * Math.PI));
      pts.push(p);
      radii.push(THREE.MathUtils.lerp(0.015, 0.0038, t));

      if (s > 1 && s % 2 === 0) {
        const thornDir = fr.normal.clone().multiplyScalar(0.55).addScaledVector(fr.tangentU, s % 4 === 0 ? 0.7 : -0.7).normalize();
        bark.addTaperedTube({ points: [p, p.clone().addScaledVector(thornDir, 0.014)], radii: [0.0032, 0.0006], radialSegments: 4, color: woodyBaseCol, jitter: rng.next(), reactivity });
      }
    }
    bark.addTaperedTube({ points: pts, radii, radialSegments: 5, color: c % 2 === 0 ? caneCol : woodyBaseCol.clone().lerp(caneCol, 0.65), jitter: rng.next(), reactivity });

    for (let s = 1; s <= steps; s++) {
      shootNodes.push({ pos: pts[s]!, frame: ctx.sampleFrame(fanFrac, s / steps), caneDir: pts[s]!.clone().sub(pts[s - 1]!).normalize(), t: s / steps });
    }
  }

  const lateralShoots = Math.round(THREE.MathUtils.clamp(width * height * 12 * density, 18, 130));
  for (let k = 0; k < lateralShoots; k++) {
    const v = rng.range(0.14, 0.94);
    const fr = ctx.sampleFrame(rng.range(0.06, 0.94), v);
    shootNodes.push({ pos: fr.pos.clone().addScaledVector(fr.normal, rng.range(0.02, 0.052)), frame: fr, caneDir: fr.tangentV.clone().addScaledVector(fr.tangentU, rng.signed() * 0.65).normalize(), t: v });
  }

  for (const nd of shootNodes) {
    const jitter = rng.next();
    for (const sgn of [-1, 1]) {
      if (sgn === 1 && rng.next() > 0.65 * Math.sqrt(density)) continue;
      const side = new THREE.Vector3().crossVectors(nd.frame.normal, nd.caneDir).normalize();
      const rachis = nd.caneDir.clone().multiplyScalar(0.45).addScaledVector(side, sgn * 0.78).addScaledVector(nd.frame.normal, 0.25).normalize();
      addPinnateCompoundFrond({
        foliage,
        pivot: nd.pos,
        rachisDir: rachis,
        normal: nd.frame.normal,
        leafletPairs: 2,
        frondLength: 0.11,
        leafletLength: rng.range(0.048, 0.068),
        leafletWidth: rng.range(0.032, 0.045),
        shape: 'ovate',
        color: roseLeafCol,
        rng,
        meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.24 },
      });
    }

    if (nd.t > 0.16 && rng.next() < THREE.MathUtils.clamp(0.44 * Math.sqrt(density), 0.28, 0.78)) {
      const isCream = rng.next() < 0.34;
      const outerCol = isCream ? creamApricot : blushOuter;
      const heartCol = isCream ? apricotCenter : blushHeart;
      const bloomPos = nd.pos.clone().addScaledVector(nd.frame.normal, 0.032);
      const bloomNrm = nd.frame.normal.clone().addScaledVector(nd.frame.tangentU, rng.signed() * 0.25).addScaledVector(nd.frame.tangentV, rng.range(-0.18, 0.22)).normalize();

      foliage.addFlowerRosette({
        pivot: bloomPos,
        normal: bloomNrm,
        radius: rng.range(0.052, 0.074),
        petalCount: 7,
        layers: 4,
        cupFactor: 0.56,
        petalColor: outerCol,
        centerColor: heartCol,
        rng,
        meta: { organ: 'summer-flower', jitter, reactivity, variant: 0.68 },
      });

      if (rng.next() < 0.55) {
        foliage.addSpheroidOrgan({
          pivot: bloomPos,
          centerOffset: nd.frame.tangentU.clone().multiplyScalar(rng.signed() * 0.055).addScaledVector(nd.frame.tangentV, 0.04),
          radiusXZ: 0.014,
          radiusY: 0.022,
          latSegments: 4,
          lonSegments: 6,
          color: heartCol,
          meta: { organ: 'summer-flower', jitter: THREE.MathUtils.clamp(jitter + 0.05, 0, 1), reactivity, variant: 0.66 },
        });
      }
    }
  }
}

export function buildWisteriaClimber(ctx: ClimberBuildContext): void {
  const { bark, foliage, rng, density, reactivity, support, width, height, depth } = ctx;
  const lianaBark = new THREE.Color(0x685d52);
  const pinnateGreen = new THREE.Color(0x4d7c32);
  const topLavender = new THREE.Color(0xc8b6f6);
  const midLilac = new THREE.Color(0x9d7ee4);
  const tipDeepViolet = new THREE.Color(0x6945b8);

  const branchNodes: { pos: THREE.Vector3; frame: ClimberSupportFrame }[] = [];
  for (let p = 0; p < 2; p++) {
    const phase = p * Math.PI;
    const steps = 14;
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];
    const topV = support === 'pergola-wire' ? 0.36 : 0.78;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const fr = ctx.sampleFrame(THREE.MathUtils.clamp(0.5 + Math.sin(t * Math.PI * 4.2 + phase) * 0.045, 0.1, 0.9), t * topV);
      pts.push(fr.pos.clone().addScaledVector(fr.normal, 0.028 + 0.016 * Math.cos(t * Math.PI * 4.2 + phase)));
      radii.push(THREE.MathUtils.lerp(0.032, 0.014, t));
    }
    bark.addTaperedTube({ points: pts, radii, radialSegments: 7, color: lianaBark, barkFluting: 0.15, jitter: rng.next(), reactivity });
  }

  const lateralBranches = Math.max(5, Math.round((5 + width * 1.4) * Math.sqrt(density)));
  for (let b = 0; b < lateralBranches; b++) {
    const targetU = lateralBranches === 1 ? 0.5 : 0.05 + (b / (lateralBranches - 1)) * 0.9;
    const baseV = support === 'pergola-wire' ? 0.35 : THREE.MathUtils.lerp(0.38, 0.92, (b % 3) / 2);
    const steps = 10;
    const bPts: THREE.Vector3[] = [];
    const bRadii: number[] = [];

    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const u = THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.5, targetU, Math.pow(f, 0.72)), 0.03, 0.97);
      const v = support === 'pergola-wire' ? THREE.MathUtils.lerp(0.35, 0.98, f) : THREE.MathUtils.clamp(baseV + Math.sin(f * Math.PI) * 0.08 - f * 0.05, 0.24, 0.97);
      const fr = ctx.sampleFrame(u, v);
      const pt = fr.pos.clone().addScaledVector(fr.normal, 0.026);
      bPts.push(pt);
      bRadii.push(THREE.MathUtils.lerp(0.016, 0.005, f));
      if (s >= 1) branchNodes.push({ pos: pt, frame: fr });
    }
    bark.addTaperedTube({ points: bPts, radii: bRadii, radialSegments: 5, color: lianaBark, jitter: rng.next(), reactivity });
  }

  const spanArea = support === 'pergola-wire' ? width * depth : width * height;
  const extraNodes = Math.round(THREE.MathUtils.clamp(spanArea * 11 * density, 18, 120));
  for (let e = 0; e < extraNodes; e++) {
    const fr = ctx.sampleFrame(rng.range(0.05, 0.95), support === 'pergola-wire' ? rng.range(0.35, 0.98) : rng.range(0.28, 0.96));
    branchNodes.push({ pos: fr.pos.clone().addScaledVector(fr.normal, rng.range(0.022, 0.055)), frame: fr });
  }

  for (const nd of branchNodes) {
    const jitter = rng.next();
    for (let f = 0, fronds = rng.int(1, 2); f < fronds; f++) {
      const az = rng.range(0, Math.PI * 2);
      const rachisDir = new THREE.Vector3().addScaledVector(nd.frame.tangentU, Math.cos(az) * 0.78).addScaledVector(nd.frame.tangentV, Math.sin(az) * 0.45 - 0.35).addScaledVector(nd.frame.normal, 0.25).normalize();
      addPinnateCompoundFrond({
        foliage,
        pivot: nd.pos,
        rachisDir,
        normal: nd.frame.normal,
        leafletPairs: rng.int(3, 4),
        frondLength: rng.range(0.16, 0.23),
        leafletLength: rng.range(0.052, 0.072),
        leafletWidth: rng.range(0.022, 0.032),
        shape: 'lanceolate',
        color: pinnateGreen,
        rng,
        meta: { organ: 'deciduous-leaf', jitter: THREE.MathUtils.clamp(jitter + f * 0.04, 0, 1), reactivity, variant: 0.14 },
      });
    }

    if (rng.next() < THREE.MathUtils.clamp(0.46 * Math.sqrt(density), 0.28, 0.82)) {
      const racemeLen = rng.range(0.22, 0.36);
      const florets = rng.int(14, 20);
      const racemeTop = support === 'wall-plane' ? new THREE.Vector3(nd.pos.x + rng.signed() * 0.03, nd.pos.y - 0.01, rng.range(0.055, 0.105)) : nd.pos.clone().addScaledVector(nd.frame.normal, support === 'pergola-wire' ? -0.02 : 0.04);
      const golden = Math.PI * (3 - Math.sqrt(5));

      for (let k = 0; k < florets; k++) {
        const rf = k / (florets - 1);
        const coneR = THREE.MathUtils.lerp(0.034, 0.007, Math.pow(rf, 0.82));
        const az = k * golden;
        const flwPiv = racemeTop.clone().add(new THREE.Vector3(Math.cos(az) * coneR, -rf * racemeLen, Math.sin(az) * (support === 'wall-plane' ? coneR * 0.65 : coneR)));
        const col = rf < 0.5 ? topLavender.clone().lerp(midLilac, rf * 2) : midLilac.clone().lerp(tipDeepViolet, (rf - 0.5) * 2);

        if (rf > 0.78) {
          foliage.addSpheroidOrgan({
            pivot: racemeTop,
            centerOffset: flwPiv.clone().sub(racemeTop),
            radiusXZ: THREE.MathUtils.lerp(0.011, 0.006, (rf - 0.78) / 0.22),
            radiusY: THREE.MathUtils.lerp(0.015, 0.009, (rf - 0.78) / 0.22),
            latSegments: 3,
            lonSegments: 5,
            color: col,
            meta: { organ: 'summer-flower', jitter: THREE.MathUtils.clamp(jitter + rf * 0.05, 0, 1), reactivity, variant: 0.36 },
          });
        } else {
          foliage.addFlowerRosette({
            pivot: flwPiv,
            normal: new THREE.Vector3(Math.cos(az) * 0.55, -0.45, support === 'wall-plane' ? 0.55 : Math.sin(az) * 0.55).normalize(),
            radius: THREE.MathUtils.lerp(0.032, 0.017, rf),
            petalCount: 5,
            layers: 1,
            cupFactor: 0.32,
            petalColor: col,
            centerColor: topLavender,
            rng,
            meta: { organ: 'summer-flower', jitter: THREE.MathUtils.clamp(jitter + rf * 0.05, 0, 1), reactivity, variant: 0.36 },
          });
        }
      }
    }
  }
}
