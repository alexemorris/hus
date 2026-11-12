import * as THREE from 'three';
import {
  attachAssetMetadata,
  mmFromMetres,
  wireCatalogHingedDoor,
  wireCatalogSlidingDrawer,
} from '../shared/catalog-smart-metadata.ts';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import type { CatalogInteractionContext } from '../architectural/neptune-kitchen-joinery.ts';
import { getBarwareMaterialSuite } from '../decor/barware-glassware.ts';
import { attachDrawerBoxBehindFront } from '../joinery/cabinet-interior.ts';
import {
  addCockBeadApertureTrim,
  addNamedBox,
  addNamedCyl,
  buildAgedBrassBarlowCupPull,
  buildAgedBrassMushroomKnob,
  buildShakerDoorAssembly,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getCandle2200kFilamentMaterial,
  getCharacterOakMaterial,
  getClearArchitecturalGlassMaterial,
  getMatteCastIronMaterial,
  getPaintedJoineryMaterial,
  getWovenFabricMaps,
  sharedSphereGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';
import {
  createPerimeterWeltLoop,
  createSculptedCushionGeometry,
} from './barker-and-stonehouse-sofas.ts';
import {
  collectSeatClickableMeshes,
  SeatInteractable,
} from './seating-interactions.ts';

function resolveRegistry(ctx: CatalogInteractionContext): InteractionRegistry | null {
  if (!ctx) return null;
  if ('registerHingedDoor' in ctx && typeof ctx.registerHingedDoor === 'function') {
    return ctx as InteractionRegistry;
  }
  if ('interactions' in ctx && ctx.interactions) {
    return ctx.interactions;
  }
  return null;
}

const fabricMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
function getLinenOrWoolMaterial(
  key: string,
  color: THREE.ColorRepresentation,
  weave: 'linen' | 'ticking' | 'matelasse' | 'cashmere',
  roughness = 0.88
): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  const fullKey = `${key}:${c.getHexString()}:${weave}:${roughness.toFixed(2)}`;
  let mat = fabricMaterialCache.get(fullKey);
  if (!mat) {
    const maps = getWovenFabricMaps(fullKey, c.getHex(), weave);
    mat = new THREE.MeshStandardMaterial({
      name: `catalog.fabric.${key}`,
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: maps.roughnessMap,
      roughness,
      metalness: 0.01,
    });
    fabricMaterialCache.set(fullKey, mat);
  }
  return mat;
}

function addWhiteCompanyGlassHurricane(
  parent: THREE.Object3D,
  namePrefix: string,
  x: number,
  y: number,
  z: number,
  w = 0.18,
  h = 0.32
): THREE.Group {
  const g = new THREE.Group();
  g.name = namePrefix;
  g.position.set(x, y, z);
  parent.add(g);

  const brassMat = getAgedBrassMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const waxMat = getPaintedJoineryMaterial(0xf5f1e6, 0.65, `${namePrefix}.pillarWax`);
  const flameMat = getCandle2200kFilamentMaterial();

  // Base brass tray (`y = 0..0.012`)
  addNamedBox(g, `${namePrefix}.baseFrame`, w, 0.012, w, 0, 0.006, 0, brassMat, true);
  // 4 corner brass posts (`10 x 10 mm`)
  const postS = 0.009;
  const bodyH = h - 0.024;
  for (const [pTag, sx, sz] of [
    ['FL', -1, 1],
    ['FR', 1, 1],
    ['BL', -1, -1],
    ['BR', 1, -1],
  ] as const) {
    addNamedBox(
      g,
      `${namePrefix}.cornerPost_${pTag}`,
      postS,
      bodyH,
      postS,
      sx * (w * 0.5 - postS * 0.5),
      0.012 + bodyH * 0.5,
      sz * (w * 0.5 - postS * 0.5),
      brassMat,
      true
    );
  }
  // Top brass rim + carry ring
  addNamedBox(
    g,
    `${namePrefix}.topRimLeft`,
    postS,
    0.01,
    w,
    -(w * 0.5 - postS * 0.5),
    h - 0.007,
    0,
    brassMat,
    true
  );
  addNamedBox(
    g,
    `${namePrefix}.topRimRight`,
    postS,
    0.01,
    w,
    w * 0.5 - postS * 0.5,
    h - 0.007,
    0,
    brassMat,
    true
  );
  addNamedBox(
    g,
    `${namePrefix}.topRimFront`,
    w - postS * 2,
    0.01,
    postS,
    0,
    h - 0.007,
    w * 0.5 - postS * 0.5,
    brassMat,
    true
  );
  addNamedBox(
    g,
    `${namePrefix}.topRimBack`,
    w - postS * 2,
    0.01,
    postS,
    0,
    h - 0.007,
    -(w * 0.5 - postS * 0.5),
    brassMat,
    true
  );

  // 4 clear glass panes strictly between the corner posts
  const paneSpan = w - postS * 2 - 0.002;
  const paneT = 0.003;
  addNamedBox(
    g,
    `${namePrefix}.glassFront`,
    paneSpan,
    bodyH - 0.004,
    paneT,
    0,
    0.012 + bodyH * 0.5,
    w * 0.5 - postS * 0.5,
    glassMat,
    true
  );
  addNamedBox(
    g,
    `${namePrefix}.glassBack`,
    paneSpan,
    bodyH - 0.004,
    paneT,
    0,
    0.012 + bodyH * 0.5,
    -(w * 0.5 - postS * 0.5),
    glassMat,
    true
  );
  addNamedBox(
    g,
    `${namePrefix}.glassLeft`,
    paneT,
    bodyH - 0.004,
    paneSpan,
    -(w * 0.5 - postS * 0.5),
    0.012 + bodyH * 0.5,
    0,
    glassMat,
    true
  );
  addNamedBox(
    g,
    `${namePrefix}.glassRight`,
    paneT,
    bodyH - 0.004,
    paneSpan,
    w * 0.5 - postS * 0.5,
    0.012 + bodyH * 0.5,
    0,
    glassMat,
    true
  );

  // Ivory pillar candle + warm 2200K flame inside
  const candleH = bodyH * 0.52;
  addNamedCyl(
    g,
    `${namePrefix}.pillarCandle`,
    w * 0.21,
    w * 0.21,
    candleH,
    14,
    0,
    0.013 + candleH * 0.5,
    0,
    waxMat,
    true
  );
  const flame = new THREE.Mesh(sharedSphereGeometry(0.008, 8, 8), flameMat);
  flame.name = `${namePrefix}.candleFlame`;
  flame.scale.set(0.7, 1.9, 0.7);
  flame.position.set(0, 0.013 + candleH + 0.014, 0);
  tagHighLod(flame);
  g.add(flame);

  return g;
}

export type NeptuneSofaModel = 'longIsland' | 'george';

export interface NeptuneUpholsteredSofaOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly model?: NeptuneSofaModel;
  /** Washed-linen colour (default Neptune *Pale Oat* `#DDD5C7`). */
  readonly fabricColor?: THREE.ColorRepresentation;
  readonly includeCashmereThrow?: boolean;
  readonly interactions?: InteractionRegistry;
}

/**
 * Neptune *Long Island* (`2100 x 1050 x 820 mm` slipcovered relaxed washed-linen) &
 * *George* (`2050 x 920 x 830 mm` tailored English roll-arm w/ turned oak legs & brass castors)
 * 3-seater sofas in *Pale Oat* (`#DDD5C7`), built with `createSculptedCushionGeometry` &
 * `createPerimeterWeltLoop`, White Company draped cashmere throw, 4 piped linen/ticking scatter cushions & `SeatInteractable`.
 * Local origin `(0, 0, 0)` is at floor level (`y = 0`), centered in X and Z, facing `+Z`.
 */
export function buildNeptuneUpholsteredSofa(
  opts: NeptuneUpholsteredSofaOptions = {}
): THREE.Group {
  const model = opts.model ?? 'longIsland';
  const namePrefix = opts.name ?? (model === 'longIsland' ? 'neptuneLongIslandSofa' : 'neptuneGeorgeSofa');
  const w = model === 'longIsland' ? 2.1 : 2.05;
  const d = model === 'longIsland' ? 1.05 : 0.92;
  const h = model === 'longIsland' ? 0.82 : 0.83;

  const mainLinen = getLinenOrWoolMaterial(
    `${namePrefix}.paleOat`,
    opts.fabricColor ?? 0xddd5c7,
    'linen',
    0.88
  );
  const weltLinen = getLinenOrWoolMaterial(
    `${namePrefix}.welt`,
    opts.fabricColor ?? 0xd3cab9,
    'linen',
    0.85
  );
  const tickingPillowMat = getLinenOrWoolMaterial(`${namePrefix}.ticking`, 0xdfd8ca, 'ticking', 0.87);
  const accentPillowMat = getLinenOrWoolMaterial(`${namePrefix}.accentFlax`, 0x9aaab2, 'linen', 0.88);
  const cashmereMat = getLinenOrWoolMaterial(`${namePrefix}.cashmereThrow`, 0xe6dfd2, 'cashmere', 0.92);
  const oakMat = getCharacterOakMaterial();
  const brassMat = getAgedBrassMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  const legH = model === 'longIsland' ? 0.045 : 0.145;
  if (model === 'longIsland') {
    // Low concealed oak block feet + relaxed tailored valence skirt (`y = 0.015 .. 0.25`)
    for (const [fTag, sx, sz] of [
      ['FL', -1, 1],
      ['FR', 1, 1],
      ['BL', -1, -1],
      ['BR', 1, -1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.concealedFoot_${fTag}`,
        0.07,
        legH,
        0.07,
        sx * (w * 0.5 - 0.09),
        legH * 0.5,
        sz * (d * 0.5 - 0.09),
        oakMat,
        true
      );
    }
  } else {
    // George turned solid-oak front legs on aged-brass cup castors + splayed oak back legs
    for (const [fTag, sx] of [
      ['FL', -1],
      ['FR', 1],
    ] as const) {
      const lx = sx * (w * 0.5 - 0.1);
      const lz = d * 0.5 - 0.1;
      addNamedCyl(
        root,
        `${namePrefix}.turnedOakLeg_${fTag}`,
        0.029,
        0.019,
        legH - 0.042,
        14,
        lx,
        0.042 + (legH - 0.042) * 0.5,
        lz,
        oakMat,
        true
      );
      addNamedCyl(
        root,
        `${namePrefix}.brassCastorCup_${fTag}`,
        0.021,
        0.017,
        0.022,
        12,
        lx,
        0.031,
        lz,
        brassMat,
        true
      );
      const wheel = addNamedCyl(
        root,
        `${namePrefix}.brassCastorWheel_${fTag}`,
        0.013,
        0.013,
        0.01,
        12,
        lx,
        0.013,
        lz + 0.004,
        brassMat,
        true
      );
      wheel.rotation.z = Math.PI * 0.5;
    }
    for (const [bTag, sx] of [
      ['BL', -1],
      ['BR', 1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.rearOakLeg_${bTag}`,
        0.048,
        legH,
        0.048,
        sx * (w * 0.5 - 0.1),
        legH * 0.5,
        -(d * 0.5 - 0.09),
        oakMat,
        true
      );
    }
  }

  const armW = model === 'longIsland' ? 0.165 : 0.19;
  const backFrameD = 0.175;
  const deckH = 0.155;
  const deckBotY = legH;
  const deckTopY = deckBotY + deckH;
  const innerSpanW = w - armW * 2 - 0.004;
  const seatDeckD = d - backFrameD - 0.004;
  const seatDeckCz = backFrameD * 0.5;

  // Sprung upholstered seat deck strictly between arms and in front of back frame
  const deckMesh = new THREE.Mesh(
    createSculptedCushionGeometry(innerSpanW, deckH, seatDeckD, 8, 4, 6, 0.36, 'standard'),
    mainLinen
  );
  deckMesh.name = `${namePrefix}.upholsteredDeck`;
  deckMesh.position.set(0, deckBotY + deckH * 0.5, seatDeckCz);
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  root.add(deckMesh);

  // Upholstered back frame (`z = -d/2 .. -d/2 + backFrameD`)
  const backFrameH = h - legH - 0.07;
  const backMesh = new THREE.Mesh(
    createSculptedCushionGeometry(innerSpanW, backFrameH, backFrameD, 8, 6, 4, 0.38, 'standard'),
    mainLinen
  );
  backMesh.name = `${namePrefix}.backrestFrame`;
  backMesh.position.set(0, legH + backFrameH * 0.5, -d * 0.5 + backFrameD * 0.5);
  backMesh.castShadow = true;
  backMesh.receiveShadow = true;
  root.add(backMesh);

  // Left & Right arms (`Long Island` slim track/sloped slipcover arm; `George` English roll-arm)
  const armH = model === 'longIsland' ? 0.55 - legH : 0.59 - legH;
  for (const [aTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const ax = sign * (w * 0.5 - armW * 0.5);
    const armMesh = new THREE.Mesh(
      createSculptedCushionGeometry(armW, armH, d - 0.02, 4, 6, 8, 0.42, 'standard'),
      mainLinen
    );
    armMesh.name = `${namePrefix}.armrest${aTag}`;
    armMesh.position.set(ax, legH + armH * 0.5, 0);
    armMesh.castShadow = true;
    armMesh.receiveShadow = true;
    root.add(armMesh);

    const armWelt = createPerimeterWeltLoop(
      armW - 0.016,
      armH - 0.016,
      0.004,
      'XZ',
      weltLinen,
      `${namePrefix}.armWelt${aTag}`
    );
    armWelt.rotation.x = Math.PI * 0.5;
    armWelt.position.set(ax, legH + armH * 0.5, (d - 0.02) * 0.5 + 0.002);
    tagHighLod(armWelt);
    root.add(armWelt);
  }

  // Seat cushions (`Long Island`: 2 deep bench-style cushions; `George`: 3 tailored cushions)
  const seatCount = model === 'longIsland' ? 2 : 3;
  const seatGap = 0.006;
  const seatCushW = (innerSpanW - seatGap * (seatCount + 1)) / seatCount;
  const seatCushH = 0.145;
  const seatCushD = seatDeckD + 0.025;
  const seatCushCy = deckTopY + seatCushH * 0.5 + 0.002;
  const seatCushCz = seatDeckCz + 0.012;

  for (let i = 0; i < seatCount; i++) {
    const cx = -innerSpanW * 0.5 + seatGap + seatCushW * 0.5 + i * (seatCushW + seatGap);
    const sc = new THREE.Mesh(
      createSculptedCushionGeometry(
        seatCushW,
        seatCushH,
        seatCushD,
        8,
        5,
        8,
        0.56,
        'standard',
        false,
        0.012
      ),
      mainLinen
    );
    sc.name = `${namePrefix}.seatCushion_${i + 1}`;
    sc.position.set(cx, seatCushCy, seatCushCz);
    sc.castShadow = true;
    sc.receiveShadow = true;
    root.add(sc);

    const welt = createPerimeterWeltLoop(
      seatCushW - 0.018,
      seatCushD - 0.018,
      0.0038,
      'XZ',
      weltLinen,
      `${namePrefix}.seatCushionWelt_${i + 1}`
    );
    welt.position.set(cx, deckTopY + seatCushH - 0.006, seatCushCz);
    tagHighLod(welt);
    root.add(welt);
  }

  // Back cushions resting above seat cushions and forward of backFrame
  const backCount = seatCount;
  const backCushW = seatCushW - 0.004;
  const backCushH = 0.38;
  const backCushD = 0.165;
  const seatSurfaceY = deckTopY + seatCushH;
  const backCushCy = seatSurfaceY + backCushH * 0.5 - 0.01;
  const backCushCz = -d * 0.5 + backFrameD + backCushD * 0.5 + 0.024;

  for (let i = 0; i < backCount; i++) {
    const cx = -innerSpanW * 0.5 + seatGap + seatCushW * 0.5 + i * (seatCushW + seatGap);
    const bc = new THREE.Mesh(
      createSculptedCushionGeometry(backCushW, backCushH, backCushD, 8, 6, 5, 0.62, 'standard', true),
      mainLinen
    );
    bc.name = `${namePrefix}.backCushion_${i + 1}`;
    bc.rotation.x = -0.14;
    bc.position.set(cx, backCushCy, backCushCz);
    bc.castShadow = true;
    bc.receiveShadow = true;
    root.add(bc);
  }

  // 4 piped linen & ticking-stripe scatter cushions
  const scatterSpecs: readonly [string, number, number, number, number, THREE.Material][] = [
    ['scatterOuterLeft', -innerSpanW * 0.39, 0.09, -0.22, 0.32, accentPillowMat],
    ['scatterInnerLeft', -innerSpanW * 0.25, 0.14, -0.15, 0.16, tickingPillowMat],
    ['scatterInnerRight', innerSpanW * 0.25, 0.14, -0.15, -0.16, tickingPillowMat],
    ['scatterOuterRight', innerSpanW * 0.39, 0.09, -0.22, -0.32, accentPillowMat],
  ];
  for (const [sTag, sx, szOff, rx, ry, sMat] of scatterSpecs) {
    const pMesh = new THREE.Mesh(
      createSculptedCushionGeometry(0.42, 0.4, 0.125, 7, 7, 4, 0.68, 'standard', true),
      sMat
    );
    pMesh.name = `${namePrefix}.${sTag}`;
    pMesh.rotation.set(rx, ry, 0);
    pMesh.position.set(sx, seatSurfaceY + 0.185, backCushCz + szOff + 0.11);
    pMesh.castShadow = true;
    root.add(pMesh);
  }

  // White Company draped cashmere throw over the right arm & seat corner (strictly offset so 0 z-fight!)
  if (opts.includeCashmereThrow ?? true) {
    const throwArmTop = new THREE.Mesh(
      createSculptedCushionGeometry(armW + 0.036, 0.018, 0.46, 5, 2, 6, 0.4, 'standard'),
      cashmereMat
    );
    throwArmTop.name = `${namePrefix}.whiteCoCashmereThrowTop`;
    throwArmTop.position.set(w * 0.5 - armW * 0.5, legH + armH + 0.011, 0.08);
    throwArmTop.castShadow = true;
    root.add(throwArmTop);

    const throwOuterDrop = new THREE.Mesh(
      createSculptedCushionGeometry(0.016, 0.3, 0.45, 2, 5, 6, 0.35, 'standard'),
      cashmereMat
    );
    throwOuterDrop.name = `${namePrefix}.whiteCoCashmereThrowDrop`;
    throwOuterDrop.position.set(w * 0.5 + 0.008, legH + armH - 0.154, 0.08);
    throwOuterDrop.castShadow = true;
    root.add(throwOuterDrop);
  }

  const seatInteractable = new SeatInteractable({
    id: `seat:${namePrefix}`,
    label: model === 'longIsland' ? 'Neptune Long Island Sofa' : 'Neptune George Sofa',
    aliases: ['sit on sofa', 'neptune sofa'],
    anchor: root,
    clickableTargets: collectSeatClickableMeshes(root),
    localSeatPos: [0, seatSurfaceY, seatCushCz],
    localFootOffset: [0, 0, d * 0.5 + 0.48],
    localForward: [0, 0, 1],
    seatedEyeHeightM: 0.71,
    proximityRadiusM: 1.25,
    material: 'linen',
  });
  root.userData.seatInteractable = seatInteractable;
  if (opts.interactions) {
    opts.interactions.registerAnimatedInteractable(seatInteractable);
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: model === 'longIsland' ? 'Neptune Long Island 3-Seater Linen Sofa' : 'Neptune George 3-Seater Tailored Sofa',
    brand: 'Neptune',
    collection: model === 'longIsland' ? 'Long Island' : 'George',
    sku: model === 'longIsland' ? 'NEP-LIS-SOF-3S' : 'NEP-GEO-SOF-3S',
    finish: 'Pale Oat Tailored Belgian Linen & Smoked Oak',
    category: 'furniture',
    dimensionsMm: mmFromMetres(w, d, h),
    productUrl: `https://www.neptune.com/uk/living/sofas/${model === 'longIsland' ? 'long-island' : 'george'}/`,
    schematicUrl: 'https://www.neptune.com/uk/living/sofas/dimensions-guide.pdf',
  });
}

export type NeptuneArmchairModel = 'olivia' | 'casey';

export interface NeptuneArmchairOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly model?: NeptuneArmchairModel;
  /** Upholstery colour (default `'flaxBlue'` `#B3C4CC` for Olivia, `'moss'` `#9FA59F` for Casey). */
  readonly fabricColor?: THREE.ColorRepresentation;
  readonly interactions?: InteractionRegistry;
}

/**
 * Neptune *Olivia* (`860 x 1050 x 880 mm` deep English roll-arm lounge armchair) &
 * *Casey* (`710 x 810 x 820 mm` compact bedroom/snug accent chair) in *Flax Blue* (`#B3C4CC`) or
 * *Moss* (`#9FA59F`) washed linen with turned solid-oak legs, aged-brass front castors & `SeatInteractable`.
 */
export function buildNeptuneArmchair(opts: NeptuneArmchairOptions = {}): THREE.Group {
  const model = opts.model ?? 'olivia';
  const namePrefix = opts.name ?? (model === 'olivia' ? 'neptuneOliviaArmchair' : 'neptuneCaseyArmchair');
  const w = model === 'olivia' ? 0.86 : 0.71;
  const d = model === 'olivia' ? 1.05 : 0.81;
  const h = model === 'olivia' ? 0.88 : 0.82;
  const defaultHex = model === 'olivia' ? 0xb3c4cc : 0x9fa59f;

  const linenMat = getLinenOrWoolMaterial(
    `${namePrefix}.linen`,
    opts.fabricColor ?? defaultHex,
    'linen',
    0.88
  );
  const cushionPillowMat = getLinenOrWoolMaterial(`${namePrefix}.lumbar`, 0xe2dcd0, 'ticking', 0.87);
  const oakMat = getCharacterOakMaterial();
  const brassMat = getAgedBrassMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  const legH = 0.155;
  // Turned oak front legs + aged brass cup castors; splayed oak rear legs
  for (const [fTag, sx] of [
    ['FL', -1],
    ['FR', 1],
  ] as const) {
    const lx = sx * (w * 0.5 - 0.085);
    const lz = d * 0.5 - 0.095;
    addNamedCyl(
      root,
      `${namePrefix}.frontOakLeg_${fTag}`,
      0.026,
      0.017,
      legH - 0.038,
      14,
      lx,
      0.038 + (legH - 0.038) * 0.5,
      lz,
      oakMat,
      true
    );
    addNamedCyl(
      root,
      `${namePrefix}.brassCastor_${fTag}`,
      0.019,
      0.014,
      0.038,
      12,
      lx,
      0.019,
      lz,
      brassMat,
      true
    );
  }
  for (const [bTag, sx] of [
    ['BL', -1],
    ['BR', 1],
  ] as const) {
    const rLeg = addNamedBox(
      root,
      `${namePrefix}.rearOakLeg_${bTag}`,
      0.042,
      legH + 0.01,
      0.042,
      sx * (w * 0.5 - 0.085),
      legH * 0.5,
      -(d * 0.5 - 0.085),
      oakMat,
      true
    );
    rLeg.rotation.x = -0.12;
  }

  const armW = model === 'olivia' ? 0.145 : 0.095;
  const backD = 0.16;
  const deckH = 0.145;
  const innerW = w - armW * 2 - 0.004;
  const seatDeckD = d - backD - 0.004;
  const seatDeckCz = backD * 0.5;

  const deck = new THREE.Mesh(
    createSculptedCushionGeometry(innerW, deckH, seatDeckD, 6, 4, 6, 0.36, 'standard'),
    linenMat
  );
  deck.name = `${namePrefix}.seatDeck`;
  deck.position.set(0, legH + deckH * 0.5, seatDeckCz);
  deck.castShadow = true;
  root.add(deck);

  const backFrameH = h - legH;
  const backMesh = new THREE.Mesh(
    createSculptedCushionGeometry(innerW, backFrameH, backD, 6, 6, 4, 0.42, 'standard'),
    linenMat
  );
  backMesh.name = `${namePrefix}.backrest`;
  backMesh.position.set(0, legH + backFrameH * 0.5, -d * 0.5 + backD * 0.5);
  backMesh.castShadow = true;
  root.add(backMesh);

  const armH = (model === 'olivia' ? 0.6 : 0.57) - legH;
  for (const [aTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const arm = new THREE.Mesh(
      createSculptedCushionGeometry(armW, armH, d - 0.03, 4, 5, 7, 0.44, 'standard'),
      linenMat
    );
    arm.name = `${namePrefix}.armrest${aTag}`;
    arm.position.set(sign * (w * 0.5 - armW * 0.5), legH + armH * 0.5, 0);
    arm.castShadow = true;
    root.add(arm);
  }

  const seatCushH = 0.14;
  const seatSurfaceY = legH + deckH + seatCushH;
  const seatCush = new THREE.Mesh(
    createSculptedCushionGeometry(
      innerW - 0.008,
      seatCushH,
      seatDeckD + 0.02,
      7,
      5,
      7,
      0.58,
      'standard'
    ),
    linenMat
  );
  seatCush.name = `${namePrefix}.seatCushion`;
  seatCush.position.set(0, legH + deckH + seatCushH * 0.5 + 0.002, seatDeckCz + 0.01);
  seatCush.castShadow = true;
  root.add(seatCush);

  const backCushH = model === 'olivia' ? 0.42 : 0.36;
  const backCush = new THREE.Mesh(
    createSculptedCushionGeometry(innerW - 0.018, backCushH, 0.15, 7, 6, 4, 0.62, 'standard', true),
    linenMat
  );
  backCush.name = `${namePrefix}.backCushion`;
  backCush.rotation.x = -0.14;
  backCush.position.set(0, seatSurfaceY + backCushH * 0.5 - 0.01, -d * 0.5 + backD + 0.1);
  backCush.castShadow = true;
  root.add(backCush);

  const lumbar = new THREE.Mesh(
    createSculptedCushionGeometry(innerW * 0.68, 0.24, 0.1, 6, 5, 4, 0.65, 'standard', true),
    cushionPillowMat
  );
  lumbar.name = `${namePrefix}.lumbarPillow`;
  lumbar.rotation.x = -0.18;
  lumbar.position.set(0, seatSurfaceY + 0.125, -d * 0.5 + backD + 0.23);
  lumbar.castShadow = true;
  root.add(lumbar);

  const seatInteractable = new SeatInteractable({
    id: `seat:${namePrefix}`,
    label: model === 'olivia' ? 'Neptune Olivia Armchair' : 'Neptune Casey Armchair',
    aliases: ['sit on armchair', 'neptune armchair'],
    anchor: root,
    clickableTargets: collectSeatClickableMeshes(root),
    localSeatPos: [0, seatSurfaceY, seatDeckCz + 0.02],
    localFootOffset: [0, 0, d * 0.5 + 0.46],
    localForward: [0, 0, 1],
    seatedEyeHeightM: 0.71,
    proximityRadiusM: 0.95,
    material: 'linen',
  });
  root.userData.seatInteractable = seatInteractable;
  if (opts.interactions) {
    opts.interactions.registerAnimatedInteractable(seatInteractable);
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: model === 'olivia' ? 'Neptune Olivia Roll-Arm Linen Armchair' : 'Neptune Casey Show-Wood Armchair',
    brand: 'Neptune',
    collection: model === 'olivia' ? 'Olivia' : 'Casey',
    sku: model === 'olivia' ? 'NEP-OLI-ARM' : 'NEP-CAS-ARM',
    finish: 'Flax Blue / Sage Belgian Linen & Character Oak',
    category: 'furniture',
    dimensionsMm: mmFromMetres(w, d, h),
    productUrl: 'https://www.neptune.com/uk/living/armchairs/',
    schematicUrl: 'https://www.neptune.com/uk/living/armchairs/specification.pdf',
  });
}

export interface NeptuneArundelDiningSetOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly tableLengthM?: number;
  readonly tableWidthM?: number;
  readonly chairStyle?: 'wardley' | 'suffolk';
  readonly includeChairs?: boolean;
  readonly interactions?: InteractionRegistry;
}

/**
 * Neptune *Arundel* solid Character Oak A-frame trestle dining table (`2000 x 950 x 740 mm`,
 * dark-iron stretcher tie rod, linen table runner + White Company brass/glass hurricane centrepiece)
 * paired with 6 *Wardley* / *Suffolk* oak dining chairs (`470 x 560 x 930 mm`, piped linen seat pads, `SeatInteractable`).
 */
export function buildNeptuneArundelDiningSet(
  opts: NeptuneArundelDiningSetOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'neptuneArundelDiningSet';
  const tableL = opts.tableLengthM ?? 2.0;
  const tableW = opts.tableWidthM ?? 0.95;
  const tableH = 0.74;
  const chairStyle = opts.chairStyle ?? 'wardley';
  const oakMat = getCharacterOakMaterial();
  const ironMat = getMatteCastIronMaterial(0x232528);
  const brassMat = getAgedBrassMaterial();
  const runnerMat = getLinenOrWoolMaterial(`${namePrefix}.runner`, 0xe4ddd0, 'linen', 0.89);
  const padMat = getLinenOrWoolMaterial(`${namePrefix}.seatPad`, 0xdad1c2, 'linen', 0.87);

  const root = new THREE.Group();
  root.name = namePrefix;

  const topT = 0.044;
  const topBotY = tableH - topT;

  // Solid 4-plank Character Oak breadboard-ended tabletop (`2000 x 950 x 44 mm`)
  const breadboardW = 0.11;
  const plankSpanL = tableL - breadboardW * 2 - 0.004;
  const nPlanks = 4;
  const plankW = tableW / nPlanks;
  for (let p = 0; p < nPlanks; p++) {
    addNamedBox(
      root,
      `${namePrefix}.tableTopPlank_${p + 1}`,
      plankSpanL,
      topT,
      plankW - 0.0025,
      0,
      tableH - topT * 0.5,
      -tableW * 0.5 + (p + 0.5) * plankW,
      oakMat
    );
  }
  for (const [eTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.breadboardEnd${eTag}`,
      breadboardW,
      topT,
      tableW,
      sign * (tableL * 0.5 - breadboardW * 0.5),
      tableH - topT * 0.5,
      0,
      oakMat
    );
  }

  // Twin A-frame Character Oak trestle pedestals + dark-iron stretcher tie rod
  const trestleOffset = tableL * 0.5 - 0.34;
  for (const [tTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const tx = sign * trestleOffset;
    // Bottom sleigh foot bar & top bearer bar
    addNamedBox(
      root,
      `${namePrefix}.trestleFootBearer${tTag}`,
      0.095,
      0.068,
      tableW * 0.78,
      tx,
      0.034,
      0,
      oakMat
    );
    addNamedBox(
      root,
      `${namePrefix}.trestleTopBearer${tTag}`,
      0.095,
      0.064,
      tableW * 0.72,
      tx,
      topBotY - 0.032,
      0,
      oakMat
    );
    // Angled A-frame legs strictly between foot bearer and top bearer
    const legSpanY = topBotY - 0.132;
    for (const [lSide, sz] of [
      ['Front', 1],
      ['Back', -1],
    ] as const) {
      const leg = addNamedBox(
        root,
        `${namePrefix}.trestleAFrameLeg_${tTag}_${lSide}`,
        0.082,
        legSpanY + 0.02,
        0.082,
        tx,
        0.068 + legSpanY * 0.5,
        sz * (tableW * 0.19),
        oakMat
      );
      leg.rotation.x = -sz * 0.24;
    }
    // Cross tie beam at mid-height
    addNamedBox(
      root,
      `${namePrefix}.trestleCrossBeam${tTag}`,
      0.072,
      0.065,
      tableW * 0.3,
      tx,
      0.26,
      0,
      oakMat
    );
  }

  // Dark-iron longitudinal stretcher tie rod & forged end turnbuckles (`y = 0.26`)
  const ironRod = addNamedCyl(
    root,
    `${namePrefix}.ironStretcherTieRod`,
    0.012,
    0.012,
    trestleOffset * 2 + 0.22,
    14,
    0,
    0.26,
    0,
    ironMat
  );
  ironRod.rotation.z = Math.PI * 0.5;
  addNamedCyl(
    root,
    `${namePrefix}.ironCenterTurnbuckle`,
    0.02,
    0.02,
    0.11,
    12,
    0,
    0.26,
    0,
    ironMat,
    true
  ).rotation.z = Math.PI * 0.5;

  // Washed-linen table runner + White Company glass & brass hurricane centrepiece
  addNamedBox(
    root,
    `${namePrefix}.linenTableRunner`,
    tableL * 0.78,
    0.004,
    0.34,
    0,
    tableH + 0.0025,
    0,
    runnerMat
  );
  addWhiteCompanyGlassHurricane(
    root,
    `${namePrefix}.whiteCoHurricaneCentrepiece`,
    0,
    tableH + 0.005,
    0,
    0.18,
    0.32
  );

  // 6 Wardley / Suffolk dining chairs (`470 x 560 x 930 mm`, 3 on -Z side, 3 on +Z side)
  const seatInteractables: SeatInteractable[] = [];
  if (opts.includeChairs ?? true) {
    const chairW = 0.47;
    const chairD = 0.56;
    const chairH = 0.93;
    const seatH = 0.46;
    const chairPaintMat =
      chairStyle === 'suffolk'
        ? getPaintedJoineryMaterial(0xd5d4ca, 0.52, `${namePrefix}.suffolkChairPaint`)
        : oakMat;

    const chairPlacements: readonly [string, number, number, number][] = [
      ['chairNorth_1', -0.58, -(tableW * 0.5 + 0.16), 0],
      ['chairNorth_2', 0, -(tableW * 0.5 + 0.16), 0],
      ['chairNorth_3', 0.58, -(tableW * 0.5 + 0.16), 0],
      ['chairSouth_1', -0.58, tableW * 0.5 + 0.16, Math.PI],
      ['chairSouth_2', 0, tableW * 0.5 + 0.16, Math.PI],
      ['chairSouth_3', 0.58, tableW * 0.5 + 0.16, Math.PI],
    ];

    chairPlacements.forEach(([cTag, cx, cz, rotY], idx) => {
      const cg = new THREE.Group();
      cg.name = `${namePrefix}.${cTag}`;
      cg.position.set(cx, 0, cz);
      cg.rotation.y = rotY;
      root.add(cg);

      const legS = 0.036;
      // Front legs (`y = 0 .. seatH - 0.024`)
      for (const [fSide, sx] of [
        ['FL', -1],
        ['FR', 1],
      ] as const) {
        addNamedBox(
          cg,
          `${cg.name}.frontLeg_${fSide}`,
          legS,
          seatH - 0.024,
          legS,
          sx * (chairW * 0.5 - legS * 0.5 - 0.01),
          (seatH - 0.024) * 0.5,
          chairD * 0.5 - legS * 0.5 - 0.01,
          chairPaintMat,
          true
        );
      }
      // Full-height back stiles (`y = 0 .. chairH`)
      for (const [bSide, sx] of [
        ['BL', -1],
        ['BR', 1],
      ] as const) {
        addNamedBox(
          cg,
          `${cg.name}.backStile_${bSide}`,
          legS,
          chairH,
          legS,
          sx * (chairW * 0.5 - legS * 0.5 - 0.01),
          chairH * 0.5,
          -(chairD * 0.5 - legS * 0.5),
          chairPaintMat
        );
      }
      // Seat rails & solid oak seat board (`y = seatH - 0.024 .. seatH`)
      addNamedBox(
        cg,
        `${cg.name}.oakSeatBoard`,
        chairW - 0.008,
        0.024,
        chairD - 0.02,
        0,
        seatH - 0.012,
        0.008,
        oakMat
      );
      // H-stretcher rails
      for (const [sSide, sx] of [
        ['L', -1],
        ['R', 1],
      ] as const) {
        addNamedBox(
          cg,
          `${cg.name}.sideStretcher_${sSide}`,
          0.02,
          0.024,
          chairD - legS * 2 - 0.02,
          sx * (chairW * 0.5 - legS * 0.5 - 0.01),
          0.14,
          0,
          chairPaintMat,
          true
        );
      }

      // Piped linen seat pad (`H 36 mm`)
      const padMesh = new THREE.Mesh(
        createSculptedCushionGeometry(chairW - 0.036, 0.036, chairD - 0.075, 6, 3, 6, 0.48, 'standard'),
        padMat
      );
      padMesh.name = `${cg.name}.linenSeatPad`;
      padMesh.position.set(0, seatH + 0.019, 0.022);
      padMesh.castShadow = true;
      cg.add(padMesh);

      // Backrest: Wardley upholstered linen panel w/ brass handle on crest, or Suffolk ladder/cross-back slats
      const crestW = chairW - legS * 2 - 0.02;
      addNamedBox(
        cg,
        `${cg.name}.crestRail`,
        crestW,
        0.068,
        0.024,
        0,
        chairH - 0.044,
        -(chairD * 0.5 - legS * 0.5),
        chairPaintMat,
        true
      );
      if (chairStyle === 'wardley') {
        const backPad = new THREE.Mesh(
          createSculptedCushionGeometry(crestW - 0.016, 0.31, 0.038, 5, 5, 3, 0.45, 'standard'),
          padMat
        );
        backPad.name = `${cg.name}.wardleyUpholsteredBack`;
        backPad.position.set(0, seatH + 0.25, -(chairD * 0.5 - legS * 0.5));
        backPad.castShadow = true;
        cg.add(backPad);
        // Signature Wardley aged-brass pull bar on rear of crest rail
        const pull = addNamedCyl(
          cg,
          `${cg.name}.wardleyRearBrassPull`,
          0.005,
          0.005,
          0.11,
          10,
          0,
          chairH - 0.044,
          -(chairD * 0.5 + 0.014),
          brassMat,
          true
        );
        pull.rotation.z = Math.PI * 0.5;
      } else {
        for (let sl = 0; sl < 3; sl++) {
          addNamedBox(
            cg,
            `${cg.name}.suffolkBackSlat_${sl + 1}`,
            0.038,
            0.34,
            0.016,
            (sl - 1) * 0.1,
            seatH + 0.24,
            -(chairD * 0.5 - legS * 0.5),
            chairPaintMat,
            true
          );
        }
      }

      const seat = new SeatInteractable({
        id: `seat:${namePrefix}.chair_${idx + 1}`,
        label: `Neptune ${chairStyle === 'wardley' ? 'Wardley' : 'Suffolk'} Dining Chair`,
        aliases: ['sit at dining table', 'dining chair'],
        anchor: cg,
        clickableTargets: collectSeatClickableMeshes(cg),
        localSeatPos: [0, seatH + 0.038, 0.02],
        localFootOffset: [0, 0, -chairD * 0.5 - 0.36],
        localForward: [0, 0, 1],
        seatedEyeHeightM: 0.72,
        proximityRadiusM: 0.85,
        material: 'linen',
      });
      cg.userData.seatInteractable = seat;
      seatInteractables.push(seat);
      if (opts.interactions) {
        opts.interactions.registerAnimatedInteractable(seat);
      }
    });
  }

  root.userData.seatInteractables = seatInteractables;
  if (seatInteractables[0]) {
    root.userData.seatInteractable = seatInteractables[0];
  }
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Neptune Arundel Trestle Oak Dining Table & Chairs',
    brand: 'Neptune',
    collection: 'Arundel',
    sku: `NEP-ARU-TBL-${Math.round(tableL * 1000)}`,
    finish: 'Character Solid Oak, Cast-Iron Tie-Rod & Tailored Linen',
    category: 'furniture',
    dimensionsMm: mmFromMetres(tableL, tableW, tableH),
    productUrl: 'https://www.neptune.com/uk/dining/dining-tables/arundel/',
    schematicUrl: 'https://www.neptune.com/uk/dining/dining-tables/arundel/specification.pdf',
  });
}

export interface NeptuneChichesterGlazedDresserOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Paint colour (default Neptune *Shingle* `#D5D4CA`). */
  readonly paintColor?: THREE.ColorRepresentation;
  readonly widthM?: number;
  readonly depthM?: number;
  readonly heightM?: number;
}

/**
 * `1320 x 490 x 2090 mm` Neptune *Chichester* 4ft glazed Welsh dresser:
 * - Painted *Shingle* (`#D5D4CA`) cock-beaded lower sideboard (`H 880 mm`) w/ `30 mm` solid Character Oak counter,
 *   2 interactive dovetail cutlery drawers (*Barlow* cup pulls) & 2 interactive Shaker cupboard doors (*Mushroom* knobs)
 * - Astragal-glazed 6-pane upper display cabinet (`D 360 mm`) w/ T&G solid-oak interior back, ogee crown cornice,
 *   and 3 grooved plate shelves stocked with stoneware dinner plates, bowls & lead-free crystal Bordeaux wine glasses.
 */
export function buildNeptuneChichesterGlazedDresser(
  ctx: CatalogInteractionContext = null,
  opts: NeptuneChichesterGlazedDresserOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'neptuneChichesterDresser';
  const w = opts.widthM ?? 1.32;
  const baseD = opts.depthM ?? 0.49;
  const totalH = opts.heightM ?? 2.09;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xd5d4ca,
    0.52,
    `${namePrefix}.shinglePaint`
  );
  const oakMat = getCharacterOakMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const barware = getBarwareMaterialSuite();
  const registry = resolveRegistry(ctx);

  const root = new THREE.Group();
  root.name = namePrefix;

  const plinthH = 0.105;
  const counterT = 0.03;
  const baseTopY = 0.88;
  const carcassTopY = baseTopY - counterT;
  const frameT = 0.024;
  const stileW = 0.034;
  const doorT = 0.022;
  const baseFrontZ = baseD * 0.5;
  const rearZ = -baseD * 0.5;

  // Chichester ogee skirting plinth
  addNamedBox(
    root,
    `${namePrefix}.ogeePlinth`,
    w + 0.012,
    plinthH,
    baseD - 0.016,
    0,
    plinthH * 0.5,
    0.008,
    paintMat
  );

  // Base carcass walls & internal shelf
  const baseBodyH = carcassTopY - plinthH;
  const baseBodyMidY = plinthH + baseBodyH * 0.5;
  const wallT = 0.022;
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.baseSide${sTag}`,
      wallT,
      baseBodyH,
      baseD - frameT,
      sign * (w * 0.5 - wallT * 0.5),
      baseBodyMidY,
      -frameT * 0.5,
      paintMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.baseBack`,
    w - wallT * 2,
    baseBodyH,
    0.018,
    0,
    baseBodyMidY,
    rearZ + 0.009,
    oakMat
  );
  addNamedBox(
    root,
    `${namePrefix}.baseInternalShelf`,
    w - wallT * 2 - 0.004,
    0.02,
    baseD - frameT - 0.05,
    0,
    plinthH + baseBodyH * 0.36,
    -0.01,
    oakMat
  );

  // Base cock-beaded face-frame: 2 upper drawers + 2 lower cupboard doors
  const fz = baseFrontZ - frameT * 0.5;
  const innerSpanW = w - stileW * 2;
  const colW = (innerSpanW - stileW) * 0.5;

  for (const [sTag, sx] of [
    ['Left', -(w * 0.5 - stileW * 0.5)],
    ['Center', 0],
    ['Right', w * 0.5 - stileW * 0.5],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.baseStile${sTag}`,
      stileW,
      baseBodyH,
      frameT,
      sx,
      baseBodyMidY,
      fz,
      paintMat
    );
  }

  const drawerH = 0.165;
  const doorH = baseBodyH - stileW * 3 - drawerH;
  const drawerCy = carcassTopY - stileW - drawerH * 0.5;
  const doorCy = plinthH + stileW + doorH * 0.5;

  let leftBaseDoorPivot: THREE.Object3D | null = null;
  let rightBaseDoorPivot: THREE.Object3D | null = null;

  for (const [cTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const cx = sign * (stileW * 0.5 + colW * 0.5);
    addNamedBox(
      root,
      `${namePrefix}.baseRailTop${cTag}`,
      colW,
      stileW,
      frameT,
      cx,
      carcassTopY - stileW * 0.5,
      fz,
      paintMat
    );
    addNamedBox(
      root,
      `${namePrefix}.baseRailMid${cTag}`,
      colW,
      stileW,
      frameT,
      cx,
      carcassTopY - stileW - drawerH - stileW * 0.5,
      fz,
      paintMat
    );
    addNamedBox(
      root,
      `${namePrefix}.baseRailBottom${cTag}`,
      colW,
      stileW,
      frameT,
      cx,
      plinthH + stileW * 0.5,
      fz,
      paintMat
    );

    // Interactive drawer
    addCockBeadApertureTrim(
      root,
      `${namePrefix}.drawerBead${cTag}`,
      cx,
      drawerCy,
      baseFrontZ,
      colW,
      drawerH,
      paintMat
    );
    const drGroup = new THREE.Group();
    drGroup.name = `${namePrefix}.cutleryDrawer${cTag}`;
    drGroup.position.set(cx, drawerCy, baseFrontZ - doorT * 0.5 - 0.001);
    root.add(drGroup);

    drGroup.add(
      buildShakerDoorAssembly(`${drGroup.name}.front`, colW - 0.008, drawerH - 0.008, doorT, paintMat, 0.038)
    );
    const pull = buildAgedBrassBarlowCupPull(`${drGroup.name}.cupPull`);
    pull.position.set(0, 0, doorT * 0.5 + 0.001);
    drGroup.add(pull);
    attachDrawerBoxBehindFront(drGroup, colW - 0.02, drawerH - 0.012, baseD - 0.1, '+z', false);
    wireCatalogSlidingDrawer(registry, {
      drawer: drGroup,
      slideDelta: [0, 0, 0.34],
      label: 'Open Dresser Cutlery Drawer',
    });

    // Interactive lower Shaker door
    addCockBeadApertureTrim(
      root,
      `${namePrefix}.doorBead${cTag}`,
      cx,
      doorCy,
      baseFrontZ,
      colW,
      doorH,
      paintMat
    );
    const dGroup = new THREE.Group();
    dGroup.name = `${namePrefix}.baseDoor${cTag}`;
    dGroup.position.set(cx, doorCy, baseFrontZ - doorT * 0.5 - 0.001);
    root.add(dGroup);

    dGroup.add(
      buildShakerDoorAssembly(`${dGroup.name}.panel`, colW - 0.008, doorH - 0.008, doorT, paintMat, 0.048)
    );
    const knob = buildAgedBrassMushroomKnob(`${dGroup.name}.knob`);
    knob.position.set(-sign * (colW * 0.5 - 0.034), doorH * 0.5 - 0.068, doorT * 0.5 + 0.001);
    dGroup.add(knob);
    const pivot = wireCatalogHingedDoor(registry, {
      parent: root,
      door: dGroup,
      hingeOffset: [sign * (colW * 0.5 - 0.01), 0, 0],
      axis: 'y',
      openAngle: sign < 0 ? -Math.PI * 0.58 : Math.PI * 0.58,
      label: 'Open Dresser Base Doors',
      linkGroup: 'dresserBaseDoors',
    });
    if (sign < 0) leftBaseDoorPivot = pivot;
    else rightBaseDoorPivot = pivot;
  }
  if (registry && leftBaseDoorPivot && rightBaseDoorPivot) {
    registry.linkDoorPair(leftBaseDoorPivot, rightBaseDoorPivot);
  }

  // 30 mm solid Character Oak counter (`y = carcassTopY .. baseTopY`)
  addNamedBox(
    root,
    `${namePrefix}.characterOakCounter`,
    w + 0.032,
    counterT,
    baseD + 0.024,
    0,
    carcassTopY + counterT * 0.5,
    0.012,
    oakMat
  );

  // Upper astragal-glazed hutch (`D = 0.36 m`, aligned to rearZ so 130 mm oak counter ledge remains exposed in front)
  const upperD = Math.min(0.36, baseD - 0.11);
  const upperFrontZ = rearZ + upperD;
  const crownH = 0.065;
  const upperBodyH = totalH - baseTopY - crownH;
  const upperMidY = baseTopY + upperBodyH * 0.5;

  // T&G solid-oak interior back boards (`z = rearZ + 0.012`)
  const innerUpperW = w - wallT * 2 - 0.02;
  const nOakBoards = Math.max(9, Math.round(innerUpperW / 0.1));
  const oakBoardPitch = innerUpperW / nOakBoards;
  for (let b = 0; b < nOakBoards; b++) {
    addNamedBox(
      root,
      `${namePrefix}.upperOakTgBack_${b + 1}`,
      oakBoardPitch - 0.003,
      upperBodyH - 0.024,
      0.018,
      -innerUpperW * 0.5 + (b + 0.5) * oakBoardPitch,
      upperMidY,
      rearZ + 0.012,
      oakMat
    );
  }

  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.upperCheek${sTag}`,
      wallT,
      upperBodyH,
      upperD - frameT,
      sign * (w * 0.5 - 0.01 - wallT * 0.5),
      upperMidY,
      rearZ + (upperD - frameT) * 0.5,
      paintMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.upperCeiling`,
    innerUpperW,
    0.02,
    upperD - frameT - 0.024,
    0,
    baseTopY + upperBodyH - 0.01,
    rearZ + 0.022 + (upperD - frameT - 0.024) * 0.5,
    oakMat
  );

  // Ogee crown cornice
  addNamedBox(
    root,
    `${namePrefix}.crownCornice`,
    w + 0.056,
    crownH,
    upperD + 0.04,
    0,
    totalH - crownH * 0.5,
    rearZ + (upperD + 0.04) * 0.5,
    paintMat
  );

  // 3 grooved solid-oak plate shelves stocked w/ stoneware dinner plates, bowls & crystal Bordeaux wine glasses
  const shelfD = upperD - frameT - 0.045;
  const shelfZ = rearZ + 0.024 + shelfD * 0.5;
  for (let s = 0; s < 3; s++) {
    const sy = baseTopY + ((s + 1) / 4) * upperBodyH;
    addNamedBox(
      root,
      `${namePrefix}.groovedPlateShelf_${s + 1}`,
      innerUpperW - 0.004,
      0.022,
      shelfD,
      0,
      sy,
      shelfZ,
      oakMat
    );

    const surfY = sy + 0.0115;
    if (s === 0) {
      // Bottom shelf: stacked stoneware bowls + 6 lead-free crystal Bordeaux wine glasses
      for (let st = 0; st < 3; st++) {
        addNamedCyl(
          root,
          `${namePrefix}.stonewareBowl_${st + 1}`,
          0.082,
          0.048,
          0.052,
          18,
          -innerUpperW * 0.28,
          surfY + 0.026 + st * 0.032,
          shelfZ,
          barware.stonewareCreamGlaze,
          true
        );
      }
      for (let g = 0; g < 5; g++) {
        const gx = 0.06 + g * 0.095;
        addNamedCyl(
          root,
          `${namePrefix}.bordeauxFoot_${g + 1}`,
          0.036,
          0.038,
          0.004,
          14,
          gx,
          surfY + 0.002,
          shelfZ + 0.01,
          barware.crystalGlass,
          true
        );
        addNamedCyl(
          root,
          `${namePrefix}.bordeauxStem_${g + 1}`,
          0.0035,
          0.004,
          0.095,
          10,
          gx,
          surfY + 0.052,
          shelfZ + 0.01,
          barware.crystalGlass,
          true
        );
        addNamedCyl(
          root,
          `${namePrefix}.bordeauxBowl_${g + 1}`,
          0.038,
          0.022,
          0.105,
          16,
          gx,
          surfY + 0.152,
          shelfZ + 0.01,
          barware.crystalGlass,
          true
        );
      }
    } else {
      // Shelves 2 & 3: Upright stoneware dinner plates leaning in the plate groove against the oak T&G back
      const plateCount = 4;
      for (let p = 0; p < plateCount; p++) {
        const px = -innerUpperW * 0.36 + p * (innerUpperW * 0.24);
        const plate = addNamedCyl(
          root,
          `${namePrefix}.displayDinnerPlate_${s + 1}_${p + 1}`,
          0.125,
          0.118,
          0.016,
          22,
          px,
          surfY + 0.124,
          rearZ + 0.052,
          p % 2 === 0 ? barware.stonewareCreamGlaze : barware.stonewareOatmeal,
          true
        );
        plate.rotation.x = Math.PI * 0.5 - 0.14;
      }
    }
  }

  // Upper cock-beaded face-frame + linked interactive 6-pane astragal-glazed double doors
  const upperW = w - 0.02;
  const upperOpenW = upperW - stileW * 2;
  const upperOpenH = upperBodyH - stileW * 2;
  const upperOpenCy = baseTopY + stileW + upperOpenH * 0.5;
  const ufz = upperFrontZ - frameT * 0.5;

  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.upperFrameStile${sTag}`,
      stileW,
      upperBodyH,
      frameT,
      sign * (upperW * 0.5 - stileW * 0.5),
      upperMidY,
      ufz,
      paintMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.upperFrameRailTop`,
    upperOpenW,
    stileW,
    frameT,
    0,
    baseTopY + upperBodyH - stileW * 0.5,
    ufz,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.upperFrameRailBottom`,
    upperOpenW,
    stileW,
    frameT,
    0,
    baseTopY + stileW * 0.5,
    ufz,
    paintMat
  );
  addCockBeadApertureTrim(
    root,
    `${namePrefix}.upperBead`,
    0,
    upperOpenCy,
    upperFrontZ,
    upperOpenW,
    upperOpenH,
    paintMat
  );

  const uLeafW = (upperOpenW - 0.012) * 0.5;
  const uLeafH = upperOpenH - 0.008;
  const doorStile = 0.046;
  let leftUpperPivot: THREE.Object3D | null = null;
  let rightUpperPivot: THREE.Object3D | null = null;

  for (const [dTag, sign] of [
    ['upperDoorLeft', -1],
    ['upperDoorRight', 1],
  ] as const) {
    const dg = new THREE.Group();
    dg.name = `${namePrefix}.${dTag}`;
    dg.position.set(sign * (uLeafW * 0.5 + 0.002), upperOpenCy, upperFrontZ - doorT * 0.5 - 0.001);
    root.add(dg);

    // Outer door stiles & rails (disjoint)
    addNamedBox(dg, `${dg.name}.stileL`, doorStile, uLeafH, doorT, -(uLeafW * 0.5 - doorStile * 0.5), 0, 0, paintMat);
    addNamedBox(dg, `${dg.name}.stileR`, doorStile, uLeafH, doorT, uLeafW * 0.5 - doorStile * 0.5, 0, 0, paintMat);
    const gSpanW = uLeafW - doorStile * 2;
    const gSpanH = uLeafH - doorStile * 2;
    addNamedBox(dg, `${dg.name}.railTop`, gSpanW, doorStile, doorT, 0, uLeafH * 0.5 - doorStile * 0.5, 0, paintMat);
    addNamedBox(dg, `${dg.name}.railBottom`, gSpanW, doorStile, doorT, 0, -(uLeafH * 0.5 - doorStile * 0.5), 0, paintMat);

    // Clear glass sheet (`z = 0`, 4 mm thick) + non-overlapping astragal glazing bars (`2 cols x 3 rows = 6 panes` per door!)
    addNamedBox(dg, `${dg.name}.glassSheet`, gSpanW, gSpanH, 0.004, 0, 0, 0, glassMat);
    // Vertical astragal bar (`z` proud on front & back of glass without intersecting horizontal bars!)
    addNamedBox(dg, `${dg.name}.astragalVert`, 0.016, gSpanH, 0.014, 0, 0, 0.005, paintMat, true);
    for (const [hIdx, hy] of [
      [1, gSpanH / 6],
      [2, -gSpanH / 6],
    ] as const) {
      const halfBarW = (gSpanW - 0.018) * 0.5;
      addNamedBox(dg, `${dg.name}.astragalHorizL_${hIdx}`, halfBarW, 0.016, 0.014, -(halfBarW * 0.5 + 0.009), hy, 0.005, paintMat, true);
      addNamedBox(dg, `${dg.name}.astragalHorizR_${hIdx}`, halfBarW, 0.016, 0.014, halfBarW * 0.5 + 0.009, hy, 0.005, paintMat, true);
    }

    const knob = buildAgedBrassMushroomKnob(`${dg.name}.knob`);
    knob.position.set(-sign * (uLeafW * 0.5 - 0.024), -0.18, doorT * 0.5 + 0.001);
    dg.add(knob);

    const pivot = wireCatalogHingedDoor(registry, {
      parent: root,
      door: dg,
      hingeOffset: [sign * (uLeafW * 0.5 - 0.01), 0, 0],
      axis: 'y',
      openAngle: sign < 0 ? -Math.PI * 0.58 : Math.PI * 0.58,
      label: 'Open Glazed Display Doors',
      linkGroup: 'dresserUpperDoors',
    });
    if (sign < 0) leftUpperPivot = pivot;
    else rightUpperPivot = pivot;
  }
  if (registry && leftUpperPivot && rightUpperPivot) {
    registry.linkDoorPair(leftUpperPivot, rightUpperPivot);
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Neptune Chichester 4ft Glazed Display Dresser',
    brand: 'Neptune',
    collection: 'Chichester',
    sku: 'NEP-CHI-DRS-4FT',
    finish: 'Shingle Painted Timber, Character Oak & Aged Brass',
    category: 'furniture',
    dimensionsMm: mmFromMetres(w, baseD, totalH),
    productUrl: 'https://www.neptune.com/uk/dining/dressers/chichester-4ft-glazed-rack-dresser/',
    schematicUrl: 'https://www.neptune.com/uk/dining/dressers/chichester-4ft-glazed-rack-dresser/specification.pdf',
  });
}

export type NeptuneCounterStoolModel = 'wardley' | 'ludlow';

export interface NeptuneCounterStoolOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly model?: NeptuneCounterStoolModel;
  readonly fabricColor?: THREE.ColorRepresentation;
  readonly interactions?: InteractionRegistry;
}

/**
 * Neptune *Wardley* (`515 x 478 x 1020 mm`, `Seat H 670 mm`, upholstered linen backrest, Character Oak legs & aged-brass footrest scuff bar)
 * and *Ludlow* (`410 x 385 x 700 mm` backless saddled Character Oak counter stool) with `SeatInteractable`.
 */
export function buildNeptuneCounterStool(opts: NeptuneCounterStoolOptions = {}): THREE.Group {
  const model = opts.model ?? 'wardley';
  const namePrefix = opts.name ?? (model === 'wardley' ? 'neptuneWardleyCounterStool' : 'neptuneLudlowCounterStool');
  const w = model === 'wardley' ? 0.515 : 0.41;
  const d = model === 'wardley' ? 0.478 : 0.385;
  const h = model === 'wardley' ? 1.02 : 0.7;
  const seatH = model === 'wardley' ? 0.67 : 0.68;

  const oakMat = getCharacterOakMaterial();
  const brassMat = getAgedBrassMaterial();
  const linenMat = getLinenOrWoolMaterial(
    `${namePrefix}.linen`,
    opts.fabricColor ?? 0xded6c8,
    'linen',
    0.88
  );

  const root = new THREE.Group();
  root.name = namePrefix;

  const legS = 0.036;
  const legFrameTopY = model === 'wardley' ? seatH - 0.065 : seatH - 0.038;

  // 4 splayed Character Oak legs + perimeter footrest stretchers + Aged Brass front footrest scuff bar
  for (const [lTag, sx, sz] of [
    ['FL', -1, 1],
    ['FR', 1, 1],
    ['BL', -1, -1],
    ['BR', 1, -1],
  ] as const) {
    const isBackWardley = model === 'wardley' && sz < 0;
    const legTop = isBackWardley ? h : legFrameTopY;
    addNamedBox(
      root,
      `${namePrefix}.oakLeg_${lTag}`,
      legS,
      legTop,
      legS,
      sx * (w * 0.5 - legS * 0.5 - 0.025),
      legTop * 0.5,
      sz * (d * 0.5 - legS * 0.5 - 0.025),
      oakMat
    );
  }

  const footY = 0.22;
  const spanX = w - legS * 2 - 0.05;
  const spanZ = d - legS * 2 - 0.05;
  // Front footrest oak rail + Aged Brass protective scuff sleeve strictly proud on top/front
  addNamedBox(
    root,
    `${namePrefix}.frontFootrestOak`,
    spanX,
    0.024,
    0.024,
    0,
    footY,
    d * 0.5 - legS * 0.5 - 0.025,
    oakMat,
    true
  );
  addNamedBox(
    root,
    `${namePrefix}.agedBrassFootrestScuffPlate`,
    spanX - 0.02,
    0.004,
    0.026,
    0,
    footY + 0.0145,
    d * 0.5 - legS * 0.5 - 0.025,
    brassMat,
    true
  );
  addNamedBox(
    root,
    `${namePrefix}.rearFootrestOak`,
    spanX,
    0.024,
    0.024,
    0,
    footY + 0.04,
    -(d * 0.5 - legS * 0.5 - 0.025),
    oakMat,
    true
  );
  for (const [sSide, sx] of [
    ['L', -1],
    ['R', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.sideFootrest_${sSide}`,
      0.022,
      0.024,
      spanZ,
      sx * (w * 0.5 - legS * 0.5 - 0.025),
      footY + 0.04,
      0,
      oakMat,
      true
    );
  }

  if (model === 'wardley') {
    // Upholstered piped washed-linen seat + supportive curved backrest w/ rear brass pull bar
    const seatCush = new THREE.Mesh(
      createSculptedCushionGeometry(w - 0.02, 0.068, d - 0.04, 6, 4, 6, 0.5, 'standard'),
      linenMat
    );
    seatCush.name = `${namePrefix}.upholsteredSeat`;
    seatCush.position.set(0, seatH - 0.032, 0.015);
    seatCush.castShadow = true;
    root.add(seatCush);

    const backPad = new THREE.Mesh(
      createSculptedCushionGeometry(w - 0.04, h - seatH - 0.02, 0.055, 6, 5, 3, 0.48, 'standard'),
      linenMat
    );
    backPad.name = `${namePrefix}.upholsteredBackrest`;
    backPad.position.set(0, seatH + (h - seatH) * 0.5, -(d * 0.5 - 0.042));
    backPad.castShadow = true;
    root.add(backPad);

    const pull = addNamedCyl(
      root,
      `${namePrefix}.rearBrassHandle`,
      0.005,
      0.005,
      0.115,
      10,
      0,
      h - 0.055,
      -(d * 0.5 + 0.005),
      brassMat,
      true
    );
    pull.rotation.z = Math.PI * 0.5;
  } else {
    // Ludlow sculpted dished Character Oak saddle seat
    const saddle = new THREE.Mesh(
      createSculptedCushionGeometry(w, 0.038, d, 6, 3, 5, 0.36, 'standard', false, 0.008),
      oakMat
    );
    saddle.name = `${namePrefix}.saddledOakSeat`;
    saddle.position.set(0, seatH - 0.018, 0);
    saddle.castShadow = true;
    root.add(saddle);
  }

  const seatInteractable = new SeatInteractable({
    id: `seat:${namePrefix}`,
    label: model === 'wardley' ? 'Neptune Wardley Counter Stool' : 'Neptune Ludlow Counter Stool',
    aliases: ['sit on stool', 'counter stool', 'island stool'],
    anchor: root,
    clickableTargets: collectSeatClickableMeshes(root),
    localSeatPos: [0, seatH, 0.01],
    localFootOffset: [0, 0, d * 0.5 + 0.42],
    localForward: [0, 0, 1],
    seatedEyeHeightM: 0.72,
    proximityRadiusM: 0.85,
    material: model === 'wardley' ? 'linen' : 'timber',
  });
  root.userData.seatInteractable = seatInteractable;
  if (opts.interactions) {
    opts.interactions.registerAnimatedInteractable(seatInteractable);
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: model === 'wardley' ? 'Neptune Wardley Upholstered Oak Counter Stool' : 'Neptune Ludlow Saddle Oak Counter Stool',
    brand: 'Neptune',
    collection: model === 'wardley' ? 'Wardley' : 'Ludlow',
    sku: model === 'wardley' ? 'NEP-WAR-STL' : 'NEP-LUD-STL',
    finish: 'Character Oak, Flax Linen & Aged Brass Footrest',
    category: 'furniture',
    dimensionsMm: mmFromMetres(w, d, h),
    productUrl: 'https://www.neptune.com/uk/dining/bar-stools/',
    schematicUrl: 'https://www.neptune.com/uk/dining/bar-stools/counter-stool-spec.pdf',
  });
}

export type NeptuneOakPieceKind =
  | 'henleyCoffeeTable'
  | 'chichesterBedsideTable'
  | 'chichesterDaybed';

export interface NeptuneOakTablesAndBedsidesOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly kind?: NeptuneOakPieceKind;
  readonly paintColor?: THREE.ColorRepresentation;
  readonly interactions?: InteractionRegistry;
}

/**
 * Neptune occasional & bedroom pieces:
 * - `'henleyCoffeeTable'` (`1200 x 650 x 400 mm` solid Character Oak w/ slatted undertier, art monographs & White Co. glass hurricane)
 * - `'chichesterBedsideTable'` (`430 x 385 x 720 mm`, painted *Shingle* frame, Character Oak top, cock-beaded drawer & lower shelf)
 * - `'chichesterDaybed'` (`980 x 2020 x 860 mm`, painted *Shingle* panelled ends w/ White Co. quilted matelassé cover, twin bolsters & `SeatInteractable`).
 */
export function buildNeptuneOakTablesAndBedsides(
  opts: NeptuneOakTablesAndBedsidesOptions = {}
): THREE.Group {
  const kind = opts.kind ?? 'henleyCoffeeTable';
  const namePrefix =
    opts.name ??
    (kind === 'henleyCoffeeTable'
      ? 'neptuneHenleyCoffeeTable'
      : kind === 'chichesterBedsideTable'
        ? 'neptuneChichesterBedside'
        : 'neptuneChichesterDaybed');

  const oakMat = getCharacterOakMaterial();
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xd5d4ca,
    0.52,
    `${namePrefix}.paint`
  );
  const matelasseMat = getLinenOrWoolMaterial(`${namePrefix}.matelasse`, 0xf3efe6, 'matelasse', 0.88);
  const tickingMat = getLinenOrWoolMaterial(`${namePrefix}.ticking`, 0xe1dacb, 'ticking', 0.87);

  const root = new THREE.Group();
  root.name = namePrefix;

  if (kind === 'henleyCoffeeTable') {
    const w = 1.2;
    const d = 0.65;
    const h = 0.4;
    const topT = 0.036;
    const legS = 0.056;

    // 4 turned/chamfered Character Oak corner posts (`y = 0 .. h - topT`)
    for (const [lTag, sx, sz] of [
      ['FL', -1, 1],
      ['FR', 1, 1],
      ['BL', -1, -1],
      ['BR', 1, -1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.oakLeg_${lTag}`,
        legS,
        h - topT,
        legS,
        sx * (w * 0.5 - legS * 0.5 - 0.02),
        (h - topT) * 0.5,
        sz * (d * 0.5 - legS * 0.5 - 0.02),
        oakMat
      );
    }
    // Apron rails
    addNamedBox(root, `${namePrefix}.apronFront`, w - legS * 2 - 0.04, 0.048, 0.022, 0, h - topT - 0.026, d * 0.5 - 0.048, oakMat);
    addNamedBox(root, `${namePrefix}.apronBack`, w - legS * 2 - 0.04, 0.048, 0.022, 0, h - topT - 0.026, -(d * 0.5 - 0.048), oakMat);

    // Slatted solid-oak undertier shelf at `y = 0.11`
    const slatSpanW = w - legS * 2 - 0.04;
    const slatZoneD = d - legS * 2 - 0.04;
    const nSlats = 6;
    const slatPitch = slatZoneD / nSlats;
    for (let s = 0; s < nSlats; s++) {
      addNamedBox(
        root,
        `${namePrefix}.undertierSlat_${s + 1}`,
        slatSpanW,
        0.018,
        slatPitch - 0.008,
        0,
        0.11,
        -slatZoneD * 0.5 + (s + 0.5) * slatPitch,
        oakMat
      );
    }

    // Solid Character Oak tabletop (`1200 x 650 x 36 mm`)
    addNamedBox(root, `${namePrefix}.characterOakTop`, w, topT, d, 0, h - topT * 0.5, 0, oakMat);

    // Styled art monographs + White Company glass hurricane lantern on top
    const monographColors = [0xd8d1c2, 0x3b4856];
    monographColors.forEach((mc, mIdx) => {
      const mMat = getPaintedJoineryMaterial(mc, 0.58, `${namePrefix}.monograph_${mIdx + 1}`);
      addNamedBox(
        root,
        `${namePrefix}.artMonograph_${mIdx + 1}`,
        0.31,
        0.028,
        0.24,
        -0.24,
        h + 0.0145 + mIdx * 0.029,
        0.02,
        mMat,
        true
      );
    });
    addWhiteCompanyGlassHurricane(root, `${namePrefix}.whiteCoHurricane`, 0.24, h + 0.001, -0.02, 0.17, 0.28);
  } else if (kind === 'chichesterBedsideTable') {
    const w = 0.43;
    const d = 0.385;
    const h = 0.72;
    const topT = 0.026;
    const legS = 0.04;

    // 4 tapered painted legs (`y = 0 .. h - topT`)
    for (const [lTag, sx, sz] of [
      ['FL', -1, 1],
      ['FR', 1, 1],
      ['BL', -1, -1],
      ['BR', 1, -1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.leg_${lTag}`,
        legS,
        h - topT,
        legS,
        sx * (w * 0.5 - legS * 0.5 - 0.012),
        (h - topT) * 0.5,
        sz * (d * 0.5 - legS * 0.5 - 0.012),
        paintMat
      );
    }

    // Upper drawer box housing (`y = h - topT - 0.16 .. h - topT`)
    const drBoxH = 0.16;
    const drMidY = h - topT - drBoxH * 0.5;
    const spanW = w - legS * 2 - 0.024;
    const spanD = d - legS * 2 - 0.024;
    for (const [sSide, sx] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.sideApron${sSide}`,
        0.018,
        drBoxH,
        spanD,
        sx * (w * 0.5 - legS * 0.5 - 0.012),
        drMidY,
        0,
        paintMat
      );
    }
    addNamedBox(
      root,
      `${namePrefix}.backApron`,
      spanW,
      drBoxH,
      0.018,
      0,
      drMidY,
      -(d * 0.5 - legS * 0.5 - 0.012),
      paintMat
    );

    // Interactive cock-beaded drawer
    const fz = d * 0.5 - 0.014;
    addCockBeadApertureTrim(root, `${namePrefix}.drawerBead`, 0, drMidY, fz + 0.002, spanW, drBoxH - 0.024, paintMat);

    const drGroup = new THREE.Group();
    drGroup.name = `${namePrefix}.drawer`;
    drGroup.position.set(0, drMidY, fz - 0.01);
    root.add(drGroup);

    drGroup.add(
      buildShakerDoorAssembly(`${drGroup.name}.front`, spanW - 0.008, drBoxH - 0.032, 0.02, paintMat, 0.032)
    );
    const knob = buildAgedBrassMushroomKnob(`${drGroup.name}.knob`);
    knob.position.set(0, 0, 0.011);
    drGroup.add(knob);
    attachDrawerBoxBehindFront(drGroup, spanW - 0.02, drBoxH - 0.04, d - 0.1, '+z', false);
    wireCatalogSlidingDrawer(opts.interactions, {
      drawer: drGroup,
      slideDelta: [0, 0, 0.24],
      label: 'Open Bedside Drawer',
    });

    // Lower open shelf (`y = 0.15`) + Character Oak top (`430 x 385 x 26 mm`)
    addNamedBox(
      root,
      `${namePrefix}.lowerShelf`,
      w - 0.048,
      0.02,
      d - 0.048,
      0,
      0.15,
      0,
      paintMat
    );
    addNamedBox(root, `${namePrefix}.characterOakTop`, w, topT, d, 0, h - topT * 0.5, 0, oakMat);
  } else {
    // Chichester single daybed (`980 x 2020 x 860 mm`, oriented along X = 2.02 m, Z = 0.98 m, facing +Z!)
    const lenX = 2.02;
    const depZ = 0.98;
    const endH = 0.86;
    const backH = 0.86;
    const postS = 0.064;
    const railBotY = 0.22;
    const railH = 0.14;
    const mattressTopY = 0.54;

    // 4 corner posts + panelled headboard/footboard ends + back T&G rail
    for (const [pTag, sx, sz] of [
      ['FL', -1, 1],
      ['FR', 1, 1],
      ['BL', -1, -1],
      ['BR', 1, -1],
    ] as const) {
      const ph = sz < 0 ? backH : endH - 0.08;
      addNamedBox(
        root,
        `${namePrefix}.post_${pTag}`,
        postS,
        ph,
        postS,
        sx * (lenX * 0.5 - postS * 0.5),
        ph * 0.5,
        sz * (depZ * 0.5 - postS * 0.5),
        paintMat
      );
      addNamedBox(
        root,
        `${namePrefix}.postCap_${pTag}`,
        postS + 0.016,
        0.022,
        postS + 0.016,
        sx * (lenX * 0.5 - postS * 0.5),
        ph + 0.011,
        sz * (depZ * 0.5 - postS * 0.5),
        oakMat,
        true
      );
    }

    // Left & Right Shaker end panels
    const endSpanZ = depZ - postS * 2;
    for (const [eTag, sx] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      const endPanel = buildShakerDoorAssembly(
        `${namePrefix}.endPanel${eTag}`,
        endSpanZ,
        endH - 0.28,
        0.026,
        paintMat,
        0.056
      );
      endPanel.rotation.y = Math.PI * 0.5;
      endPanel.position.set(sx * (lenX * 0.5 - postS * 0.5), 0.2 + (endH - 0.28) * 0.5, 0);
      root.add(endPanel);
    }

    // Rear Shaker backrest panel (`z = -depZ/2 + postS/2`) + front mattress rail
    const innerLenX = lenX - postS * 2;
    const rearPanel = buildShakerDoorAssembly(
      `${namePrefix}.rearPanel`,
      innerLenX,
      backH - 0.22,
      0.026,
      paintMat,
      0.056
    );
    rearPanel.position.set(0, 0.2 + (backH - 0.22) * 0.5, -(depZ * 0.5 - postS * 0.5));
    root.add(rearPanel);

    addNamedBox(
      root,
      `${namePrefix}.frontMattressRail`,
      innerLenX,
      railH,
      0.028,
      0,
      railBotY + railH * 0.5,
      depZ * 0.5 - postS * 0.5,
      paintMat
    );

    // White Company quilted Chalk matelassé mattress & counterpane (`y = railBotY + 0.04 .. mattressTopY`)
    const matH = mattressTopY - (railBotY + 0.04);
    const mattress = new THREE.Mesh(
      createSculptedCushionGeometry(innerLenX - 0.012, matH, depZ - postS * 2 - 0.012, 10, 5, 7, 0.46, 'standard'),
      matelasseMat
    );
    mattress.name = `${namePrefix}.matelasseMattress`;
    mattress.position.set(0, railBotY + 0.04 + matH * 0.5, 0);
    mattress.castShadow = true;
    root.add(mattress);

    // Twin cylindrical ticking bolsters at each end + 3 back scatter cushions
    for (const [bTag, sign] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      const bolster = addNamedCyl(
        root,
        `${namePrefix}.bolster${bTag}`,
        0.095,
        0.095,
        depZ - postS * 2 - 0.09,
        18,
        sign * (innerLenX * 0.5 - 0.115),
        mattressTopY + 0.096,
        0.02,
        tickingMat
      );
      bolster.rotation.x = Math.PI * 0.5;
    }

    for (let c = -1; c <= 1; c++) {
      const p = new THREE.Mesh(
        createSculptedCushionGeometry(0.48, 0.38, 0.13, 7, 6, 4, 0.65, 'standard', true),
        c === 0 ? tickingMat : matelasseMat
      );
      p.name = `${namePrefix}.backCushion_${c + 2}`;
      p.rotation.x = -0.16;
      p.position.set(c * 0.5, mattressTopY + 0.18, -(depZ * 0.5 - postS - 0.13));
      p.castShadow = true;
      root.add(p);
    }

    const seatInteractable = new SeatInteractable({
      id: `seat:${namePrefix}`,
      label: 'Neptune Chichester Daybed',
      aliases: ['sit on daybed', 'daybed'],
      anchor: root,
      clickableTargets: collectSeatClickableMeshes(root),
      localSeatPos: [0, mattressTopY, 0.06],
      localFootOffset: [0, 0, depZ * 0.5 + 0.45],
      localForward: [0, 0, 1],
      seatedEyeHeightM: 0.72,
      proximityRadiusM: 1.15,
      material: 'linen',
    });
    root.userData.seatInteractable = seatInteractable;
    if (opts.interactions) {
      opts.interactions.registerAnimatedInteractable(seatInteractable);
    }
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name:
      kind === 'henleyCoffeeTable'
        ? 'Neptune Henley Character Oak Slatted Coffee Table'
        : kind === 'chichesterBedsideTable'
          ? 'Neptune Chichester Painted & Oak Bedside Table'
          : 'Neptune Chichester Spindle Daybed',
    brand: 'Neptune',
    collection: kind === 'henleyCoffeeTable' ? 'Henley' : 'Chichester',
    sku: kind === 'henleyCoffeeTable' ? 'NEP-HEN-CFT' : kind === 'chichesterBedsideTable' ? 'NEP-CHI-BST' : 'NEP-CHI-DBD',
    finish: 'Character Solid Oak & Shingle Painted Timber',
    category: 'furniture',
    productUrl: 'https://www.neptune.com/uk/furniture/',
    schematicUrl: 'https://www.neptune.com/uk/furniture/dimensions-spec.pdf',
  });
}

export interface WhiteCompanyBedStylingOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** UK bed size (`'king'` `1500 x 2000 mm` default, `'superKing'` `1800 x 2000 mm`, `'double'` `1350 x 1900 mm`). */
  readonly size?: 'double' | 'king' | 'superKing';
  /** Mattress top height above `y = 0` in metres (default `0.58`, pass `0` to place directly on an existing mattress surface). */
  readonly mattressTopY?: number;
}

/**
 * Layered **The White Company** bedroom styling overlay for King / Double / Super-King beds:
 * - *Savoy* 400TC crisp white corded folded duvet turn-back (`#F8F6F1` w/ charcoal/taupe cord stitch)
 * - Quilted *Chalk* matelassé counterpane (`#EFEBE1`)
 * - *Oatmeal* cashmere end-of-bed throw (`#DED6C7`)
 * - 4 Oxford-bordered *Savoy* sleeping pillows + 2 piped linen square Euro shams + central lumbar cushion.
 * Head of bed is at `-Z`, foot of bed at `+Z`. Every layer uses non-overlapping Y/Z bounds so `0` z-fighting occurs!
 */
export function buildWhiteCompanyBedStyling(
  opts: WhiteCompanyBedStylingOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'whiteCompanyBedStyling';
  const bedSize = opts.size ?? 'king';
  const bedW = bedSize === 'superKing' ? 1.8 : bedSize === 'double' ? 1.35 : 1.5;
  const bedL = bedSize === 'double' ? 1.9 : 2.0;
  const baseY = opts.mattressTopY ?? 0.58;

  const savoyWhiteMat = getLinenOrWoolMaterial(`${namePrefix}.savoy400tc`, 0xf8f6f1, 'linen', 0.84);
  const cordTrimMat = getLinenOrWoolMaterial(`${namePrefix}.savoyCord`, 0x8f877b, 'linen', 0.85);
  const matelasseMat = getLinenOrWoolMaterial(`${namePrefix}.chalkMatelasse`, 0xefebe1, 'matelasse', 0.88);
  const cashmereMat = getLinenOrWoolMaterial(`${namePrefix}.oatmealCashmere`, 0xded6c7, 'cashmere', 0.92);
  const tickingAccentMat = getLinenOrWoolMaterial(`${namePrefix}.tickingLumbar`, 0xd8d1c2, 'ticking', 0.87);

  const root = new THREE.Group();
  root.name = namePrefix;

  const headZ = -bedL * 0.5;
  const footZ = bedL * 0.5;

  // Main Savoy 400TC plump feather duvet covering middle-to-foot (`z = headZ + 0.52 .. footZ`)
  const duvetL = bedL - 0.52;
  const duvetH = 0.085;
  const duvetCz = headZ + 0.52 + duvetL * 0.5;
  const duvet = new THREE.Mesh(
    createSculptedCushionGeometry(bedW + 0.08, duvetH, duvetL, 10, 4, 10, 0.52, 'standard'),
    savoyWhiteMat
  );
  duvet.name = `${namePrefix}.savoy400tcDuvet`;
  duvet.position.set(0, baseY + duvetH * 0.5 + 0.002, duvetCz);
  duvet.castShadow = true;
  duvet.receiveShadow = true;
  root.add(duvet);

  // Savoy folded top sheet turn-back collar (`z = headZ + 0.44 .. headZ + 0.72`, strictly above duvet top!)
  const turnBackD = 0.28;
  const turnBackY = baseY + duvetH + 0.015;
  const turnBackCz = headZ + 0.58;
  const turnBack = new THREE.Mesh(
    createSculptedCushionGeometry(bedW + 0.09, 0.026, turnBackD, 10, 3, 5, 0.44, 'standard'),
    savoyWhiteMat
  );
  turnBack.name = `${namePrefix}.savoyFoldedTurnBack`;
  turnBack.position.set(0, turnBackY, turnBackCz);
  turnBack.castShadow = true;
  root.add(turnBack);

  // Savoy signature contrast cord line along the turn-back edge (`+2 mm` proud above turnBack)
  addNamedBox(
    root,
    `${namePrefix}.savoySignatureCordLine`,
    bedW + 0.075,
    0.004,
    0.008,
    0,
    turnBackY + 0.0155,
    turnBackCz + turnBackD * 0.5 - 0.025,
    cordTrimMat,
    true
  );

  // Quilted Chalk matelassé counterpane folded across the lower half (`z = headZ + 0.96 .. footZ - 0.04`)
  const counterpaneD = bedL - 1.0;
  const counterpaneY = baseY + duvetH + 0.018;
  const counterpaneCz = footZ - 0.04 - counterpaneD * 0.5;
  const counterpane = new THREE.Mesh(
    createSculptedCushionGeometry(bedW + 0.11, 0.032, counterpaneD, 10, 3, 8, 0.45, 'standard'),
    matelasseMat
  );
  counterpane.name = `${namePrefix}.chalkMatelasseCounterpane`;
  counterpane.position.set(0, counterpaneY, counterpaneCz);
  counterpane.castShadow = true;
  root.add(counterpane);

  // Oatmeal cashmere end-throw folded neatly at the foot of the bed (`z = footZ - 0.44 .. footZ + 0.02`, strictly above counterpane!)
  const throwD = 0.42;
  const throwY = counterpaneY + 0.028;
  const throwCz = footZ - 0.21;
  const endThrow = new THREE.Mesh(
    createSculptedCushionGeometry(bedW + 0.14, 0.022, throwD, 10, 3, 6, 0.42, 'standard'),
    cashmereMat
  );
  endThrow.name = `${namePrefix}.oatmealCashmereEndThrow`;
  endThrow.position.set(0, throwY, throwCz);
  endThrow.castShadow = true;
  root.add(endThrow);

  // Pillowscape at head of bed (`-Z`):
  // Row 1 (against headboard): 2 square Euro shams (`620 x 620 mm`)
  const colOffset = bedW * 0.25;
  for (const [eTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const euro = new THREE.Mesh(
      createSculptedCushionGeometry(0.6, 0.54, 0.14, 7, 7, 4, 0.64, 'standard', true),
      matelasseMat
    );
    euro.name = `${namePrefix}.euroSham${eTag}`;
    euro.rotation.x = -0.18;
    euro.position.set(sign * colOffset, baseY + 0.25, headZ + 0.14);
    euro.castShadow = true;
    root.add(euro);

    // Row 2: Savoy 400TC Oxford pillowcases (`720 x 460 mm`) in front of Euro shams
    const oxford = new THREE.Mesh(
      createSculptedCushionGeometry(0.66, 0.42, 0.135, 8, 6, 4, 0.66, 'standard', true),
      savoyWhiteMat
    );
    oxford.name = `${namePrefix}.savoyOxfordPillow${eTag}`;
    oxford.rotation.x = -0.26;
    oxford.position.set(sign * colOffset, baseY + 0.2, headZ + 0.3);
    oxford.castShadow = true;
    root.add(oxford);
  }

  // Row 3: Central piped linen/ticking lumbar cushion (`680 x 280 mm`)
  const lumbar = new THREE.Mesh(
    createSculptedCushionGeometry(0.68, 0.27, 0.12, 8, 5, 4, 0.68, 'standard', true),
    tickingAccentMat
  );
  lumbar.name = `${namePrefix}.centralPipedLumbar`;
  lumbar.rotation.x = -0.3;
  lumbar.position.set(0, baseY + 0.155, headZ + 0.44);
  lumbar.castShadow = true;
  root.add(lumbar);


  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'The White Company Savoy 400TC Egyptian Cotton & Cashmere Bed Linen Set',
    brand: 'The White Company',
    collection: 'Savoy & Symons',
    sku: `TWC-SAV-400TC-${bedSize.toUpperCase()}`,
    finish: 'White / Silver Cord 400TC Percale, Chalk Matelassé & Oatmeal Cashmere',
    category: 'decor',
    dimensionsMm: mmFromMetres(bedW, bedL, 0.42),
    productUrl: 'https://www.thewhitecompany.com/uk/Bedroom/Bed-Linen/Savoy-Bed-Linen-Collection/p/savoy-bed-linen',
    schematicUrl: 'https://www.thewhitecompany.com/uk/help/size-guides/bedding',
  });
}
