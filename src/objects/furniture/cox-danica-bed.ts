import * as THREE from 'three';
import { attachAssetMetadata } from '../shared/catalog-smart-metadata.ts';
import { getOrCreateCachedPropTexture } from '../../engine/textures/texture-registry.ts';
import {
  sharedBoxGeometry,
  sharedCylinderGeometry,
} from '../shared/geometry-cache.ts';

export interface CoxDanicaBedOptions {
  readonly name: string;
  readonly zone: string;
  /** World or parent-group position of the center-back of the headboard at floor level (`y = FFL`). */
  readonly position: readonly [number, number, number];
  /** Rotation around Y in radians (`0` = bed extends along `+X` from headboard back `x = 0` to foot `x = +2.10 m`). */
  readonly rotationY?: number;
  /** Size preset: `'ukDouble'` (`W 1.45 × L 2.10 × H 1.10 m`, SKU 1253920) or `'ukKing'` (`W 1.60 × L 2.20 × H 1.10 m`). */
  readonly size?: 'ukDouble' | 'ukKing';
}

function createScandiLightOakTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('cox-danica-bed:scandi-light-oak', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#d3b892';
      ctx.fillRect(0, 0, 256, 256);

      for (let i = 0; i < 180; i++) {
        const y = (i * 1.42) % 256;
        const light = i % 3 === 0;
        ctx.strokeStyle = light ? 'rgba(246, 236, 217, 0.25)' : 'rgba(148, 114, 76, 0.18)';
        ctx.lineWidth = light ? 0.9 : 1.4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        const wave = Math.sin(i * 0.37) * 2.5;
        ctx.bezierCurveTo(85, y + wave, 170, y - wave, 256, y);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

function createOatmealBoucleTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('cox-danica-bed:oatmeal-boucle', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ddd3c2';
      ctx.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 4) {
        for (let x = 0; x < 128; x += 4) {
          const v = ((x * 17 + y * 31) % 23) - 11;
          const base = 216 + v;
          ctx.fillStyle = `rgb(${base}, ${base - 9}, ${base - 23})`;
          ctx.fillRect(x, y, 3, 3);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 3);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

function createWaffleThrowTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('cox-danica-bed:oatmeal-waffle-throw', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#c8bba6';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(130, 112, 88, 0.32)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < 128; gx += 8) {
        for (let gy = 0; gy < 128; gy += 8) {
          ctx.strokeRect(gx + 0.5, gy + 0.5, 7, 7);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 6);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/**
 * Builds a plump, soft-shouldered pillow or cushion geometry without mutating cached primitives.
 */
function createPlumpCushionGeometry(
  thicknessX: number,
  heightY: number,
  widthZ: number,
  segX = 8,
  segY = 14,
  segZ = 18
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(thicknessX, heightY, widthZ, segX, segY, segZ);
  const pos = geo.attributes.position;
  const halfY = heightY * 0.5;
  const halfZ = widthZ * 0.5;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const ny = halfY > 0 ? y / halfY : 0;
    const nz = halfZ > 0 ? z / halfZ : 0;
    const cosY = Math.cos(ny * Math.PI * 0.48);
    const cosZ = Math.cos(nz * Math.PI * 0.48);
    const crown = Math.pow(Math.max(0.04, cosY * cosZ), 0.52);

    const edgePinchY = 1 - 0.08 * Math.pow(Math.abs(nz), 3);
    const edgePinchZ = 1 - 0.06 * Math.pow(Math.abs(ny), 3);

    pos.setXYZ(i, x * (0.45 + 0.55 * crown), y * edgePinchY, z * edgePinchZ);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a soft lofted duvet / throw blanket geometry draped neatly inside/over the low oak rails.
 */
function createSoftDuvetGeometry(options: {
  readonly lengthX: number;
  readonly widthZ: number;
  readonly thicknessY: number;
  readonly sideDropY: number;
  readonly footDropY: number;
}): THREE.BufferGeometry {
  const { lengthX, widthZ, thicknessY, sideDropY, footDropY } = options;
  const geo = new THREE.BoxGeometry(lengthX, thicknessY, widthZ, 20, 4, 24);
  const pos = geo.attributes.position;
  const halfX = lengthX * 0.5;
  const halfZ = widthZ * 0.5;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);

    const ux = (x + halfX) / lengthX; // 0 at head fold, 1 at foot
    const az = Math.abs(z) / halfZ; // 0 at centerline, 1 at side edge

    // Gentle central loft crown across width & length
    const centerCrown = Math.cos(az * Math.PI * 0.5) * Math.sin(Math.min(1, ux * 1.15) * Math.PI * 0.85) * 0.024;
    // Soft waterfall drape at outer edges
    const sideRoll = az > 0.76 ? Math.pow((az - 0.76) / 0.24, 1.75) * sideDropY : 0;
    const footRoll = ux > 0.86 ? Math.pow((ux - 0.86) / 0.14, 1.75) * footDropY : 0;
    const ripple = az > 0.7 ? Math.sin(ux * Math.PI * 5) * 0.004 * ((az - 0.7) / 0.3) : 0;

    y = y + centerCrown - sideRoll - footRoll + ripple;
    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds the Cox & Cox `Danica Bed` (`SKU 1253920` UK Double `W 145 × L 210 × H 110 cm`):
 * - Warm-grained light natural solid Scandinavian oak (`roughness: 0.44`)
 * - 4 turned tapered cylindrical oak legs (`H = 0.150 m`, `Ø 44 mm -> Ø 28 mm`)
 * - `0.200 m`-tall flat solid-oak side & foot apron rails (`Y = +0.150 .. +0.350 m`, `0` high footboard)
 * - Spindle headboard (`H = 1.100 m` total): two `Ø 50 mm` turned outer posts with chamfered top caps,
 *   `Ø 38 mm` cylindrical horizontal top crest rail (`+1.065 m`), lower rail (`+0.350 m`),
 *   and **`19` slender turned cylindrical vertical oak spindles (`Ø 17 mm`)**
 * - Signature detachable **`52 cm H × 137 cm W × 6.5 cm D`** warm oatmeal bouclé-linen headboard cushion
 *   suspended from the top rail by **two looped tan-leather straps with aged-brass button studs**
 * - Crisp white linen duvet, oatmeal textured foot throw, and plump sleeping + scatter pillows.
 */
export function buildCoxDanicaBed(
  parent: THREE.Object3D,
  options: CoxDanicaBedOptions
): THREE.Group {
  const { name, zone, position, rotationY = 0, size = 'ukDouble' } = options;

  const isKing = size === 'ukKing';
  const frameW = isKing ? 1.60 : 1.45;
  const frameL = isKing ? 2.20 : 2.10;
  const headboardH = 1.10;

  const root = new THREE.Group();
  root.name = name;
  root.userData.zone = zone;
  root.userData.zoneId = zone;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const oakMat = new THREE.MeshStandardMaterial({
    color: 0xdcc5a4,
    map: createScandiLightOakTexture(),
    roughness: 0.44,
    metalness: 0.02,
  });
  const boucleCushionMat = new THREE.MeshStandardMaterial({
    color: 0xe3dacb,
    map: createOatmealBoucleTexture(),
    roughness: 0.86,
    metalness: 0.0,
  });
  const tanLeatherStrapMat = new THREE.MeshStandardMaterial({
    color: 0x9b6b43,
    roughness: 0.56,
    metalness: 0.04,
  });
  const agedBrassStudMat = new THREE.MeshStandardMaterial({
    color: 0xb7924e,
    roughness: 0.34,
    metalness: 0.84,
  });
  const crispWhiteLinenMat = new THREE.MeshStandardMaterial({
    color: 0xf7f5f0,
    roughness: 0.84,
    metalness: 0.0,
  });
  const mattressTickingMat = new THREE.MeshStandardMaterial({
    color: 0xeeeae2,
    roughness: 0.82,
    metalness: 0.0,
  });
  const oatmealThrowMat = new THREE.MeshStandardMaterial({
    color: 0xd0c3ae,
    map: createWaffleThrowTexture(),
    roughness: 0.88,
    metalness: 0.0,
  });
  const warmStoneScatterMat = new THREE.MeshStandardMaterial({
    color: 0xbcae99,
    roughness: 0.86,
    metalness: 0.0,
  });

  // Key frame dimensions
  const postRadius = 0.025; // Ø 50 mm outer headboard posts
  const headX = postRadius; // 0.025 m so back of headboard posts sits flush at xLocal = 0.000 m
  const legH = 0.15; // Y = 0.000 .. 0.150 m
  const apronBotY = 0.15;
  const apronH = 0.20; // Y = 0.150 .. 0.350 m (low footboard-less Scandi oak frame!)
  const apronTopY = apronBotY + apronH; // 0.350 m
  const railT = 0.028;

  const halfFrameW = frameW * 0.5;
  const postCenterZ = halfFrameW - postRadius; // Outer edges of Ø 50 mm posts sit at ±0.725 m (exact 1.450 m W!)
  const footCenterX = frameL - railT * 0.5;

  // Four Turned Tapered Cylindrical Oak Legs (H = 0.150 m, Ø 44 mm -> Ø 28 mm)
  const footLegX = frameL - 0.036;
  const footLegZ = halfFrameW - 0.036;
  for (const [legTag, lx, lz] of [
    ['headLeft', headX, -postCenterZ],
    ['headRight', headX, postCenterZ],
    ['footLeft', footLegX, -footLegZ],
    ['footRight', footLegX, footLegZ],
  ] as const) {
    const leg = new THREE.Mesh(
      sharedCylinderGeometry(0.022, 0.014, legH, 16),
      oakMat
    );
    leg.name = `${name}.leg_${legTag}`;
    leg.position.set(lx, legH * 0.5, lz);
    leg.castShadow = true;
    leg.receiveShadow = true;
    root.add(leg);
  }

  // Low Footboard-less Solid-Oak Side & Foot Apron Rails (side rails trimmed +0.6 mm off post bottom cap)
  const railPostClearance = 0.0006;
  const sideRailH = apronH - railPostClearance;
  const sideRailCenterY = apronBotY + railPostClearance + sideRailH * 0.5;
  const sideRailLen = frameL - headX - railT;
  const sideRailCenterX = headX + sideRailLen * 0.5;
  for (const [sideTag, sz] of [
    ['leftApronRail', -halfFrameW + railT * 0.5],
    ['rightApronRail', halfFrameW - railT * 0.5],
  ] as const) {
    const rail = new THREE.Mesh(
      sharedBoxGeometry(sideRailLen, sideRailH, railT),
      oakMat
    );
    rail.name = `${name}.${sideTag}`;
    rail.position.set(sideRailCenterX, sideRailCenterY, sz);
    rail.castShadow = true;
    rail.receiveShadow = true;
    root.add(rail);
  }

  const footApronW = frameW - railT * 2;
  const footApron = new THREE.Mesh(
    sharedBoxGeometry(railT, apronH, footApronW),
    oakMat
  );
  footApron.name = `${name}.footApronRail`;
  footApron.position.set(footCenterX, apronBotY + apronH * 0.5, 0);
  footApron.castShadow = true;
  footApron.receiveShadow = true;
  root.add(footApron);

  // Rounded vertical solid-oak foot corner joints (0 high footboard: stops flush at Y = +0.350 m!)
  for (const [cTag, sz] of [
    ['left', -halfFrameW + railT * 0.5],
    ['right', halfFrameW - railT * 0.5],
  ] as const) {
    const cornerJoint = new THREE.Mesh(
      sharedCylinderGeometry(railT * 0.5, railT * 0.5, apronH, 14),
      oakMat
    );
    cornerJoint.name = `${name}.footCorner_${cTag}`;
    cornerJoint.position.set(footCenterX, apronBotY + apronH * 0.5, sz);
    cornerJoint.castShadow = true;
    root.add(cornerJoint);
  }

  // Head apron cross-rail tying the two headboard posts (trimmed +0.6 mm above post bottom cap)
  const innerHeadSpanZ = postCenterZ * 2 - postRadius * 2;
  const headLowerApron = new THREE.Mesh(
    sharedBoxGeometry(railT, sideRailH, innerHeadSpanZ + 0.012),
    oakMat
  );
  headLowerApron.name = `${name}.headLowerRail`;
  headLowerApron.position.set(headX, sideRailCenterY, 0);
  headLowerApron.castShadow = true;
  headLowerApron.receiveShadow = true;
  root.add(headLowerApron);

  // Internal pine/oak slat support base
  const slatDeck = new THREE.Mesh(
    sharedBoxGeometry(frameL - headX - railT - 0.02, 0.02, frameW - railT * 2 - 0.01),
    oakMat
  );
  slatDeck.name = `${name}.slatDeck`;
  slatDeck.position.set(sideRailCenterX, apronBotY + 0.05, 0);
  root.add(slatDeck);

  // Spindle Headboard (H = 1.100 m total: outer Ø 50 mm posts, Ø 38 mm top crest rail at +1.065 m, 19 Ø 17 mm spindles)
  const postBodyH = headboardH - apronBotY - 0.016; // rises from +0.150 m to +1.084 m + 16 mm chamfered cap = 1.100 m
  for (const [pTag, pz] of [
    ['left', -postCenterZ],
    ['right', postCenterZ],
  ] as const) {
    const post = new THREE.Mesh(
      sharedCylinderGeometry(postRadius, postRadius, postBodyH, 24),
      oakMat
    );
    post.name = `${name}.headboardPost_${pTag}`;
    post.position.set(headX, apronBotY + postBodyH * 0.5, pz);
    post.castShadow = true;
    post.receiveShadow = true;
    root.add(post);

    // Turned chamfered top cap finishing cleanly at Y = +1.100 m
    const cap = new THREE.Mesh(
      sharedCylinderGeometry(postRadius * 0.72, postRadius, 0.016, 18),
      oakMat
    );
    cap.name = `${name}.headboardPostCap_${pTag}`;
    cap.position.set(headX, headboardH - 0.008, pz);
    cap.castShadow = true;
    root.add(cap);
  }

  // Cylindrical horizontal top crest rail (Ø 38 mm at Y = +1.065 m)
  const topCrestRailY = 1.065;
  const topCrestRailRadius = 0.019; // Ø 38 mm
  const topCrestRail = new THREE.Mesh(
    sharedCylinderGeometry(
      topCrestRailRadius,
      topCrestRailRadius,
      innerHeadSpanZ + postRadius,
      18
    ),
    oakMat
  );
  topCrestRail.name = `${name}.headboardTopRail`;
  topCrestRail.rotation.x = Math.PI * 0.5;
  topCrestRail.position.set(headX, topCrestRailY, 0);
  topCrestRail.castShadow = true;
  topCrestRail.receiveShadow = true;
  root.add(topCrestRail);

  // 19 Slender Turned Cylindrical Vertical Oak Spindles (Ø 17 mm) evenly spaced across inner headboard span
  const spindleCount = 19;
  const spindleRadius = 0.0085; // Ø 17 mm
  const spindleBotY = apronTopY - 0.006;
  const spindleTopY = topCrestRailY - 0.004;
  const spindleH = spindleTopY - spindleBotY;
  const spindleSpacing = innerHeadSpanZ / (spindleCount + 1);
  for (let i = 0; i < spindleCount; i++) {
    const sz = -innerHeadSpanZ * 0.5 + spindleSpacing * (i + 1);
    const spindle = new THREE.Mesh(
      sharedCylinderGeometry(spindleRadius * 0.88, spindleRadius, spindleH, 12),
      oakMat
    );
    spindle.name = `${name}.headboardSpindle_${i + 1}`;
    spindle.position.set(headX, spindleBotY + spindleH * 0.5, sz);
    spindle.castShadow = true;
    spindle.receiveShadow = true;
    root.add(spindle);
  }

  // Signature Detachable Headboard Cushion (52 cm H × 137 cm W × 6.5 cm D) + 2 Looped Straps & Brass Button Studs
  const cushionW = isKing ? 1.50 : 1.37;
  const cushionH = 0.52;
  const cushionD = 0.065;
  const cushionTopY = 0.995; // Suspended ~70 mm below +1.065 m cylindrical top rail
  const cushionCenterY = cushionTopY - cushionH * 0.5; // 0.735 m (spans +0.475 .. +0.995 m)
  const cushionCenterX = headX + postRadius + cushionD * 0.5 + 0.004;

  const cushionGeo = createPlumpCushionGeometry(cushionD, cushionH, cushionW, 8, 14, 24);
  const headboardCushion = new THREE.Mesh(cushionGeo, boucleCushionMat);
  headboardCushion.name = `${name}.headboardCushion`;
  headboardCushion.position.set(cushionCenterX, cushionCenterY, 0);
  headboardCushion.castShadow = true;
  headboardCushion.receiveShadow = true;
  root.add(headboardCushion);

  // Two looped tan-leather/fabric suspension straps wrapping over the Ø 38 mm top crest rail with brass button studs
  const strapOffsetZ = cushionW * 0.5 - 0.19;
  const strapW = 0.034;
  const strapT = 0.005;
  for (const [sTag, sz] of [
    ['left', -strapOffsetZ],
    ['right', strapOffsetZ],
  ] as const) {
    // Top loop wrapping around the Ø 38 mm cylindrical crest rail
    const topLoop = new THREE.Mesh(
      sharedCylinderGeometry(topCrestRailRadius + strapT, topCrestRailRadius + strapT, strapW, 16),
      tanLeatherStrapMat
    );
    topLoop.name = `${name}.cushionStrapLoop_${sTag}`;
    topLoop.rotation.x = Math.PI * 0.5;
    topLoop.position.set(headX, topCrestRailY, sz);
    topLoop.castShadow = true;
    root.add(topLoop);

    // Front vertical strap leg dropping onto the front face of the cushion
    const frontStrapTopY = topCrestRailY;
    const frontStrapBotY = cushionTopY - 0.085;
    const frontStrapH = frontStrapTopY - frontStrapBotY;
    const frontStrap = new THREE.Mesh(
      sharedBoxGeometry(strapT, frontStrapH, strapW),
      tanLeatherStrapMat
    );
    frontStrap.name = `${name}.cushionStrap_${sTag}`;
    frontStrap.position.set(
      cushionCenterX + cushionD * 0.42,
      frontStrapBotY + frontStrapH * 0.5,
      sz
    );
    frontStrap.rotation.z = -0.14;
    frontStrap.castShadow = true;
    root.add(frontStrap);

    // Rear strap leg dropping behind the top rail into the top seam of the cushion
    const rearStrapH = topCrestRailY - cushionTopY + 0.025;
    const rearStrap = new THREE.Mesh(
      sharedBoxGeometry(strapT, rearStrapH, strapW),
      tanLeatherStrapMat
    );
    rearStrap.name = `${name}.cushionStrapRear_${sTag}`;
    rearStrap.position.set(
      headX + 0.012,
      cushionTopY - 0.01 + rearStrapH * 0.5,
      sz
    );
    rearStrap.rotation.z = -0.32;
    root.add(rearStrap);

    // Aged-brass button stud securing each strap to the front of the headboard cushion
    const stud = new THREE.Mesh(
      sharedCylinderGeometry(0.0085, 0.0085, 0.006, 14),
      agedBrassStudMat
    );
    stud.name = `${name}.cushionStud_${sTag}`;
    stud.rotation.z = Math.PI * 0.5;
    stud.position.set(cushionCenterX + cushionD * 0.46 + 0.003, frontStrapBotY + 0.018, sz);
    root.add(stud);
  }

  // Pocket-Sprung Mattress + Crisp White Linen Duvet + Oatmeal Textured Foot Throw + Plump Pillows
  const mattL = frameL - headX - railT - 0.02;
  const mattW = frameW - railT * 2 - 0.01;
  const mattBotY = apronBotY + 0.06; // 0.210 m (sits recessed 140 mm inside the 0.350 m oak rails)
  const mattH = 0.24; // Top of mattress at Y = +0.450 m
  const mattTopY = mattBotY + mattH;
  const mattCenterX = headX + 0.01 + mattL * 0.5;

  const mattress = new THREE.Mesh(
    sharedBoxGeometry(mattL, mattH, mattW),
    mattressTickingMat
  );
  mattress.name = `${name}.mattress`;
  mattress.position.set(mattCenterX, mattBotY + mattH * 0.5, 0);
  mattress.castShadow = true;
  mattress.receiveShadow = true;
  root.add(mattress);

  // Crisp white washed-linen duvet tucked cleanly over the mattress (total width stays <= frameW = 1.45 m!)
  const duvetStartX = headX + 0.42;
  const duvetEndX = frameL - 0.012;
  const duvetLen = duvetEndX - duvetStartX;
  const duvetW = frameW - 0.016; // 1.434 m (softly overhangs mattress while staying within 1.450 m outer post width!)
  const duvetGeo = createSoftDuvetGeometry({
    lengthX: duvetLen,
    widthZ: duvetW,
    thicknessY: 0.056,
    sideDropY: 0.105,
    footDropY: 0.095,
  });
  const duvet = new THREE.Mesh(duvetGeo, crispWhiteLinenMat);
  duvet.name = `${name}.duvet`;
  duvet.position.set((duvetStartX + duvetEndX) * 0.5, mattTopY + 0.024, 0);
  duvet.castShadow = true;
  duvet.receiveShadow = true;
  root.add(duvet);

  // Crisp folded white linen turn-down collar at the head of the duvet
  const turnDownGeo = createPlumpCushionGeometry(0.18, 0.048, duvetW - 0.012, 8, 8, 20);
  const turnDown = new THREE.Mesh(turnDownGeo, crispWhiteLinenMat);
  turnDown.name = `${name}.duvetTurnDown`;
  turnDown.position.set(duvetStartX + 0.06, mattTopY + 0.056, 0);
  turnDown.castShadow = true;
  turnDown.receiveShadow = true;
  root.add(turnDown);

  // Textured warm oatmeal waffle foot throw folded across the lower third of the bed
  const throwStartX = frameL - 0.68;
  const throwEndX = frameL - 0.008;
  const throwGeo = createSoftDuvetGeometry({
    lengthX: throwEndX - throwStartX,
    widthZ: frameW - 0.008,
    thicknessY: 0.022,
    sideDropY: 0.125,
    footDropY: 0.11,
  });
  const footThrow = new THREE.Mesh(throwGeo, oatmealThrowMat);
  footThrow.name = `${name}.footThrow`;
  footThrow.position.set((throwStartX + throwEndX) * 0.5, mattTopY + 0.06, 0);
  footThrow.castShadow = true;
  footThrow.receiveShadow = true;
  root.add(footThrow);

  // Two plump white linen sleeping pillows resting against the suspended bouclé headboard cushion
  const sleepPillowW = isKing ? 0.68 : 0.61;
  const sleepPillowGeo = createPlumpCushionGeometry(0.14, 0.36, sleepPillowW, 8, 12, 16);
  const scatterPillowGeo = createPlumpCushionGeometry(0.12, 0.30, 0.44, 8, 12, 14);
  for (const [pTag, sz] of [
    ['left', -1],
    ['right', 1],
  ] as const) {
    const pz = sz * (sleepPillowW * 0.5 + 0.022);
    const sleepPillow = new THREE.Mesh(sleepPillowGeo, crispWhiteLinenMat);
    sleepPillow.name = `${name}.sleepingPillow_${pTag}`;
    sleepPillow.position.set(headX + 0.21, mattTopY + 0.145, pz);
    sleepPillow.rotation.z = 0.34;
    sleepPillow.castShadow = true;
    sleepPillow.receiveShadow = true;
    root.add(sleepPillow);

    const scatterPillow = new THREE.Mesh(scatterPillowGeo, warmStoneScatterMat);
    scatterPillow.name = `${name}.scatterPillow_${pTag}`;
    scatterPillow.position.set(headX + 0.34, mattTopY + 0.125, sz * 0.27);
    scatterPillow.rotation.z = 0.42;
    scatterPillow.rotation.y = -sz * 0.06;
    scatterPillow.castShadow = true;
    scatterPillow.receiveShadow = true;
    root.add(scatterPillow);
  }

  attachAssetMetadata(root, {
    name: 'Cox & Cox Danica Upholstered Bouclé & Light Oak Double Bed',
    brand: 'Cox & Cox',
    collection: 'Danica',
    sku: 'CC-DAN-BED-DBL',
    finish: 'Scandi Light White Oak & Oatmeal Bouclé',
    category: 'furniture',
    dimensionsMm: [1450, 2040, 1050],
    productUrl: 'https://www.coxandcox.co.uk/furniture/bedroom-furniture/beds/',
    schematicUrl: 'https://www.coxandcox.co.uk/media/spec/Danica-Double-Bed-Dimensions.pdf',
  });
  parent.add(root);
  return root;
}
