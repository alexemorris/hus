import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import {
  applyMetricBoxUVs,
  getOrCreateCachedTexture,
} from 'husjs/materials';
import {
  addInteractiveShakerWardrobeDoor,
  attachAssetMetadata,
  attachDrawerBoxBehindFront,
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildHollowWardrobeInterior,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  createDadoRun,
  prepGeo,
  registerSlidingDrawer,
  sharedCylinderGeometry,
  sharedSphereGeometry,
  tagCutaway,
  tagHighLodDetail,
} from 'husjs/objects';
import {
  buildTongueAndGrooveDadoPanelling,
  getPaleEuropeanOakJoineryMaterial,
} from 'husjs/catalog/architectural';
import {
  SeatInteractable,
  buildCoxDanicaBed,
  buildCoxNivalaDesk,
  buildCuratedMirrorsArtAndRugs,
  buildGeorgianAntiqueCasework,
  buildNeptuneOakTablesAndBedsides,
  buildWhiteCompanyAccessories,
  buildWhiteCompanyBedStyling,
  collectSeatClickableMeshes,
  createSculptedCushionGeometry,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import {
  buildArmstrongConcealedShowerSet,
  buildArmstrongFreestandingBathMixer,
  buildArmstrongPaperHolder,
  buildArmstrongRobeHook,
  buildBcDesignsCopperBoatBath,
  buildCrittallWalkInShowerAndTowelRail,
  buildLefroyBrooksCharterhouseWc,
  buildLefroyBrooksLissaDoonWashstand,
  buildNeptuneChichesterVanity,
  buildPerrinRoweTowelRing,
  getBathroomBrassMaterials,
  getHonedCarraraMarbleMaterial,
} from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import { IN_X, IN_Z, type SimpleHouseShell } from './architecture.ts';
import { FFL_FIRST, FIRST_CEILING_SOFFIT_Y } from './electrical-and-rooms.ts';


function deconflictRomanBlind(blind: THREE.Group, facingZ: 1 | -1): THREE.Group {
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

function deconflictCurtainBrackets(curtains: THREE.Group, inwardSignX: 1 | -1): THREE.Group {
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

const NEPTUNE_SALT = 0xe8e3d7;
const FB_MIZZLE = 0xc0c6b8;

function addBox(
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

function stripBuiltInDanicaBedding(bedGroup: THREE.Group): void {
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

function createTurnedWalnutMaterial(name: string): THREE.MeshStandardMaterial {
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
function buildEnglishLibraryLoveseat(
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
function buildWalnutLibrarySideTableAndLamp(
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
function buildPrincipalEndOfBedBench(
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
function buildWideChichesterBedsideChest(
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

  const w = 0.65;
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
function buildCompactPleatedBedsideLamp(
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

  const circuitMap = (
    ctx as unknown as {
      readonly circuitGroups?: ReadonlyMap<
        string,
        { readonly emissives: THREE.Material[] }
      >;
    }
  ).circuitGroups;
  const cg = circuitMap?.get(circuitId);
  if (cg) {
    cg.emissives.push(bulbMat, shadeMat);
  }

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

function getSepiaFamilyPhotoTexture(variantIdx: number): THREE.DataTexture {
  return getOrCreateCachedTexture(`simpleHouse.landing.familyPhoto.${variantIdx}`, () => {
    const w = 96;
    const h = 120;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const ny = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const nx = x / (w - 1);
        // Wide cream conservation mount (`22%` margin) + warm charcoal inner wash line
        const inAperture = nx > 0.22 && nx < 0.78 && ny > 0.2 && ny < 0.8;
        const onBevelLine =
          !inAperture &&
          nx > 0.2 &&
          nx < 0.8 &&
          ny > 0.18 &&
          ny < 0.82 &&
          (Math.abs(nx - 0.21) < 0.012 ||
            Math.abs(nx - 0.79) < 0.012 ||
            Math.abs(ny - 0.19) < 0.01 ||
            Math.abs(ny - 0.81) < 0.01);

        let r = 243;
        let g = 238;
        let b = 226;

        if (onBevelLine) {
          r = 188;
          g = 178;
          b = 160;
        } else if (inAperture) {
          const u = (nx - 0.22) / 0.56;
          const v = (ny - 0.2) / 0.6;
          const vignette = 1 - 0.28 * Math.hypot(u - 0.5, v - 0.5);
          if (variantIdx % 2 === 0) {
            // Warm sepia portrait silhouette against soft studio backdrop
            const headDist = Math.hypot((u - 0.5) * 1.15, (v - 0.62) * 1.35);
            const shoulderDist = Math.hypot((u - 0.5) * 0.82, (v - 0.24) * 1.05);
            const isSubject = headDist < 0.16 || (v < 0.45 && shoulderDist < 0.31);
            const tone = isSubject ? 0.36 + 0.12 * u : 0.78 - 0.14 * v;
            r = Math.round(232 * tone * vignette);
            g = Math.round(212 * tone * vignette);
            b = Math.round(184 * tone * vignette);
          } else {
            // Warm sepia coastal/countryside horizon vignette
            const horizon = 0.46 + 0.04 * Math.sin(u * Math.PI * 2 + variantIdx);
            const isLand = v < horizon;
            const tone = isLand
              ? 0.42 + 0.16 * (v / horizon)
              : 0.84 - 0.12 * ((v - horizon) / (1 - horizon));
            r = Math.round(234 * tone * vignette);
            g = Math.round(216 * tone * vignette);
            b = Math.round(190 * tone * vignette);
          }
        }

        const p = (y * w + x) * 4;
        data[p] = Math.max(0, Math.min(255, r));
        data[p + 1] = Math.max(0, Math.min(255, g));
        data[p + 2] = Math.max(0, Math.min(255, b));
        data[p + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}

function getAntiquarianMapTexture(plateIdx: number): THREE.DataTexture {
  return getOrCreateCachedTexture(`simpleHouse.study.antiquarianMap.${plateIdx}`, () => {
    const w = 128;
    const h = 104;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const ny = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const nx = x / (w - 1);
        const inMap = nx > 0.15 && nx < 0.85 && ny > 0.16 && ny < 0.84;
        const onRule =
          nx > 0.13 &&
          nx < 0.87 &&
          ny > 0.14 &&
          ny < 0.86 &&
          !inMap;
        let r = 240;
        let g = 234;
        let b = 219;
        if (onRule) {
          r = 128;
          g = 114;
          b = 94;
        } else if (inMap) {
          const u = (nx - 0.15) / 0.7;
          const v = (ny - 0.16) / 0.68;
          const coast = 0.52 + 0.14 * Math.sin(v * 5.2 + plateIdx * 1.7) + 0.07 * Math.cos(u * 6.4);
          const isShire = u < coast;
          const grid =
            Math.abs(((u * 6) % 1) - 0.5) > 0.47 || Math.abs(((v * 5) % 1) - 0.5) > 0.47;
          if (grid) {
            r = 148;
            g = 136;
            b = 116;
          } else if (isShire) {
            const parishTint = ((Math.floor(u * 4 + v * 3) + plateIdx) % 3);
            r = parishTint === 0 ? 222 : parishTint === 1 ? 210 : 226;
            g = parishTint === 0 ? 206 : parishTint === 1 ? 212 : 216;
            b = parishTint === 0 ? 178 : parishTint === 1 ? 184 : 192;
          } else {
            r = 214;
            g = 219;
            b = 214;
          }
        }
        const p = (y * w + x) * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}

/**
 * Curated organic/symmetrical 6-frame family photograph gallery cluster (`180x230 mm` to `240x300 mm`
 * dark walnut & brushed aged-brass frames with wide cream conservation mounts & warm sepia vignettes).
 * Local origin `(0, 0, 0)` is the cluster center (`z = 0` flush with wall, projecting into `+Z`).
 */
function buildFamilyPhotoGalleryCluster(
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

  const walnutFrameMat = createTurnedWalnutMaterial(`${name}.darkWalnutFrame`);
  const glassMat = new THREE.MeshPhysicalMaterial({
    name: `${name}.conservationGlass`,
    color: 0xf7faf8,
    transparent: true,
    opacity: 0.18,
    roughness: 0.08,
    ior: 1.5,
  });

  // Harmonious salon-hung 2-row x 3-column cluster of mixed portrait & landscape frames (`total span ~0.88 m W x 0.64 m H`)
  const frames: readonly {
    readonly dx: number;
    readonly dy: number;
    readonly w: number;
    readonly h: number;
    readonly useBrass: boolean;
  }[] = [
    { dx: -0.305, dy: 0.165, w: 0.21, h: 0.265, useBrass: false },
    { dx: 0.0, dy: 0.175, w: 0.24, h: 0.3, useBrass: true },
    { dx: 0.305, dy: 0.165, w: 0.21, h: 0.265, useBrass: false },
    { dx: -0.295, dy: -0.165, w: 0.22, h: 0.185, useBrass: true },
    { dx: 0.0, dy: -0.175, w: 0.195, h: 0.245, useBrass: false },
    { dx: 0.295, dy: -0.165, w: 0.22, h: 0.185, useBrass: true },
  ];

  frames.forEach((spec, idx) => {
    const fg = new THREE.Group();
    fg.name = `${name}.photoFrame_${idx + 1}`;
    fg.position.set(spec.dx, spec.dy, 0);
    root.add(fg);

    const frameMat = spec.useBrass ? brassMat : walnutFrameMat;
    const rim = spec.useBrass ? 0.011 : 0.016;
    const depth = 0.018;
    const innerW = spec.w - rim * 2;
    const innerH = spec.h - rim * 2;

    const photoMat = new THREE.MeshStandardMaterial({
      name: `${fg.name}.mountedSepiaPrint`,
      map: getSepiaFamilyPhotoTexture(idx),
      roughness: 0.8,
    });

    addBox(fg, `${fg.name}.backing`, [innerW, innerH, 0.006], [0, 0, 0.003], walnutFrameMat);
    addBox(fg, `${fg.name}.printSheet`, [innerW, innerH, 0.002], [0, 0, 0.008], photoMat);
    const glz = addBox(fg, `${fg.name}.glazing`, [innerW, innerH, 0.002], [0, 0, 0.012], glassMat);
    glz.castShadow = false;

    addBox(fg, `${fg.name}.railTop`, [spec.w, rim, depth], [0, spec.h * 0.5 - rim * 0.5, depth * 0.5], frameMat);
    addBox(fg, `${fg.name}.railBottom`, [spec.w, rim, depth], [0, -(spec.h * 0.5 - rim * 0.5), depth * 0.5], frameMat);
    addBox(fg, `${fg.name}.stileLeft`, [rim, innerH, depth], [-(spec.w * 0.5 - rim * 0.5), 0, depth * 0.5], frameMat);
    addBox(fg, `${fg.name}.stileRight`, [rim, innerH, depth], [spec.w * 0.5 - rim * 0.5, 0, depth * 0.5], frameMat);
  });

  return attachAssetMetadata(root, {
    name: 'Curated 6-Piece Dark Walnut & Aged Brass Family Portrait Gallery',
    brand: 'Bespoke Framing',
    collection: 'Conservation Mount Series',
    sku: 'FRM-GAL-6PC',
    finish: 'Dark Waxed Walnut, Brushed Aged Brass & Cream Conservation Mounts',
    category: 'decor',
    dimensionsMm: [880, 20, 650],
  });
}

/**
 * Framed pair of 18th-century English county & estate survey maps (`460 x 380 mm` each)
 * in dark walnut & gilt-slip Hogarth frames for the Study East wall.
 */
function buildAntiquarianMapDiptych(
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

  const walnutMat = createTurnedWalnutMaterial(`${name}.hogarthWalnut`);
  const w = 0.46;
  const h = 0.38;
  const rim = 0.022;
  const d = 0.022;

  for (const [idx, dx] of [
    [0, -0.275],
    [1, 0.275],
  ] as const) {
    const mg = new THREE.Group();
    mg.name = `${name}.mapFrame_${idx + 1}`;
    mg.position.set(dx, 0, 0);
    root.add(mg);

    const mapMat = new THREE.MeshStandardMaterial({
      name: `${mg.name}.countySurveyPlate`,
      map: getAntiquarianMapTexture(idx),
      roughness: 0.78,
    });
    const innerW = w - rim * 2;
    const innerH = h - rim * 2;
    addBox(mg, `${mg.name}.backing`, [innerW - 0.002, innerH - 0.002, 0.008], [0, 0, 0.004], walnutMat);
    addBox(mg, `${mg.name}.engraving`, [innerW - 0.002, innerH - 0.002, 0.003], [0, 0, 0.011], mapMat);
    void brassMat;
    addBox(mg, `${mg.name}.railTop`, [w, rim, d], [0, h * 0.5 - rim * 0.5, d * 0.5], walnutMat);
    addBox(mg, `${mg.name}.railBottom`, [w, rim, d], [0, -(h * 0.5 - rim * 0.5), d * 0.5], walnutMat);
    addBox(mg, `${mg.name}.stileLeft`, [rim, innerH, d], [-(w * 0.5 - rim * 0.5), 0, d * 0.5], walnutMat);
    addBox(mg, `${mg.name}.stileRight`, [rim, innerH, d], [w * 0.5 - rim * 0.5, 0, d * 0.5], walnutMat);
  }

  return attachAssetMetadata(root, {
    name: 'Pair of John Cary Antiquarian English County Survey Maps in Hogarth Frames',
    brand: 'Grosvenor Prints',
    collection: '18th-Century Cartography',
    sku: 'GRP-MAP-DIP-990',
    finish: 'Ebonised Walnut & Gilt Sight-Edge Slip',
    category: 'decor',
    dimensionsMm: [1010, 22, 380],
  });
}

/**
 * Single framed heritage botanical watercolour plate (`420 x 520 mm` with cream wash-line mount
 * & aged-brass/walnut Hogarth frame) centered above the Guest Bedroom headboard (`y = 0` center).
 */
function buildSingleBotanicalWatercolourFrame(
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
    readonly brassMat: THREE.Material;
  }
): THREE.Group {
  const fullGrid = buildCuratedMirrorsArtAndRugs({
    kind: 'curtisBotanicalGrid',
    name: `${options.name}_source`,
    botanicalLayout: '2x2',
  });
  const plate = fullGrid.getObjectByName(`${options.name}_source.plate_1`);

  const root = new THREE.Group();
  root.name = options.name;
  root.position.set(options.position[0], options.position[1], options.position[2]);
  root.rotation.y = options.rotationY;

  if (plate) {
    plate.removeFromParent();
    plate.name = `${options.name}.botanicalPlate`;
    plate.position.set(0, 0, 0);
    plate.scale.set(1.24, 1.18, 1);
    root.add(plate);
  }

  // Subtle brass hanging ring at top rail
  const ring = new THREE.Mesh(sharedCylinderGeometry(0.014, 0.014, 0.005, 16), options.brassMat);
  ring.name = `${options.name}.brassHangingRing`;
  ring.rotation.x = Math.PI * 0.5;
  ring.position.set(0, 0.275, 0.012);
  tagHighLodDetail(ring);
  root.add(ring);

  return attachAssetMetadata(root, {
    name: 'Framed William Curtis Botanical Watercolour Study',
    brand: 'Kew Botanical Prints',
    collection: 'Flora Londinensis',
    sku: 'KEW-BOT-420',
    finish: 'Ebonised Hogarth Frame & Cream Wash-Line Conservation Mount',
    category: 'decor',
    dimensionsMm: [422, 24, 520],
  });
}

function buildArticulatedBrassDeskLamp(
  namePrefix: string,
  brassMat: THREE.Material,
  position: readonly [number, number, number],
  rotationY = 0
): THREE.Group {
  const root = new THREE.Group();
  root.name = namePrefix;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const bulbMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.bulb`,
    color: 0xfff3d6,
    emissive: new THREE.Color(0xffb85c),
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });

  const base = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.075, 0.082, 0.018, 20)), brassMat);
  base.name = `${namePrefix}.base`;
  base.position.set(0, 0.009, 0);
  base.castShadow = true;
  root.add(base);

  const lowerStem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.007, 0.008, 0.28, 12)), brassMat);
  lowerStem.name = `${namePrefix}.lowerArm`;
  lowerStem.position.set(0, 0.155, -0.025);
  lowerStem.rotation.x = -0.18;
  lowerStem.castShadow = true;
  root.add(lowerStem);

  const knuckle = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.013, 12, 10)), brassMat);
  knuckle.name = `${namePrefix}.knuckle`;
  knuckle.position.set(0, 0.295, -0.05);
  root.add(knuckle);

  const upperArm = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.006, 0.007, 0.2, 12)), brassMat);
  upperArm.name = `${namePrefix}.upperArm`;
  upperArm.position.set(0, 0.355, 0.03);
  upperArm.rotation.x = 0.95;
  upperArm.castShadow = true;
  root.add(upperArm);

  const shade = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.078, 0.105, 20, 1, true)), brassMat);
  shade.name = `${namePrefix}.coneShade`;
  shade.position.set(0, 0.365, 0.125);
  shade.rotation.x = 0.32;
  shade.castShadow = true;
  root.add(shade);

  const bulb = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.022, 12, 10)), bulbMat);
  bulb.name = `${namePrefix}.filamentBulb`;
  bulb.position.set(0, 0.348, 0.132);
  root.add(bulb);

  return root;
}

/**
 * Airing cupboard interior (`X in [1.45, 2.35], Z in [-2.33, -1.65]`):
 * slatted European oak linen shelves, folded White Company Hydrocotton towels & insulated copper DHW cylinder.
 */
function buildAiringCupboardFittings(
  parent: THREE.Object3D,
  oakMat: THREE.Material,
  copperMat: THREE.Material
): void {
  const airing = new THREE.Group();
  airing.name = 'simpleHouse.airingCupboard';
  parent.add(airing);

  const linenMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.airingCupboard.whiteCoLinen',
    color: 0xf5f2ea,
    roughness: 0.9,
  });

  // Insulated copper domestic hot-water cylinder on West side of airing cupboard (`X = 1.66, Z = -2.08`)
  const cyl = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.18, 0.18, 1.04, 18)), copperMat);
  cyl.name = 'simpleHouse.airingCupboard.hotWaterCylinder';
  cyl.position.set(1.66, FFL_FIRST + 0.522, -2.08);
  cyl.castShadow = true;
  airing.add(cyl);

  const dome = new THREE.Mesh(
    prepGeo(new THREE.SphereGeometry(0.18, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)),
    copperMat
  );
  dome.name = 'simpleHouse.airingCupboard.cylinderDome';
  dome.position.set(1.66, FFL_FIRST + 1.042, -2.08);
  airing.add(dome);

  // Slatted oak linen shelving on East half & upper full-width tier (`Z in [-2.31, -1.96]`)
  for (const [tierIdx, sy, minX] of [
    [1, FFL_FIRST + 0.68, 1.9],
    [2, FFL_FIRST + 1.12, 1.9],
    [3, FFL_FIRST + 1.56, 1.48],
    [4, FFL_FIRST + 1.96, 1.48],
  ] as const) {
    const sw = 2.33 - minX;
    const cx = (minX + 2.33) * 0.5;
    for (let s = 0; s < 5; s++) {
      const sz = -2.29 + s * 0.075;
      addBox(
        airing,
        `simpleHouse.airingCupboard.slat_${tierIdx}_${s + 1}`,
        [sw, 0.016, 0.052],
        [cx, sy, sz],
        oakMat
      );
    }
    addBox(
      airing,
      `simpleHouse.airingCupboard.foldedTowels_${tierIdx}`,
      [Math.min(0.34, sw - 0.06), 0.11, 0.28],
      [2.11, sy + 0.065, -2.14],
      linenMat
    );
  }
}

export function buildSimpleHouseFirstInteriors(
  ctx: SceneBuilderContext,
  shell: SimpleHouseShell
): void {
  const firstGroup = ctx.floor ? ctx.floor('first').group : ctx.firstFloorMeshGroup;
  const firstCeilingGroup = ctx.floor ? ctx.floor('first').ceilingGroup : ctx.ceilingMeshGroup;

  const root = new THREE.Group();
  root.name = 'simpleHouse.interiors.first';
  firstGroup.add(root);

  const brassMats = getBathroomBrassMaterials('SB');
  const polishedBrassMats = getBathroomBrassMaterials('BR');
  const carraraMat = getHonedCarraraMarbleMaterial();
  const oakMat = getPaleEuropeanOakJoineryMaterial();
  const westCut = shell.cut('west', 'first');
  const northCut = shell.cut('north', 'first');
  const eastCut = shell.cut('east', 'first');
  const southCut = shell.cut('south', 'first');

  // =========================================================================
  // 1. Principal Bedroom & Walk-In Dressing Room (housePrincipalBed)
  // =========================================================================
  const principalGroup = new THREE.Group();
  principalGroup.name = 'simpleHouse.principalBedroom';
  principalGroup.userData.zoneId = 'housePrincipalBed';
  root.add(principalGroup);

  const principalRug = buildCuratedMirrorsArtAndRugs({
    kind: 'coxPebbleWool',
    name: 'simpleHouse.principal.pebbleWoolRug',
    widthM: 2.65,
    lengthM: 2.25,
    position: [-3.95, FFL_FIRST + 0.002, 1.285],
  });
  principalGroup.add(principalRug);

  const principalBed = buildCoxDanicaBed(principalGroup, {
    name: 'simpleHouse.principal.danicaKingBed',
    zone: 'housePrincipalBed',
    size: 'ukKing',
    position: [-5.375, FFL_FIRST + 0.022, 1.285],
    rotationY: 0,
  });
  stripBuiltInDanicaBedding(principalBed);

  const whiteCoBedding = buildWhiteCompanyBedStyling({
    name: 'simpleHouse.principal.whiteCompanyBedding',
    size: 'king',
    mattressTopY: 0.452,
    position: [-4.24, FFL_FIRST + 0.022, 1.285],
    rotationY: Math.PI / 2,
  });
  principalGroup.add(whiteCoBedding);

  // Pin #18: Tailored deep-buttoned Belgian linen & turned-oak end-of-bed ottoman bench
  const endOfBedBench = buildPrincipalEndOfBedBench(ctx, {
    name: 'simpleHouse.principal.endOfBedBench',
    position: [-2.86, FFL_FIRST + 0.002, 1.285],
    rotationY: Math.PI / 2,
    oakMat,
    brassMat: brassMats.primary,
  });
  principalGroup.add(endOfBedBench);

  // Pin #19: Wider 2-drawer Georgian / Neptune Chichester bedside chests (`650 W x 440 D x 670 H mm`)
  // paired with delicate `385 mm`-tall turned veined-alabaster bedside lamps (`Ø242 mm` empire linen shades)
  const bedsidePaintMat = shell.schemes.housePrincipalDressing.trim;
  for (const [tag, bz] of [
    ['north', 0.04],
    ['south', 2.53],
  ] as const) {
    const bedside = buildWideChichesterBedsideChest(ctx, {
      name: `simpleHouse.principal.bedside_${tag}`,
      position: [-5.18, FFL_FIRST + 0.001, bz],
      rotationY: Math.PI / 2,
      paintMat: bedsidePaintMat,
      brassMat: brassMats.primary,
    });
    const alabasterLamp = buildCompactPleatedBedsideLamp(ctx, {
      name: `simpleHouse.principal.alabasterLamp_${tag}`,
      position: [-5.18, FFL_FIRST + 0.671, bz],
      brassMat: brassMats.primary,
      circuitId: 'housePrincipalPendant' as CircuitId,
      alabasterBase: true,
    });
    tagCutaway(bedside, westCut);
    tagCutaway(alabasterLamp, westCut);
    principalGroup.add(bedside, alabasterLamp);
  }

  // George III bow-front mahogany chest on North wall of bedroom (`pN_east`, Z = -1.65)
  const bowChest = buildGeorgianAntiqueCasework(ctx, {
    kind: 'bowFrontChest',
    name: 'simpleHouse.principal.bowFrontChest',
    position: [-2.45, FFL_FIRST + 0.001, -1.33],
    rotationY: 0,
  });
  // Framed landscape painting centered above the George III bow-front chest + diffuser vignette
  const principalChestArt = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.principal.chestPainting',
    widthM: 0.92,
    heightM: 0.66,
    position: [-2.45, FFL_FIRST + 1.24, -1.646],
    rotationY: 0,
  });
  const principalChestDiffuser = buildWhiteCompanyAccessories({
    kind: 'reedDiffuser',
    name: 'simpleHouse.principal.chestDiffuser',
    position: [-2.12, FFL_FIRST + 1.043, -1.33],
  });

  // Full-length oatmeal-linen triple-pinch-pleat curtains & cast-iron column radiator on Principal Bedroom South sash
  const principalCurtainsSouth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.principal.curtainsSouth',
    poleName: 'simpleHouse.principal.curtainsSouth.pole',
    finialName: 'simpleHouse.principal.curtainsSouth.finial',
    bracketName: 'simpleHouse.principal.curtainsSouth.bracket',
    panelName: 'simpleHouse.principal.curtainsSouth.panel',
    headerName: 'simpleHouse.principal.curtainsSouth.header',
    hemName: 'simpleHouse.principal.curtainsSouth.hem',
    tieBackName: 'simpleHouse.principal.curtainsSouth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.28,
    stackWidthZ: 0.32,
    stackInnerInsetZ: 0.04,
    poleX: 0.088,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_FIRST + 2.34,
    floorY: FFL_FIRST,
    tieBackY: FFL_FIRST + 0.96,
    mainColorHex: 0xe3dacb,
    shadowColorHex: 0xbcae98,
    trimColorHex: 0xcfc2ae,
    brassMat: brassMats.primary,
  });
  principalCurtainsSouth.position.set(-3.35, 0, IN_Z);
  principalCurtainsSouth.rotation.y = Math.PI / 2;
  deconflictCurtainBrackets(principalCurtainsSouth, 1);
  tagCutaway(principalCurtainsSouth, southCut);

  const principalRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.principal.radiator',
    zone: 'housePrincipalBed',
    cx: -3.35,
    floorY: FFL_FIRST + 0.001,
    cz: IN_Z - 0.12,
    width: 0.92,
    height: 0.54,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(principalRadiator, southCut);

  principalGroup.add(bowChest, principalChestArt, principalChestDiffuser, principalCurtainsSouth, principalRadiator);

  // Dedicated Walk-In Dressing Room (`X in [-5.42, -3.59], Z in [-4.22, -1.77]`)
  // Pin #16: West full-height Shaker wardrobe bank retained; cramped `wardrobeEastNorth` removed!
  const wardrobeMat = shell.schemes.housePrincipalDressing.trim;
  const wDoorBaseY = FFL_FIRST + 0.085;
  const wTopY = FIRST_CEILING_SOFFIT_Y - 0.12;
  const wDoorH = wTopY - 0.048 - wDoorBaseY;

  const westFrontX = -4.92;
  buildHollowWardrobeInterior({
    parent: principalGroup,
    namePrefix: 'simpleHouse.dressing.wardrobeWest',
    openFace: '+x',
    uMin: -4.16,
    uMax: -1.86,
    frontCoord: westFrontX,
    depth: 0.485,
    roomFloorY: FFL_FIRST + 0.001,
    carcassBaseY: FFL_FIRST + 0.001,
    doorBaseY: wDoorBaseY,
    getCarcassTopY: () => wTopY,
    exteriorMat: wardrobeMat,
    brassMat: brassMats.primary,
    interactions: ctx.interactions,
    bays: [
      { id: 'bay1', uMin: -4.14, uMax: -3.4, preset: 'doubleHang' },
      { id: 'bay2', uMin: -3.38, uMax: -2.64, preset: 'longHangAndDrawers', registerHeroDrawer: false },
      { id: 'bay3', uMin: -2.62, uMax: -1.88, preset: 'threeDrawerChestAndLinen', registerHeroDrawer: false },
    ],
  });
  for (const [dTag, u0, u1, handleSide] of [
    ['door_1', -4.14, -3.4, 'left'],
    ['door_2', -3.38, -2.64, 'left'],
    ['door_3', -2.62, -1.88, 'right'],
  ] as const) {
    addInteractiveShakerWardrobeDoor(principalGroup, {
      name: `simpleHouse.dressing.wardrobeWest.${dTag}`,
      x: westFrontX + 0.015,
      yBot: wDoorBaseY,
      z: (u0 + u1) * 0.5,
      width: u1 - u0 - 0.006,
      heightLeft: wDoorH,
      heightRight: wDoorH,
      alongZ: true,
      normalSign: 1,
      handleSide,
      doorMat: wardrobeMat,
      brassMat: brassMats.primary,
      interactions: ctx.interactions,
    });
  }

  // Pin #17: Full-length Cox & Cox arched brass dressing mirror centered horizontally on the open
  // North Dressing Room wall between `wardrobeWest` front (`X = -4.905`) and `pDress` (`X = -3.590`)!
  const archedMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxArchedBrass',
    name: 'simpleHouse.dressing.archedBrassMirror',
    widthM: 0.68,
    heightM: 1.58,
    position: [-4.248, FFL_FIRST + 0.165, -IN_Z + 0.006],
    rotationY: 0,
  });
  tagCutaway(archedMirror, northCut);

  // Dressing Room upholstered bouclé dressing stool/pouffe, framed botanical study & brass ceiling pendant (0 extra PointLights)
  const dressingPouffe = new THREE.Group();
  dressingPouffe.name = 'simpleHouse.dressing.bouclePouffe';
  dressingPouffe.position.set(-4.24, FFL_FIRST + 0.001, -3.55);
  const pouffePlinth = new THREE.Mesh(sharedCylinderGeometry(0.22, 0.225, 0.036, 22), brassMats.primary);
  pouffePlinth.name = 'simpleHouse.dressing.bouclePouffe.brassPlinth';
  pouffePlinth.position.y = 0.018;
  const pouffeMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.dressing.boucleMat',
    color: 0xe5ddd0,
    roughness: 0.9,
  });
  const pouffeBody = new THREE.Mesh(sharedCylinderGeometry(0.23, 0.23, 0.34, 24), pouffeMat);
  pouffeBody.name = 'simpleHouse.dressing.bouclePouffe.body';
  pouffeBody.position.y = 0.208;
  pouffeBody.castShadow = true;
  pouffeBody.receiveShadow = true;
  const pouffeCrown = new THREE.Mesh(sharedCylinderGeometry(0.215, 0.23, 0.055, 24), pouffeMat);
  pouffeCrown.name = 'simpleHouse.dressing.bouclePouffe.crown';
  pouffeCrown.position.y = 0.408;
  pouffeCrown.castShadow = true;
  dressingPouffe.add(pouffePlinth, pouffeBody, pouffeCrown);

  const dressingArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.dressing.botanicalPrint',
    position: [-3.594, FFL_FIRST + 1.48, -3.65],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'coxFlutedPendant',
      name: 'simpleHouse.dressing.pendant',
      position: [-4.25, FIRST_CEILING_SOFFIT_Y - 0.01, -2.98],
      dropM: 0.34,
      circuitId: 'housePrincipalPendant' as CircuitId,
      createPointLight: false,
    })
  );

  principalGroup.add(archedMirror, dressingPouffe, dressingArt);

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'chandelier6Arm',
      name: 'simpleHouse.principal.chandelier',
      position: [-3.345, FIRST_CEILING_SOFFIT_Y - 0.04, 1.285],
      dropM: 0.38,
      circuitId: 'housePrincipalPendant' as CircuitId,
      createPointLight: true,
    })
  );

  // =========================================================================
  // 2. Galleried First-Floor Landing Art & Family Photo Gallery (houseLanding)
  // =========================================================================
  const landingGroup = new THREE.Group();
  landingGroup.name = 'simpleHouse.landingGallery';
  landingGroup.userData.zoneId = 'houseLanding';
  root.add(landingGroup);

  // Pin #20: Framed Constable pastoral landscape oil painting on `pW_south` Landing (+X) face (`X = -1.150 m`)
  const landingPaintingSouth = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.landing.constablePaintingSouth',
    widthM: 1.02,
    heightM: 0.74,
    position: [-1.146, FFL_FIRST + 1.07, 3.02],
    rotationY: Math.PI / 2,
  });

  // Pin #21: Companion framed heritage English landscape oil painting on `pW_south` North pier (`Z = -0.36 m`)
  const landingPaintingNorth = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.landing.heritagePaintingNorth',
    widthM: 0.94,
    heightM: 0.7,
    position: [-1.146, FFL_FIRST + 1.09, -0.36],
    rotationY: Math.PI / 2,
  });

  // Pin #22: Symmetrical/organic 6-frame dark walnut & brushed-brass family photo gallery on `pE_south` (-X face, `X = +1.150 m`)
  const landingFamilyPhotos = buildFamilyPhotoGalleryCluster({
    name: 'simpleHouse.landing.familyPhotoGallery',
    position: [1.146, FFL_FIRST + 1.43, 1.35],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });

  landingGroup.add(landingPaintingSouth, landingPaintingNorth, landingFamilyPhotos);

  // =========================================================================
  // 3. Jewel-Box Principal Ensuite (`2.20 x 2.45 m = 5.39 m²`, housePrincipalEnsuite)
  // =========================================================================
  const ensuiteGroup = new THREE.Group();
  ensuiteGroup.name = 'simpleHouse.principalEnsuite';
  ensuiteGroup.userData.zoneId = 'housePrincipalEnsuite';
  root.add(ensuiteGroup);

  // Tiled plumbing stud false-wall (`102 mm` deep) behind shower so recessed Zellige LED niche never penetrates North exterior wall
  const showerPlumbingStud = addBox(
    ensuiteGroup,
    'simpleHouse.ensuite.showerPlumbingWall',
    [1.26, 2.52, 0.102],
    [-2.82, FFL_FIRST + 1.262, -IN_Z + 0.055],
    shell.schemes.housePrincipalEnsuite.walls
  );
  tagCutaway(showerPlumbingStud, northCut);

  const ensuiteShower = buildCrittallWalkInShowerAndTowelRail({
    name: 'simpleHouse.ensuite.crittallShower',
    screenWidthM: 0.78,
    trayDepthM: 0.78,
    frameFinish: 'agedBrass',
    towelWarmerVariant: 'traditionalColumn',
    brassFinish: 'SB',
    includeShowerValveSet: true,
    position: [-2.82, FFL_FIRST + 0.001, -IN_Z + 0.108],
    rotationY: 0,
  });
  // Seat the floor-standing heated towel warmer's rear wall-stay roses (`X = -1.725 m`, east of the `1.26 m` plumbing stud)
  // flush against the North interior masonry wall (`Z = -IN_Z`) below the `sillY = 1.15 m` frosted sash window!
  const ensuiteTowelWarmer = ensuiteShower.getObjectByName('simpleHouse.ensuite.crittallShower.heatedTowelWarmer');
  if (ensuiteTowelWarmer) {
    ensuiteTowelWarmer.position.z = -0.106;
  }
  tagCutaway(ensuiteShower, northCut);

  const ensuiteVanity = buildNeptuneChichesterVanity(ctx, {
    name: 'simpleHouse.ensuite.chichesterDoubleVanity',
    variant: 'double',
    paintColor: NEPTUNE_SALT,
    brassFinish: 'SB',
    position: [-2.12, FFL_FIRST + 0.001, -2.055],
    rotationY: Math.PI,
  });
  const ensuiteMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxRoundBrass',
    name: 'simpleHouse.ensuite.roundBrassMirror',
    widthM: 0.8,
    position: [-2.12, FFL_FIRST + 1.06, -1.776],
    rotationY: Math.PI,
  });
  const ensuiteSconceWest = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.ensuite.sconceWest',
    position: [-2.64, FFL_FIRST + 1.48, -1.776],
    rotationY: Math.PI,
    circuitId: 'houseEnsuiteSconces' as CircuitId,
    createPointLight: true,
  });
  const ensuiteSconceEast = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.ensuite.sconceEast',
    position: [-1.6, FFL_FIRST + 1.48, -1.776],
    rotationY: Math.PI,
    circuitId: 'houseEnsuiteSconces' as CircuitId,
    createPointLight: false,
  });

  const ensuiteWc = buildLefroyBrooksCharterhouseWc({
    namePrefix: 'simpleHouse.ensuite.charterhouseWc',
    finish: 'SB',
    variant: 'closeCoupled',
  });
  ensuiteWc.position.set(-1.278, FFL_FIRST + 0.001, -3.12);
  ensuiteWc.rotation.y = -Math.PI / 2;

  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.ensuite.romanBlind',
    zone: 'housePrincipalEnsuite',
    centerX: -1.72,
    width: 0.68,
    railY: FFL_FIRST + 2.28,
    bottomY: FFL_FIRST + 1.98,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: ensuiteGroup,
  }), 1);

  const ensuiteWcArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.ensuite.botanicalArt',
    position: [-1.274, FFL_FIRST + 1.42, -3.12],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });
  const ensuitePaperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleHouse.ensuite.paperHolder',
    finish: 'SB',
    style: 'traditional',
    coreClearanceM: 0.0008,
  });
  ensuitePaperHolder.position.set(-1.278, FFL_FIRST + 0.68, -2.68);
  ensuitePaperHolder.rotation.y = -Math.PI / 2;

  const ensuiteTowelRing = buildPerrinRoweTowelRing({
    namePrefix: 'simpleHouse.ensuite.towelRing',
    finish: 'SB',
  });
  ensuiteTowelRing.position.set(-1.278, FFL_FIRST + 1.05, -2.18);
  ensuiteTowelRing.rotation.y = -Math.PI / 2;

  ensuiteGroup.add(
    ensuiteShower,
    ensuiteVanity,
    ensuiteMirror,
    ensuiteSconceWest,
    ensuiteSconceEast,
    ensuiteWc,
    ensuiteWcArt,
    ensuitePaperHolder,
    ensuiteTowelRing
  );

  // =========================================================================
  // 4. Guest Double Bedroom (houseBedroom2: F&B Setting Plaster + Honey Sisal)
  // =========================================================================
  const guestGroup = new THREE.Group();
  guestGroup.name = 'simpleHouse.guestBedroom';
  guestGroup.userData.zoneId = 'houseBedroom2';
  root.add(guestGroup);

  const guestRug = buildCuratedMirrorsArtAndRugs({
    kind: 'zieglerOushak',
    name: 'simpleHouse.guest.zieglerRug',
    widthM: 2.3,
    lengthM: 1.65,
    position: [3.35, FFL_FIRST + 0.002, 1.12],
    rotationY: Math.PI / 2,
  });
  guestGroup.add(guestRug);

  buildCoxDanicaBed(guestGroup, {
    name: 'simpleHouse.guest.danicaDoubleBed',
    zone: 'houseBedroom2',
    size: 'ukDouble',
    position: [3.35, FFL_FIRST + 0.019, -0.09],
    rotationY: -Math.PI / 2,
  });

  for (const [tag, bx] of [
    ['west', 2.2],
    ['east', 4.5],
  ] as const) {
    const bedside = buildNeptuneOakTablesAndBedsides({
      name: `simpleHouse.guest.bedside_${tag}`,
      kind: 'chichesterBedsideTable',
      position: [bx, FFL_FIRST + 0.001, 0.16],
      rotationY: 0,
      interactions: ctx.interactions,
    });
    const gourdLamp = buildHeritageInteriorLighting(ctx, {
      kind: 'whiteCoCeramicLamp',
      name: `simpleHouse.guest.portobelloLamp_${tag}`,
      position: [bx, FFL_FIRST + 0.722, 0.16],
      circuitId: 'houseBed2Pendant' as CircuitId,
      createPointLight: false,
    });
    guestGroup.add(bedside, gourdLamp);
  }

  const guestBotanicals = buildCuratedMirrorsArtAndRugs({
    kind: 'curtisBotanicalGrid',
    name: 'simpleHouse.guest.botanicalPrints',
    botanicalLayout: '1x4',
    position: [1.274, FFL_FIRST + 1.32, 1.55],
    rotationY: Math.PI / 2,
  });
  guestGroup.add(guestBotanicals);

  // Pin #26: Framed botanical watercolour study centered above the Guest Bed headboard on `pG` South face (`Z = -0.100 m`)
  const guestHeadboardArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.guest.headboardBotanicalArt',
    position: [3.35, FFL_FIRST + 1.48, -0.096],
    rotationY: 0,
    brassMat: brassMats.primary,
  });
  guestGroup.add(guestHeadboardArt);

  // Pin #27: Full-length Cox & Cox arched aged-brass pier mirror on South exterior wall SE pier (`Z = +4.212 m`),
  // facing `-Z` North into Guest Bedroom and tagged with First-Floor South `cutawayWall`!
  const guestArchedMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxArchedBrass',
    name: 'simpleHouse.guest.archedBrassMirror',
    widthM: 0.64,
    heightM: 1.58,
    position: [4.72, FFL_FIRST + 0.165, IN_Z - 0.006],
    rotationY: Math.PI,
  });
  tagCutaway(guestArchedMirror, southCut);

  // Full-length blush-oatmeal pinch-pleat linen curtains on Guest Bedroom South & East sashes + cast-iron radiator
  const guestCurtainsSouth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.guest.curtainsSouth',
    poleName: 'simpleHouse.guest.curtainsSouth.pole',
    finialName: 'simpleHouse.guest.curtainsSouth.finial',
    bracketName: 'simpleHouse.guest.curtainsSouth.bracket',
    panelName: 'simpleHouse.guest.curtainsSouth.panel',
    headerName: 'simpleHouse.guest.curtainsSouth.header',
    hemName: 'simpleHouse.guest.curtainsSouth.hem',
    tieBackName: 'simpleHouse.guest.curtainsSouth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.25,
    stackWidthZ: 0.29,
    stackInnerInsetZ: 0.04,
    poleX: 0.086,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_FIRST + 2.34,
    floorY: FFL_FIRST,
    tieBackY: FFL_FIRST + 0.96,
    mainColorHex: 0xe4d7cc,
    shadowColorHex: 0xbdaea2,
    trimColorHex: 0xd1c2b5,
    brassMat: brassMats.primary,
  });
  guestCurtainsSouth.position.set(3.35, 0, IN_Z);
  guestCurtainsSouth.rotation.y = Math.PI / 2;
  deconflictCurtainBrackets(guestCurtainsSouth, 1);
  tagCutaway(guestCurtainsSouth, southCut);

  const guestCurtainsEast = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.guest.curtainsEast',
    poleName: 'simpleHouse.guest.curtainsEast.pole',
    finialName: 'simpleHouse.guest.curtainsEast.finial',
    bracketName: 'simpleHouse.guest.curtainsEast.bracket',
    panelName: 'simpleHouse.guest.curtainsEast.panel',
    headerName: 'simpleHouse.guest.curtainsEast.header',
    hemName: 'simpleHouse.guest.curtainsEast.hem',
    tieBackName: 'simpleHouse.guest.curtainsEast.tieBack',
    centerZ: 2.1,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.26,
    stackWidthZ: 0.3,
    stackInnerInsetZ: 0.04,
    poleX: IN_X - 0.086,
    wallFaceX: IN_X,
    inwardSignX: -1,
    poleY: FFL_FIRST + 2.34,
    floorY: FFL_FIRST,
    tieBackY: FFL_FIRST + 0.96,
    mainColorHex: 0xe4d7cc,
    shadowColorHex: 0xbdaea2,
    trimColorHex: 0xd1c2b5,
    brassMat: brassMats.primary,
  });
  deconflictCurtainBrackets(guestCurtainsEast, -1);
  tagCutaway(guestCurtainsEast, eastCut);

  const guestRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.guest.radiator',
    zone: 'houseBedroom2',
    cx: 3.35,
    floorY: FFL_FIRST + 0.001,
    cz: IN_Z - 0.12,
    width: 0.92,
    height: 0.54,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(guestRadiator, southCut);

  guestGroup.add(guestArchedMirror, guestCurtainsSouth, guestCurtainsEast, guestRadiator);

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'coxFlutedPendant',
      name: 'simpleHouse.guest.pendant',
      position: [3.345, FIRST_CEILING_SOFFIT_Y - 0.04, 2.06],
      dropM: 0.48,
      circuitId: 'houseBed2Pendant' as CircuitId,
      createPointLight: true,
    })
  );

  // =========================================================================
  // 5. English Country Study / Library (houseStudy: F&B Drop Cloth + Honey-Smoked Oak)
  // =========================================================================
  const studyGroup = new THREE.Group();
  studyGroup.name = 'simpleHouse.study';
  studyGroup.userData.zoneId = 'houseStudy';
  root.add(studyGroup);

  // Pin #15: Warm faded terracotta & indigo Ziegler Oushak library rug anchoring the study seating & desk zone
  const studyRug = buildCuratedMirrorsArtAndRugs({
    kind: 'zieglerOushak',
    name: 'simpleHouse.study.zieglerLibraryRug',
    widthM: 1.85,
    lengthM: 2.35,
    position: [3.85, FFL_FIRST + 0.002, -2.05],
  });

  // Cox & Cox Nivala honeyed-oak desk + bouclé desk chair + articulated brass task lamp at North sash window
  const nivalaDesk = buildCoxNivalaDesk(studyGroup, {
    name: 'simpleHouse.study.nivalaDesk',
    zone: 'houseStudy',
    position: [3.95, FFL_FIRST + 0.001, -3.82],
    rotationY: Math.PI,
    interactions: ctx.interactions,
    includeChair: true,
    insetJoineryButtJoints: true,
  });
  tagCutaway(nivalaDesk, northCut);

  const deskLamp = buildArticulatedBrassDeskLamp(
    'simpleHouse.study.brassDeskLamp',
    brassMats.primary,
    [4.34, FFL_FIRST + 0.752, -3.9],
    -0.35
  );
  tagCutaway(deskLamp, northCut);

  // Pin #14: Tailored 2-seater English library loveseat replacing the oversized Chichester daybed
  const libraryLoveseat = buildEnglishLibraryLoveseat(ctx, {
    name: 'simpleHouse.study.libraryLoveseat',
    position: [4.88, FFL_FIRST + 0.001, -1.65],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(libraryLoveseat, eastCut);

  // Turned walnut & brass circular library side table + reading lamp beside the loveseat
  const walnutSideTable = buildWalnutLibrarySideTableAndLamp(ctx, {
    name: 'simpleHouse.study.walnutSideTable',
    position: [5.02, FFL_FIRST + 0.001, -2.76],
    brassMat: brassMats.primary,
    circuitId: 'houseStudyPendant' as CircuitId,
  });
  tagCutaway(walnutSideTable, eastCut);

  // George III astragal-glazed mahogany bureau bookcase with leather-bound volumes against South partition `pG`
  // (`X = 3.55 m` -> `X in [3.04, 4.06]`, keeping all Study furniture east of `X = 1.95 m` with generous walkthrough!)
  const bureauBookcase = buildGeorgianAntiqueCasework(ctx, {
    kind: 'astragalBureauBookcase',
    name: 'simpleHouse.study.bureauBookcase',
    position: [3.55, FFL_FIRST + 0.001, -0.5],
    rotationY: Math.PI,
  });

  // Framed pair of 18th-century antiquarian English county survey maps above the library loveseat
  const studyMapPrints = buildAntiquarianMapDiptych({
    name: 'simpleHouse.study.antiquarianMapPrints',
    position: [IN_X - 0.005, FFL_FIRST + 1.48, -1.65],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(studyMapPrints, eastCut);

  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.study.northRomanBlind',
    zone: 'houseStudy',
    centerX: 3.95,
    width: 1.12,
    railY: FFL_FIRST + 2.28,
    bottomY: FFL_FIRST + 1.88,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: studyGroup,
  }), 1);

  const studyRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.study.radiator',
    zone: 'houseStudy',
    cx: 2.59,
    floorY: FFL_FIRST + 0.001,
    cz: -3.2,
    width: 0.86,
    height: 0.54,
    rotationY: 0,
    brassMat: brassMats.primary,
  });

  studyGroup.add(
    studyRug,
    deskLamp,
    libraryLoveseat,
    walnutSideTable,
    bureauBookcase,
    studyMapPrints,
    studyRadiator
  );

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'coxFlutedPendant',
      name: 'simpleHouse.study.pendant',
      position: [3.95, FIRST_CEILING_SOFFIT_Y - 0.003, -2.22],
      dropM: 0.46,
      circuitId: 'houseStudyPendant' as CircuitId,
      createPointLight: true,
    })
  );

  // =========================================================================
  // 6. Re-Proportioned Family Bathroom & Airing Cupboard (houseBathroom)
  // =========================================================================
  const bathroomGroup = new THREE.Group();
  bathroomGroup.name = 'simpleHouse.familyBathroom';
  bathroomGroup.userData.zoneId = 'houseBathroom';
  root.add(bathroomGroup);

  const copperCylinderMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.airingCupboard.copperJacket',
    color: 0xb97748,
    roughness: 0.42,
    metalness: 0.65,
  });
  buildAiringCupboardFittings(bathroomGroup, oakMat, copperCylinderMat);

  // F&B Mizzle (#C0C6B8) tongue-and-groove dado panelling along the West & South dry walls
  const bathDadoWest = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bathroom.mizzleDadoWest',
    lengthM: 2.42,
    heightM: 1.08,
    paintColor: FB_MIZZLE,
    position: [-1.144, FFL_FIRST + 0.001, -2.93],
    rotationY: Math.PI / 2,
  });
  const bathDadoSouth = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bathroom.mizzleDadoSouth',
    lengthM: 1.22,
    heightM: 1.08,
    paintColor: FB_MIZZLE,
    position: [0.68, FFL_FIRST + 0.001, -1.656],
    rotationY: Math.PI,
  });

  const copperBath = buildBcDesignsCopperBoatBath({
    namePrefix: 'simpleHouse.bathroom.copperBoatBath',
    brassFinish: 'BR',
  });
  copperBath.position.set(0.18, FFL_FIRST + 0.001, -3.74);
  tagCutaway(copperBath, northCut);

  const bathMixer = buildArmstrongFreestandingBathMixer({
    namePrefix: 'simpleHouse.bathroom.freestandingBathMixer',
    finish: 'BR',
    style: 'traditional',
  });
  bathMixer.position.set(-0.78, FFL_FIRST + 0.001, -3.74);
  bathMixer.rotation.y = Math.PI / 2;
  tagCutaway(bathMixer, northCut);

  const lissaWashstand = buildLefroyBrooksLissaDoonWashstand({
    namePrefix: 'simpleHouse.bathroom.lissaDoonWashstand',
    finish: 'BR',
    mixerStyle: 'traditional',
  });
  lissaWashstand.position.set(-1.124, FFL_FIRST + 0.001, -2.68);
  lissaWashstand.rotation.y = Math.PI / 2;

  const bathMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxRoundBrass',
    name: 'simpleHouse.bathroom.roundBrassMirror',
    widthM: 0.65,
    position: [-1.142, FFL_FIRST + 1.14, -2.68],
    rotationY: Math.PI / 2,
  });

  const bathSconceNorth = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.bathroom.sconceNorth',
    position: [-1.142, FFL_FIRST + 1.52, -3.14],
    rotationY: Math.PI / 2,
    circuitId: 'houseBathSpots' as CircuitId,
    createPointLight: true,
  });
  const bathSconceSouth = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.bathroom.sconceSouth',
    position: [-1.142, FFL_FIRST + 1.52, -2.22],
    rotationY: Math.PI / 2,
    circuitId: 'houseBathSpots' as CircuitId,
    createPointLight: false,
  });

  const bathWc = buildLefroyBrooksCharterhouseWc({
    namePrefix: 'simpleHouse.bathroom.charterhouseWc',
    finish: 'BR',
    variant: 'closeCoupled',
  });
  bathWc.position.set(1.322, FFL_FIRST + 0.001, -2.02);
  bathWc.rotation.y = -Math.PI / 2;

  // Stud-nibbed olive-metro-tiled wet-zone shower alcove (`X in [1.45, 2.35], Z in [-4.22, -2.45]`)
  const wetAlcoveGroup = new THREE.Group();
  wetAlcoveGroup.name = 'simpleHouse.bathroom.wetZoneShower';
  addBox(
    wetAlcoveGroup,
    'simpleHouse.bathroom.wetZoneShower.stoneTray',
    [0.86, 0.034, 0.92],
    [1.9, FFL_FIRST + 0.018, -3.73],
    carraraMat
  );
  const glassMat = new THREE.MeshPhysicalMaterial({
    name: 'simpleHouse.bathroom.wetZoneGlass',
    color: 0xecf4f5,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    ior: 1.52,
    clearcoat: 0.65,
    transmission: 0,
  });
  addBox(
    wetAlcoveGroup,
    'simpleHouse.bathroom.wetZoneShower.crittallScreen',
    [0.54, 1.98, 0.01],
    [2.05, FFL_FIRST + 1.025, -3.27],
    glassMat
  );
  addBox(
    wetAlcoveGroup,
    'simpleHouse.bathroom.wetZoneShower.brassPost',
    [0.018, 1.98, 0.018],
    [1.78, FFL_FIRST + 1.025, -3.27],
    polishedBrassMats.primary
  );
  const wetShowerValve = buildArmstrongConcealedShowerSet({
    namePrefix: 'simpleHouse.bathroom.wetZoneShower.valveSet',
    finish: 'BR',
    style: 'traditional',
    overheadArmYM: 1.96,
    valveCenterYM: 1.12,
  });
  wetShowerValve.position.set(1.9, FFL_FIRST + 0.036, -IN_Z + 0.02);
  tagCutaway(wetShowerValve, northCut);
  wetAlcoveGroup.add(wetShowerValve);

  const laundryHamper = buildWhiteCompanyAccessories({
    kind: 'kubuLaundryHamper',
    name: 'simpleHouse.bathroom.kubuHamper',
    position: [2.04, FFL_FIRST + 0.001, -2.74],
    rotationY: -Math.PI / 2,
  });

  // Extend F&B Mizzle wainscot & dado rail behind the freestanding copper boat bath on the North dry wall
  const bathNorthWainscot = addBox(
    bathroomGroup,
    'simpleHouse.bathroom.mizzleWainscotNorth',
    [2.52, 0.88, 0.006],
    [0.16, FFL_FIRST + 0.14 + 0.88 * 0.5, -IN_Z + 0.004],
    shell.schemes.houseBathroom.trim
  );
  bathNorthWainscot.castShadow = false;
  tagCutaway(bathNorthWainscot, northCut);

  const bathNorthDadoRail = createDadoRun({
    name: 'simpleHouse.bathroom.mizzleDadoRailNorth',
    path: [
      [1.43, -IN_Z],
      [-1.1, -IN_Z],
    ],
    closed: false,
    roomSide: 'left',
    floorY: FFL_FIRST,
    elevationY: 1.045,
    profile: 'astragal-dado',
    height: 0.048,
    projection: 0.02,
    material: shell.schemes.houseBathroom.trim,
    gaps: [{ box: { minX: -0.52, maxX: 0.82, minZ: -4.3, maxZ: -4.14 }, cap: 'selfReturn' }],
    cutawayWalls: [northCut],
    floor: 'first',
    zone: 'houseBathroom',
  });

  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.bathroom.northRomanBlind',
    zone: 'houseBathroom',
    centerX: 0.15,
    width: 1.12,
    railY: FFL_FIRST + 2.28,
    bottomY: FFL_FIRST + 1.92,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: bathroomGroup,
  }), 1);

  // Slatted European oak bath caddy across the copper boat bath + apothecary diffuser
  const bathCaddy = new THREE.Group();
  bathCaddy.name = 'simpleHouse.bathroom.oakBathCaddy';
  bathCaddy.position.set(0.28, FFL_FIRST + 0.655, -3.74);
  addBox(bathCaddy, 'simpleHouse.bathroom.oakBathCaddy.railWest', [0.038, 0.018, 0.76], [-0.11, 0.009, 0], oakMat);
  addBox(bathCaddy, 'simpleHouse.bathroom.oakBathCaddy.railEast', [0.038, 0.018, 0.76], [0.11, 0.009, 0], oakMat);
  for (let s = -3; s <= 3; s++) {
    addBox(bathCaddy, `simpleHouse.bathroom.oakBathCaddy.slat_${s + 4}`, [0.18, 0.012, 0.046], [0, 0.016, s * 0.078], oakMat);
  }
  tagCutaway(bathCaddy, northCut);

  const bathWcArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.bathroom.wcBotanicalArt',
    position: [1.326, FFL_FIRST + 1.44, -2.02],
    rotationY: -Math.PI / 2,
    brassMat: polishedBrassMats.primary,
  });
  const bathPaperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleHouse.bathroom.paperHolder',
    finish: 'BR',
    style: 'traditional',
    coreClearanceM: 0.0008,
  });
  bathPaperHolder.position.set(0.95, FFL_FIRST + 0.68, -1.698);
  bathPaperHolder.rotation.y = Math.PI;

  const bathRobeHook = buildArmstrongRobeHook({
    namePrefix: 'simpleHouse.bathroom.robeHook',
    finish: 'BR',
    style: 'traditional',
  });
  bathRobeHook.position.set(1.326, FFL_FIRST + 1.56, -2.36);
  bathRobeHook.rotation.y = -Math.PI / 2;

  bathroomGroup.add(
    bathDadoWest,
    bathDadoSouth,
    bathNorthDadoRail,
    copperBath,
    bathCaddy,
    bathMixer,
    lissaWashstand,
    bathMirror,
    bathSconceNorth,
    bathSconceSouth,
    bathWc,
    bathWcArt,
    bathPaperHolder,
    bathRobeHook,
    wetAlcoveGroup,
    laundryHamper
  );

  // =========================================================================
  // 7. First-Floor Corston Toggle Switches & Power Sockets
  // =========================================================================
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.landingTop',
    switchPa: 'plate-landing-top',
    location: 'Galleried landing head of stairs',
    x: 1.147,
    y: FFL_FIRST + 1.15,
    z: -0.35,
    facing: 'west',
    mountedInZoneId: 'houseLanding' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-stair-top' }),
    gangs: [
      { gang: 1, zoneId: 'houseLanding' as RoomZoneId, label: 'Stairwell 2-Way (Top)', circuitId: 'houseStairPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.principalDoor',
    switchPa: 'plate-principal-door',
    location: 'Principal bedroom latch jamb',
    x: -1.273,
    y: FFL_FIRST + 1.15,
    z: 0.65,
    facing: 'west',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed1-door' }),
    gangs: [
      { gang: 1, zoneId: 'housePrincipalBed' as RoomZoneId, label: 'Principal 3-Way (Door)', circuitId: 'housePrincipalPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.principalLeft',
    switchPa: 'plate-principal-left',
    location: 'Left Chichester bedside',
    x: -IN_X + 0.007,
    y: FFL_FIRST + 0.92,
    z: 0.04,
    facing: 'east',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: root,
    cutawayWall: westCut,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed1-left' }),
    gangs: [
      { gang: 1, zoneId: 'housePrincipalBed' as RoomZoneId, label: 'Principal 3-Way (Left)', circuitId: 'housePrincipalPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.principalRight',
    switchPa: 'plate-principal-right',
    location: 'Right Chichester bedside',
    x: -IN_X + 0.007,
    y: FFL_FIRST + 0.92,
    z: 2.53,
    facing: 'east',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: root,
    cutawayWall: westCut,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed1-right' }),
    gangs: [
      { gang: 1, zoneId: 'housePrincipalBed' as RoomZoneId, label: 'Principal 3-Way (Right)', circuitId: 'housePrincipalPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.ensuite',
    switchPa: 'plate-ensuite',
    location: 'Dressing room outside principal ensuite',
    x: -3.593,
    y: FFL_FIRST + 1.15,
    z: -2.25,
    facing: 'west',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-ensuite' }),
    gangs: [
      { gang: 1, zoneId: 'housePrincipalEnsuite' as RoomZoneId, label: 'Principal Ensuite Sconces', circuitId: 'houseEnsuiteSconces' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.bed2',
    switchPa: 'plate-bed2',
    location: 'Guest bedroom door jamb',
    x: 1.273,
    y: FFL_FIRST + 1.15,
    z: 2.85,
    facing: 'east',
    mountedInZoneId: 'houseBedroom2' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed2' }),
    gangs: [
      { gang: 1, zoneId: 'houseBedroom2' as RoomZoneId, label: 'Guest Bedroom Pendant', circuitId: 'houseBed2Pendant' as CircuitId },
    ],
  });

  // Pin #24 coordination: mounted on Study side of South partition `pG` (`Z = -0.223 m`, facing North `-Z` into Study)
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.study',
    switchPa: 'plate-study',
    location: 'Study door jamb',
    x: 1.58,
    y: FFL_FIRST + 1.15,
    z: -0.223,
    facing: 'north',
    mountedInZoneId: 'houseStudy' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-study' }),
    gangs: [
      { gang: 1, zoneId: 'houseStudy' as RoomZoneId, label: 'Study Pendant', circuitId: 'houseStudyPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.bath',
    switchPa: 'plate-bath',
    location: 'Landing outside family bathroom',
    x: 0.06,
    y: FFL_FIRST + 1.15,
    z: -1.527,
    facing: 'south',
    mountedInZoneId: 'houseLanding' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bath' }),
    gangs: [
      { gang: 1, zoneId: 'houseBathroom' as RoomZoneId, label: 'Family Bathroom Sconces', circuitId: 'houseBathSpots' as CircuitId },
    ],
  });

  root.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.principalNorth',
      zone: 'housePrincipalBed',
      kind: 'double',
      x: -1.65,
      y: FFL_FIRST + 0.45,
      z: -1.647,
      facing: 'south',
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.studyDesk',
      zone: 'houseStudy',
      kind: 'double',
      x: 4.55,
      y: FFL_FIRST + 0.45,
      z: -IN_Z + 0.003,
      facing: 'south',
      cutawayWall: northCut,
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.guestWest',
      zone: 'houseBedroom2',
      kind: 'double',
      x: 1.273,
      y: FFL_FIRST + 0.45,
      z: 0.75,
      facing: 'east',
    })
  );
}
