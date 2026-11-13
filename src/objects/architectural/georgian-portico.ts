import * as THREE from 'three';
import {
  attachAssetMetadata,
  mmFromMetres,
  wireCatalogHingedDoor,
} from '../shared/catalog-smart-metadata.ts';
import { createStoneMasonryMaterial } from '../../engine/textures/cobblestone-materials.ts';
import {
  addNamedBox,
  addNamedCyl,
  buildAgedBrassMushroomKnob,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getClearArchitecturalGlassMaterial,
  getDarkAntiquedBrassMaterial,
  getPaintedJoineryMaterial,
  sharedSphereGeometry,
  sharedTorusGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';
import type { CatalogInteractionContext } from './neptune-kitchen-joinery.ts';
import {
  addMetricMasonryBox,
  getBathStoneMaterial,
  resolveGeorgianRegistry,
} from "./georgian-shared.ts";
import { createTopiary } from "../vegetation/topiary-and-hedges.ts";

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
  const registry = resolveGeorgianRegistry(ctx);

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

      const topiary = createTopiary({
        form: isOlive ? 'olive-planter' : 'bay-standard',
        planter: 'none',
        height: 1.31,
        radius: 0.31,
        exposure: 'outdoor',
        seed: sign < 0 ? 411 : 419,
        name: `${pGroup.name}.topiary`,
      });
      topiary.position.set(0, planterS - 0.035, 0);
      pGroup.add(topiary);
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

