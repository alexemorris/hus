import * as THREE from 'three';
import { applyMetricBoxUVs } from 'husjs/materials';
import {
  attachAssetInteraction,
  attachAssetMetadata,
  attachAudioEmitter,
  buildHallWoodBurningStoveFirebox,
  prepGeo,
  tagCollisionRole,
} from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import { getWovenSparkMeshTexture512, hashCell2D } from './pbr-textures.ts';
import { bevelledBox, buildSplitCeramicLogGeo } from './sculpted-geometry.ts';
import type { StahlMaterials } from './structure.ts';
import { CLEAR_CEILING_Y, DECK_DEPTH_M, Z2 } from './terrain.ts';

/**
 * Extrudes a true continuous T-Steel / H. H. Robertson `5"` (`127 mm`) 18-gauge trapezoidal
 * corrugated steel roof deck section spanning `xMin..xMax` and `zMin..zMax` (flutes running E-W)
 * with smooth filleted bend corners (`r ~ 8 mm`) and `computeVertexNormals()` so grazing
 * California sunlight produces authentic specular rib highlights instead of flat facets.
 */
export function buildTrapezoidalRoofDeckMesh(
  name: string,
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number,
  soffitY: number,
  mat: THREE.Material
): THREE.Mesh {
  const spanX = xMax - xMin;
  const topY = soffitY + DECK_DEPTH_M;
  const troughTopY = soffitY + 0.044;
  const pitch = 0.2032; // 8" (203.2 mm) Robertson / T-Steel trapezoidal flute pitch
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(zMin, topY),
    new THREE.Vector2(zMax, topY),
    new THREE.Vector2(zMax, troughTopY),
  ];

  const pushFilletCorner = (prev: THREE.Vector2, corner: THREE.Vector2, next: THREE.Vector2, rad = 0.0065) => {
    const d1 = prev.clone().sub(corner).normalize();
    const d2 = next.clone().sub(corner).normalize();
    for (let s = 0; s <= 3; s++) {
      const t = s / 3;
      const pA = corner.clone().addScaledVector(d1, rad * (1 - t));
      const pB = corner.clone().addScaledVector(d2, rad * t);
      pts.push(pA.lerp(pB, t));
    }
  };

  const count = Math.floor((zMax - zMin - 0.08) / pitch);
  const startZ = zMin + (zMax - zMin - count * pitch) * 0.5;
  for (let i = count - 1; i >= 0; i--) {
    const z0 = startZ + i * pitch;
    const pCrestR = new THREE.Vector2(z0 + pitch * 0.72, troughTopY);
    const pBotR = new THREE.Vector2(z0 + pitch * 0.58, soffitY);
    const pBotL = new THREE.Vector2(z0 + pitch * 0.22, soffitY);
    const pCrestL = new THREE.Vector2(z0 + pitch * 0.08, troughTopY);

    const prevZ = i === count - 1 ? zMax : startZ + (i + 1) * pitch + pitch * 0.08;
    const nextZ = i === 0 ? zMin : startZ + (i - 1) * pitch + pitch * 0.72;

    pushFilletCorner(new THREE.Vector2(prevZ, troughTopY), pCrestR, pBotR);
    pushFilletCorner(pCrestR, pBotR, pBotL);
    pushFilletCorner(pBotR, pBotL, pCrestL);
    pushFilletCorner(pBotL, pCrestL, new THREE.Vector2(nextZ, troughTopY));
  }
  pts.push(new THREE.Vector2(zMin, troughTopY));

  const shape = new THREE.Shape(pts);
  shape.closePath();

  const cleanGeo = new THREE.ExtrudeGeometry(shape, { depth: spanX, bevelEnabled: false, steps: 1 });
  cleanGeo.rotateY(-Math.PI * 0.5);
  cleanGeo.translate(xMax, 0, 0);
  cleanGeo.computeVertexNormals();

  const mesh = new THREE.Mesh(prepGeo(applyMetricBoxUVs(cleanGeo, { tileW: 1.524, tileH: 1.524 })), mat);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/**
 * Filleted vertical Woods Drive H. H. Robertson box-rib flute profile (`computeVertexNormals()`).
 */
export function buildFilletedBoxRibFluteGeo(
  width: number,
  height: number,
  depth: number,
  axis: 'z' | 'x' = 'z'
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const r = Math.min(0.006, hw * 0.24, depth * 0.24);
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(-hw + 0.008, depth - r);
  shape.quadraticCurveTo(-hw + 0.009, depth, -hw + 0.009 + r, depth);
  shape.lineTo(hw - 0.009 - r, depth);
  shape.quadraticCurveTo(hw - 0.009, depth, hw - 0.008, depth - r);
  shape.lineTo(hw, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 6,
    steps: 1,
  });
  // Shape (X, Y) extruded along +Z (0..height) -> rotateX(-90 deg) puts height along +Y and depth along -Z
  geo.rotateX(-Math.PI * 0.5);
  geo.translate(0, -height * 0.5, depth * 0.5);
  if (axis === 'x') {
    geo.rotateY(Math.PI * 0.5);
  }
  geo.computeVertexNormals();
  return prepGeo(applyMetricBoxUVs(geo, { tileW: 1.2, tileH: 1.2 }));
}

/**
 * Flush round recessed `Emerson-Pryne` architectural soffit downlight (`36` radial segments).
 */
export function addEmersonPryneSoffitDownlight(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  name: string,
  circuitId: string,
  x: number,
  y: number,
  z: number,
  mats: StahlMaterials,
  options?: { readonly hex?: number; readonly poolY?: number; readonly poolRadius?: number; readonly poolOpacity?: number }
): void {
  const hex = options?.hex ?? 0xffd59c;
  const grp = (ctx.lightGroups as Record<string, LightCircuitGroup>)[circuitId];
  const fix = new THREE.Group();
  fix.name = name;
  fix.position.set(x, y, z);

  const trimRing = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.072, 0.072, 0.008, 36)), mats.anodizedAlum);
  trimRing.position.y = -0.004;
  const baffle = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.056, 0.056, 0.012, 32)), mats.matteBlackHood);
  baffle.position.y = -0.0065;
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0xfff8eb,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 1.75,
    roughness: 0.25,
  });
  const lens = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.006, 32)), lensMat);
  lens.position.y = -0.0102;
  fix.add(trimRing, baffle, lens);
  tagCollisionRole(fix, 'ignore');
  parent.add(fix);

  if (grp) grp.emissives.push(lensMat);
  ctx.addGlowPool(
    circuitId as never,
    x,
    options?.poolY ?? 0.007,
    z,
    options?.poolRadius ?? 1.65,
    options?.poolOpacity ?? 0.24
  );
}

/**
 * Prescolite / Litecraft mid-century satin opal-glass globe pendant (`64 x 40` SphereGeometry).
 */
export function addPrescoliteOpalGlobeFixture(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  name: string,
  circuitId: string,
  x: number,
  soffitY: number,
  z: number,
  mats: StahlMaterials,
  options?: { readonly dropM?: number; readonly radiusM?: number; readonly hex?: number; readonly poolRadius?: number }
): void {
  const dropM = options?.dropM ?? 0.16;
  const radiusM = options?.radiusM ?? 0.095;
  const hex = options?.hex ?? 0xffd7a0;
  const grp = (ctx.lightGroups as Record<string, LightCircuitGroup>)[circuitId];

  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, soffitY, z);

  const canopy = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.052, 0.058, 0.016, 32)), mats.anodizedAlum);
  canopy.position.y = -0.008;
  g.add(canopy);

  if (dropM > radiusM + 0.03) {
    const stemLen = dropM - radiusM - 0.014;
    const stem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.005, 0.005, stemLen, 18)), mats.anodizedAlum);
    stem.position.y = -0.016 - stemLen * 0.5;
    g.add(stem);
  }

  const neck = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.028, 0.034, 0.018, 28)), mats.anodizedAlum);
  neck.position.y = -dropM + radiusM + 0.004;

  const opalMat = new THREE.MeshStandardMaterial({
    color: 0xfffaf0,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 1.55,
    roughness: 0.32,
  });
  const globe = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(radiusM, 64, 40)), opalMat);
  globe.position.y = -dropM;
  g.add(neck, globe);
  tagCollisionRole(g, 'ignore');
  parent.add(g);

  if (grp) grp.emissives.push(opalMat);
  ctx.addGlowPool(circuitId as never, x, 0.007, z, options?.poolRadius ?? 1.8, 0.22);
}

/**
 * Koenig's iconic 4-sided suspended sheet-steel fireplace (`stahl.fireplace.assembly`)
 * anchored on a sculpted natural Palos Verdes stone ashlar masonry plinth (36 individual
 * varied-relief bevelled stone blocks + recessed mortar core), filleted 4" steel L-angles,
 * smooth 4-way tapered steel hood, natural curved split ceramic logs, and fine translucent
 * woven wire spark-mesh firescreens.
 */
export function buildKoenigSuspendedFireplace(
  root: THREE.Group,
  roofGroup: THREE.Group,
  mats: StahlMaterials
): void {
  const fpX = 2.95;
  const fpZ = Z2;
  const fpGroup = new THREE.Group();
  fpGroup.name = 'stahl.fireplace.assembly';
  fpGroup.position.set(fpX, 0, fpZ);

  const hearthH = 0.32;
  const hearthW = 2.16;
  const hearthD = 0.98;
  const masonryTopY = hearthH - 0.036;
  const masonryBotY = 0.0012;
  const masonryH = masonryTopY - masonryBotY;

  // Recessed dark cementitious mortar core (`16 mm` inset behind Palos Verdes stone blocks)
  const mortarMat = new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 0.92 });
  const plinthCore = new THREE.Mesh(
    bevelledBox(hearthW - 0.034, masonryH - 0.004, hearthD - 0.034, 0.004, 3, 1.0, 1.0),
    mortarMat
  );
  plinthCore.name = 'stahl.fireplace.hearthPlinth';
  plinthCore.position.y = masonryBotY + masonryH * 0.5;
  plinthCore.castShadow = plinthCore.receiveShadow = true;
  fpGroup.add(plinthCore);

  // 3-course sculpted Palos Verdes ledgestone/ashlar masonry around all 4 hearth faces
  // (varied stone relief 4..10 mm proud of core, 8 mm mortar joints, zero coplanar overlap!)
  const courseHeights = [0.088, 0.094, masonryH - 0.088 - 0.094 - 0.016];
  const jointM = 0.008;
  let curY = masonryBotY;
  courseHeights.forEach((ch, cIdx) => {
    const cy = curY + ch * 0.5;
    curY += ch + jointM;

    // North & South long faces (spanning full hearthW including corners)
    const nsSplits = cIdx === 1 ? [-1.08, -0.58, -0.06, 0.48, 1.08] : [-1.08, -0.44, 0.14, 0.66, 1.08];
    for (const sz of [-1, 1] as const) {
      for (let i = 0; i < nsSplits.length - 1; i++) {
        const xA = nsSplits[i]! + (i === 0 ? 0 : jointM * 0.5);
        const xB = nsSplits[i + 1]! - (i === nsSplits.length - 2 ? 0 : jointM * 0.5);
        const bw = xB - xA;
        const relief = 0.022 + hashCell2D(i + cIdx * 7, sz > 0 ? 1 : 2, 313) * 0.007;
        const block = new THREE.Mesh(
          bevelledBox(bw, ch, relief, 0.007, 3, 0.9, 0.9),
          mats.hearthPalosVerdes
        );
        block.position.set((xA + xB) * 0.5, cy, sz * (hearthD * 0.5 - 0.017 + relief * 0.5 + 0.0012));
        block.castShadow = block.receiveShadow = true;
        fpGroup.add(block);
      }
    }

    // East & West end faces (inset cleanly between N/S corner returns so zero corner z-fighting)
    const ewInnerSpan = hearthD - 0.036;
    const ewSplits = cIdx === 1 ? [-ewInnerSpan * 0.5, 0.04, ewInnerSpan * 0.5] : [-ewInnerSpan * 0.5, -0.05, ewInnerSpan * 0.5];
    for (const sx of [-1, 1] as const) {
      for (let i = 0; i < ewSplits.length - 1; i++) {
        const zA = ewSplits[i]! + jointM * 0.5;
        const zB = ewSplits[i + 1]! - jointM * 0.5;
        const bd = zB - zA;
        const relief = 0.021 + hashCell2D(i + cIdx * 5, sx > 0 ? 3 : 4, 419) * 0.007;
        const block = new THREE.Mesh(
          bevelledBox(relief, ch, bd, 0.007, 3, 0.9, 0.9),
          mats.hearthPalosVerdes
        );
        block.position.set(sx * (hearthW * 0.5 - 0.017 + relief * 0.5 + 0.0012), cy, (zA + zB) * 0.5);
        block.castShadow = block.receiveShadow = true;
        fpGroup.add(block);
      }
    }
  });

  // Cantilevered bevelled honed concrete hearth cap slab (`1.5 mm` clear above top masonry course)
  const capH = 0.034;
  const hearthCap = new THREE.Mesh(
    bevelledBox(hearthW + 0.044, capH, hearthD + 0.044, 0.006, 4, 1.524, 1.524),
    mats.concreteSlab
  );
  hearthCap.name = 'stahl.fireplace.hearthCap';
  hearthCap.position.y = hearthH - capH * 0.5;
  hearthCap.castShadow = hearthCap.receiveShadow = true;

  // Recessed refractory firebrick pit pan cleanly proud of hearth cap (`+1.2 mm`)
  const firePanMat = new THREE.MeshStandardMaterial({ color: 0x282421, roughness: 0.88 });
  const firePan = new THREE.Mesh(bevelledBox(1.48, 0.022, 0.54, 0.004, 3), firePanMat);
  firePan.position.y = hearthH + 0.0122;
  fpGroup.add(hearthCap, firePan);

  // Four continuous filleted 4" (96 mm) matte-black steel corner L-angles rising from hearth to soffit
  const hoodBotY = 1.04;
  const hoodTopY = CLEAR_CEILING_Y - 0.038;
  const hoodW = 1.72;
  const hoodD = 0.7;
  const angleLeg = 0.072;
  const angleT = 0.011;
  const postBottomY = hearthH + 0.0015;
  const postH = hoodTopY - postBottomY;
  const postMidY = postBottomY + postH * 0.5;

  const legXGeo = bevelledBox(angleLeg, postH, angleT, 0.0025, 3);
  const legZGeo = bevelledBox(angleT, postH, angleLeg - angleT - 0.0015, 0.0025, 3);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (hoodW * 0.5 - angleT * 0.5);
      const cz = sz * (hoodD * 0.5 - angleT * 0.5);
      const legX = new THREE.Mesh(legXGeo, mats.matteBlackHood);
      legX.position.set(cx - sx * (angleLeg * 0.5 - angleT * 0.5), postMidY, cz);
      const legZ = new THREE.Mesh(legZGeo, mats.matteBlackHood);
      legZ.position.set(cx, postMidY, cz - sz * (angleLeg * 0.5 + angleT * 0.5 + 0.0008));
      legX.castShadow = legZ.castShadow = true;
      fpGroup.add(legX, legZ);
    }
  }

  // True 4-way tapered pyramidal-frustum lower apron (`1.09..1.42 m`) + bevelled upper hood (`1.42..2.604 m`)
  const apronBotY = hoodBotY + 0.05;
  const apronTopY = 1.42;
  const botHalfW = hoodW * 0.5 - angleT - 0.003;
  const botHalfD = hoodD * 0.5 - angleT - 0.003;
  const upperW = 1.56;
  const upperD = 0.58;
  const topHalfW = upperW * 0.5;
  const topHalfD = upperD * 0.5;

  const frustumPos = new Float32Array([
    -botHalfW, apronBotY,  botHalfD,
     botHalfW, apronBotY,  botHalfD,
     botHalfW, apronBotY, -botHalfD,
    -botHalfW, apronBotY, -botHalfD,
    -topHalfW, apronTopY,  topHalfD,
     topHalfW, apronTopY,  topHalfD,
     topHalfW, apronTopY, -topHalfD,
    -topHalfW, apronTopY, -topHalfD,
  ]);
  const frustumIdx = [
    0, 1, 5, 0, 5, 4, // South
    1, 2, 6, 1, 6, 5, // East
    2, 3, 7, 2, 7, 6, // North
    3, 0, 4, 3, 4, 7, // West
    4, 5, 6, 4, 6, 7, // Top cap
    3, 2, 1, 3, 1, 0, // Bottom soffit
  ];
  const apronRaw = new THREE.BufferGeometry();
  apronRaw.setAttribute('position', new THREE.BufferAttribute(frustumPos, 3));
  apronRaw.setIndex(frustumIdx);
  apronRaw.computeVertexNormals();
  const hoodApron = new THREE.Mesh(prepGeo(applyMetricBoxUVs(apronRaw, { tileW: 1.2, tileH: 1.2 })), mats.matteBlackHood);
  hoodApron.name = 'stahl.fireplace.taperedApron';
  hoodApron.castShadow = true;

  const upperHoodH = hoodTopY - apronTopY - 0.0015;
  const upperHood = new THREE.Mesh(
    bevelledBox(upperW, upperHoodH, upperD, 0.005, 3, 1.2, 1.2),
    mats.matteBlackHood
  );
  upperHood.name = 'stahl.fireplace.hoodBody';
  upperHood.position.y = apronTopY + 0.0015 + upperHoodH * 0.5;
  upperHood.castShadow = true;

  // Perimeter horizontal steel angle lintel collar around `hoodBotY`
  const lintelH = 0.048;
  const lintelFBGeo = bevelledBox(hoodW - 2 * angleLeg - 0.003, lintelH, 0.014, 0.002, 3);
  for (const sz of [-1, 1]) {
    const bar = new THREE.Mesh(lintelFBGeo, mats.matteBlackHood);
    bar.position.set(0, hoodBotY + lintelH * 0.5, sz * (hoodD * 0.5 - 0.019));
    fpGroup.add(bar);
  }
  const lintelSideGeo = bevelledBox(0.014, lintelH, hoodD - 2 * angleLeg - 0.003, 0.002, 3);
  for (const sx of [-1, 1]) {
    const bar = new THREE.Mesh(lintelSideGeo, mats.matteBlackHood);
    bar.position.set(sx * (hoodW * 0.5 - 0.019), hoodBotY + lintelH * 0.5, 0);
    fpGroup.add(bar);
  }

  // Fine translucent woven wire spark-mesh curtains (`512x512` woven wire alpha texture + gentle pleats)
  const sparkTex = getWovenSparkMeshTexture512();
  const screenMat = new THREE.MeshStandardMaterial({
    map: sparkTex,
    roughness: 0.56,
    metalness: 0.72,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const screenH = hoodBotY - (hearthH + 0.028);
  const screenMidY = hearthH + 0.028 + screenH * 0.5;
  const screenPlane = new THREE.PlaneGeometry(hoodW - 0.18, screenH, 48, 8);
  const sPos = screenPlane.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sPos.count; i++) {
    const sx = sPos.getX(i);
    sPos.setZ(i, Math.sin(sx * 44) * 0.006);
  }
  screenPlane.computeVertexNormals();
  const screenFaceGeo = prepGeo(screenPlane);

  for (const [tag, sz] of [
    ['northDining', -(hoodD * 0.5 - 0.045)],
    ['southLiving', hoodD * 0.5 - 0.045],
  ] as const) {
    const scr = new THREE.Mesh(screenFaceGeo, screenMat);
    scr.name = `stahl.fireplace.meshScreen.${tag}`;
    scr.position.set(0, screenMidY, sz);
    fpGroup.add(scr);
    for (const px of [-0.045, 0.045]) {
      const pull = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.014, 0.0028, 12, 24)), mats.anodizedAlum);
      pull.position.set(px, screenMidY + 0.06, sz + (sz > 0 ? 0.01 : -0.01));
      fpGroup.add(pull);
    }
  }

  // Heavy wrought-steel log cradle grate + ceramic gas burner bar
  const grateBarGeo = bevelledBox(1.12, 0.016, 0.018, 0.003, 3);
  for (const gz of [-0.14, -0.07, 0, 0.07, 0.14]) {
    const gBar = new THREE.Mesh(grateBarGeo, mats.matteBlackHood);
    gBar.position.set(0, hearthH + 0.058, gz);
    fpGroup.add(gBar);
  }
  const gasPipe = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.96, 18)), mats.matteBlackHood);
  gasPipe.rotation.z = Math.PI * 0.5;
  gasPipe.position.set(0, hearthH + 0.034, 0.195);
  fpGroup.add(gasPipe);

  // Double-sided firebox flame/ember core
  const fireInsert = new THREE.Group();
  fireInsert.name = 'stahl.fireplace.firebox';
  fireInsert.position.set(0.11, hearthH - 0.16, 0);
  buildHallWoodBurningStoveFirebox({
    stoveGroup: fireInsert,
    castIronMat: mats.matteBlackHood,
    namePrefix: 'stahlHearth',
    id: 'stahl-hearth-fire',
    label: 'Koenig Double-Sided Suspended Fireplace',
  });
  fireInsert.traverse((child) => {
    if (
      child.name.includes('fireboxBack') ||
      child.name.includes('fireboxLiner') ||
      child.name.includes('doorGlass') ||
      child.name.includes('logRetainer') ||
      child.name.includes('fireboxFloor')
    ) {
      child.visible = false;
    }
  });

  const emberMat = new THREE.MeshStandardMaterial({
    color: 0xff7426,
    emissive: new THREE.Color(0xff4e08),
    emissiveIntensity: 2.6,
    roughness: 0.55,
  });
  const wideEmberBed = new THREE.Mesh(bevelledBox(0.92, 0.018, 0.28, 0.006, 3), emberMat);
  wideEmberBed.name = 'stahl.fireplace.emberBed';
  wideEmberBed.position.set(0, hearthH + 0.036, 0);

  // Sculpted natural curved & split ceramic hearth logs (`buildSplitCeramicLogGeo`)
  const ceramicLogMat = new THREE.MeshStandardMaterial({
    color: 0x3b261a,
    emissive: new THREE.Color(0xd94406),
    emissiveIntensity: 0.95,
    roughness: 0.86,
  });
  const logSpecs: readonly [number, number, number, number, number, number, number][] = [
    [-0.18, hearthH + 0.09, -0.045, 0.044, 0.6, 0.09, 1],
    [0.16, hearthH + 0.094, 0.048, 0.046, 0.64, -0.1, 2],
    [0.01, hearthH + 0.136, 0.0, 0.039, 0.54, 0.24, 3],
    [-0.04, hearthH + 0.088, 0.085, 0.036, 0.46, -0.22, 4],
  ];
  logSpecs.forEach(([lx, ly, lz, rad, len, yaw, seed], idx) => {
    const log = new THREE.Mesh(buildSplitCeramicLogGeo(len, rad, 0.026, seed), ceramicLogMat);
    log.name = `stahl.fireplace.ceramicLog_${idx + 1}`;
    log.rotation.y = yaw;
    log.position.set(lx, ly, lz);
    fpGroup.add(log);
  });

  // Brushed-steel throat damper lever on East face of hood + interactive toggle
  const damperLever = new THREE.Group();
  damperLever.name = 'stahl.fireplace.damperLever';
  damperLever.position.set(upperW * 0.5 + 0.008, 1.52, 0);
  const leverArm = new THREE.Mesh(bevelledBox(0.045, 0.012, 0.012, 0.002, 2), mats.anodizedAlum);
  leverArm.position.x = 0.022;
  const leverKnob = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.014, 20, 16)), mats.walnutWood);
  leverKnob.position.x = 0.048;
  damperLever.add(leverArm, leverKnob);

  fpGroup.add(hoodApron, upperHood, fireInsert, wideEmberBed, damperLever);

  const audioHandle = attachAudioEmitter(fpGroup, {
    id: 'stahl-fireplace-crackle',
    preset: 'woodStove',
    zoneId: 'stahlLivingDining',
    volume: 0.38,
    refDistance: 1.6,
    maxDistance: 11.0,
  });

  attachAssetMetadata(fpGroup, {
    id: 'stahl.fireplace.assembly',
    name: 'Pierre Koenig Double-Sided Suspended Sheet-Steel Fireplace & Stone Hearth',
    brand: 'Pierre Koenig FAIA / Raymond Equipment & Welding',
    collection: 'Case Study House #22 Architectural Hearth (1960)',
    sku: 'CSH22-FP-1960',
    finish: 'Matte Black Sheet Steel, 4" Steel Angles, Woven Spark Mesh & Palos Verdes Stone Hearth',
    category: 'architectural',
    dimensionsMm: [2160, 980, 2642],
  });

  attachAssetInteraction(damperLever, {
    kind: 'toggle',
    id: 'stahl-fireplace-damper',
    label: 'Toggle Fireplace Gas Flame & Throat Damper',
    activeLabel: 'Close Damper & Extinguish Hearth Flame',
    initialActive: true,
    audio: { openPreset: 'switchClick', closePreset: 'switchClick', volume: 0.45 },
    onStep: (_dtSeconds, { progress, active, elapsedActiveSec }) => {
      damperLever.rotation.z = (1 - progress) * -0.45;
      const flicker = active
        ? 0.88 + 0.14 * Math.sin(elapsedActiveSec * 6.7) + 0.07 * Math.cos(elapsedActiveSec * 11.3)
        : 0;
      wideEmberBed.material.emissiveIntensity = 2.6 * progress * (active ? flicker : 1);
      ceramicLogMat.emissiveIntensity = 0.95 * progress * (active ? flicker : 1);
      fireInsert.visible = progress > 0.05;
      audioHandle.setActive(active);
    },
  });

  root.add(fpGroup);

  // High-segment oval matte-black steel chimney flue stack penetrating above the 5" roof deck
  const roofTopY = CLEAR_CEILING_Y + DECK_DEPTH_M;
  const flueGroup = new THREE.Group();
  flueGroup.name = 'stahl.fireplace.roofFlueStack';
  flueGroup.position.set(fpX, roofTopY, fpZ);

  const flashingCollar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.24, 0.28, 0.045, 36)),
    mats.steelCharcoal
  );
  flashingCollar.position.y = 0.026;
  flashingCollar.scale.set(1.35, 1, 0.85);

  const fluePipe = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.19, 0.19, 0.62, 36)),
    mats.matteBlackHood
  );
  fluePipe.position.y = 0.35;
  fluePipe.scale.set(1.35, 1, 0.85);
  fluePipe.castShadow = true;

  const rainCapStruts = new THREE.Mesh(bevelledBox(0.42, 0.075, 0.016, 0.002, 2), mats.matteBlackHood);
  rainCapStruts.position.y = 0.695;
  const rainCap = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.27, 0.31, 0.042, 36)),
    mats.matteBlackHood
  );
  rainCap.position.y = 0.745;
  rainCap.scale.set(1.32, 1, 0.88);
  rainCap.castShadow = true;

  flueGroup.add(flashingCollar, fluePipe, rainCapStruts, rainCap);
  roofGroup.add(flueGroup);
}

/**
 * Full-bay Integrated Ceilings & Grilleworks "Infinilite" suspended luminous ceiling
 * (`stahl.kitchen.infiniliteCeiling`) with bevelled walnut fascia & anodized T-bar splines.
 */
export function buildInfiniliteKitchenCeiling(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials
): void {
  const ceilGroup = new THREE.Group();
  ceilGroup.name = 'stahl.kitchen.infiniliteCeiling';

  const centerX = 3.05;
  const centerZ = -2.85;
  const totalW = 4.68;
  const totalD = 3.72;
  const soffitY = 2.385;
  const fasciaH = 0.076;
  const frameT = 0.032;

  ceilGroup.position.set(centerX, soffitY, centerZ);

  const frontFasciaGeo = bevelledBox(totalW, fasciaH, frameT, 0.003, 3, 0.9, 0.9);
  for (const sz of [-1, 1]) {
    const f = new THREE.Mesh(frontFasciaGeo, mats.walnutWood);
    f.position.set(0, fasciaH * 0.5, sz * (totalD * 0.5 - frameT * 0.5));
    f.castShadow = true;
    ceilGroup.add(f);
  }
  const sideFasciaGeo = bevelledBox(frameT, fasciaH, totalD - 2 * frameT - 0.003, 0.003, 3, 0.9, 0.9);
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(sideFasciaGeo, mats.walnutWood);
    f.position.set(sx * (totalW * 0.5 - frameT * 0.5), fasciaH * 0.5, 0);
    f.castShadow = true;
    ceilGroup.add(f);
  }

  const hangerTop = CLEAR_CEILING_Y - 0.038 - soffitY - fasciaH;
  if (hangerTop > 0.04) {
    const rodGeo = prepGeo(new THREE.CylinderGeometry(0.0035, 0.0035, hangerTop, 14));
    for (const hx of [-totalW * 0.42, 0, totalW * 0.42]) {
      for (const hz of [-totalD * 0.42, totalD * 0.42]) {
        const rod = new THREE.Mesh(rodGeo, mats.anodizedAlum);
        rod.position.set(hx, fasciaH + hangerTop * 0.5, hz);
        ceilGroup.add(rod);
      }
    }
  }

  const innerW = totalW - 2 * frameT - 0.004;
  const innerD = totalD - 2 * frameT - 0.004;
  const cols = 4;
  const rows = 3;
  const tBarW = 0.018;
  const tBarH = 0.016;

  const longTBarGeo = bevelledBox(tBarW, tBarH, innerD, 0.002, 2);
  for (let c = 1; c < cols; c++) {
    const tx = -innerW * 0.5 + (innerW * c) / cols;
    const bar = new THREE.Mesh(longTBarGeo, mats.anodizedAlum);
    bar.position.set(tx, tBarH * 0.5, 0);
    ceilGroup.add(bar);
  }
  const segSpanX = innerW / cols - tBarW - 0.003;
  const crossBarGeo = bevelledBox(segSpanX, tBarH, tBarW, 0.002, 2);
  for (let r = 1; r < rows; r++) {
    const tz = -innerD * 0.5 + (innerD * r) / rows;
    for (let c = 0; c < cols; c++) {
      const cx = -innerW * 0.5 + (innerW * (c + 0.5)) / cols;
      const bar = new THREE.Mesh(crossBarGeo, mats.anodizedAlum);
      bar.position.set(cx, tBarH * 0.5, tz);
      ceilGroup.add(bar);
    }
  }

  const opalPanelMat = new THREE.MeshStandardMaterial({
    color: 0xfaf6ea,
    emissive: new THREE.Color(0xffebc2),
    emissiveIntensity: 1.55,
    roughness: 0.28,
  });
  const cellW = innerW / cols - tBarW - 0.006;
  const cellD = innerD / rows - tBarW - 0.006;
  const cellGeo = bevelledBox(cellW, 0.012, cellD, 0.002, 2);
  for (let c = 0; c < cols; c++) {
    const cx = -innerW * 0.5 + (innerW * (c + 0.5)) / cols;
    for (let r = 0; r < rows; r++) {
      const cz = -innerD * 0.5 + (innerD * (r + 0.5)) / rows;
      const panel = new THREE.Mesh(cellGeo, opalPanelMat);
      panel.name = `stahl.kitchen.infinilitePanel_${c}_${r}`;
      panel.position.set(cx, 0.024, cz);
      ceilGroup.add(panel);
    }
  }

  tagCollisionRole(ceilGroup, 'ignore');
  attachAssetMetadata(ceilGroup, {
    id: 'stahl.kitchen.infiniliteCeiling',
    name: 'Integrated Ceilings & Grilleworks "Infinilite" Suspended Luminous Kitchen Ceiling',
    brand: 'Integrated Ceilings & Grilleworks, Inc.',
    collection: 'Case Study House #22 Merit Specified Lighting (1960)',
    sku: 'ICG-INFINILITE-60',
    finish: 'Translucent Milk-White Opal-Acrylic Diffuser Grid, Satin Anodized T-Bars & American Walnut Fascia',
    category: 'lighting',
    dimensionsMm: [Math.round(totalW * 1000), Math.round(totalD * 1000), Math.round(fasciaH * 1000)],
  });

  const lumGroup = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlKitchenLuminous;
  if (lumGroup) lumGroup.emissives.push(opalPanelMat);
  ctx.addGlowPool('stahlKitchenLuminous' as never, centerX - 0.9, 0.007, centerZ, 2.1, 0.24);
  ctx.addGlowPool('stahlKitchenLuminous' as never, centerX + 0.9, 0.007, centerZ, 2.1, 0.24);

  root.add(ceilGroup);
}
