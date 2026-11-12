import * as THREE from 'three';
import {
  attachAssetInteraction,
  attachAssetMetadata,
  mmFromMetres,
  wireCatalogHingedDoor,
} from '../shared/catalog-smart-metadata.ts';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import { createBrickMaterial } from '../../engine/textures/brick-materials.ts';
import { applyMetricBoxUVs } from '../../engine/textures/metric-masonry-uvs.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import { createStoneMasonryMaterial } from '../../engine/textures/cobblestone-materials.ts';
import { getOrCreateCachedTexture } from '../../engine/textures/texture-registry.ts';
import { createSculptedCushionGeometry, createPerimeterWeltLoop } from '../furniture/barker-and-stonehouse-sofas.ts';
import {
  collectSeatClickableMeshes,
  SeatInteractable,
} from '../furniture/seating-interactions.ts';
import {
  buildHallWoodBurningStoveFirebox,
  type WoodBurningStoveFireController,
} from '../heating/wood-burning-stove-fire.ts';
import {
  addCockBeadApertureTrim,
  addNamedBox,
  addNamedCyl,
  buildAgedBrassMushroomKnob,
  buildShakerDoorAssembly,
  deriveNormalAndRoughnessFromHeight,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getBathStoneMaps,
  getCharacterOakMaterial,
  getClearArchitecturalGlassMaterial,
  getDarkAntiquedBrassMaterial,
  getGeorgianLimePlasterMaterial,
  getHonedCarraraCatalogMaterial,
  getMatteCastIronMaterial,
  getNeroMarquinaCatalogMaterial,
  getPaintedJoineryMaterial,
  getWarm2700kLedMaterial,
  getWovenFabricMaps,
  makeRgbaDataTexture,
  type PbrDataMapBundle,
  seamlessFbm2D,
  seamlessValueNoise2D,
  sharedSphereGeometry,
  sharedTorusGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';
import type { CatalogInteractionContext } from './neptune-kitchen-joinery.ts';

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

let cachedBathStoneMat: THREE.MeshStandardMaterial | null = null;
export function getBathStoneMaterial(): THREE.MeshStandardMaterial {
  if (!cachedBathStoneMat) {
    const maps = getBathStoneMaps();
    cachedBathStoneMat = new THREE.MeshStandardMaterial({
      name: 'catalog.bathStoneAshlar',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: maps.roughnessMap,
      roughness: 0.78,
      metalness: 0.01,
    });
  }
  return cachedBathStoneMat;
}

function addMetricMasonryBox(
  parent: THREE.Object3D,
  name: string,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  worldOx = 0,
  worldOy = 0,
  worldOz = 0
): THREE.Mesh {
  const geo = prepGeo(
    applyMetricBoxUVs(new THREE.BoxGeometry(w, h, d), {
      tileW: 1.0,
      tileH: 1.0,
      ox: worldOx + x,
      oy: worldOy + y,
      oz: worldOz + z,
    })
  );
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export interface GeorgianTuscanPorticoAndDoorOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Portico entablature width in metres (default `2.10`). */
  readonly porticoWidthM?: number;
  /** Portico projection from facade wall (`z = 0`) in metres (default `1.15`). */
  readonly porticoDepthM?: number;
  /** Total portico height in metres (default `3.05`). */
  readonly porticoHeightM?: number;
  /** Door colour (default high-gloss F&B *Off-Black* `#454749`). */
  readonly doorColor?: THREE.ColorRepresentation;
  /** Include twin dark-lead square planters (`480 mm`) w/ clipped standard bay/olive trees (`H 1.75 m`). Default `true`. */
  readonly includePlanters?: boolean;
  readonly treeSpecies?: 'bay' | 'olive';
}

/**
 * Classical Bath-stone (`#DDD0B8`) Tuscan portico (`2100 x 1150 x 3050 mm`) with:
 * - Twin turned entasis columns (`Ø240 -> 205 mm`) on square plinths + rear pilasters
 * - Architrave-frieze-cornice entablature & 2 bullnose Yorkstone steps
 * - Interactive gloss F&B *Off-Black* (`#454749`, `roughness: 0.16`) 6-panel bolection Georgian front door (`980 x 54 x 2140 mm`)
 *   with brass lion's-head knocker, central pull knob & letterplate
 * - Glazed semicircular radial-spoke cobweb fanlight above
 * - Optional twin dark-lead square planters (`480 x 480 x 480 mm`, `#3A3D40`) with clipped standard bay/olive trees (`H 1750 mm`).
 * Local origin `(0, 0, 0)` is at ground level (`y = 0`) on the exterior wall plane (`z = 0`), projecting along `+Z`.
 */
export function buildGeorgianTuscanPorticoAndDoor(
  ctx: CatalogInteractionContext = null,
  opts: GeorgianTuscanPorticoAndDoorOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianTuscanPortico';
  const porticoW = opts.porticoWidthM ?? 2.1;
  const porticoD = opts.porticoDepthM ?? 1.15;
  const porticoH = opts.porticoHeightM ?? 3.05;
  const bathStoneMat = getBathStoneMaterial();
  const yorkstoneMat = createStoneMasonryMaterial({
    preset: 'sawn-yorkstone-coping',
    name: `${namePrefix}.yorkstoneStep`,
  } as Parameters<typeof createStoneMasonryMaterial>[0]);
  const glossDoorMat = new THREE.MeshPhysicalMaterial({
    name: `${namePrefix}.offBlackGloss`,
    color: new THREE.Color(opts.doorColor ?? 0x454749),
    roughness: 0.16,
    metalness: 0.03,
    clearcoat: 0.85,
    clearcoatRoughness: 0.1,
  });
  const fanlightFrameMat = getPaintedJoineryMaterial(0xf2efe6, 0.42, `${namePrefix}.fanlightWhite`);
  const brassMat = getAgedBrassMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const leadMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.weatheredLead`,
    color: 0x3a3d40,
    roughness: 0.56,
    metalness: 0.58,
  });
  const registry = resolveRegistry(ctx);

  const root = new THREE.Group();
  root.name = namePrefix;

  // 2 bullnose Yorkstone steps (`step1`: H 150 mm, `step2` landing: H 150 mm -> FFL +300 mm)
  const stepH = 0.15;
  const landingY = stepH * 2;
  addMetricMasonryBox(
    root,
    `${namePrefix}.yorkstoneLowerStep`,
    porticoW + 0.24,
    stepH,
    porticoD + 0.28,
    0,
    stepH * 0.5,
    (porticoD + 0.28) * 0.5,
    yorkstoneMat
  );
  const lowerBullnose = addNamedCyl(
    root,
    `${namePrefix}.yorkstoneLowerBullnose`,
    0.024,
    0.024,
    porticoW + 0.24 - 0.002,
    12,
    0,
    stepH - 0.024,
    porticoD + 0.28 + 0.012,
    yorkstoneMat,
    true
  );
  lowerBullnose.rotation.z = Math.PI * 0.5;

  addMetricMasonryBox(
    root,
    `${namePrefix}.yorkstoneUpperLanding`,
    porticoW + 0.06,
    stepH,
    porticoD + 0.04,
    0,
    stepH * 1.5,
    (porticoD + 0.04) * 0.5,
    yorkstoneMat
  );

  // Entablature dimensions (`H 490 mm` at top -> columns span `landingY .. porticoH - 0.49`)
  const entabH = 0.49;
  const colTopY = porticoH - entabH;
  const colSpanH = colTopY - landingY;
  const colSpanCenterX = porticoW * 0.5 - 0.22;
  const colFrontZ = porticoD - 0.18;

  // Turned Tuscan entasis column shaft geometry (`Ø240 -> Ø205 mm` classical 1/3 entasis curve)
  const plinthH = 0.14;
  const baseTorusH = 0.075;
  const capH = 0.135;
  const shaftH = Math.max(0.8, colSpanH - plinthH - baseTorusH - capH);

  const lathePts: THREE.Vector2[] = [];
  const nSegs = 20;
  for (let i = 0; i <= nSegs; i++) {
    const t = i / nSegs;
    // Classical Tuscan entasis: full Ø240 mm up to 1/3 height, smooth cosine taper to Ø205 mm at necking
    const taper = t <= 0.33 ? 0 : Math.pow((t - 0.33) / 0.67, 1.25);
    const r = 0.12 - taper * (0.12 - 0.1025);
    lathePts.push(new THREE.Vector2(r, t * shaftH));
  }
  const entasisShaftGeo = new THREE.LatheGeometry(lathePts, 24);
  entasisShaftGeo.computeVertexNormals();

  for (const [sideTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const cx = sign * colSpanCenterX;
    // Square Tuscan plinth block
    addNamedBox(
      root,
      `${namePrefix}.columnPlinth${sideTag}`,
      0.33,
      plinthH,
      0.33,
      cx,
      landingY + plinthH * 0.5,
      colFrontZ,
      bathStoneMat
    );
    // Base torus & fillet
    const torus = new THREE.Mesh(sharedTorusGeometry(0.122, 0.026, 12, 24), bathStoneMat);
    torus.name = `${namePrefix}.columnBaseTorus${sideTag}`;
    torus.rotation.x = Math.PI * 0.5;
    torus.position.set(cx, landingY + plinthH + 0.032, colFrontZ);
    torus.castShadow = true;
    root.add(torus);

    addNamedCyl(
      root,
      `${namePrefix}.columnBaseFillet${sideTag}`,
      0.124,
      0.13,
      0.024,
      24,
      cx,
      landingY + plinthH + baseTorusH - 0.012,
      colFrontZ,
      bathStoneMat,
      true
    );

    // Turned entasis column shaft
    const shaft = new THREE.Mesh(entasisShaftGeo, bathStoneMat);
    shaft.name = `${namePrefix}.columnShaft${sideTag}`;
    shaft.position.set(cx, landingY + plinthH + baseTorusH, colFrontZ);
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    root.add(shaft);

    // Necking astragal, echinus ovolo & square Tuscan abacus
    const neckY = landingY + plinthH + baseTorusH + shaftH;
    addNamedCyl(
      root,
      `${namePrefix}.columnAstragal${sideTag}`,
      0.112,
      0.112,
      0.022,
      24,
      cx,
      neckY + 0.011,
      colFrontZ,
      bathStoneMat,
      true
    );
    addNamedCyl(
      root,
      `${namePrefix}.columnEchinus${sideTag}`,
      0.148,
      0.108,
      0.055,
      24,
      cx,
      neckY + 0.05,
      colFrontZ,
      bathStoneMat,
      true
    );
    addNamedBox(
      root,
      `${namePrefix}.columnAbacus${sideTag}`,
      0.32,
      0.058,
      0.32,
      cx,
      neckY + 0.106,
      colFrontZ,
      bathStoneMat
    );

    // Rear Bath-stone respond pilaster against wall (`z = 0..0.095`)
    addNamedBox(
      root,
      `${namePrefix}.rearPilasterPlinth${sideTag}`,
      0.3,
      plinthH,
      0.11,
      cx,
      landingY + plinthH * 0.5,
      0.055,
      bathStoneMat
    );
    addNamedBox(
      root,
      `${namePrefix}.rearPilasterShaft${sideTag}`,
      0.24,
      colSpanH - plinthH - 0.07,
      0.085,
      cx,
      landingY + plinthH + (colSpanH - plinthH - 0.07) * 0.5,
      0.0425,
      bathStoneMat
    );
    addNamedBox(
      root,
      `${namePrefix}.rearPilasterCapital${sideTag}`,
      0.3,
      0.07,
      0.115,
      cx,
      colTopY - 0.035,
      0.0575,
      bathStoneMat
    );
  }

  // Classical Tuscan Entablature: Architrave (`125 mm`), Frieze (`175 mm`), Projecting Cornice (`145 mm`) & Lead Weathering (`45 mm`)
  const archH = 0.125;
  const friezeH = 0.175;
  const cornH = 0.145;
  const leadCapH = 0.045;

  addNamedBox(
    root,
    `${namePrefix}.entablatureArchitrave`,
    porticoW - 0.06,
    archH,
    porticoD - 0.03,
    0,
    colTopY + archH * 0.5,
    (porticoD - 0.03) * 0.5,
    bathStoneMat
  );
  addNamedBox(
    root,
    `${namePrefix}.entablatureFrieze`,
    porticoW - 0.04,
    friezeH,
    porticoD - 0.02,
    0,
    colTopY + archH + friezeH * 0.5,
    (porticoD - 0.02) * 0.5,
    bathStoneMat
  );
  addNamedBox(
    root,
    `${namePrefix}.entablatureCornice`,
    porticoW + 0.18,
    cornH,
    porticoD + 0.11,
    0,
    colTopY + archH + friezeH + cornH * 0.5,
    (porticoD + 0.11) * 0.5,
    bathStoneMat
  );
  addNamedBox(
    root,
    `${namePrefix}.porticoLeadRoof`,
    porticoW + 0.14,
    leadCapH,
    porticoD + 0.09,
    0,
    colTopY + archH + friezeH + cornH + leadCapH * 0.5,
    (porticoD + 0.09) * 0.5,
    leadMat
  );

  // Door frame & glazed semicircular cobweb fanlight (`door: 980 x 54 x 2140 mm` above landingY)
  const doorW = 0.98;
  const doorT = 0.054;
  const doorH = 2.14;
  const jambW = 0.075;
  const frameDepth = 0.11;
  const transomH = 0.065;
  const fanRadius = doorW * 0.5;
  const doorwayOuterW = doorW + jambW * 2;
  const fanCenterY = landingY + doorH + transomH;

  for (const [jTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.doorFrameJamb${jTag}`,
      jambW,
      doorH + transomH,
      frameDepth,
      sign * (doorW * 0.5 + jambW * 0.5),
      landingY + (doorH + transomH) * 0.5,
      frameDepth * 0.5,
      fanlightFrameMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.doorTransomBar`,
    doorW,
    transomH,
    frameDepth,
    0,
    landingY + doorH + transomH * 0.5,
    frameDepth * 0.5,
    fanlightFrameMat
  );

  // Semicircular Bath-stone archivolts + glazed radial-spoke cobweb fanlight
  const fanArchRing = new THREE.Mesh(
    sharedTorusGeometry(fanRadius + 0.055, 0.052, 12, 28, Math.PI),
    bathStoneMat
  );
  fanArchRing.name = `${namePrefix}.fanlightStoneArchivolt`;
  fanArchRing.position.set(0, fanCenterY, 0.055);
  root.add(fanArchRing);

  // Keystone at apex of fanlight arch
  addNamedBox(
    root,
    `${namePrefix}.fanlightKeystone`,
    0.13,
    0.13,
    0.122,
    0,
    fanCenterY + fanRadius + 0.015,
    0.064,
    bathStoneMat,
    true
  );

  // Semicircular fanlight glass pane
  const fanGlassGeo = new THREE.CircleGeometry(fanRadius - 0.012, 28, 0, Math.PI);
  const fanGlass = new THREE.Mesh(fanGlassGeo, glassMat);
  fanGlass.name = `${namePrefix}.fanlightGlass`;
  fanGlass.position.set(0, fanCenterY, 0.058);
  root.add(fanGlass);

  // Radial-spoke & concentric-web Georgian cobweb glazing bars
  const innerWebRing = new THREE.Mesh(
    sharedTorusGeometry(fanRadius * 0.5, 0.007, 8, 22, Math.PI),
    fanlightFrameMat
  );
  innerWebRing.name = `${namePrefix}.fanlightCobwebInnerArc`;
  innerWebRing.position.set(0, fanCenterY, 0.064);
  tagHighLod(innerWebRing);
  root.add(innerWebRing);

  const hubArc = new THREE.Mesh(
    sharedTorusGeometry(0.075, 0.008, 8, 16, Math.PI),
    fanlightFrameMat
  );
  hubArc.name = `${namePrefix}.fanlightCenterHub`;
  hubArc.position.set(0, fanCenterY, 0.064);
  tagHighLod(hubArc);
  root.add(hubArc);

  const spokeCount = 7;
  for (let s = 0; s < spokeCount; s++) {
    const theta = ((s + 0.5) / spokeCount) * Math.PI;
    const spokeLen = fanRadius - 0.085;
    const midR = 0.075 + spokeLen * 0.5;
    const spoke = addNamedCyl(
      root,
      `${namePrefix}.fanlightSpoke_${s + 1}`,
      0.006,
      0.006,
      spokeLen,
      8,
      Math.cos(theta) * midR,
      fanCenterY + Math.sin(theta) * midR,
      0.064,
      fanlightFrameMat,
      true
    );
    spoke.rotation.z = theta - Math.PI * 0.5;
  }

  // Interactive 6-panel bolection Georgian front door (`980 x 54 x 2140 mm`)
  const doorGroup = new THREE.Group();
  doorGroup.name = `${namePrefix}.frontDoor`;
  doorGroup.position.set(0, landingY + doorH * 0.5, 0.052);
  root.add(doorGroup);

  // Core slab (`44 mm` thick) + raised bolection fielded panels (`+8 mm` proud on front face, zero coplanarity!)
  addNamedBox(
    doorGroup,
    `${doorGroup.name}.stileCore`,
    doorW - 0.006,
    doorH - 0.006,
    doorT - 0.01,
    0,
    0,
    0,
    glossDoorMat
  );

  const panelColXs = [-doorW * 0.235, doorW * 0.235];
  const panelRows: readonly [string, number, number][] = [
    ['Upper', doorH * 0.31, 0.42],
    ['Middle', -doorH * 0.03, 0.58],
    ['Lower', -doorH * 0.36, 0.36],
  ];
  for (const [rTag, ry, rh] of panelRows) {
    for (const [cIdx, cx] of panelColXs.entries()) {
      const pw = doorW * 0.31;
      // Bolection outer frame moulding
      addNamedBox(
        doorGroup,
        `${doorGroup.name}.bolectionFrame_${rTag}_${cIdx + 1}`,
        pw,
        rh,
        0.007,
        cx,
        ry,
        (doorT - 0.01) * 0.5 + 0.0035,
        glossDoorMat,
        true
      );
      // Raised fielded center tablet stepped forward another 4 mm
      addNamedBox(
        doorGroup,
        `${doorGroup.name}.fieldedTablet_${rTag}_${cIdx + 1}`,
        pw - 0.052,
        rh - 0.052,
        0.005,
        cx,
        ry,
        (doorT - 0.01) * 0.5 + 0.0095,
        glossDoorMat,
        true
      );
    }
  }

  // Brass ironmongery: Lion's-head knocker, central octagonal pull knob, horizontal letterplate & lock escutcheon
  const frontFaceZ = (doorT - 0.01) * 0.5 + 0.002;
  // Lion's-head knocker
  const lionMask = new THREE.Mesh(sharedSphereGeometry(0.036, 14, 12), brassMat);
  lionMask.name = `${doorGroup.name}.lionHeadKnockerBoss`;
  lionMask.scale.set(0.95, 1.15, 0.55);
  lionMask.position.set(0, 0.36, frontFaceZ + 0.018);
  tagHighLod(lionMask);
  doorGroup.add(lionMask);

  const knockerRing = new THREE.Mesh(sharedTorusGeometry(0.044, 0.0075, 10, 20), brassMat);
  knockerRing.name = `${doorGroup.name}.lionKnockerRing`;
  knockerRing.position.set(0, 0.305, frontFaceZ + 0.022);
  tagHighLod(knockerRing);
  doorGroup.add(knockerRing);

  // Central Georgian centre-door pull knob
  const centerKnob = buildAgedBrassMushroomKnob(`${doorGroup.name}.centrePullKnob`);
  centerKnob.scale.setScalar(1.55);
  centerKnob.position.set(0, -0.03, frontFaceZ);
  doorGroup.add(centerKnob);

  // Brass letterplate on lock rail
  addNamedBox(
    doorGroup,
    `${doorGroup.name}.brassLetterplateRim`,
    0.26,
    0.078,
    0.008,
    0,
    -0.19,
    frontFaceZ + 0.004,
    brassMat,
    true
  );
  addNamedBox(
    doorGroup,
    `${doorGroup.name}.brassLetterplateFlap`,
    0.205,
    0.044,
    0.005,
    0,
    -0.19,
    frontFaceZ + 0.0105,
    getDarkAntiquedBrassMaterial(),
    true
  );

  // Latch handle & keyhole escutcheon on lock stile
  const latchKnob = buildAgedBrassMushroomKnob(`${doorGroup.name}.latchKnob`);
  latchKnob.position.set(doorW * 0.5 - 0.072, -0.06, frontFaceZ);
  doorGroup.add(latchKnob);

  wireCatalogHingedDoor(registry, {
    parent: root,
    door: doorGroup,
    hingeOffset: [-doorW * 0.5 + 0.018, 0, 0],
    axis: 'y',
    openAngle: -Math.PI * 0.52,
    label: 'Open Georgian Front Entrance Door',
    audio: { openPreset: 'doorLatch', closePreset: 'doorLatch' },
  });

  // Optional twin dark-lead square planters (`480 x 480 x 480 mm`, `#3A3D40`) with clipped standard bay/olive trees (`H 1750 mm`)
  if (opts.includePlanters ?? true) {
    const isOlive = (opts.treeSpecies ?? 'bay') === 'olive';
    const foliageMaps = getWovenFabricMaps(
      isOlive ? 'olive-foliage' : 'bay-foliage',
      isOlive ? 0x6c7c63 : 0x355031,
      'kubu'
    );
    const foliageMat = new THREE.MeshStandardMaterial({
      name: `${namePrefix}.clippedTopiaryFoliage`,
      map: foliageMaps.colorMap,
      normalMap: foliageMaps.normalMap,
      roughness: 0.86,
      metalness: 0.01,
    });
    const trunkMat = getPaintedJoineryMaterial(0x6b5642, 0.85, `${namePrefix}.standardStem`);
    const soilMat = getPaintedJoineryMaterial(0x362b22, 0.92, `${namePrefix}.topsoil`);

    const planterS = 0.48;
    const planterZ = porticoD + 0.02;
    for (const [pTag, sign] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      const px = sign * (doorwayOuterW * 0.5 + 0.34);
      const pGroup = new THREE.Group();
      pGroup.name = `${namePrefix}.leadPlanter${pTag}`;
      pGroup.position.set(px, stepH, planterZ);
      root.add(pGroup);

      // Lead planter box (`480 x 480 x 480 mm`) w/ raised Georgian relief panel mouldings & rim lip
      addNamedBox(
        pGroup,
        `${pGroup.name}.boxCore`,
        planterS - 0.024,
        planterS - 0.036,
        planterS - 0.024,
        0,
        (planterS - 0.036) * 0.5 + 0.012,
        0,
        leadMat
      );
      addNamedBox(
        pGroup,
        `${pGroup.name}.topRim`,
        planterS,
        0.032,
        planterS,
        0,
        planterS - 0.016,
        0,
        leadMat
      );
      addNamedBox(
        pGroup,
        `${pGroup.name}.frontReliefPanel`,
        planterS - 0.11,
        planterS - 0.14,
        0.008,
        0,
        planterS * 0.48,
        (planterS - 0.024) * 0.5 + 0.004,
        leadMat,
        true
      );
      addNamedBox(
        pGroup,
        `${pGroup.name}.soilBed`,
        planterS - 0.06,
        0.02,
        planterS - 0.06,
        0,
        planterS - 0.045,
        0,
        soilMat
      );

      // Straight standard woody stem + clipped lollipop canopy ball (`total H = 1.75 m` above planter base)
      const stemH = 0.78;
      addNamedCyl(
        pGroup,
        `${pGroup.name}.standardTrunk`,
        0.022,
        0.028,
        stemH,
        12,
        0,
        planterS - 0.04 + stemH * 0.5,
        0,
        trunkMat
      );

      const canopyCenterY = 1.44;
      const mainCanopy = new THREE.Mesh(sharedSphereGeometry(0.31, 18, 16), foliageMat);
      mainCanopy.name = `${pGroup.name}.clippedCanopyCrown`;
      mainCanopy.position.set(0, canopyCenterY, 0);
      mainCanopy.castShadow = true;
      pGroup.add(mainCanopy);

      // Organic secondary leaf clusters breaking the silhouette slightly while staying formally clipped
      const clusterOffsets: readonly [number, number, number, number][] = [
        [0.11, 0.08, 0.09, 0.19],
        [-0.12, 0.05, 0.08, 0.18],
        [0.07, -0.07, -0.11, 0.19],
        [-0.09, 0.1, -0.08, 0.17],
      ];
      clusterOffsets.forEach(([ox, oy, oz, cr], cIdx) => {
        const cl = new THREE.Mesh(sharedSphereGeometry(cr, 12, 10), foliageMat);
        cl.name = `${pGroup.name}.foliageLobe_${cIdx + 1}`;
        cl.position.set(ox, canopyCenterY + oy, oz);
        cl.castShadow = true;
        pGroup.add(cl);
      });
    }
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Georgian Bath-Stone Tuscan Portico & 6-Panel Entrance Door',
    brand: 'Haddonstone',
    collection: 'Classical Porticos',
    sku: 'HAD-TUS-2100',
    finish: 'Cast Bath Limestone / Farrow & Ball Off-Black Gloss & Aged Brass',
    category: 'architectural',
    dimensionsMm: mmFromMetres(porticoW, porticoD, porticoH),
    productUrl: 'https://www.haddonstone.com/en-gb/architectural-cast-stone/porticos/',
    schematicUrl: 'https://www.haddonstone.com/en-gb/technical-library/portico-cad-details.pdf',
  });
}

export interface GeorgianBrickRailingsAndGateOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Number of wrought-iron railing bays on each side of the central gate (default `1`). */
  readonly baysPerSide?: number;
  /** Width of each dwarf-brick + wrought-iron bay in metres (default `2.16`). */
  readonly bayWidthM?: number;
  /** Include the central linked double wrought-iron entrance gate (`2 x 610 x 1420 mm` leaves + overthrow). Default `true`. */
  readonly includeDoubleGate?: boolean;
}

/**
 * Flemish-bond dwarf brick garden wall (`H 450 mm` using `createBrickMaterial('heritage-red-flemish')`
 * + `65 x 275 mm` chamfered `'sawn-yorkstone-coping'`), stone-capped Flemish-brick piers
 * (`450 x 450 x 1680 mm` w/ stepped Yorkstone cap & `Ø220 mm` ball finial), F&B *Railings* (`#45494C`)
 * wrought-iron panels (`16 x 16 mm` verticals at `108 mm` c/c, `40 x 10 mm` rails, alternating `480 mm`
 * fleur-de-lis dog-bars & `115 mm` cast spearhead finials -> `H 1480 mm`), and an interactive
 * linked double wrought-iron entrance gate (`2 x 610 x 1420 mm` leaves w/ arched overthrow scroll).
 */
export function buildGeorgianBrickRailingsAndGate(
  ctx: CatalogInteractionContext = null,
  opts: GeorgianBrickRailingsAndGateOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianBrickRailings';
  const baysPerSide = Math.max(1, opts.baysPerSide ?? 1);
  const bayW = opts.bayWidthM ?? 2.16;
  const includeGate = opts.includeDoubleGate ?? true;
  const registry = resolveRegistry(ctx);

  const brickMat = createBrickMaterial({
    preset: 'heritage-red-flemish',
    bond: 'flemish',
  });
  const copingMat = createStoneMasonryMaterial('sawn-yorkstone-coping');
  const ironMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.farrowBallRailings`,
    color: 0x45494c,
    roughness: 0.36,
    metalness: 0.78,
  });
  const brassMat = getAgedBrassMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  const pierW = 0.45;
  const pierMasonryH = 1.46; // + 0.22 stepped cap + Ø220 ball finial -> pier masonry/cap 1.68 m + finial
  const dwarfBrickH = 0.45;
  const dwarfBrickD = 0.225;
  const copingH = 0.065;
  const copingD = 0.275;
  const gateClearW = 1.24; // 2 x 610 mm leaves + latch/hinge clearances

  const buildPier = (pierId: string, cx: number): void => {
    const pg = new THREE.Group();
    pg.name = `${namePrefix}.${pierId}`;
    pg.position.set(cx, 0, 0);
    root.add(pg);

    // Brick plinth & Flemish-bond pier shaft (1 UV = 1.0 m -> exact 75 mm courses & 225 mm stretchers)
    addMetricMasonryBox(
      pg,
      `${pg.name}.plinthCourse`,
      pierW + 0.036,
      0.15,
      pierW + 0.036,
      0,
      0.075,
      0,
      brickMat,
      cx,
      0,
      0
    );
    addMetricMasonryBox(
      pg,
      `${pg.name}.brickShaft`,
      pierW,
      pierMasonryH - 0.15,
      pierW,
      0,
      0.15 + (pierMasonryH - 0.15) * 0.5,
      0,
      brickMat,
      cx,
      0,
      0
    );
    // Stepped Yorkstone pier cap (`1.46 .. 1.68 m`) + Ø220 mm ball finial on necking socle
    addMetricMasonryBox(
      pg,
      `${pg.name}.yorkstoneCapLower`,
      pierW + 0.09,
      0.11,
      pierW + 0.09,
      0,
      pierMasonryH + 0.055,
      0,
      copingMat,
      cx,
      0,
      0
    );
    addMetricMasonryBox(
      pg,
      `${pg.name}.yorkstoneCapUpper`,
      pierW - 0.02,
      0.11,
      pierW - 0.02,
      0,
      pierMasonryH + 0.165,
      0,
      copingMat,
      cx,
      0,
      0
    );
    addNamedCyl(
      pg,
      `${pg.name}.finialSocle`,
      0.072,
      0.092,
      0.055,
      16,
      0,
      1.68 + 0.0275,
      0,
      copingMat,
      true
    );
    const ball = new THREE.Mesh(sharedSphereGeometry(0.11, 18, 14), copingMat);
    ball.name = `${pg.name}.ballFinial`;
    ball.position.set(0, 1.68 + 0.055 + 0.105, 0);
    ball.castShadow = true;
    pg.add(ball);
  };

  const buildRailingBay = (bayId: string, cx: number, spanW: number): void => {
    const bg = new THREE.Group();
    bg.name = `${namePrefix}.${bayId}`;
    bg.position.set(cx, 0, 0);
    root.add(bg);

    // Flemish-bond dwarf brick garden wall (H 450 mm: 150 mm plinth course between pier plinths + 300 mm upper wall)
    addMetricMasonryBox(
      bg,
      `${bg.name}.dwarfBrickPlinth`,
      spanW - 0.038,
      0.15,
      dwarfBrickD + 0.016,
      0,
      0.075,
      0,
      brickMat,
      cx,
      0,
      0
    );
    addMetricMasonryBox(
      bg,
      `${bg.name}.dwarfBrickWall`,
      spanW,
      dwarfBrickH - 0.15,
      dwarfBrickD,
      0,
      0.15 + (dwarfBrickH - 0.15) * 0.5,
      0,
      brickMat,
      cx,
      0,
      0
    );
    addMetricMasonryBox(
      bg,
      `${bg.name}.yorkstoneCoping`,
      spanW,
      copingH,
      copingD,
      0,
      dwarfBrickH + copingH * 0.5,
      0,
      copingMat,
      cx,
      0,
      0
    );

    // Wrought-iron railings rising above coping (`copingTop = 0.515` -> spearhead tip `1.48 m`)
    const copingTopY = dwarfBrickH + copingH;
    const bottomRailY = copingTopY + 0.055;
    const topRailY = 1.355;
    const railThickY = 0.01;
    const railDepthZ = 0.04;

    addNamedBox(
      bg,
      `${bg.name}.bottomIronRail`,
      spanW,
      railThickY,
      railDepthZ,
      0,
      bottomRailY,
      0,
      ironMat
    );
    addNamedBox(
      bg,
      `${bg.name}.topIronRail`,
      spanW,
      railThickY,
      railDepthZ,
      0,
      topRailY,
      0,
      ironMat
    );

    // Alternating 16 x 16 mm square main verticals (`H -> 1.48 m` w/ 115 mm spearhead) and intermediate 480 mm fleur-de-lis dog-bars at 108 mm c/c
    const pitch = 0.108;
    const nBars = Math.max(3, Math.floor((spanW - 0.08) / pitch));
    const startX = -((nBars - 1) * pitch) * 0.5;

    for (let i = 0; i < nBars; i++) {
      const bx = startX + i * pitch;
      const isDogBar = i % 2 === 1;
      if (!isDogBar) {
        const barBot = copingTopY + 0.002;
        const barTop = 1.365;
        const barH = barTop - barBot;
        addNamedBox(
          bg,
          `${bg.name}.verticalBar_${i + 1}`,
          0.016,
          barH,
          0.016,
          bx,
          barBot + barH * 0.5,
          0,
          ironMat,
          true
        );
        // 115 mm cast spearhead finial (`1.365 .. 1.480 m`)
        addNamedCyl(
          bg,
          `${bg.name}.spearCollar_${i + 1}`,
          0.015,
          0.012,
          0.02,
          8,
          bx,
          1.375,
          0,
          ironMat,
          true
        );
        addNamedCyl(
          bg,
          `${bg.name}.spearPoint_${i + 1}`,
          0.002,
          0.017,
          0.095,
          6,
          bx,
          1.385 + 0.0475,
          0,
          ironMat,
          true
        );
      } else {
        // 480 mm intermediate dog-bar w/ small fleur-de-lis finial
        const dogH = 0.44;
        addNamedBox(
          bg,
          `${bg.name}.dogBar_${i + 1}`,
          0.014,
          dogH,
          0.014,
          bx,
          bottomRailY + 0.006 + dogH * 0.5,
          0,
          ironMat,
          true
        );
        addNamedCyl(
          bg,
          `${bg.name}.dogFleurFinial_${i + 1}`,
          0.003,
          0.013,
          0.042,
          6,
          bx,
          bottomRailY + 0.006 + dogH + 0.021,
          0,
          ironMat,
          true
        );
      }
    }
  };

  if (includeGate) {
    const gateLeftPierX = -(gateClearW * 0.5 + pierW * 0.5);
    const gateRightPierX = gateClearW * 0.5 + pierW * 0.5;
    buildPier('gatePierLeft', gateLeftPierX);
    buildPier('gatePierRight', gateRightPierX);

    for (let b = 0; b < baysPerSide; b++) {
      const bayOffset = gateRightPierX + pierW * 0.5 + bayW * 0.5 + b * (bayW + pierW);
      const outerPierX = bayOffset + bayW * 0.5 + pierW * 0.5;
      buildRailingBay(`railingBayLeft_${b + 1}`, -bayOffset, bayW);
      buildPier(`endPierLeft_${b + 1}`, -outerPierX);
      buildRailingBay(`railingBayRight_${b + 1}`, bayOffset, bayW);
      buildPier(`endPierRight_${b + 1}`, outerPierX);
    }

    // Arched wrought-iron overthrow scroll spanning between the two gate piers above the gate leaves
    const archSpanR = gateClearW * 0.5 + 0.02;
    const overthrowArch = new THREE.Mesh(
      sharedTorusGeometry(archSpanR, 0.014, 10, 26, Math.PI),
      ironMat
    );
    overthrowArch.name = `${namePrefix}.gateOverthrowArch`;
    overthrowArch.position.set(0, 1.48, 0);
    root.add(overthrowArch);

    const innerScroll = new THREE.Mesh(
      sharedTorusGeometry(archSpanR - 0.085, 0.01, 8, 24, Math.PI),
      ironMat
    );
    innerScroll.name = `${namePrefix}.gateOverthrowInnerArch`;
    innerScroll.position.set(0, 1.48, 0);
    root.add(innerScroll);

    // Central lantern/crest finial ring at apex of overthrow
    const crestRing = new THREE.Mesh(sharedTorusGeometry(0.085, 0.009, 8, 18), ironMat);
    crestRing.name = `${namePrefix}.gateOverthrowCrest`;
    crestRing.position.set(0, 1.48 + archSpanR - 0.042, 0);
    tagHighLod(crestRing);
    root.add(crestRing);

    addNamedCyl(
      root,
      `${namePrefix}.gateOverthrowApexSpear`,
      0.003,
      0.018,
      0.12,
      6,
      0,
      1.48 + archSpanR + 0.065,
      0,
      brassMat,
      true
    );

    // Interactive linked double wrought-iron entrance gate (`2 x 610 x 1420 mm` leaves)
    const leafW = 0.61;
    const leafH = 1.42;
    const groundClearY = 0.05;
    let leftGatePivot: THREE.Object3D | null = null;
    let rightGatePivot: THREE.Object3D | null = null;

    for (const [gTag, sign] of [
      ['leftGateLeaf', -1],
      ['rightGateLeaf', 1],
    ] as const) {
      const leafCx = sign * (leafW * 0.5 + 0.005);
      const leafGroup = new THREE.Group();
      leafGroup.name = `${namePrefix}.${gTag}`;
      leafGroup.position.set(leafCx, groundClearY + leafH * 0.5, 0);
      root.add(leafGroup);

      // Outer hinge & meeting stiles (30 x 30 mm)
      addNamedBox(
        leafGroup,
        `${leafGroup.name}.hingeStile`,
        0.03,
        leafH,
        0.03,
        sign * (leafW * 0.5 - 0.015),
        0,
        0,
        ironMat
      );
      addNamedBox(
        leafGroup,
        `${leafGroup.name}.meetingStile`,
        0.026,
        leafH - 0.06,
        0.026,
        -sign * (leafW * 0.5 - 0.013),
        -0.03,
        0,
        ironMat
      );
      // Top, mid-lock, and bottom horizontal rails strictly between stiles
      const innerLeafW = leafW - 0.056;
      for (const [rName, ry] of [
        ['bottomRail', -leafH * 0.5 + 0.06],
        ['midDogRail', -leafH * 0.5 + 0.5],
        ['topRail', leafH * 0.5 - 0.14],
      ] as const) {
        addNamedBox(
          leafGroup,
          `${leafGroup.name}.${rName}`,
          innerLeafW,
          0.014,
          0.036,
          0,
          ry,
          0,
          ironMat
        );
      }

      // 5 vertical bars w/ spearhead finials + 4 dog-bars
      const nGateBars = 5;
      const gPitch = innerLeafW / (nGateBars + 0.5);
      for (let k = 0; k < nGateBars; k++) {
        const kx = -innerLeafW * 0.5 + (k + 0.75) * gPitch;
        const vBarH = leafH - 0.2;
        addNamedBox(
          leafGroup,
          `${leafGroup.name}.picket_${k + 1}`,
          0.016,
          vBarH,
          0.016,
          kx,
          -0.04,
          0,
          ironMat,
          true
        );
        addNamedCyl(
          leafGroup,
          `${leafGroup.name}.spear_${k + 1}`,
          0.002,
          0.016,
          0.095,
          6,
          kx,
          leafH * 0.5 - 0.14 + 0.055,
          0,
          ironMat,
          true
        );
      }

      // Decorative C-scroll rings in lower dog-bar panel + aged brass drop-ring latch on left meeting stile
      const ring = new THREE.Mesh(sharedTorusGeometry(0.052, 0.007, 8, 16), ironMat);
      ring.name = `${leafGroup.name}.scrollMedallion`;
      ring.position.set(0, -leafH * 0.5 + 0.28, 0);
      tagHighLod(ring);
      leafGroup.add(ring);

      if (sign < 0) {
        const latchRing = new THREE.Mesh(sharedTorusGeometry(0.032, 0.006, 8, 16), brassMat);
        latchRing.name = `${leafGroup.name}.brassGateRingLatch`;
        latchRing.position.set(leafW * 0.5 - 0.035, 0.08, 0.026);
        tagHighLod(latchRing);
        leafGroup.add(latchRing);
      }

      const pivot = wireCatalogHingedDoor(registry, {
        parent: root,
        door: leafGroup,
        hingeOffset: [sign * (leafW * 0.5 - 0.015), 0, 0],
        axis: 'y',
        openAngle: sign < 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
        label: 'Open Wrought-Iron Forecourt Gates',
        linkGroup: 'forecourtDoubleGate',
        audio: { openPreset: 'gateLatch', closePreset: 'gateLatch', isExterior: true },
      });
      if (sign < 0) leftGatePivot = pivot;
      else rightGatePivot = pivot;
    }

    if (registry && leftGatePivot && rightGatePivot) {
      registry.linkDoorPair(leftGatePivot, rightGatePivot);
    }
  } else {
    buildPier('pierLeft', -(bayW * 0.5 + pierW * 0.5));
    buildRailingBay('railingBay_1', 0, bayW);
    buildPier('pierRight', bayW * 0.5 + pierW * 0.5);
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Georgian Flemish-Brick Dwarf Wall, Wrought-Iron Railings & Double Gate',
    brand: 'British Spirals & Castings',
    collection: 'Georgian Heritage Ironwork',
    sku: `BSC-GEO-GATE-${baysPerSide * 2}B`,
    finish: 'Heritage Flemish Red Brick, Sawn Yorkstone & Farrow & Ball Railings (#45494C)',
    category: 'architectural',
    dimensionsMm: mmFromMetres(baysPerSide * 2 * bayW + 1.8, 0.45, 1.92),
    productUrl: 'https://www.britishsc.co.uk/cast-iron-railings-and-gates/',
    schematicUrl: 'https://www.britishsc.co.uk/technical/georgian-railing-and-gate-elevation.pdf',
  });
}

export type GeorgianFacadeDressingKind =
  | 'cornerQuoins'
  | 'stringcourse'
  | 'eavesCornice'
  | 'chimneyStack'
  | 'rainwaterDownpipe'
  | 'completeEnsemble';

export interface GeorgianFacadeDressingsOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly kind?: GeorgianFacadeDressingKind;
  /** Height for corner quoins or rainwater downpipe in metres (default `3.0`). */
  readonly heightM?: number;
  /** Horizontal length for stringcourse or modillion/dentil eaves cornice in metres (default `3.6`). */
  readonly lengthM?: number;
  /** Corner quoin orientation (`'left'` or `'right'`, default `'left'`). */
  readonly cornerSide?: 'left' | 'right';
}

/**
 * Parametric Georgian facade dressings:
 * - Alternating Bath-stone corner quoins (`450/225 x 215 x 22 mm` chamfered ashlar blocks wrapping a 90° corner)
 * - Bath-stone inter-floor stringcourse (`H 140 mm`)
 * - Modillion/dentil eaves cornice (`H 220 mm`)
 * - Symmetrical Flemish-brick chimney stacks (`900 x 550 mm` w/ oversailing brick corbels & paired `Ø240 x 450 mm` terracotta roll-top pots)
 * - Black cast-iron `Ø75 mm` rainwater downpipes + moulded hopper heads + eared pipe clips.
 */
export function buildGeorgianFacadeDressings(
  opts: GeorgianFacadeDressingsOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianFacadeDressings';
  const kind = opts.kind ?? 'completeEnsemble';
  const bathStoneMat = getBathStoneMaterial();
  const brickMat = createBrickMaterial({
    preset: 'heritage-red-flemish',
    bond: 'flemish',
  });
  const castIronMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.castIronBlack`,
    color: 0x222528,
    roughness: 0.4,
    metalness: 0.72,
  });
  const terracottaMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.terracottaPot`,
    color: 0xb55a3c,
    roughness: 0.72,
    metalness: 0.03,
  });

  const root = new THREE.Group();
  root.name = namePrefix;

  const heightM = opts.heightM ?? 3.0;
  const lengthM = opts.lengthM ?? 3.6;

  if (kind === 'cornerQuoins' || kind === 'completeEnsemble') {
    const qGroup = new THREE.Group();
    qGroup.name = `${namePrefix}.cornerQuoins`;
    if (kind === 'completeEnsemble') {
      qGroup.position.set(-lengthM * 0.5, 0, 0);
    }
    root.add(qGroup);

    const sign = (opts.cornerSide ?? 'left') === 'left' ? 1 : -1;
    const quoinH = 0.215;
    const jointH = 0.01;
    const pitchY = quoinH + jointH;
    const reliefT = 0.022;
    const count = Math.max(2, Math.floor(heightM / pitchY));

    for (let i = 0; i < count; i++) {
      const isLongFront = i % 2 === 0;
      const frontLen = isLongFront ? 0.45 : 0.225;
      const returnLen = isLongFront ? 0.225 : 0.45;
      const cy = i * pitchY + quoinH * 0.5;

      // Front face quoin (`+Z` relief `0..22 mm`)
      addNamedBox(
        qGroup,
        `${qGroup.name}.frontBlock_${i + 1}`,
        frontLen,
        quoinH,
        reliefT,
        sign * (frontLen * 0.5),
        cy,
        reliefT * 0.5,
        bathStoneMat
      );
      // 90° return face quoin along `-Z` strictly behind `z = 0` so zero overlap at the corner arris
      addNamedBox(
        qGroup,
        `${qGroup.name}.returnBlock_${i + 1}`,
        reliefT,
        quoinH,
        returnLen,
        -sign * (reliefT * 0.5),
        cy,
        -returnLen * 0.5,
        bathStoneMat
      );
    }
  }

  if (kind === 'stringcourse' || kind === 'completeEnsemble') {
    const sGroup = new THREE.Group();
    sGroup.name = `${namePrefix}.stringcourse`;
    const scLen = kind === 'completeEnsemble' ? Math.max(0.6, lengthM - 0.46) : lengthM;
    if (kind === 'completeEnsemble') {
      sGroup.position.set(0.23, heightM * 0.5, 0);
    }
    root.add(sGroup);

    // H 140 mm weathered Bath-stone inter-floor stringcourse (`lower fillet 45 mm` + `projecting drip band 95 mm`)
    addNamedBox(
      sGroup,
      `${sGroup.name}.lowerFillet`,
      scLen,
      0.045,
      0.042,
      0,
      0.0225,
      0.021,
      bathStoneMat
    );
    addNamedBox(
      sGroup,
      `${sGroup.name}.upperWeatheredBand`,
      scLen,
      0.095,
      0.068,
      0,
      0.045 + 0.0475,
      0.034,
      bathStoneMat
    );
  }

  if (kind === 'eavesCornice' || kind === 'completeEnsemble') {
    const cGroup = new THREE.Group();
    cGroup.name = `${namePrefix}.eavesCornice`;
    if (kind === 'completeEnsemble') {
      cGroup.position.set(0, heightM, 0);
    }
    root.add(cGroup);

    // H 220 mm classical Georgian dentil/modillion eaves cornice
    addNamedBox(
      cGroup,
      `${cGroup.name}.bedMould`,
      lengthM,
      0.055,
      0.075,
      0,
      0.0275,
      0.0375,
      bathStoneMat
    );
    // Dentil / modillion bracket course (`y = 0.055 .. 0.135`, backing frieze + projecting modillions)
    addNamedBox(
      cGroup,
      `${cGroup.name}.dentilBacking`,
      lengthM,
      0.08,
      0.065,
      0,
      0.095,
      0.0325,
      bathStoneMat
    );
    const modPitch = 0.18;
    const nMods = Math.max(4, Math.floor((lengthM - 0.12) / modPitch));
    const modStart = -((nMods - 1) * modPitch) * 0.5;
    for (let m = 0; m < nMods; m++) {
      addNamedBox(
        cGroup,
        `${cGroup.name}.modillion_${m + 1}`,
        0.072,
        0.072,
        0.105,
        modStart + m * modPitch,
        0.095,
        0.065 + 0.0525,
        bathStoneMat,
        true
      );
    }
    // Projecting corona & cyma-recta crown (`y = 0.135 .. 0.220`)
    addNamedBox(
      cGroup,
      `${cGroup.name}.coronaCrown`,
      lengthM + 0.04,
      0.085,
      0.21,
      0,
      0.135 + 0.0425,
      0.105,
      bathStoneMat
    );
  }

  if (kind === 'chimneyStack' || kind === 'completeEnsemble') {
    const chGroup = new THREE.Group();
    chGroup.name = `${namePrefix}.chimneyStack`;
    if (kind === 'completeEnsemble') {
      chGroup.position.set(0, heightM + 0.22, -0.45);
    }
    root.add(chGroup);

    const stackW = 0.9;
    const stackD = 0.55;
    const shaftH = 1.15;
    // Flemish-brick chimney shaft
    addMetricMasonryBox(
      chGroup,
      `${chGroup.name}.flemishBrickShaft`,
      stackW,
      shaftH,
      stackD,
      0,
      shaftH * 0.5,
      0,
      brickMat
    );
    // 2 oversailing brick corbel courses + Bath-stone necking band
    addMetricMasonryBox(
      chGroup,
      `${chGroup.name}.oversailingCorbelLower`,
      stackW + 0.08,
      0.075,
      stackD + 0.08,
      0,
      shaftH + 0.0375,
      0,
      brickMat
    );
    addMetricMasonryBox(
      chGroup,
      `${chGroup.name}.oversailingCorbelUpper`,
      stackW + 0.15,
      0.075,
      stackD + 0.15,
      0,
      shaftH + 0.075 + 0.0375,
      0,
      brickMat
    );
    addMetricMasonryBox(
      chGroup,
      `${chGroup.name}.stoneFlaunchingCap`,
      stackW + 0.12,
      0.055,
      stackD + 0.12,
      0,
      shaftH + 0.15 + 0.0275,
      0,
      bathStoneMat
    );

    // Paired Ø240 x 450 mm terracotta roll-top chimney pots
    const potBaseY = shaftH + 0.205;
    const potH = 0.45;
    for (const [pTag, px] of [
      ['Left', -0.22],
      ['Right', 0.22],
    ] as const) {
      addNamedCyl(
        chGroup,
        `${chGroup.name}.terracottaPot${pTag}`,
        0.105,
        0.12,
        potH,
        18,
        px,
        potBaseY + potH * 0.5,
        0,
        terracottaMat
      );
      const rollRim = new THREE.Mesh(sharedTorusGeometry(0.108, 0.018, 10, 18), terracottaMat);
      rollRim.name = `${chGroup.name}.terracottaRollTop${pTag}`;
      rollRim.rotation.x = Math.PI * 0.5;
      rollRim.position.set(px, potBaseY + potH, 0);
      tagHighLod(rollRim);
      chGroup.add(rollRim);
    }
  }

  if (kind === 'rainwaterDownpipe' || kind === 'completeEnsemble') {
    const dpGroup = new THREE.Group();
    dpGroup.name = `${namePrefix}.rainwaterDownpipe`;
    if (kind === 'completeEnsemble') {
      dpGroup.position.set(lengthM * 0.5 - 0.18, 0, 0);
    }
    root.add(dpGroup);

    const pipeR = 0.0375; // Ø75 mm cast-iron downpipe
    const pipeZ = 0.062;
    const hopperH = 0.21;
    const hopperTopY = heightM - 0.04;
    const shoeH = 0.14;
    const pipeLen = Math.max(0.6, hopperTopY - hopperH - shoeH - 0.04);

    // Moulded Georgian cast-iron rainwater hopper head
    addNamedBox(
      dpGroup,
      `${dpGroup.name}.hopperLowerBowl`,
      0.19,
      hopperH * 0.55,
      0.14,
      0,
      hopperTopY - hopperH * 0.725,
      0.07,
      castIronMat,
      true
    );
    addNamedBox(
      dpGroup,
      `${dpGroup.name}.hopperMouldedRim`,
      0.25,
      hopperH * 0.45,
      0.175,
      0,
      hopperTopY - hopperH * 0.225,
      0.0875,
      castIronMat
    );

    // Main Ø75 mm cast-iron pipe stack
    addNamedCyl(
      dpGroup,
      `${dpGroup.name}.castIronPipeShaft`,
      pipeR,
      pipeR,
      pipeLen,
      16,
      0,
      shoeH + 0.04 + pipeLen * 0.5,
      pipeZ,
      castIronMat
    );

    // Eared pipe socket clips every ~0.95 m
    const clipCount = Math.max(2, Math.floor(pipeLen / 0.95) + 1);
    for (let c = 0; c < clipCount; c++) {
      const cy = shoeH + 0.12 + (c / Math.max(1, clipCount - 1)) * (pipeLen - 0.16);
      addNamedCyl(
        dpGroup,
        `${dpGroup.name}.pipeSocketCollar_${c + 1}`,
        pipeR + 0.008,
        pipeR + 0.008,
        0.048,
        16,
        0,
        cy,
        pipeZ,
        castIronMat,
        true
      );
      addNamedBox(
        dpGroup,
        `${dpGroup.name}.pipeEarBracket_${c + 1}`,
        0.165,
        0.036,
        0.016,
        0,
        cy,
        0.01,
        castIronMat,
        true
      );
    }

    // Angled bottom discharge shoe above gully
    const shoe = addNamedCyl(
      dpGroup,
      `${dpGroup.name}.bottomDischargeShoe`,
      pipeR + 0.003,
      pipeR + 0.005,
      shoeH,
      16,
      0,
      0.04 + shoeH * 0.5,
      pipeZ + 0.025,
      castIronMat,
      true
    );
    shoe.rotation.x = 0.36;
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: `Georgian Bath-Stone & Cast-Iron Facade Dressings (${kind})`,
    brand: 'Haddonstone',
    collection: 'Georgian Architectural Dressings',
    sku: `HAD-GEO-${kind.toUpperCase()}`,
    finish: 'Bath Limestone Ashlar & Heritage Cast Iron',
    category: 'architectural',
    productUrl: 'https://www.haddonstone.com/en-gb/architectural-cast-stone/',
    schematicUrl: 'https://www.haddonstone.com/en-gb/technical-library/quoins-and-cornices.pdf',
  });
}

export interface GeorgianBolectionFireplaceOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly hearthStyle?: 'slate' | 'herringboneBrick';
  /** Include the Charnwood *C-Five* (`556 x 357 x 560 mm`) cast-iron stove + Ø125 mm flue & animated fire. Default `true`. */
  readonly includeStove?: boolean;
}

/**
 * `1420 x 210 x 1160 mm` George III Honed Carrara bolection marble fireplace surround,
 * herringbone firebrick chamber, honed slate / herringbone-brick hearth (`1520 x 480 x 35 mm`),
 * and **Charnwood *C-Five* (`556 x 357 x 560 mm`)** cast-iron wood-burning stove body + `Ø125 mm` flue pipe
 * (integrating `buildHallWoodBurningStoveFirebox` and registering its `WoodBurningStoveFireController` when `ctx` is supplied).
 * Local origin `(0, 0, 0)` is at floor level (`y = 0`) on the chimney-breast face (`z = 0`), with chamber recessed into `-Z` and hearth/surround projecting `+Z`.
 */
export function buildGeorgianBolectionFireplace(
  ctx: CatalogInteractionContext = null,
  opts: GeorgianBolectionFireplaceOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianBolectionFireplace';
  const carraraMat = getHonedCarraraCatalogMaterial();
  const slateMat = getMatteCastIronMaterial(0x272a2d);
  const firebrickMat = createBrickMaterial({
    preset: 'heritage-red-flemish',
    bond: 'herringbone-45',
    weathering: { sootLevel: 0.52, kilnFlash: 0.4 },
  });
  const castIronMat = getMatteCastIronMaterial(0x1f2124);
  const brassMat = getAgedBrassMaterial();
  const registry = resolveRegistry(ctx);

  const root = new THREE.Group();
  root.name = namePrefix;

  const hearthW = 1.52;
  const hearthFrontD = 0.48;
  const chamberD = 0.42;
  const hearthH = 0.035;
  const hearthMat = (opts.hearthStyle ?? 'slate') === 'herringboneBrick' ? firebrickMat : slateMat;

  // Front hearth (`z = 0 .. +0.48`) + chamber hearth floor (`z = -0.42 .. 0`) as one continuous non-overlapping slab
  addMetricMasonryBox(
    root,
    `${namePrefix}.frontHearthSlab`,
    hearthW,
    hearthH,
    hearthFrontD,
    0,
    hearthH * 0.5,
    hearthFrontD * 0.5,
    hearthMat
  );

  const openW = 0.88;
  const openH = 0.86;
  const chamberWallT = 0.04;
  addMetricMasonryBox(
    root,
    `${namePrefix}.chamberHearthFloor`,
    openW + chamberWallT * 2,
    hearthH,
    chamberD,
    0,
    hearthH * 0.5,
    -chamberD * 0.5,
    hearthMat
  );

  // Herringbone firebrick chamber walls (`z = -chamberD .. 0`, strictly behind `z = 0`)
  addMetricMasonryBox(
    root,
    `${namePrefix}.chamberBackFirebrick`,
    openW,
    openH,
    chamberWallT,
    0,
    hearthH + openH * 0.5,
    -chamberD + chamberWallT * 0.5,
    firebrickMat
  );
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addMetricMasonryBox(
      root,
      `${namePrefix}.chamberCheekFirebrick${sTag}`,
      chamberWallT,
      openH,
      chamberD - chamberWallT,
      sign * (openW * 0.5 + chamberWallT * 0.5),
      hearthH + openH * 0.5,
      -(chamberD - chamberWallT) * 0.5,
      firebrickMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.chamberSoffitRegisterPlate`,
    openW + chamberWallT * 2,
    0.025,
    chamberD,
    0,
    hearthH + openH + 0.0125,
    -chamberD * 0.5,
    slateMat
  );

  // George III Honed Carrara bolection marble surround (`1420 x 210 x 1160 mm` above hearth)
  const surrW = 1.42;
  const surrTotalH = 1.16;
  const shelfH = 0.055;
  const surrD = 0.21;
  const legW = (surrW - openW) * 0.5; // 0.27 m
  const legH = openH;
  const friezeH = surrTotalH - hearthH - legH - shelfH;
  const slipsD = 0.115;

  // Outer Carrara jamb legs & frieze header (`z = 0 .. slipsD`)
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.carraraJambFootBlock${sTag}`,
      legW + 0.024,
      0.13,
      slipsD + 0.02,
      sign * (openW * 0.5 + legW * 0.5),
      hearthH + 0.065,
      (slipsD + 0.02) * 0.5,
      carraraMat
    );
    addNamedBox(
      root,
      `${namePrefix}.carraraJambPilaster${sTag}`,
      legW,
      legH - 0.13,
      slipsD,
      sign * (openW * 0.5 + legW * 0.5),
      hearthH + 0.13 + (legH - 0.13) * 0.5,
      slipsD * 0.5,
      carraraMat
    );
  }

  addNamedBox(
    root,
    `${namePrefix}.carraraFriezeLintel`,
    surrW,
    friezeH,
    slipsD,
    0,
    hearthH + legH + friezeH * 0.5,
    slipsD * 0.5,
    carraraMat
  );

  // Central carved George III tablet plaque proud on the upper frieze above the bolection header roll (`z = slipsD + 0.001 .. slipsD + 0.019`)
  const upperFriezeH = Math.max(0.06, friezeH - 0.095 - 0.022);
  addNamedBox(
    root,
    `${namePrefix}.carraraCenterFriezeTablet`,
    0.44,
    upperFriezeH,
    0.018,
    0,
    hearthH + legH + 0.095 + (friezeH - 0.095) * 0.5,
    slipsD + 0.01,
    carraraMat
  );

  // Bold George III bolection cushion moulding framing the fireplace opening (`z = slipsD .. slipsD + 0.055`, strictly forward of jambs/frieze!)
  const bolW = 0.095;
  const bolD = 0.052;
  const bolZ = slipsD + bolD * 0.5;
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.bolectionVerticalRoll${sTag}`,
      bolW,
      legH - 0.13,
      bolD,
      sign * (openW * 0.5 + bolW * 0.5),
      hearthH + 0.13 + (legH - 0.13) * 0.5,
      bolZ,
      carraraMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.bolectionHeaderRoll`,
    openW + bolW * 2,
    bolW,
    bolD,
    0,
    hearthH + legH + bolW * 0.5,
    bolZ,
    carraraMat
  );

  // Breakfront Honed Carrara mantle shelf (`1480 x 210 x 55 mm`)
  addNamedBox(
    root,
    `${namePrefix}.carraraMantleShelf`,
    surrW + 0.06,
    shelfH,
    surrD,
    0,
    hearthH + legH + friezeH + shelfH * 0.5,
    surrD * 0.5,
    carraraMat
  );

  // Charnwood *C-Five* (`556 W x 357 D x 560 H mm`) cast-iron wood-burning stove + Ø125 mm flue pipe
  let fireController: WoodBurningStoveFireController | undefined;
  if (opts.includeStove ?? true) {
    const stoveW = 0.556;
    const stoveD = 0.357;
    const stoveH = 0.56;
    const legStoveH = 0.125;

    const stoveOuter = new THREE.Group();
    stoveOuter.name = `${namePrefix}.charnwoodCFiveStove`;
    stoveOuter.position.set(0, hearthH, -0.15);
    root.add(stoveOuter);

    // 4 splayed Charnwood corner legs
    for (const [lTag, lx, lz] of [
      ['FL', -stoveW * 0.43, stoveD * 0.4],
      ['FR', stoveW * 0.43, stoveD * 0.4],
      ['BL', -stoveW * 0.43, -stoveD * 0.4],
      ['BR', stoveW * 0.43, -stoveD * 0.4],
    ] as const) {
      addNamedBox(
        stoveOuter,
        `${stoveOuter.name}.leg_${lTag}`,
        0.044,
        legStoveH,
        0.044,
        lx,
        legStoveH * 0.5,
        lz,
        castIronMat,
        true
      );
    }

    // Hollow cast-iron stove body shell around the recessed firebox so front glass reveals flames & embers!
    const bodyBotY = legStoveH;
    const bodyTopY = stoveH - 0.024;
    const bodyBoxH = bodyTopY - bodyBotY;
    const ashLipH = 0.055;
    const headerH = 0.075;
    const cheekW = 0.078;

    // Bottom ashpan floor & projecting ash-lip apron
    addNamedBox(
      stoveOuter,
      `${stoveOuter.name}.stoveFloorPlate`,
      stoveW,
      ashLipH,
      stoveD + 0.036,
      0,
      bodyBotY + ashLipH * 0.5,
      0.018,
      castIronMat
    );
    // Top convection plate (`556 x 357 x 24 mm`)
    addNamedBox(
      stoveOuter,
      `${stoveOuter.name}.stoveTopPlate`,
      stoveW + 0.016,
      0.024,
      stoveD + 0.016,
      0,
      stoveH - 0.012,
      0,
      castIronMat
    );
    // Back cast-iron wall
    const midWindowH = bodyBoxH - ashLipH - headerH;
    const midWindowCy = bodyBotY + ashLipH + midWindowH * 0.5;
    addNamedBox(
      stoveOuter,
      `${stoveOuter.name}.stoveRearWall`,
      stoveW,
      bodyBoxH - ashLipH,
      0.055,
      0,
      bodyBotY + ashLipH + (bodyBoxH - ashLipH) * 0.5,
      -stoveD * 0.5 + 0.0275,
      castIronMat
    );
    // Left & Right cast-iron side cheeks strictly between rear wall and front face
    for (const [cTag, sign] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      addNamedBox(
        stoveOuter,
        `${stoveOuter.name}.stoveSideCheek${cTag}`,
        cheekW,
        midWindowH,
        stoveD - 0.055,
        sign * (stoveW * 0.5 - cheekW * 0.5),
        midWindowCy,
        0.0275,
        castIronMat
      );
    }
    // Upper cast-iron lintel above ceramic glass window
    addNamedBox(
      stoveOuter,
      `${stoveOuter.name}.stoveHeaderBand`,
      stoveW,
      headerH,
      stoveD - 0.055,
      0,
      bodyTopY - headerH * 0.5,
      0.0275,
      castIronMat
    );
    // Cool-to-touch Charnwood turned handle & Quattro air-control pull rod
    addNamedCyl(
      stoveOuter,
      `${stoveOuter.name}.doorHandleGrip`,
      0.011,
      0.011,
      0.11,
      12,
      stoveW * 0.5 - 0.038,
      midWindowCy,
      stoveD * 0.5 + 0.026,
      brassMat,
      true
    );
    const airKnob = addNamedCyl(
      stoveOuter,
      `${stoveOuter.name}.quattroAirControl`,
      0.014,
      0.014,
      0.024,
      12,
      0,
      bodyBotY + 0.028,
      stoveD * 0.5 + 0.048,
      brassMat,
      true
    );
    airKnob.rotation.x = Math.PI * 0.5;

    // Ø125 mm matte cast-iron flue pipe rising cleanly into the register plate
    const flueH = Math.max(0.28, openH - stoveH + 0.02);
    addNamedCyl(
      stoveOuter,
      `${stoveOuter.name}.flueCollar`,
      0.074,
      0.078,
      0.036,
      18,
      0,
      stoveH + 0.018,
      -0.05,
      castIronMat,
      true
    );
    addNamedCyl(
      stoveOuter,
      `${stoveOuter.name}.fluePipe125`,
      0.0625,
      0.0625,
      flueH,
      20,
      0,
      stoveH + 0.036 + flueH * 0.5,
      -0.05,
      castIronMat
    );

    // Oriented inner firebox container: `buildHallWoodBurningStoveFirebox` faces `-X` in its own frame,
    // so rotating `-Math.PI / 2` around Y aims the ceramic door glass & hearth glow straight out `+Z`!
    const fireboxMount = new THREE.Group();
    fireboxMount.name = `${stoveOuter.name}.fireboxMount`;
    fireboxMount.rotation.y = -Math.PI * 0.5;
    fireboxMount.position.set(0, 0.002, 0.004);
    stoveOuter.add(fireboxMount);

    fireController = buildHallWoodBurningStoveFirebox({
      stoveGroup: fireboxMount,
      castIronMat,
      namePrefix: `${namePrefix}.firebox`,
      id: `stove-fire:${namePrefix}`,
      label: 'Charnwood C-Five Wood-Burning Stove',
    });

    if (registry) {
      registry.registerAnimatedInteractable(fireController);
    } else if (fireController) {
      const fc = fireController;
      attachAssetInteraction(root, {
        kind: 'custom',
        label: 'Light Charnwood C-Five Wood-Burning Stove',
        activeLabel: 'Extinguish Charnwood C-Five Stove',
        initialActive: true,
        audio: { activeLoopPreset: 'woodStove', volume: 0.6 },
        onToggle: () => {
          fc.trigger();
        },
        onStep: (dt) => fc.step(dt),
      });
    }
  }

  const finalized = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  if (fireController) {
    finalized.userData.stoveFireController = fireController;
  }
  return attachAssetMetadata(finalized, {
    name: 'Georgian Carrara Bolection Chimneypiece & Charnwood C-Five Stove',
    brand: 'Chesneys & Charnwood',
    collection: 'Georgian Marble Chimneypieces / C-Series',
    sku: 'CHES-BOL-CHARN-C5',
    finish: 'Honed Carrara Marble, Riven Welsh Slate & Matte Black Cast Iron',
    category: 'architectural',
    dimensionsMm: [1420, 480, 1220],
    productUrl: 'https://www.charnwood.com/range/stove/c-five/',
    schematicUrl: 'https://www.charnwood.com/wp-content/uploads/C-Five-Dimensions-Spec.pdf',
  });
}

export interface GeorgianAlcoveBookcaseOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Paint colour (default Neptune *Old Chalk* `#D8D2C2`). */
  readonly paintColor?: THREE.ColorRepresentation;
  readonly widthM?: number;
  readonly baseDepthM?: number;
  readonly upperDepthM?: number;
  readonly heightM?: number;
  readonly interactions?: InteractionRegistry;
}

/**
 * `1180 x 420 x 2550 mm` Georgian fitted alcove bookcase:
 * cock-beaded 2-door Shaker base cupboard (`H 840 mm`, Neptune *Old Chalk* `#D8D2C2`) +
 * upper 4-shelf fluted-pilaster open bookcase (`D 310 mm`) with warm `2700K` shelf wash
 * and procedural leather/linen hardbacks, ceramic vessels & reed diffuser.
 */
export function buildGeorgianAlcoveBookcase(
  opts: GeorgianAlcoveBookcaseOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianAlcoveBookcase';
  const w = opts.widthM ?? 1.18;
  const baseD = opts.baseDepthM ?? 0.42;
  const upperD = opts.upperDepthM ?? 0.31;
  const totalH = opts.heightM ?? 2.55;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xd8d2c2,
    0.54,
    `${namePrefix}.oldChalkPaint`
  );
  const oakMat = getCharacterOakMaterial();
  const brassMat = getAgedBrassMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const ledMat = getWarm2700kLedMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  const plinthH = 0.1;
  const counterH = 0.028;
  const baseH = 0.84;
  const carcassH = baseH - counterH;
  const stileW = 0.036;
  const frameT = 0.024;
  const baseFrontZ = baseD;

  // Base plinth (`z = 0 .. baseD - 0.02`)
  addNamedBox(
    root,
    `${namePrefix}.basePlinth`,
    w,
    plinthH,
    baseD - 0.02,
    0,
    plinthH * 0.5,
    (baseD - 0.02) * 0.5,
    paintMat
  );

  // Base carcass walls (`z = 0 .. baseD - frameT`)
  const baseBodyH = carcassH - plinthH;
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
      (baseD - frameT) * 0.5,
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
    0.009,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.baseInnerShelf`,
    w - wallT * 2 - 0.004,
    0.02,
    baseD - frameT - 0.04,
    0,
    baseBodyMidY,
    (baseD - frameT) * 0.5,
    oakMat
  );

  // Cock-beaded 2-door Shaker base face-frame
  const openW = w - stileW * 2;
  const openH = baseBodyH - stileW * 2;
  const openCy = plinthH + stileW + openH * 0.5;
  const fz = baseFrontZ - frameT * 0.5;

  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.baseFrameStile${sTag}`,
      stileW,
      baseBodyH,
      frameT,
      sign * (w * 0.5 - stileW * 0.5),
      baseBodyMidY,
      fz,
      paintMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.baseFrameRailTop`,
    openW,
    stileW,
    frameT,
    0,
    carcassH - stileW * 0.5,
    fz,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.baseFrameRailBottom`,
    openW,
    stileW,
    frameT,
    0,
    plinthH + stileW * 0.5,
    fz,
    paintMat
  );
  addCockBeadApertureTrim(root, `${namePrefix}.baseBead`, 0, openCy, baseFrontZ, openW, openH, paintMat);

  const leafW = (openW - 0.012) * 0.5;
  let leftDoorPivot: THREE.Object3D | null = null;
  let rightDoorPivot: THREE.Object3D | null = null;
  for (const [dTag, sign] of [
    ['leftDoor', -1],
    ['rightDoor', 1],
  ] as const) {
    const dGroup = new THREE.Group();
    dGroup.name = `${namePrefix}.${dTag}`;
    dGroup.position.set(sign * (leafW * 0.5 + 0.002), openCy, baseFrontZ - 0.012);
    root.add(dGroup);

    dGroup.add(
      buildShakerDoorAssembly(`${dGroup.name}.panel`, leafW, openH - 0.008, 0.022, paintMat, 0.05)
    );
    const knob = buildAgedBrassMushroomKnob(`${dGroup.name}.knob`);
    knob.position.set(-sign * (leafW * 0.5 - 0.034), openH * 0.5 - 0.075, 0.012);
    dGroup.add(knob);

    const pivot = wireCatalogHingedDoor(opts.interactions, {
      parent: root,
      door: dGroup,
      hingeOffset: [sign * (leafW * 0.5 - 0.01), 0, 0],
      axis: 'y',
      openAngle: sign < 0 ? -Math.PI * 0.56 : Math.PI * 0.56,
      label: 'Open Bookcase Base Cupboard',
      linkGroup: 'alcoveBookcaseBaseDoors',
    });
    if (sign < 0) leftDoorPivot = pivot;
    else rightDoorPivot = pivot;
  }
  if (opts.interactions && leftDoorPivot && rightDoorPivot) {
    opts.interactions.linkDoorPair(leftDoorPivot, rightDoorPivot);
  }

  // Stepped solid counter shelf at `H 840 mm`
  addNamedBox(
    root,
    `${namePrefix}.counterLedge`,
    w + 0.024,
    counterH,
    baseD + 0.02,
    0,
    carcassH + counterH * 0.5,
    (baseD + 0.02) * 0.5,
    paintMat
  );

  // Upper 4-shelf fluted-pilaster open bookcase (`y = baseH .. totalH`, `D = upperD`)
  const crownH = 0.085;
  const upperBodyH = totalH - baseH - crownH;
  const upperMidY = baseH + upperBodyH * 0.5;
  const pilasterW = 0.076;
  const innerUpperW = w - pilasterW * 2;

  // T&G matchboard back lining (`z = 0..0.018`)
  const nBackBoards = Math.max(8, Math.round(innerUpperW / 0.098));
  const bPitch = innerUpperW / nBackBoards;
  for (let b = 0; b < nBackBoards; b++) {
    addNamedBox(
      root,
      `${namePrefix}.upperTgBack_${b + 1}`,
      bPitch - 0.003,
      upperBodyH,
      0.018,
      -innerUpperW * 0.5 + (b + 0.5) * bPitch,
      upperMidY,
      0.009,
      paintMat
    );
  }

  // Left & Right side cheeks + fluted classical pilasters on front stiles
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const px = sign * (w * 0.5 - pilasterW * 0.5);
    addNamedBox(
      root,
      `${namePrefix}.upperCheek${sTag}`,
      0.024,
      upperBodyH,
      upperD - 0.032,
      sign * (w * 0.5 - 0.012),
      upperMidY,
      (upperD - 0.032) * 0.5,
      paintMat
    );
    addNamedBox(
      root,
      `${namePrefix}.flutedPilasterBase${sTag}`,
      pilasterW,
      0.095,
      0.032,
      px,
      baseH + 0.0475,
      upperD - 0.012,
      paintMat
    );
    addNamedBox(
      root,
      `${namePrefix}.flutedPilasterCapital${sTag}`,
      pilasterW + 0.008,
      0.085,
      0.036,
      px,
      baseH + upperBodyH - 0.0425,
      upperD - 0.012,
      paintMat
    );
    // Fluted pilaster shaft built as 4 raised vertical reed strips over recessed core (0 z-fighting!)
    const fluteShaftH = upperBodyH - 0.18;
    const fluteMidY = baseH + 0.095 + fluteShaftH * 0.5;
    addNamedBox(
      root,
      `${namePrefix}.flutedPilasterCore${sTag}`,
      pilasterW,
      fluteShaftH,
      0.022,
      px,
      fluteMidY,
      upperD - 0.015,
      paintMat
    );
    for (let f = 0; f < 4; f++) {
      const fx = px - pilasterW * 0.36 + f * (pilasterW * 0.24);
      addNamedBox(
        root,
        `${namePrefix}.pilasterReed_${sTag}_${f + 1}`,
        0.008,
        fluteShaftH - 0.03,
        0.006,
        fx,
        fluteMidY,
        upperD - 0.001,
        paintMat,
        true
      );
    }
  }

  // Top frieze & classical cornice
  addNamedBox(
    root,
    `${namePrefix}.upperCeilingSoffit`,
    innerUpperW,
    0.022,
    upperD - 0.048,
    0,
    baseH + upperBodyH - 0.011,
    0.019 + (upperD - 0.048) * 0.5,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.crownCorniceFrieze`,
    w + 0.02,
    crownH * 0.48,
    upperD + 0.016,
    0,
    totalH - crownH + crownH * 0.24,
    (upperD + 0.016) * 0.5,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.crownCorniceCap`,
    w + 0.068,
    crownH * 0.52,
    upperD + 0.048,
    0,
    totalH - crownH * 0.26,
    (upperD + 0.048) * 0.5,
    paintMat
  );

  // 4 adjustable shelves with warm 2700K LED wash strips & curated leather/linen books, ceramic vessel & reed diffuser
  const bookPalette = [0x6e2c22, 0x26394a, 0x455342, 0xcabfa9, 0x7b5638, 0x3b3531, 0xdfd7c6];
  const shelfDepth = upperD - 0.042;
  const shelfCenterZ = 0.018 + shelfDepth * 0.5;

  for (let s = 0; s < 4; s++) {
    const sy = baseH + ((s + 1) / 5) * (upperBodyH - 0.08);
    addNamedBox(
      root,
      `${namePrefix}.bookShelf_${s + 1}`,
      innerUpperW,
      0.026,
      shelfDepth,
      0,
      sy,
      shelfCenterZ,
      paintMat
    );
    // Warm 2700K recessed LED wash bar under front lip
    addNamedBox(
      root,
      `${namePrefix}.shelfLedWash_${s + 1}`,
      innerUpperW - 0.06,
      0.005,
      0.01,
      0,
      sy - 0.016,
      upperD - 0.045,
      ledMat,
      true
    );

    const surfaceY = sy + 0.0135;
    if (s % 2 === 0) {
      // Leather/linen hardback cluster on left + ceramic vase or reed diffuser on right
      let bx = -innerUpperW * 0.42;
      for (let k = 0; k < 8; k++) {
        const bt = 0.028 + ((k * 7 + s * 3) % 4) * 0.007;
        const bh = 0.2 + ((k * 5 + s) % 4) * 0.024;
        const bd = 0.165 + (k % 2) * 0.018;
        const bMat = getPaintedJoineryMaterial(
          bookPalette[(k + s * 2) % bookPalette.length]!,
          0.62,
          `${namePrefix}.book_${s + 1}_${k + 1}`
        );
        addNamedBox(
          root,
          `${namePrefix}.hardback_${s + 1}_${k + 1}`,
          bt - 0.001,
          bh,
          bd,
          bx + bt * 0.5,
          surfaceY + bh * 0.5,
          0.03 + bd * 0.5,
          bMat,
          true
        );
        bx += bt + 0.002;
      }

      if (s === 0) {
        // Apothecary glass reed diffuser on shelf 1 right
        const dx = innerUpperW * 0.28;
        addNamedCyl(
          root,
          `${namePrefix}.shelfDiffuserBottle`,
          0.036,
          0.038,
          0.11,
          14,
          dx,
          surfaceY + 0.055,
          shelfCenterZ,
          glassMat,
          true
        );
        addNamedCyl(
          root,
          `${namePrefix}.shelfDiffuserCollar`,
          0.016,
          0.018,
          0.02,
          12,
          dx,
          surfaceY + 0.12,
          shelfCenterZ,
          brassMat,
          true
        );
        for (let r = 0; r < 5; r++) {
          const reed = addNamedCyl(
            root,
            `${namePrefix}.shelfDiffuserReed_${r + 1}`,
            0.0018,
            0.0018,
            0.21,
            6,
            dx + (r - 2) * 0.005,
            surfaceY + 0.15,
            shelfCenterZ + ((r % 2) - 0.5) * 0.006,
            oakMat,
            true
          );
          reed.rotation.z = (r - 2) * 0.09;
        }
      } else {
        // Turned stoneware ceramic vessel on shelf 3 right
        const ceramicMat = getPaintedJoineryMaterial(0xe9e4da, 0.46, `${namePrefix}.stoneware`);
        addNamedCyl(
          root,
          `${namePrefix}.ceramicVessel_${s + 1}`,
          0.048,
          0.068,
          0.19,
          16,
          innerUpperW * 0.26,
          surfaceY + 0.095,
          shelfCenterZ,
          ceramicMat,
          true
        );
      }
    } else {
      // Horizontal stacked art monographs on left + upright books on right
      for (let st = 0; st < 3; st++) {
        const bMat = getPaintedJoineryMaterial(
          bookPalette[(st + 3) % bookPalette.length]!,
          0.58,
          `${namePrefix}.monograph_${s + 1}_${st + 1}`
        );
        addNamedBox(
          root,
          `${namePrefix}.monograph_${s + 1}_${st + 1}`,
          0.25,
          0.032,
          0.19,
          -innerUpperW * 0.24,
          surfaceY + 0.016 + st * 0.033,
          shelfCenterZ,
          bMat,
          true
        );
      }
      let bx = 0.04;
      for (let k = 0; k < 7; k++) {
        const bt = 0.03 + (k % 3) * 0.006;
        const bh = 0.21 + ((k + s) % 3) * 0.02;
        const bMat = getPaintedJoineryMaterial(
          bookPalette[(k * 2 + 1) % bookPalette.length]!,
          0.64,
          `${namePrefix}.rightBook_${s + 1}_${k + 1}`
        );
        addNamedBox(
          root,
          `${namePrefix}.rightBook_${s + 1}_${k + 1}`,
          bt - 0.001,
          bh,
          0.175,
          bx + bt * 0.5,
          surfaceY + bh * 0.5,
          shelfCenterZ,
          bMat,
          true
        );
        bx += bt + 0.002;
      }
    }
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Georgian Fluted-Pilaster Fitted Alcove Bookcase',
    brand: 'Neptune Bespoke',
    collection: 'Chichester Library Joinery',
    sku: 'NEP-LIB-ALC-1180',
    finish: 'Old Chalk Painted Timber & Character Oak',
    category: 'joinery',
    dimensionsMm: mmFromMetres(w, baseD, totalH),
    productUrl: 'https://www.neptune.com/uk/living/bookcases-and-shelving/',
    schematicUrl: 'https://www.neptune.com/uk/living/bookcases-and-shelving/alcove-joinery-spec.pdf',
  });
}

export interface TongueAndGrooveDadoPanellingOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Run length in metres (default `2.40`). */
  readonly lengthM?: number;
  /** Total height including skirting and bullnose dado rail (`1.05 - 1.20 m`, default `1.12`). */
  readonly heightM?: number;
  /** Vertical matchboard pitch in metres (default `0.10` = `100 mm`). */
  readonly boardPitchM?: number;
  /** Paint colour (default F&B *School House White* / *Shingle* `#DFDDD2`). */
  readonly paintColor?: THREE.ColorRepresentation;
}

/**
 * Parametric V-grooved tongue-and-groove matchboard dado panelling (`H 1050-1200 mm`,
 * `100 mm` board pitch, torus skirting base & bullnose dado rail), projecting `+Z` from `z = 0`.
 */
export function buildTongueAndGrooveDadoPanelling(
  opts: TongueAndGrooveDadoPanellingOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'tongueAndGrooveDado';
  const len = opts.lengthM ?? 2.4;
  const h = opts.heightM ?? 1.12;
  const pitch = opts.boardPitchM ?? 0.1;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xdfddd2,
    0.54,
    `${namePrefix}.paint`
  );

  const root = new THREE.Group();
  root.name = namePrefix;

  const skirtH = 0.135;
  const dadoRailH = 0.052;
  const boardH = Math.max(0.4, h - skirtH - dadoRailH);
  const boardMidY = skirtH + boardH * 0.5;

  // Recessed shadow backing strip behind V-grooves (`z = 0..0.008`)
  addNamedBox(
    root,
    `${namePrefix}.battenBacking`,
    len,
    boardH,
    0.008,
    0,
    boardMidY,
    0.004,
    paintMat
  );

  // V-grooved vertical matchboards strictly in front of backing (`z = 0.008..0.020`)
  const nBoards = Math.max(3, Math.round(len / pitch));
  const actualPitch = len / nBoards;
  const grooveGap = 0.004;
  for (let i = 0; i < nBoards; i++) {
    const bx = -len * 0.5 + (i + 0.5) * actualPitch;
    addNamedBox(
      root,
      `${namePrefix}.matchboard_${i + 1}`,
      actualPitch - grooveGap,
      boardH,
      0.012,
      bx,
      boardMidY,
      0.014,
      paintMat
    );
  }

  // Moulded skirting board (`y = 0 .. skirtH`, `z = 0 .. 0.024`)
  addNamedBox(
    root,
    `${namePrefix}.skirtingPlinth`,
    len,
    skirtH,
    0.024,
    0,
    skirtH * 0.5,
    0.012,
    paintMat
  );

  // Bullnose dado rail cap (`y = skirtH + boardH .. h`, `z = 0 .. 0.036`)
  const railCy = skirtH + boardH + dadoRailH * 0.5;
  addNamedBox(
    root,
    `${namePrefix}.dadoRailCore`,
    len,
    dadoRailH,
    0.026,
    0,
    railCy,
    0.013,
    paintMat
  );
  const bullnose = addNamedCyl(
    root,
    `${namePrefix}.dadoBullnose`,
    0.014,
    0.014,
    len - 0.002,
    12,
    0,
    railCy + 0.004,
    0.028,
    paintMat,
    true
  );
  bullnose.rotation.z = Math.PI * 0.5;

  return finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
}

export interface NeptuneBootBenchAndPegRailOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Paint colour (default F&B *Green Smoke* `#6F7B71`). */
  readonly paintColor?: THREE.ColorRepresentation;
  readonly widthM?: number;
  readonly depthM?: number;
  readonly heightM?: number;
  readonly interactions?: InteractionRegistry;
}

/**
 * `1350 x 460 x 1920 mm` Neptune boot-room bench & peg rail unit:
 * F&B *Green Smoke* (`#6F7B71`) joinery, `36 mm` Character Oak seat + piped oatmeal linen cushion (`SeatInteractable`),
 * 3 White Company Kubu rattan boot baskets below, T&G matchboard back, 5 aged-brass double coat hooks & hat shelf.
 */
export function buildNeptuneBootBenchAndPegRail(
  opts: NeptuneBootBenchAndPegRailOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'neptuneBootBench';
  const w = opts.widthM ?? 1.35;
  const d = opts.depthM ?? 0.46;
  const h = opts.heightM ?? 1.92;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0x6f7b71,
    0.52,
    `${namePrefix}.greenSmokePaint`
  );
  const oakMat = getCharacterOakMaterial();
  const brassMat = getAgedBrassMaterial();
  const kubuMaps = getWovenFabricMaps('boot-kubu', 0x998064, 'kubu');
  const kubuMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.kubuRattan`,
    map: kubuMaps.colorMap,
    normalMap: kubuMaps.normalMap,
    roughnessMap: kubuMaps.roughnessMap,
    roughness: 0.85,
  });
  const linenMaps = getWovenFabricMaps('boot-seat-linen', 0xddd4c5, 'linen');
  const linenMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.pipedLinen`,
    map: linenMaps.colorMap,
    normalMap: linenMaps.normalMap,
    roughnessMap: linenMaps.roughnessMap,
    roughness: 0.86,
  });

  const root = new THREE.Group();
  root.name = namePrefix;

  const plinthH = 0.085;
  const benchSeatTopY = 0.47;
  const oakSeatT = 0.036;
  const lowerBodyH = benchSeatTopY - oakSeatT - plinthH;
  const lowerMidY = plinthH + lowerBodyH * 0.5;
  const cheekT = 0.028;

  // Plinth & 3-cubby boot bench base (`z = 0 .. d`)
  addNamedBox(
    root,
    `${namePrefix}.benchPlinth`,
    w,
    plinthH,
    d - 0.025,
    0,
    plinthH * 0.5,
    (d - 0.025) * 0.5,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.cubbyFloor`,
    w - cheekT * 2,
    0.02,
    d - 0.03,
    0,
    plinthH + 0.01,
    (d - 0.03) * 0.5 + 0.015,
    paintMat
  );

  // Outer bench cheeks + 2 internal cubby dividers -> 3 boot cubbies
  const dividerXs = [
    -(w * 0.5 - cheekT * 0.5),
    -(w - cheekT * 2) / 6,
    (w - cheekT * 2) / 6,
    w * 0.5 - cheekT * 0.5,
  ];
  dividerXs.forEach((dx, idx) => {
    const isOuter = idx === 0 || idx === 3;
    const innerDividerH = lowerBodyH - 0.02;
    addNamedBox(
      root,
      `${namePrefix}.benchCheek_${idx + 1}`,
      cheekT,
      isOuter ? h - plinthH - 0.055 : innerDividerH,
      isOuter ? 0.28 : d - 0.035,
      dx,
      isOuter ? plinthH + (h - plinthH - 0.055) * 0.5 : plinthH + 0.02 + innerDividerH * 0.5,
      isOuter ? 0.14 : (d - 0.035) * 0.5 + 0.02,
      paintMat
    );
    if (isOuter) {
      // Lower bench side extension forward of the upper side cheek (`z = 0.28 .. d - 0.015`, zero overlap!)
      addNamedBox(
        root,
        `${namePrefix}.benchLowerArmCheek_${idx + 1}`,
        cheekT,
        lowerBodyH,
        d - 0.295,
        dx,
        lowerMidY,
        0.28 + (d - 0.295) * 0.5,
        paintMat
      );
    }
  });

  // 3 White Company Kubu rattan boot baskets inside the 3 lower cubbies
  const cubbySpanW = (w - cheekT * 4) / 3;
  for (let c = 0; c < 3; c++) {
    const cx = (c - 1) * (cubbySpanW + cheekT);
    const basketH = lowerBodyH - 0.055;
    addNamedBox(
      root,
      `${namePrefix}.kubuBootBasket_${c + 1}`,
      cubbySpanW - 0.028,
      basketH,
      d - 0.085,
      cx,
      plinthH + 0.022 + basketH * 0.5,
      d * 0.5 + 0.005,
      kubuMat
    );
    // Cut-out hand-pull shadow slot on Kubu basket front
    addNamedBox(
      root,
      `${namePrefix}.kubuBasketHandleRim_${c + 1}`,
      0.095,
      0.024,
      0.008,
      cx,
      plinthH + 0.022 + basketH - 0.045,
      d * 0.5 + 0.005 + (d - 0.085) * 0.5 + 0.004,
      oakMat,
      true
    );
  }

  // 36 mm solid Character Oak bench seat (`y = benchSeatTopY - 0.036 .. benchSeatTopY`)
  addNamedBox(
    root,
    `${namePrefix}.characterOakSeatSlab`,
    w - cheekT * 2 + 0.004,
    oakSeatT,
    d - 0.02,
    0,
    benchSeatTopY - oakSeatT * 0.5,
    0.02 + (d - 0.02) * 0.5,
    oakMat
  );

  // Tailored piped oatmeal linen seat cushion (`H 55 mm`) resting on the oak seat
  const cushW = w - cheekT * 2 - 0.02;
  const cushH = 0.055;
  const cushD = d - 0.065;
  const cushZ = 0.035 + cushD * 0.5;
  const cushCy = benchSeatTopY + cushH * 0.5 + 0.001;
  const cushionMesh = new THREE.Mesh(
    createSculptedCushionGeometry(cushW, cushH, cushD, 8, 4, 6, 0.48, 'standard'),
    linenMat
  );
  cushionMesh.name = `${namePrefix}.seatCushion`;
  cushionMesh.position.set(0, cushCy, cushZ);
  cushionMesh.castShadow = true;
  cushionMesh.receiveShadow = true;
  root.add(cushionMesh);

  const weltTop = createPerimeterWeltLoop(
    cushW - 0.012,
    cushD - 0.012,
    0.0035,
    'XZ',
    linenMat,
    `${namePrefix}.seatCushionWelt`
  );
  weltTop.position.set(0, benchSeatTopY + cushH - 0.004, cushZ);
  tagHighLod(weltTop);
  root.add(weltTop);

  // Upper V-grooved T&G matchboard back panel (`y = benchSeatTopY .. h - 0.055`)
  const upperBackH = h - 0.055 - benchSeatTopY;
  const upperBackMidY = benchSeatTopY + upperBackH * 0.5;
  const innerBackW = w - cheekT * 2;
  const nBoards = Math.max(8, Math.round(innerBackW / 0.098));
  const bPitch = innerBackW / nBoards;
  for (let b = 0; b < nBoards; b++) {
    addNamedBox(
      root,
      `${namePrefix}.backMatchboard_${b + 1}`,
      bPitch - 0.003,
      upperBackH,
      0.018,
      -innerBackW * 0.5 + (b + 0.5) * bPitch,
      upperBackMidY,
      0.011,
      paintMat
    );
  }

  // Peg rail batten + 5 Aged Brass double coat & hat hooks + upper hat shelf & cornice
  const hookRailY = h - 0.34;
  addNamedBox(
    root,
    `${namePrefix}.pegRailBatten`,
    innerBackW,
    0.088,
    0.02,
    0,
    hookRailY,
    0.03,
    paintMat
  );

  for (let k = 0; k < 5; k++) {
    const hx = -innerBackW * 0.38 + k * (innerBackW * 0.19);
    addNamedBox(
      root,
      `${namePrefix}.coatHookBackplate_${k + 1}`,
      0.034,
      0.058,
      0.005,
      hx,
      hookRailY,
      0.043,
      brassMat,
      true
    );
    const upperProng = addNamedCyl(
      root,
      `${namePrefix}.coatHookUpperArm_${k + 1}`,
      0.0045,
      0.0055,
      0.078,
      10,
      hx,
      hookRailY + 0.024,
      0.076,
      brassMat,
      true
    );
    upperProng.rotation.x = Math.PI * 0.36;
    const lowerProng = addNamedCyl(
      root,
      `${namePrefix}.coatHookLowerArm_${k + 1}`,
      0.004,
      0.005,
      0.046,
      10,
      hx,
      hookRailY - 0.016,
      0.062,
      brassMat,
      true
    );
    lowerProng.rotation.x = Math.PI * 0.44;
  }

  // Hat shelf (`D 280 mm`) + ogee top cap
  const hatShelfY = h - 0.18;
  addNamedBox(
    root,
    `${namePrefix}.hatShelf`,
    innerBackW,
    0.024,
    0.26,
    0,
    hatShelfY,
    0.02 + 0.13,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.crownHeader`,
    w + 0.044,
    0.055,
    0.31,
    0,
    h - 0.0275,
    0.155,
    paintMat
  );

  const seatInteractable = new SeatInteractable({
    id: `seat:${namePrefix}`,
    label: 'Neptune Boot Room Bench',
    aliases: ['sit on boot bench', 'boot room bench'],
    anchor: root,
    clickableTargets: collectSeatClickableMeshes(root),
    localSeatPos: [0, benchSeatTopY + cushH, cushZ],
    localFootOffset: [0, 0, d + 0.42],
    localForward: [0, 0, 1],
    seatedEyeHeightM: 0.72,
    proximityRadiusM: 1.05,
    material: 'linen',
  });
  root.userData.seatInteractable = seatInteractable;
  if (opts.interactions) {
    opts.interactions.registerAnimatedInteractable(seatInteractable);
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Neptune Boot-Room Bench, Peg Rail & Kubu Basket Unit',
    brand: 'Neptune',
    collection: 'Suffolk Boot Room',
    sku: 'NEP-SUF-BOOT-1350',
    finish: 'Farrow & Ball Green Smoke, Character Oak & Aged Brass',
    category: 'joinery',
    dimensionsMm: mmFromMetres(w, d, h),
    productUrl: 'https://www.neptune.com/uk/hallway/boot-room-furniture/',
    schematicUrl: 'https://www.neptune.com/uk/hallway/boot-room-furniture/boot-bench-spec.pdf',
  });
}

export interface CarraraNeroChequerboardTextureOptions {
  /** Diagonal tile edge length in metres (default `0.305` = classic 12-inch Georgian marble tile). */
  readonly tileEdgeM?: number;
  /** Grout joint width in metres (default `0.0025`). */
  readonly groutWidthM?: number;
  readonly resolution?: number;
  readonly repeatX?: number;
  readonly repeatY?: number;
}

/**
 * Generates a seamless `45°` diagonal Honed Carrara (`#ECEAE4` w/ subtle grey veining) &
 * Belgian Nero Marquina (`#1E1F21` w/ crisp white calcite veins) PBR map bundle
 * (`colorMap`, `normalMap`, `roughnessMap`) using headless-safe `DataTexture`s.
 */
export function createCarraraNeroChequerboardTextures(
  opts: CarraraNeroChequerboardTextureOptions = {}
): PbrDataMapBundle & { readonly diagonalRepeatM: number } {
  const tileEdgeM = opts.tileEdgeM ?? 0.305;
  const groutM = opts.groutWidthM ?? 0.0025;
  const size = opts.resolution ?? 256;
  const repeatX = opts.repeatX ?? 1;
  const repeatY = opts.repeatY ?? 1;
  const diagonalRepeatM = tileEdgeM * Math.SQRT2;
  const groutNorm = groutM / tileEdgeM;

  const cacheKey = `catalog:carrara-nero-chequer:${size}:${tileEdgeM.toFixed(3)}:${groutM.toFixed(4)}:${repeatX.toFixed(3)}:${repeatY.toFixed(3)}`;
  const bundle = getOrCreateCachedTexture(cacheKey, () => {
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        // 45° rotated coordinates: (u + v) and (u - v) have integer period 1 along UV edges!
        // In 1x1 UV tile, s = u + v spans [0..2], t = u - v + 1 spans [0..2] -> exact 45° seamless diamond chequerboard!
        const s = u + v;
        const t = u - v + 2;
        const cellS = Math.floor(s);
        const cellT = Math.floor(t);
        const fs = s - cellS;
        const ft = t - cellT;

        const edgeDist = Math.min(fs, 1 - fs, ft, 1 - ft);
        const isGrout = edgeDist < groutNorm * 0.5;
        const isNero = ((cellS + cellT) & 1) === 1;

        const idx = y * size + x;
        const o = idx * 4;

        if (isGrout) {
          color[o] = 154;
          color[o + 1] = 151;
          color[o + 2] = 145;
          color[o + 3] = 255;
          height[idx] = 0.28;
          rough[idx] = 0.72;
        } else if (isNero) {
          // Belgian Nero Marquina (#1E1F21) with crisp white calcite veins
          const warp = seamlessFbm2D(u, v, 4, 3, 7207) * 0.3;
          const ridge = Math.abs(
            Math.sin((u * 2 + v * 2 + warp) * Math.PI * 2) +
              (seamlessFbm2D(u + 0.17, v + 0.31, 8, 3, 7331) - 0.5) * 0.85
          );
          const calcite = Math.pow(Math.max(0, 1 - ridge * 10), 1.65);
          const tone = (seamlessValueNoise2D(u, v, 8, 8, 7411) - 0.5) * 7;
          color[o] = Math.max(0, Math.min(255, Math.round(30 + tone + calcite * 195)));
          color[o + 1] = Math.max(0, Math.min(255, Math.round(31 + tone + calcite * 192)));
          color[o + 2] = Math.max(0, Math.min(255, Math.round(33 + tone + calcite * 186)));
          color[o + 3] = 255;
          height[idx] = 0.5 + calcite * 0.03;
          rough[idx] = 0.25 + calcite * 0.06;
        } else {
          // Honed Carrara (#ECEAE4) with subtle grey feather veining
          const warp = seamlessFbm2D(u, v, 3, 3, 7507) * 0.32;
          const ridge = Math.abs(
            Math.sin((u * 2 - v * 1 + warp) * Math.PI * 2) * 0.65 +
              (seamlessFbm2D(u + 0.23, v, 6, 3, 7603) - 0.5) * 0.72
          );
          const vein = Math.max(0, 1 - ridge * 7.8) * 0.78;
          const cloud = (seamlessFbm2D(u, v, 4, 2, 7717) - 0.5) * 9;
          color[o] = Math.max(0, Math.min(255, Math.round(236 + cloud - vein * 48)));
          color[o + 1] = Math.max(0, Math.min(255, Math.round(234 + cloud - vein * 47)));
          color[o + 2] = Math.max(0, Math.min(255, Math.round(228 + cloud - vein * 43)));
          color[o + 3] = 255;
          height[idx] = 0.51 - vein * 0.03;
          rough[idx] = 0.29 + vein * 0.06;
        }
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      2.2,
      'catalog.carraraNeroChequer',
      repeatX,
      repeatY
    );
    return {
      colorMap: makeRgbaDataTexture(
        color,
        size,
        size,
        'catalog.carraraNeroChequer.color',
        true,
        repeatX,
        repeatY
      ),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });

  return { ...bundle, diagonalRepeatM };
}

export interface ChequerboardMarbleFloorOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Overall floor width along X in metres (default `3.20`). */
  readonly widthM?: number;
  /** Overall floor depth along Z in metres (default `4.20`). */
  readonly depthM?: number;
  /** Slab thickness in metres (default `0.02`, top surface at `y = 0` or `y = thicknessM` via `topAtZero`). */
  readonly thicknessM?: number;
  /** Nero Marquina tramline border width in metres (default `0.14` = `140 mm`). */
  readonly tramlineWidthM?: number;
  /** Honed Carrara outer margin width in metres (default `0.18` = `180 mm`). */
  readonly outerMarginWidthM?: number;
  /** Diagonal marble tile edge in metres (default `0.305`). */
  readonly tileEdgeM?: number;
}

/**
 * Builds a Georgian entrance-hall Honed Carrara & Belgian Nero Marquina `45°` diagonal
 * chequerboard marble floor framed by a `140 mm` Nero Marquina tramline border and
 * `180 mm` Carrara outer margin using **9 strictly disjoint non-overlapping panels** (`0` z-fighting!).
 */
export function buildChequerboardMarbleFloor(
  opts: ChequerboardMarbleFloorOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'chequerboardMarbleFloor';
  const totalW = opts.widthM ?? 3.2;
  const totalD = opts.depthM ?? 4.2;
  const t = opts.thicknessM ?? 0.02;
  const marginW = Math.min(opts.outerMarginWidthM ?? 0.18, Math.min(totalW, totalD) * 0.2);
  const tramW = Math.min(opts.tramlineWidthM ?? 0.14, Math.min(totalW, totalD) * 0.15);
  const tileEdgeM = opts.tileEdgeM ?? 0.305;

  const fieldW = Math.max(0.2, totalW - (marginW + tramW) * 2);
  const fieldD = Math.max(0.2, totalD - (marginW + tramW) * 2);
  const diagPeriod = tileEdgeM * Math.SQRT2;

  const chequerMaps = createCarraraNeroChequerboardTextures({
    tileEdgeM,
    repeatX: Math.max(1, fieldW / diagPeriod),
    repeatY: Math.max(1, fieldD / diagPeriod),
  });
  const fieldMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.diagonalChequerMat`,
    map: chequerMaps.colorMap,
    normalMap: chequerMaps.normalMap,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: chequerMaps.roughnessMap,
    roughness: 0.28,
    metalness: 0.02,
  });
  const neroMat = getNeroMarquinaCatalogMaterial();
  const carraraMat = getHonedCarraraCatalogMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;
  const cy = t * 0.5;

  // Center 45° diagonal chequerboard field (`[-fieldW/2 .. +fieldW/2] x [-fieldD/2 .. +fieldD/2]`)
  const centerMesh = addNamedBox(
    root,
    `${namePrefix}.diagonalChequerField`,
    fieldW,
    t,
    fieldD,
    0,
    cy,
    0,
    fieldMat
  );
  centerMesh.castShadow = false;

  // 4 strictly disjoint Nero Marquina 140 mm tramline border strips around the center field
  const tramOuterW = fieldW + tramW * 2;
  addNamedBox(
    root,
    `${namePrefix}.neroTramlineNorth`,
    tramOuterW,
    t,
    tramW,
    0,
    cy,
    -(fieldD * 0.5 + tramW * 0.5),
    neroMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.neroTramlineSouth`,
    tramOuterW,
    t,
    tramW,
    0,
    cy,
    fieldD * 0.5 + tramW * 0.5,
    neroMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.neroTramlineWest`,
    tramW,
    t,
    fieldD,
    -(fieldW * 0.5 + tramW * 0.5),
    cy,
    0,
    neroMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.neroTramlineEast`,
    tramW,
    t,
    fieldD,
    fieldW * 0.5 + tramW * 0.5,
    cy,
    0,
    neroMat
  ).castShadow = false;

  // 4 strictly disjoint Honed Carrara 180 mm outer margin strips around the tramline
  const tramOuterD = fieldD + tramW * 2;
  addNamedBox(
    root,
    `${namePrefix}.carraraMarginNorth`,
    totalW,
    t,
    marginW,
    0,
    cy,
    -(tramOuterD * 0.5 + marginW * 0.5),
    carraraMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.carraraMarginSouth`,
    totalW,
    t,
    marginW,
    0,
    cy,
    tramOuterD * 0.5 + marginW * 0.5,
    carraraMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.carraraMarginWest`,
    marginW,
    t,
    tramOuterD,
    -(tramOuterW * 0.5 + marginW * 0.5),
    cy,
    0,
    carraraMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.carraraMarginEast`,
    marginW,
    t,
    tramOuterD,
    tramOuterW * 0.5 + marginW * 0.5,
    cy,
    0,
    carraraMat
  ).castShadow = false;

  return finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
}

export interface GeorgianCeilingRoseOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  /** Outer diameter in metres (default `0.62`). */
  readonly diameterM?: number;
}

/**
 * Classical George III acanthus & beaded lime-plaster ceiling rose (`Ø620 mm` default),
 * hanging downward (`-Y`) from `y = 0` ceiling soffit.
 */
export function buildGeorgianCeilingRose(
  opts: GeorgianCeilingRoseOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianCeilingRose';
  const r = (opts.diameterM ?? 0.62) * 0.5;
  const plasterMat = getGeorgianLimePlasterMaterial();
  const root = new THREE.Group();
  root.name = namePrefix;

  addNamedCyl(root, `${namePrefix}.outerPlaque`, r, r * 0.96, 0.014, 32, 0, -0.0078, 0, plasterMat);
  const outerRing = new THREE.Mesh(sharedTorusGeometry(r * 0.86, 0.011, 10, 32), plasterMat);
  outerRing.name = `${namePrefix}.outerBeadRing`;
  outerRing.rotation.x = Math.PI * 0.5;
  outerRing.position.set(0, -0.018, 0);
  tagHighLod(outerRing);
  root.add(outerRing);

  const innerRing = new THREE.Mesh(sharedTorusGeometry(r * 0.48, 0.009, 10, 28), plasterMat);
  innerRing.name = `${namePrefix}.innerAcanthusRing`;
  innerRing.rotation.x = Math.PI * 0.5;
  innerRing.position.set(0, -0.022, 0);
  tagHighLod(innerRing);
  root.add(innerRing);

  // 12 radial acanthus leaves between inner & outer rings
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const midR = r * 0.66;
    const leaf = new THREE.Mesh(sharedSphereGeometry(r * 0.12, 10, 8), plasterMat);
    leaf.name = `${namePrefix}.acanthusLeaf_${i + 1}`;
    leaf.scale.set(0.52, 0.25, 1.35);
    leaf.rotation.y = -a;
    leaf.position.set(Math.sin(a) * midR, -0.02, Math.cos(a) * midR);
    tagHighLod(leaf);
    root.add(leaf);
  }

  addNamedCyl(
    root,
    `${namePrefix}.centerBoss`,
    r * 0.16,
    r * 0.22,
    0.024,
    20,
    0,
    -0.026,
    0,
    plasterMat,
    true
  );

  return finalizeCatalogGroup(root, namePrefix, opts.position);
}
