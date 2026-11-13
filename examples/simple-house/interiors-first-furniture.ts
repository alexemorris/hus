import * as THREE from 'three';
import type { CircuitId } from 'husjs';
import {
  applyMetricBoxUVs,
  getOrCreateCachedTexture,
} from 'husjs/materials';
import {
  attachAssetMetadata,
  attachDrawerBoxBehindFront,
  prepGeo,
  registerSlidingDrawer,
  sharedCylinderGeometry,
  sharedSphereGeometry,
  tagHighLodDetail,
} from 'husjs/objects';
import {
  SeatInteractable,
  collectSeatClickableMeshes,
  createSculptedCushionGeometry,
} from 'husjs/catalog/furniture';
import type { SceneBuilderContext } from 'husjs/viewer';


export function deconflictRomanBlind(blind: THREE.Group, facingZ: 1 | -1): THREE.Group {
  for (const child of blind.children) {
    if (child.name.endsWith('.hemBar')) {
      child.position.y -= 0.0015;
      child.position.z += facingZ * 0.002;
    } else if (child.name.endsWith('.pleat')) {
      child.position.z += facingZ * 0.005;
    }
  }
  return blind;
}

export function deconflictCurtainBrackets(curtains: THREE.Group, inwardSignX: 1 | -1): THREE.Group {
  let idx = 0;
  for (const child of curtains.children) {
    if (child.name.endsWith('.bracket')) {
      const mod = idx % 3;
      if (mod === 0) {
        child.scale.y = 0.86;
      } else if (mod === 1) {
        child.position.x += inwardSignX * 0.0012;
      }
      idx++;
    }
  }
  return curtains;
}

export function registerCircuitEmissive(
  ctx: SceneBuilderContext,
  circuitId: CircuitId,
  mat: THREE.MeshStandardMaterial
): void {
  const maybeReg = (
    ctx as unknown as {
      registerEmissive?: (id: CircuitId, m: THREE.MeshStandardMaterial) => void;
    }
  ).registerEmissive;
  if (typeof maybeReg === 'function') {
    maybeReg.call(ctx, circuitId, mat);
    return;
  }
  ctx.lightGroups[circuitId]?.emissives.push(mat);
}

export function createWarm2700kLedMaterial(
  name: string,
  emissiveIntensity = 1.4
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xfff1d6,
    emissive: new THREE.Color(0xffb86b),
    emissiveIntensity,
    roughness: 0.3,
  });
}

export const NEPTUNE_SALT = 0xe8e3d7;
export const FB_MIZZLE = 0xc0c6b8;

export function addBox(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  center: readonly [number, number, number],
  material: THREE.Material
): THREE.Mesh {
  const geo = prepGeo(new THREE.BoxGeometry(size[0], size[1], size[2]));
  applyMetricBoxUVs(geo, { tileW: 0.9 });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.position.set(center[0], center[1], center[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function stripBuiltInDanicaBedding(bedGroup: THREE.Group): void {
  const suffixes = [
    '.duvet',
    '.duvetTurnDown',
    '.footThrow',
    '.sleepingPillow_left',
    '.sleepingPillow_right',
    '.scatterPillow_left',
    '.scatterPillow_right',
  ];
  const toRemove: THREE.Object3D[] = [];
  bedGroup.traverse((child) => {
    if (suffixes.some((sfx) => child.name.endsWith(sfx))) {
      toRemove.push(child);
    }
  });
  for (const node of toRemove) {
    node.removeFromParent();
  }
}

function createWovenHerringboneFabricMaterial(
  key: string,
  baseHex: string,
  accentHex: string,
  roughness = 0.88
): THREE.MeshStandardMaterial {
  const maps = getOrCreateCachedTexture(`simpleHouse.ff.fabric.${key}`, () => {
    const size = 128;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const base = new THREE.Color(baseHex);
    const acc = new THREE.Color(accentHex);
    const br = Math.round(base.r * 255);
    const bg = Math.round(base.g * 255);
    const bb = Math.round(base.b * 255);
    const ar = Math.round(acc.r * 255);
    const ag = Math.round(acc.g * 255);
    const ab = Math.round(acc.b * 255);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const zig = ((x >> 3) & 1) === 0 ? x + y : x - y + size;
        const thread = (zig & 3) < 2 ? 1 : 0;
        const slub = (((x * 37 + y * 73) & 15) - 7) * 0.012;
        const mix = (thread ? 0.68 : 0.32) + slub;
        const idx = y * size + x;
        height[idx] = mix;
        const p = idx * 4;
        color[p] = Math.max(0, Math.min(255, Math.round(br * mix + ar * (1 - mix))));
        color[p + 1] = Math.max(0, Math.min(255, Math.round(bg * mix + ag * (1 - mix))));
        color[p + 2] = Math.max(0, Math.min(255, Math.round(bb * mix + ab * (1 - mix))));
        color[p + 3] = 255;
      }
    }
    const colorTex = new THREE.DataTexture(color, size, size, THREE.RGBAFormat);
    colorTex.wrapS = THREE.RepeatWrapping;
    colorTex.wrapT = THREE.RepeatWrapping;
    colorTex.repeat.set(6, 6);
    colorTex.colorSpace = THREE.SRGBColorSpace;
    colorTex.needsUpdate = true;

    const bumpBytes = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const v = Math.max(0, Math.min(255, Math.round(height[i] * 255)));
      const p = i * 4;
      bumpBytes[p] = v;
      bumpBytes[p + 1] = v;
      bumpBytes[p + 2] = v;
      bumpBytes[p + 3] = 255;
    }
    const bumpTex = new THREE.DataTexture(bumpBytes, size, size, THREE.RGBAFormat);
    bumpTex.wrapS = THREE.RepeatWrapping;
    bumpTex.wrapT = THREE.RepeatWrapping;
    bumpTex.repeat.set(6, 6);
    bumpTex.needsUpdate = true;
    return { colorTex, bumpTex };
  });

  return new THREE.MeshStandardMaterial({
    name: `simpleHouse.ff.mat.${key}`,
    map: maps.colorTex,
    bumpMap: maps.bumpTex,
    bumpScale: 0.004,
    roughness,
    metalness: 0.0,
  });
}

export function createTurnedWalnutMaterial(name: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name,
    color: 0x4b3120,
    roughness: 0.44,
    metalness: 0.03,
  });
}

function createCharacterOakTopMaterial(name: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xa47c52,
    roughness: 0.48,
    metalness: 0.02,
  });
}

/**
 * Tailored 2-seater English country library loveseat (`1.64 m W x 0.86 m D x 0.82 m H`):
 * warm olive-oatmeal herringbone wool-linen upholstery, twin piped feather seat & back cushions,
 * rolled scroll arms, turned walnut legs on aged-brass castors, scatter cushions & cashmere throw.
 */
export function buildEnglishLibraryLoveseat(
  ctx: SceneBuilderContext,
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
    readonly brassMat: THREE.Material;
  }
): THREE.Group {
  const { name, position, rotationY, brassMat } = options;
  const root = new THREE.Group();
  root.name = name;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const w = 1.64;
  const d = 0.86;
  const legH = 0.145;
  const mainTweedMat = createWovenHerringboneFabricMaterial('studyOliveOatHerringbone', '#A59E88', '#7D7963', 0.88);
  const pipingMat = createWovenHerringboneFabricMaterial('studyMadderPiping', '#8D7E68', '#6B5E4C', 0.86);
  const madderCushionMat = createWovenHerringboneFabricMaterial('studyTerracottaScatter', '#A85D44', '#7E412E', 0.89);
  const indigoCushionMat = createWovenHerringboneFabricMaterial('studyIndigoScatter', '#425264', '#2F3B49', 0.89);
  const cashmereThrowMat = createWovenHerringboneFabricMaterial('studyOatCashmereThrow', '#DFD5C3', '#C7BCA8', 0.92);
  const walnutMat = createTurnedWalnutMaterial(`${name}.turnedWalnut`);

  // 4 turned walnut legs with aged-brass cup castors
  for (const [tag, sx, sz] of [
    ['FL', -1, 1],
    ['FR', 1, 1],
    ['BL', -1, -1],
    ['BR', 1, -1],
  ] as const) {
    const lx = sx * (w * 0.5 - 0.095);
    const lz = sz * (d * 0.5 - 0.095);
    const castorWheel = new THREE.Mesh(sharedSphereGeometry(0.015, 12, 10), brassMat);
    castorWheel.name = `${name}.castor_${tag}`;
    castorWheel.position.set(lx, 0.015, lz);
    tagHighLodDetail(castorWheel);
    root.add(castorWheel);

    const brassCup = new THREE.Mesh(sharedCylinderGeometry(0.021, 0.016, 0.028, 14), brassMat);
    brassCup.name = `${name}.brassCup_${tag}`;
    brassCup.position.set(lx, 0.036, lz);
    tagHighLodDetail(brassCup);
    root.add(brassCup);

    const leg = new THREE.Mesh(sharedCylinderGeometry(0.03, 0.019, legH - 0.044, 16), walnutMat);
    leg.name = `${name}.walnutLeg_${tag}`;
    leg.position.set(lx, 0.048 + (legH - 0.044) * 0.5, lz);
    leg.castShadow = true;
    root.add(leg);
  }

  const armW = 0.145;
  const betweenArmsW = w - armW * 2 - 0.032;

  // Sprung upholstered deck (`y = 0.148 .. 0.304`, strictly between arms & in front of back frame)
  const deck = new THREE.Mesh(
    createSculptedCushionGeometry(betweenArmsW, 0.156, d - 0.22, 8, 4, 6, 0.34, 'standard'),
    mainTweedMat
  );
  deck.name = `${name}.sprungDeck`;
  deck.position.set(0, legH + 0.08, 0.085);
  deck.castShadow = true;
  deck.receiveShadow = true;
  root.add(deck);

  // Upholstered English library back (`y = 0.145 .. 0.78`, strictly between arms)
  const backFrame = new THREE.Mesh(
    createSculptedCushionGeometry(betweenArmsW, 0.635, 0.15, 8, 6, 4, 0.38, 'standard'),
    mainTweedMat
  );
  backFrame.name = `${name}.upholsteredBack`;
  backFrame.position.set(0, legH + 0.3175, -d * 0.5 + 0.085);
  backFrame.castShadow = true;
  backFrame.receiveShadow = true;
  root.add(backFrame);

  // Tailored English scroll arms (`W = 0.145 m` each side)
  for (const [aTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const ax = sx * (w * 0.5 - armW * 0.5 - 0.01);
    const armBody = new THREE.Mesh(
      createSculptedCushionGeometry(armW - 0.01, 0.41, d - 0.06, 5, 5, 7, 0.4, 'standard'),
      mainTweedMat
    );
    armBody.name = `${name}.armBody${aTag}`;
    armBody.position.set(ax, legH + 0.205, 0.01);
    armBody.castShadow = true;
    armBody.receiveShadow = true;
    root.add(armBody);

    const scrollRoll = new THREE.Mesh(sharedCylinderGeometry(0.082, 0.082, d - 0.05, 18), mainTweedMat);
    scrollRoll.name = `${name}.scrollArmRoll${aTag}`;
    scrollRoll.rotation.x = Math.PI * 0.5;
    scrollRoll.position.set(ax + sx * 0.014, legH + 0.415, 0.012);
    scrollRoll.castShadow = true;
    root.add(scrollRoll);

    const scrollFacing = new THREE.Mesh(sharedCylinderGeometry(0.078, 0.078, 0.016, 18), pipingMat);
    scrollFacing.name = `${name}.scrollFacing${aTag}`;
    scrollFacing.rotation.x = Math.PI * 0.5;
    scrollFacing.position.set(ax + sx * 0.014, legH + 0.415, (d - 0.05) * 0.5 + 0.014);
    tagHighLodDetail(scrollFacing);
    root.add(scrollFacing);
  }

  // Twin deep feather-wrapped seat cushions (`y = 0.305 .. 0.455`) & back cushions (`y = 0.44 .. 0.82`)
  const innerW = w - armW * 2 - 0.03;
  const cushW = innerW * 0.5 - 0.008;
  for (const [cIdx, sx] of [
    [1, -1],
    [2, 1],
  ] as const) {
    const cx = sx * (cushW * 0.5 + 0.004);
    const seatCush = new THREE.Mesh(
      createSculptedCushionGeometry(cushW, 0.148, d - 0.2, 8, 5, 8, 0.54, 'standard'),
      mainTweedMat
    );
    seatCush.name = `${name}.seatCushion_${cIdx}`;
    seatCush.position.set(cx, legH + 0.16 + 0.072, 0.065);
    seatCush.castShadow = true;
    seatCush.receiveShadow = true;
    root.add(seatCush);

    const backCush = new THREE.Mesh(
      createSculptedCushionGeometry(cushW - 0.01, 0.39, 0.165, 8, 6, 5, 0.58, 'standard'),
      mainTweedMat
    );
    backCush.name = `${name}.backCushion_${cIdx}`;
    backCush.rotation.x = -0.14;
    backCush.position.set(cx, legH + 0.48, -d * 0.5 + 0.22);
    backCush.castShadow = true;
    backCush.receiveShadow = true;
    root.add(backCush);
  }

  // Madder terracotta & indigo wool scatter cushions echoing the Ziegler Oushak rug
  const scatterLeft = new THREE.Mesh(
    createSculptedCushionGeometry(0.4, 0.38, 0.125, 7, 6, 4, 0.66, 'standard', true),
    madderCushionMat
  );
  scatterLeft.name = `${name}.scatterMadder`;
  scatterLeft.position.set(-(innerW * 0.5 - 0.19), legH + 0.45, -0.04);
  scatterLeft.rotation.set(-0.16, 0.28, -0.09);
  scatterLeft.castShadow = true;
  root.add(scatterLeft);

  const scatterRight = new THREE.Mesh(
    createSculptedCushionGeometry(0.38, 0.36, 0.12, 7, 6, 4, 0.66, 'standard', true),
    indigoCushionMat
  );
  scatterRight.name = `${name}.scatterIndigo`;
  scatterRight.position.set(innerW * 0.5 - 0.2, legH + 0.44, -0.05);
  scatterRight.rotation.set(-0.15, -0.26, 0.08);
  scatterRight.castShadow = true;
  root.add(scatterRight);

  // Folded oatmeal cashmere throw draped over the right scroll arm
  const throwDraped = new THREE.Mesh(
    createSculptedCushionGeometry(0.24, 0.036, 0.54, 6, 3, 7, 0.48, 'standard'),
    cashmereThrowMat
  );
  throwDraped.name = `${name}.cashmereThrow`;
  throwDraped.position.set(w * 0.5 - armW * 0.5 + 0.008, legH + 0.495, 0.06);
  throwDraped.rotation.z = -0.08;
  throwDraped.castShadow = true;
  root.add(throwDraped);

  if (ctx.interactions) {
    ctx.interactions.registerAnimatedInteractable(
      new SeatInteractable({
        id: `${name}.seat`,
        label: 'Sit on Library Loveseat',
        aliases: [name],
        anchor: root,
        clickableTargets: collectSeatClickableMeshes(root),
        localSeatPos: [0, 0.455, 0.06],
        localFootOffset: [0, 0, 0.72],
        localForward: [0, 0, 1],
        material: 'linen',
      })
    );
  }

  return attachAssetMetadata(root, {
    name: 'George Sherlock Tailored Herringbone 2-Seater Library Loveseat',
    brand: 'George Sherlock',
    collection: 'English Country Library',
    sku: 'GS-LIB-2S-1640',
    finish: 'Olive-Oatmeal Wool Herringbone & Turned Walnut on Aged Brass Castors',
    category: 'furniture',
    dimensionsMm: [1640, 860, 820],
  });
}

/**
 * Turned burr-walnut & aged-brass circular library lamp table (`Ø460 x 580 mm`)
 * with leather-bound book stack & warm shaded brass reading lamp.
 */
export function buildWalnutLibrarySideTableAndLamp(
  ctx: SceneBuilderContext,
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly brassMat: THREE.Material;
    readonly circuitId: CircuitId;
  }
): THREE.Group {
  const { name, position, brassMat, circuitId } = options;
  const root = new THREE.Group();
  root.name = name;
  root.position.set(position[0], position[1], position[2]);

  const walnutMat = createTurnedWalnutMaterial(`${name}.burrWalnut`);
  const bookCrimsonMat = new THREE.MeshStandardMaterial({ name: `${name}.bookCrimson`, color: 0x6e2b23, roughness: 0.72 });
  const bookOliveMat = new THREE.MeshStandardMaterial({ name: `${name}.bookOlive`, color: 0x4b5642, roughness: 0.74 });
  const pageMat = new THREE.MeshStandardMaterial({ name: `${name}.bookPages`, color: 0xede4d0, roughness: 0.85 });

  // Tripod splayed base plinth + turned baluster pedestal + gallery-rimmed circular top (`y = 0.58 m`)
  const plinth = new THREE.Mesh(sharedCylinderGeometry(0.165, 0.185, 0.032, 24), walnutMat);
  plinth.name = `${name}.plinth`;
  plinth.position.set(0, 0.016, 0);
  plinth.castShadow = true;
  root.add(plinth);

  const column = new THREE.Mesh(sharedCylinderGeometry(0.034, 0.048, 0.51, 20), walnutMat);
  column.name = `${name}.turnedColumn`;
  column.position.set(0, 0.032 + 0.255, 0);
  column.castShadow = true;
  root.add(column);

  const brassCollar = new THREE.Mesh(sharedCylinderGeometry(0.044, 0.044, 0.022, 18), brassMat);
  brassCollar.name = `${name}.brassCollar`;
  brassCollar.position.set(0, 0.31, 0);
  tagHighLodDetail(brassCollar);
  root.add(brassCollar);

  const topDisc = new THREE.Mesh(sharedCylinderGeometry(0.23, 0.23, 0.024, 28), walnutMat);
  topDisc.name = `${name}.walnutTop`;
  topDisc.position.set(0, 0.568, 0);
  topDisc.castShadow = true;
  topDisc.receiveShadow = true;
  root.add(topDisc);

  // Pair of stacked octavo cloth-bound books (offset cleanly from lamp base)
  addBox(root, `${name}.bookLower`, [0.135, 0.024, 0.175], [-0.088, 0.593, 0.055], bookOliveMat);
  addBox(root, `${name}.bookLowerPages`, [0.125, 0.02, 0.165], [-0.084, 0.593, 0.055], pageMat);
  const upperBook = addBox(root, `${name}.bookUpper`, [0.12, 0.022, 0.158], [-0.086, 0.617, 0.052], bookCrimsonMat);
  upperBook.rotation.y = 0.16;

  // Compact aged-brass & pleated parchment library reading lamp (`H = 385 mm`)
  const lamp = buildCompactPleatedBedsideLamp(ctx, {
    name: `${name}.brassLibraryLamp`,
    position: [0.082, 0.581, -0.055],
    brassMat,
    circuitId,
    alabasterBase: false,
  });
  root.add(lamp);

  return attachAssetMetadata(root, {
    name: 'Regency Turned Burr-Walnut & Brass Circular Library Table',
    brand: 'Vaughan Designs',
    collection: 'Georgian Library',
    sku: 'VAU-WAL-TBL-460',
    finish: 'Hand-Waxed Burr Walnut & Aged Brass',
    category: 'furniture',
    dimensionsMm: [460, 460, 580],
  });
}

/**
 * Tailored deep-buttoned Belgian linen & turned solid-oak end-of-bed ottoman bench
 * (`1.36 m W x 0.46 m D x 0.45 m H`) with lower slatted oak linen shelf & folded cashmere throw.
 */
export function buildPrincipalEndOfBedBench(
  ctx: SceneBuilderContext,
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
    readonly oakMat: THREE.Material;
    readonly brassMat: THREE.Material;
  }
): THREE.Group {
  const { name, position, rotationY, oakMat, brassMat } = options;
  const root = new THREE.Group();
  root.name = name;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const w = 1.36;
  const d = 0.46;
  const railTopY = 0.325;
  const linenMat = createWovenHerringboneFabricMaterial('principalBenchOatmealLinen', '#DFD7C8', '#CCC2B0', 0.87);
  const buttonMat = createWovenHerringboneFabricMaterial('principalBenchButtons', '#C4B9A5', '#AF9F88', 0.85);
  const throwMat = createWovenHerringboneFabricMaterial('principalBenchThrow', '#CFC5B3', '#B8AC97', 0.91);

  // 4 turned oak legs (`y = 0 .. 0.325`) + brass ferrules
  const legInsetX = w * 0.5 - 0.055;
  const legInsetZ = d * 0.5 - 0.055;
  for (const [lTag, sx, sz] of [
    ['FL', -1, 1],
    ['FR', 1, 1],
    ['BL', -1, -1],
    ['BR', 1, -1],
  ] as const) {
    const lx = sx * legInsetX;
    const lz = sz * legInsetZ;
    const ferrule = new THREE.Mesh(sharedCylinderGeometry(0.017, 0.015, 0.026, 14), brassMat);
    ferrule.name = `${name}.ferrule_${lTag}`;
    ferrule.position.set(lx, 0.013, lz);
    tagHighLodDetail(ferrule);
    root.add(ferrule);

    const leg = new THREE.Mesh(sharedCylinderGeometry(0.026, 0.018, railTopY - 0.026, 16), oakMat);
    leg.name = `${name}.oakLeg_${lTag}`;
    leg.position.set(lx, 0.026 + (railTopY - 0.026) * 0.5, lz);
    leg.castShadow = true;
    root.add(leg);
  }

  // Moulded solid-oak apron rails (`y = 0.265 .. 0.325`)
  addBox(root, `${name}.apronFront`, [w - 0.15, 0.056, 0.024], [0, 0.295, legInsetZ], oakMat);
  addBox(root, `${name}.apronBack`, [w - 0.15, 0.056, 0.024], [0, 0.295, -legInsetZ], oakMat);
  addBox(root, `${name}.apronLeft`, [0.024, 0.056, d - 0.164], [-legInsetX, 0.295, 0], oakMat);
  addBox(root, `${name}.apronRight`, [0.024, 0.056, d - 0.164], [legInsetX, 0.295, 0], oakMat);

  // Lower slatted oak linen shelf (`y = 0.125`)
  addBox(root, `${name}.shelfRailFront`, [w - 0.15, 0.022, 0.026], [0, 0.125, legInsetZ], oakMat);
  addBox(root, `${name}.shelfRailBack`, [w - 0.15, 0.022, 0.026], [0, 0.125, -legInsetZ], oakMat);
  const slatCount = 13;
  const slatSpan = w - 0.18;
  for (let i = 0; i < slatCount; i++) {
    const sx = -slatSpan * 0.5 + (i / (slatCount - 1)) * slatSpan;
    addBox(root, `${name}.shelfSlat_${i + 1}`, [0.052, 0.012, d - 0.168], [sx, 0.133, 0], oakMat);
  }

  // Deep-buttoned warm oatmeal Belgian linen top cushion (`y = 0.325 .. 0.452`)
  const topCushion = new THREE.Mesh(
    createSculptedCushionGeometry(w, 0.126, d, 12, 5, 8, 0.48, 'standard'),
    linenMat
  );
  topCushion.name = `${name}.buttonedLinenCushion`;
  topCushion.position.set(0, 0.388, 0);
  topCushion.castShadow = true;
  topCushion.receiveShadow = true;
  root.add(topCushion);

  // 2 x 5 deep upholstery tuft buttons recessed gently on top surface
  for (const rz of [-0.105, 0.105] as const) {
    for (let c = -2; c <= 2; c++) {
      const btn = new THREE.Mesh(sharedSphereGeometry(0.011, 10, 8), buttonMat);
      btn.name = `${name}.tuftButton_${c + 3}_${rz < 0 ? 'a' : 'b'}`;
      btn.scale.set(1, 0.45, 1);
      btn.position.set(c * 0.23, 0.449, rz);
      tagHighLodDetail(btn);
      root.add(btn);
    }
  }

  // Neatly folded cashmere throw across one end of the bench + stacked linen cushions on shelf
  const foldedThrow = new THREE.Mesh(
    createSculptedCushionGeometry(0.34, 0.032, d + 0.03, 6, 3, 8, 0.46, 'standard'),
    throwMat
  );
  foldedThrow.name = `${name}.foldedCashmereThrow`;
  foldedThrow.position.set(0.36, 0.458, 0);
  foldedThrow.castShadow = true;
  root.add(foldedThrow);

  const foldedLinenStack = new THREE.Mesh(
    createSculptedCushionGeometry(0.36, 0.075, 0.28, 6, 3, 6, 0.44, 'standard'),
    linenMat
  );
  foldedLinenStack.name = `${name}.shelfLinenStack`;
  foldedLinenStack.position.set(-0.32, 0.176, 0);
  foldedLinenStack.castShadow = true;
  root.add(foldedLinenStack);

  if (ctx.interactions) {
    ctx.interactions.registerAnimatedInteractable(
      new SeatInteractable({
        id: `${name}.seat`,
        label: 'Sit on End-of-Bed Ottoman Bench',
        aliases: [name],
        anchor: root,
        clickableTargets: collectSeatClickableMeshes(root),
        localSeatPos: [0, 0.452, 0],
        localFootOffset: [0, 0, 0.56],
        localForward: [0, 0, 1],
        material: 'linen',
      })
    );
  }

  return attachAssetMetadata(root, {
    name: 'Neptune Larsson Deep-Buttoned Belgian Linen & Turned Oak End-of-Bed Bench',
    brand: 'Neptune',
    collection: 'Larsson',
    sku: 'NEP-LAR-BCH-1360',
    finish: 'Oatmeal Belgian Linen & Natural European Oak',
    category: 'furniture',
    dimensionsMm: [1360, 460, 452],
  });
}

/**
 * Wider 2-drawer Georgian / Neptune *Chichester* bedside chest (`650 W x 440 D x 670 H mm`)
 * with cock-beaded in-frame Shaker drawers, aged-brass mushroom knobs, interactive sliding
 * top & bottom drawers, moulded plinth/legs & solid Character Oak top (`y = 0 .. 0.670 m`).
 */
export function buildWideChichesterBedsideChest(
  ctx: SceneBuilderContext,
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
    readonly paintMat: THREE.Material;
    readonly brassMat: THREE.Material;
  }
): THREE.Group {
  const { name, position, rotationY, paintMat, brassMat } = options;
  const root = new THREE.Group();
  root.name = name;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const w = 0.64;
  const d = 0.44;
  const h = 0.67;
  const topT = 0.028;
  const legS = 0.044;
  const oakTopMat = createCharacterOakTopMaterial(`${name}.characterOakTopMat`);

  // 4 tapered Shaker corner stiles/legs (`y = 0 .. h - topT`)
  for (const [lTag, sx, sz] of [
    ['FL', -1, 1],
    ['FR', 1, 1],
    ['BL', -1, -1],
    ['BR', 1, -1],
  ] as const) {
    addBox(
      root,
      `${name}.cornerPost_${lTag}`,
      [legS, h - topT, legS],
      [sx * (w * 0.5 - legS * 0.5 - 0.012), (h - topT) * 0.5, sz * (d * 0.5 - legS * 0.5 - 0.012)],
      paintMat
    );
  }

  // Side & rear panelled carcass (`y = 0.135 .. h - topT`)
  const carcassBotY = 0.135;
  const carcassH = h - topT - carcassBotY;
  const carcassCy = carcassBotY + carcassH * 0.5;
  const spanW = w - legS * 2 - 0.024;
  const spanD = d - legS * 2 - 0.024;

  addBox(root, `${name}.panelLeft`, [0.02, carcassH, spanD], [-(w * 0.5 - legS * 0.5 - 0.012), carcassCy, 0], paintMat);
  addBox(root, `${name}.panelRight`, [0.02, carcassH, spanD], [w * 0.5 - legS * 0.5 - 0.012, carcassCy, 0], paintMat);
  addBox(root, `${name}.panelBack`, [spanW, carcassH, 0.018], [0, carcassCy, -(d * 0.5 - legS * 0.5 - 0.012)], paintMat);

  // Horizontal front rails framing 2 graduated drawers
  const frontZ = d * 0.5 - 0.022;
  addBox(root, `${name}.railBottom`, [spanW, 0.026, 0.024], [0, carcassBotY + 0.013, frontZ], paintMat);
  addBox(root, `${name}.railMid`, [spanW, 0.024, 0.024], [0, 0.405, frontZ], paintMat);
  addBox(root, `${name}.railTop`, [spanW, 0.024, 0.024], [0, h - topT - 0.012, frontZ], paintMat);

  // Lower open book/slipper undertier shelf (`y = 0.088`)? Actually 2 generous graduated drawers (`lower: 0.161..0.393`, `upper: 0.417..0.618`)
  for (const [dIdx, y0, y1, label] of [
    [1, 0.42, 0.616, 'Open Top Bedside Drawer'],
    [2, 0.164, 0.39, 'Open Lower Bedside Drawer'],
  ] as const) {
    const dh = y1 - y0;
    const dcy = (y0 + y1) * 0.5;
    const dw = spanW - 0.008;
    const drGroup = new THREE.Group();
    drGroup.name = `${name}.drawer_${dIdx}`;
    drGroup.position.set(0, dcy, frontZ + 0.002);
    root.add(drGroup);

    // Shaker recessed panel front + cock-beading + twin aged-brass mushroom knobs
    addBox(drGroup, `${drGroup.name}.panel`, [dw - 0.056, dh - 0.052, 0.014], [0, 0, -0.002], paintMat);
    addBox(drGroup, `${drGroup.name}.stileL`, [0.032, dh, 0.02], [-(dw * 0.5 - 0.016), 0, 0], paintMat);
    addBox(drGroup, `${drGroup.name}.stileR`, [0.032, dh, 0.02], [dw * 0.5 - 0.016, 0, 0], paintMat);
    addBox(drGroup, `${drGroup.name}.railT`, [dw - 0.064, 0.03, 0.02], [0, dh * 0.5 - 0.015, 0], paintMat);
    addBox(drGroup, `${drGroup.name}.railB`, [dw - 0.064, 0.03, 0.02], [0, -(dh * 0.5 - 0.015), 0], paintMat);

    for (const [kTag, kx] of [
      ['L', -0.145],
      ['R', 0.145],
    ] as const) {
      const stem = new THREE.Mesh(sharedCylinderGeometry(0.005, 0.007, 0.016, 12), brassMat);
      stem.name = `${drGroup.name}.knobStem_${kTag}`;
      stem.rotation.x = Math.PI * 0.5;
      stem.position.set(kx, 0, 0.016);
      drGroup.add(stem);

      const cap = new THREE.Mesh(sharedSphereGeometry(0.014, 14, 10), brassMat);
      cap.name = `${drGroup.name}.knobCap_${kTag}`;
      cap.scale.set(1, 1, 0.65);
      cap.position.set(kx, 0, 0.026);
      drGroup.add(cap);
    }

    attachDrawerBoxBehindFront(drGroup, dw - 0.02, dh - 0.02, d - 0.09, '+z', false);
    if (ctx.interactions) {
      drGroup.userData.interactableLabel = label;
      registerSlidingDrawer(ctx.interactions, {
        drawer: drGroup,
        slideDelta: [0, 0, 0.25],
      });
    }
  }

  // Moulded solid Character Oak overhanging top (`650 x 440 x 28 mm`)
  addBox(root, `${name}.characterOakTop`, [w, topT, d], [0, h - topT * 0.5, 0], oakTopMat);

  return attachAssetMetadata(root, {
    name: 'Neptune Chichester Wide 2-Drawer Painted & Character Oak Bedside Chest',
    brand: 'Neptune',
    collection: 'Chichester',
    sku: 'NEP-CHI-BDS-650',
    finish: 'Pointing Estate Eggshell & Natural Character Oak with Aged Brass Knobs',
    category: 'furniture',
    dimensionsMm: [650, 440, 670],
  });
}

/**
 * Delicate, well-proportioned turned veined-alabaster (or aged-brass) bedside/library table lamp
 * (`H = 385 mm`, compact `Ø242 mm` warm pleated empire linen shade) wired to an electrical circuit.
 */
export function buildCompactPleatedBedsideLamp(
  ctx: SceneBuilderContext,
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly brassMat: THREE.Material;
    readonly circuitId: CircuitId;
    readonly alabasterBase?: boolean;
  }
): THREE.Group {
  const { name, position, brassMat, circuitId, alabasterBase = true } = options;
  const root = new THREE.Group();
  root.name = name;
  root.position.set(position[0], position[1], position[2]);

  const alabasterMat = new THREE.MeshPhysicalMaterial({
    name: `${name}.veinedAlabaster`,
    color: 0xf4eee2,
    roughness: 0.24,
    clearcoat: 0.42,
    clearcoatRoughness: 0.2,
  });
  const shadeMat = new THREE.MeshStandardMaterial({
    name: `${name}.pleatedEmpireShade`,
    color: 0xf4ede0,
    emissive: new THREE.Color(0xffc987),
    emissiveIntensity: 0.28,
    roughness: 0.86,
    side: THREE.DoubleSide,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    name: `${name}.filamentBulb`,
    color: 0xfff3d6,
    emissive: new THREE.Color(0xffbe6b),
    emissiveIntensity: 0.95,
    roughness: 0.25,
  });

  registerCircuitEmissive(ctx, circuitId, bulbMat);
  registerCircuitEmissive(ctx, circuitId, shadeMat);

  // Stepped brass plinth (`y = 0 .. 0.022`) + delicate turned baluster (`y = 0.022 .. 0.228`)
  const plinth = new THREE.Mesh(sharedCylinderGeometry(0.056, 0.062, 0.022, 22), brassMat);
  plinth.name = `${name}.brassPlinth`;
  plinth.position.set(0, 0.011, 0);
  plinth.castShadow = true;
  root.add(plinth);

  const bodyMat = alabasterBase ? alabasterMat : brassMat;
  const lowerUrn = new THREE.Mesh(sharedCylinderGeometry(0.036, 0.044, 0.145, 22), bodyMat);
  lowerUrn.name = `${name}.turnedColumn`;
  lowerUrn.position.set(0, 0.022 + 0.0725, 0);
  lowerUrn.castShadow = true;
  root.add(lowerUrn);

  const upperNeck = new THREE.Mesh(sharedCylinderGeometry(0.018, 0.034, 0.058, 20), bodyMat);
  upperNeck.name = `${name}.turnedNeck`;
  upperNeck.position.set(0, 0.167 + 0.029, 0);
  upperNeck.castShadow = true;
  root.add(upperNeck);

  const capital = new THREE.Mesh(sharedCylinderGeometry(0.016, 0.024, 0.024, 18), brassMat);
  capital.name = `${name}.brassSocket`;
  capital.position.set(0, 0.237, 0);
  root.add(capital);

  const bulb = new THREE.Mesh(sharedSphereGeometry(0.02, 12, 10), bulbMat);
  bulb.name = `${name}.bulb`;
  bulb.position.set(0, 0.282, 0);
  root.add(bulb);

  // Compact `Ø242 mm` base -> `Ø144 mm` top x `152 mm` high empire linen shade (`y = 0.233 .. 0.385 m`)
  const shadeGeo = prepGeo(new THREE.CylinderGeometry(0.072, 0.121, 0.152, 28, 1, true));
  const shade = new THREE.Mesh(shadeGeo, shadeMat);
  shade.name = `${name}.empireLinenShade`;
  shade.position.set(0, 0.309, 0);
  shade.castShadow = true;
  root.add(shade);

  return attachAssetMetadata(root, {
    name: alabasterBase
      ? 'Pooky Delicate Turned Alabaster Bedside Lamp & Empire Linen Shade'
      : 'Vaughan Turned Aged-Brass Library Lamp & Parchment Shade',
    brand: alabasterBase ? 'Pooky Lighting' : 'Vaughan Designs',
    collection: 'Petite Bedside & Library',
    sku: alabasterBase ? 'PKY-ALA-385' : 'VAU-LIB-385',
    finish: alabasterBase ? 'Veined Spanish Alabaster, Aged Brass & Oatmeal Linen' : 'Aged Brass & Warm Parchment',
    category: 'lighting',
    dimensionsMm: [242, 242, 385],
  });
}

