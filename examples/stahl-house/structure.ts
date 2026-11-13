import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  buildCorstonToggleSwitch,
  createSkirtingRun,
  createWallFaceFrame,
  extrudePlanarSolidWithHoles,
  placeOnWall,
  prepGeo,
  sweepMouldingAlongPath,
  tagCutaway,
} from 'husjs/objects';
import type { SceneBuilderContext } from 'husjs/viewer';
import {
  getArchitecturalFinishPbr512,
  getScoredConcretePbr2048,
  getStonePbr1024,
  getWalnutPbr1024,
} from './pbr-textures.ts';
import { bevelledBox } from './sculpted-geometry.ts';
import {
  addEmersonPryneSoffitDownlight,
  addPrescoliteOpalGlobeFixture,
  buildFilletedBoxRibFluteGeo,
  buildInfiniliteKitchenCeiling,
  buildKoenigSuspendedFireplace,
  buildTrapezoidalRoofDeckMesh,
} from './structure-fireplace-and-roof.ts';
import {
  addArcadiaSlidingGlassWall,
  addPlateGlassBay,
  addRoofIGirder,
  addWideFlangeColumn,
  buildCantileveredCliffCatwalk,
} from './structure-glazing-and-steel.ts';
import {
  CANTILEVER_M,
  CATWALK_WIDTH_M,
  CLEAR_CEILING_Y,
  DECK_DEPTH_M,
  MODULE_M,
  X0,
  X1,
  X2,
  X3,
  X4,
  Z0,
  Z1,
  Z2,
  Z3,
  stahlTerrainSampler,
} from './terrain.ts';

/** Backward-compatible elevation exports for sibling Stahl House modules. */
export const FFL = 0;
export const CEILING_Y = CLEAR_CEILING_Y;

export interface StahlMaterials {
  readonly steelCharcoal: THREE.MeshStandardMaterial;
  readonly deckOffWhite: THREE.MeshStandardMaterial;
  readonly concreteSlab: THREE.MeshStandardMaterial;
  readonly aggregateDeck: THREE.MeshStandardMaterial;
  readonly anodizedAlum: THREE.MeshStandardMaterial;
  readonly plateGlass: THREE.MeshPhysicalMaterial;
  readonly walnutWood: THREE.MeshStandardMaterial;
  readonly parchmentFormica: THREE.MeshStandardMaterial;
  readonly matteBlackHood: THREE.MeshStandardMaterial;
  readonly plasterOffWhite: THREE.MeshStandardMaterial;
  readonly robertsonExteriorTan: THREE.MeshStandardMaterial;
  readonly hearthPalosVerdes: THREE.MeshStandardMaterial;
  readonly guardrailOffWhite: THREE.MeshStandardMaterial;
}

export interface StahlStructureResult {
  readonly eastCliffCut: CutawayWallDescriptor;
  readonly southCliffCut: CutawayWallDescriptor;
  readonly northWoodsCut: CutawayWallDescriptor;
  readonly westCarportCut: CutawayWallDescriptor;
  readonly westPoolLivingCut: CutawayWallDescriptor;
  readonly southPrivatePoolCut: CutawayWallDescriptor;
}

let cachedStahlMats: StahlMaterials | null = null;

export function createStahlMaterials(): StahlMaterials {
  if (cachedStahlMats) return cachedStahlMats;

  const concreteInt = getScoredConcretePbr2048('interior');
  const concreteExt = getScoredConcretePbr2048('terrace');
  const walnut = getWalnutPbr1024();
  const palosVerdes = getStonePbr1024('palosVerdes');
  const paintedSteel = getArchitecturalFinishPbr512('paintedSteel');
  const anodizedAlum = getArchitecturalFinishPbr512('anodizedAlum');
  const plaster = getArchitecturalFinishPbr512('plaster');

  cachedStahlMats = {
    steelCharcoal: new THREE.MeshStandardMaterial({
      color: 0x38342f,
      normalMap: paintedSteel.normalMap,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughnessMap: paintedSteel.roughnessMap,
      roughness: 0.4,
      metalness: 0.62,
    }),
    deckOffWhite: new THREE.MeshStandardMaterial({
      color: 0xede7d9,
      normalMap: paintedSteel.normalMap,
      normalScale: new THREE.Vector2(0.15, 0.15),
      roughnessMap: paintedSteel.roughnessMap,
      roughness: 0.48,
      metalness: 0.14,
    }),
    concreteSlab: new THREE.MeshStandardMaterial({
      map: concreteInt.map,
      normalMap: concreteInt.normalMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: concreteInt.roughnessMap,
      roughness: 0.56,
      metalness: 0.02,
    }),
    aggregateDeck: new THREE.MeshStandardMaterial({
      map: concreteExt.map,
      normalMap: concreteExt.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: concreteExt.roughnessMap,
      roughness: 0.78,
    }),
    anodizedAlum: new THREE.MeshStandardMaterial({
      color: 0xd4d9dc,
      map: anodizedAlum.map,
      normalMap: anodizedAlum.normalMap,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughnessMap: anodizedAlum.roughnessMap,
      roughness: 0.24,
      metalness: 0.9,
    }),
    plateGlass: new THREE.MeshPhysicalMaterial({
      color: 0xdceef2,
      transparent: true,
      opacity: 0.19,
      roughness: 0.03,
      metalness: 0.04,
      transmission: 0,
      ior: 1.51,
    }),
    walnutWood: new THREE.MeshStandardMaterial({
      map: walnut.map,
      normalMap: walnut.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughnessMap: walnut.roughnessMap,
      roughness: 0.4,
      metalness: 0.03,
    }),
    parchmentFormica: new THREE.MeshStandardMaterial({
      color: 0xf1ece0,
      normalMap: paintedSteel.normalMap,
      normalScale: new THREE.Vector2(0.08, 0.08),
      roughness: 0.28,
    }),
    matteBlackHood: new THREE.MeshStandardMaterial({
      color: 0x201f1e,
      normalMap: paintedSteel.normalMap,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughnessMap: paintedSteel.roughnessMap,
      roughness: 0.46,
      metalness: 0.56,
    }),
    plasterOffWhite: new THREE.MeshStandardMaterial({
      color: 0xf2eee4,
      map: plaster.map,
      normalMap: plaster.normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughnessMap: plaster.roughnessMap,
      roughness: 0.78,
    }),
    robertsonExteriorTan: new THREE.MeshStandardMaterial({
      color: 0xcdc7b9,
      normalMap: paintedSteel.normalMap,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughnessMap: paintedSteel.roughnessMap,
      roughness: 0.52,
      metalness: 0.24,
    }),
    hearthPalosVerdes: new THREE.MeshStandardMaterial({
      map: palosVerdes.map,
      normalMap: palosVerdes.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: palosVerdes.roughnessMap,
      roughness: 0.74,
    }),
    guardrailOffWhite: new THREE.MeshStandardMaterial({
      color: 0xe9e6dd,
      normalMap: paintedSteel.normalMap,
      normalScale: new THREE.Vector2(0.16, 0.16),
      roughnessMap: paintedSteel.roughnessMap,
      roughness: 0.42,
      metalness: 0.28,
    }),
  };

  return cachedStahlMats;
}

function installInteriorsReconciliationHook(
  root: THREE.Group,
  westPoolLivingCut: CutawayWallDescriptor
): void {
  const origAdd = root.add.bind(root);
  root.add = (...objects: THREE.Object3D[]): THREE.Group => {
    const kept: THREE.Object3D[] = [];
    for (const obj of objects) {
      if (obj.name === 'stahl.living.fireplace') {
        continue;
      }
      if (obj.name === 'stahl.kitchen.joinery') {
        const toRemove: THREE.Object3D[] = [];
        for (const ch of obj.children) {
          if (
            ch.name === 'stahl.kitchen.luminousPanel' ||
            ch.name === 'stahl.kitchen.luminousCeilingGrid' ||
            (ch instanceof THREE.Mesh && Math.abs(ch.position.y - 2.42) < 0.05 && Math.abs(ch.position.z - -2.55) < 0.1)
          ) {
            toRemove.push(ch);
          }
        }
        for (const r of toRemove) obj.remove(r);
      }
      if (
        obj.name === 'stahl.sw.hearth' ||
        obj.name === 'stahl.dimmer.dimmer-stahl-dining' ||
        obj.name === 'stahl.dimmer.dimmer-stahl-living'
      ) {
        tagCutaway(obj, westPoolLivingCut);
      }
      kept.push(obj);
    }
    if (kept.length > 0) {
      origAdd(...kept);
    }
    return root;
  };
}

export function buildStahlStructure(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials
): StahlStructureResult {
  const eastCliffCut: CutawayWallDescriptor = {
    axis: 'x',
    coord: X4,
    minSpan: Z0,
    maxSpan: Z3,
    floor: 'ground',
    outwardSide: 'east',
  };
  const southCliffCut: CutawayWallDescriptor = {
    axis: 'z',
    coord: Z3,
    minSpan: X3,
    maxSpan: X4,
    floor: 'ground',
    outwardSide: 'south',
  };
  const northWoodsCut: CutawayWallDescriptor = {
    axis: 'z',
    coord: Z0,
    minSpan: X1 - 0.2,
    maxSpan: X4 + 0.2,
    floor: 'ground',
    outwardSide: 'north',
  };
  const westCarportCut: CutawayWallDescriptor = {
    axis: 'x',
    coord: X1,
    minSpan: Z0,
    maxSpan: Z1,
    floor: 'ground',
    outwardSide: 'west',
  };
  const westPoolLivingCut: CutawayWallDescriptor = {
    axis: 'x',
    coord: X3,
    minSpan: Z1,
    maxSpan: Z3,
    floor: 'ground',
    outwardSide: 'west',
  };
  const southPrivatePoolCut: CutawayWallDescriptor = {
    axis: 'z',
    coord: Z1,
    minSpan: X1,
    maxSpan: X3,
    floor: 'ground',
    outwardSide: 'south',
  };

  installInteriorsReconciliationHook(root, westPoolLivingCut);

  // Cantilevered 30" (762 mm) Board-Formed Concrete Grade Beams & 32-Seg Caissons
  const beamH = 0.762;
  const beamW = 0.36;
  const beamTopY = -0.182;
  const beamCenterY = beamTopY - beamH * 0.5;
  const beamBotY = beamTopY - beamH;
  const gradeBeamGroup = new THREE.Group();
  gradeBeamGroup.name = 'stahl.foundation.gradeBeams';

  const formConeMat = new THREE.MeshStandardMaterial({ color: 0x7b766c, roughness: 0.78 });
  const formConeGeo = prepGeo(new THREE.CylinderGeometry(0.018, 0.018, beamW + 0.012, 16));

  for (const z of [Z0, Z1, Z2, Z3]) {
    const minX = z <= Z1 ? X0 : X3 - 1.2;
    const maxX = X4 + CATWALK_WIDTH_M;
    const span = maxX - minX;
    const beam = new THREE.Mesh(
      bevelledBox(span, beamH, beamW, 0.009, 3, MODULE_M, MODULE_M),
      mats.aggregateDeck
    );
    beam.position.set((minX + maxX) * 0.5, beamCenterY, z);
    beam.castShadow = beam.receiveShadow = true;
    gradeBeamGroup.add(beam);

    for (let tx = 3.5; tx <= maxX - 0.25; tx += 0.76) {
      for (const ty of [beamCenterY + 0.19, beamCenterY - 0.19]) {
        const tie = new THREE.Mesh(formConeGeo, formConeMat);
        tie.rotation.x = Math.PI * 0.5;
        tie.position.set(tx, ty, z);
        gradeBeamGroup.add(tie);
      }
    }
  }

  const beamHalfW = beamW * 0.5 + 0.0015;
  const nsBeamSpans: readonly [number, number][] = [
    [Z0 + beamHalfW, Z1 - beamHalfW],
    [Z1 + beamHalfW, Z2 - beamHalfW],
    [Z2 + beamHalfW, Z3 - beamHalfW],
    [Z3 + beamHalfW, Z3 + CATWALK_WIDTH_M],
  ];
  for (const x of [X3, X4]) {
    for (const [zMin, zMax] of nsBeamSpans) {
      const beam = new THREE.Mesh(
        bevelledBox(beamW, beamH, zMax - zMin, 0.009, 3, MODULE_M, MODULE_M),
        mats.aggregateDeck
      );
      beam.position.set(x, beamCenterY, (zMin + zMax) * 0.5);
      beam.castShadow = beam.receiveShadow = true;
      gradeBeamGroup.add(beam);
    }
  }

  const subJoistGeo = bevelledBox(2.68, 0.26, 0.22, 0.007, 3, MODULE_M, MODULE_M);
  for (const sz of [7.62, 10.62]) {
    const subJoist = new THREE.Mesh(subJoistGeo, mats.aggregateDeck);
    subJoist.position.set(4.58, beamTopY - 0.132, sz);
    subJoist.castShadow = true;
    gradeBeamGroup.add(subJoist);
  }

  const caissonTopY = beamBotY - 0.004;
  const caissonCoords: readonly [number, number][] = [
    [3.06, Z0],
    [3.06, Z1],
    [3.06, Z2],
    [3.06, 9.04],
    [X3, 9.04],
  ];
  for (const [cx, cz] of caissonCoords) {
    const groundY = Math.min(-2.8, stahlTerrainSampler.sampleTerrainY(cx, cz) - 1.45);
    const h = caissonTopY - groundY;
    const pileCollar = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.46, 0.42, 0.24, 32)),
      mats.aggregateDeck
    );
    pileCollar.position.set(cx, caissonTopY - 0.12, cz);
    const caisson = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.38, 0.41, h - 0.244, 32)),
      mats.aggregateDeck
    );
    caisson.position.set(cx, groundY + (h - 0.244) * 0.5, cz);
    pileCollar.castShadow = caisson.castShadow = true;
    gradeBeamGroup.add(pileCollar, caisson);
  }

  const retainTopY = beamBotY - 0.002;
  const retainBotY = -3.85;
  const retainH = retainTopY - retainBotY;
  const retainCenterY = retainBotY + retainH * 0.5;
  const retainEastMinZ = Z0 + 0.19;
  const retainEastMaxZ = 9.04 + 0.17;
  const retainEast = new THREE.Mesh(
    bevelledBox(0.34, retainH, retainEastMaxZ - retainEastMinZ, 0.008, 3, MODULE_M, MODULE_M),
    mats.aggregateDeck
  );
  retainEast.position.set(3.06, retainCenterY, (retainEastMinZ + retainEastMaxZ) * 0.5);

  const retainLivingSouthMinX = X3 - 0.175;
  const retainLivingSouthMaxX = 3.06 - 0.17 - 0.002;
  const retainLivingSouth = new THREE.Mesh(
    bevelledBox(retainLivingSouthMaxX - retainLivingSouthMinX, retainH, 0.34, 0.008, 3, MODULE_M, MODULE_M),
    mats.aggregateDeck
  );
  retainLivingSouth.position.set((retainLivingSouthMinX + retainLivingSouthMaxX) * 0.5, retainCenterY, 9.04);

  const terraceStemTopY = -0.152;
  const terraceStemBotY = -0.64;
  const terraceStemH = terraceStemTopY - terraceStemBotY;
  const terraceStemMidY = terraceStemBotY + terraceStemH * 0.5;
  const terraceStemMinX = -13.73;
  const terraceStemMaxX = X3 - 0.185;
  const retainSouth = new THREE.Mesh(
    bevelledBox(terraceStemMaxX - terraceStemMinX, terraceStemH, 0.34, 0.008, 3, MODULE_M, MODULE_M),
    mats.aggregateDeck
  );
  retainSouth.position.set((terraceStemMinX + terraceStemMaxX) * 0.5, terraceStemMidY, 9.35);

  const westStemMinZ = Z1 + 0.02;
  const westStemMaxZ = 9.35 - 0.17 - 0.002;
  const retainWest = new THREE.Mesh(
    bevelledBox(0.34, terraceStemH, westStemMaxZ - westStemMinZ, 0.008, 3, MODULE_M, MODULE_M),
    mats.aggregateDeck
  );
  retainWest.position.set(-13.56, terraceStemMidY, (westStemMinZ + westStemMaxZ) * 0.5);

  gradeBeamGroup.add(retainEast, retainLivingSouth, retainSouth, retainWest);
  root.add(gradeBeamGroup);

  // Trowelled Watco-Dennis sealed L-shaped concrete floor slabs (`2048x2048` 5'x5' = 1.524m PBR grid)
  const privSlabMaxX = X3 - 0.0015;
  const privateSlab = new THREE.Mesh(
    bevelledBox(privSlabMaxX - X0, 0.18, Z1 - Z0, 0.005, 4, MODULE_M, MODULE_M),
    mats.concreteSlab
  );
  privateSlab.name = 'stahl.slab.privateWing';
  privateSlab.position.set((X0 + privSlabMaxX) * 0.5, -0.09, (Z0 + Z1) * 0.5);
  privateSlab.receiveShadow = true;

  const publicSlab = new THREE.Mesh(
    bevelledBox(X4 - X3, 0.18, Z3 - Z0, 0.005, 4, MODULE_M, MODULE_M),
    mats.concreteSlab
  );
  publicSlab.name = 'stahl.slab.publicPavilion';
  publicSlab.position.set((X3 + X4) * 0.5, -0.09, (Z0 + Z3) * 0.5);
  publicSlab.receiveShadow = true;
  root.add(privateSlab, publicSlab);

  // Bethlehem Steel 4" WF H-Columns & 12" WF Roof Girders + Filleted T-Steel Corrugated Deck
  const columnsGroup = new THREE.Group();
  columnsGroup.name = 'stahl.steel.columns';
  const gridCols: readonly [string, number, number][] = [
    ['X0_Z0', X0, Z0], ['X1_Z0', X1, Z0], ['X2_Z0', X2, Z0], ['X3_Z0', X3, Z0], ['X4_Z0', X4, Z0],
    ['X0_Z1', X0, Z1], ['X1_Z1', X1, Z1], ['X2_Z1', X2, Z1], ['X3_Z1', X3, Z1], ['X4_Z1', X4, Z1],
    ['X3_Z2', X3, Z2], ['X4_Z2', X4, Z2],
    ['X3_Z3', X3, Z3], ['X4_Z3', X4, Z3],
  ];
  for (const [tag, cx, cz] of gridCols) {
    addWideFlangeColumn(
      columnsGroup,
      `stahl.steel.col.${tag}`,
      cx,
      cz,
      0.0006,
      CLEAR_CEILING_Y - 0.0006,
      mats.steelCharcoal,
      mats.anodizedAlum
    );
  }
  root.add(columnsGroup);

  const roofGroup = new THREE.Group();
  roofGroup.name = 'stahl.steel.roof';
  const girderY = CLEAR_CEILING_Y + DECK_DEPTH_M + 0.0008;

  addRoofIGirder(roofGroup, X0 - 1.1, Z0, X4 + CANTILEVER_M, Z0, girderY, mats.steelCharcoal);
  addRoofIGirder(roofGroup, X0 - 1.1, Z1, X4 + CANTILEVER_M, Z1, girderY, mats.steelCharcoal);
  addRoofIGirder(roofGroup, X3 - CANTILEVER_M, Z2, X4 + CANTILEVER_M, Z2, girderY, mats.steelCharcoal);
  addRoofIGirder(roofGroup, X3 - CANTILEVER_M, Z3, X4 + CANTILEVER_M, Z3, girderY, mats.steelCharcoal);

  const girderClearHalf = 0.072;
  const privGirderSpans: readonly [number, number][] = [
    [Z0 - 0.9, Z0 - girderClearHalf],
    [Z0 + girderClearHalf, Z1 - girderClearHalf],
    [Z1 + girderClearHalf, Z1 + CANTILEVER_M],
  ];
  for (const x of [X0, X1, X2]) {
    for (const [zA, zB] of privGirderSpans) {
      addRoofIGirder(roofGroup, x, zA, x, zB, girderY, mats.steelCharcoal);
    }
  }
  const pubGirderSpans: readonly [number, number][] = [
    [Z0 - 0.9, Z0 - girderClearHalf],
    [Z0 + girderClearHalf, Z1 - girderClearHalf],
    [Z1 + girderClearHalf, Z2 - girderClearHalf],
    [Z2 + girderClearHalf, Z3 - girderClearHalf],
    [Z3 + girderClearHalf, Z3 + CANTILEVER_M],
  ];
  for (const x of [X3, X4]) {
    for (const [zA, zB] of pubGirderSpans) {
      addRoofIGirder(roofGroup, x, zA, x, zB, girderY, mats.steelCharcoal);
    }
  }

  const privDeckMinX = X0 - 1.1;
  const privDeckMaxX = X3 - CANTILEVER_M - 0.002;
  const privDeck = buildTrapezoidalRoofDeckMesh(
    'stahl.roof.corrugatedDeckPrivate',
    privDeckMinX,
    privDeckMaxX,
    Z0 - 0.9,
    Z1 + CANTILEVER_M,
    CLEAR_CEILING_Y,
    mats.deckOffWhite
  );
  const pubDeck = buildTrapezoidalRoofDeckMesh(
    'stahl.roof.corrugatedDeckPublic',
    X3 - CANTILEVER_M,
    X4 + CANTILEVER_M,
    Z0 - 0.9,
    Z3 + CANTILEVER_M,
    CLEAR_CEILING_Y,
    mats.deckOffWhite
  );
  roofGroup.add(privDeck, pubDeck);

  const fPad = 0.0015;
  const roofPerimeterPath: readonly [number, number][] = [
    [X0 - 1.1 - fPad, Z0 - 0.9 - fPad],
    [X4 + CANTILEVER_M + fPad, Z0 - 0.9 - fPad],
    [X4 + CANTILEVER_M + fPad, Z3 + CANTILEVER_M + fPad],
    [X3 - CANTILEVER_M - fPad, Z3 + CANTILEVER_M + fPad],
    [X3 - CANTILEVER_M - fPad, Z1 + CANTILEVER_M + fPad],
    [X0 - 1.1 - fPad, Z1 + CANTILEVER_M + fPad],
  ];
  const fasciaProfile = [
    [0, -0.014],
    [0.014, -0.014],
    [0.014, 0],
    [0.046, 0],
    [0.046, 0.205],
    [0.004, 0.205],
    [0.004, 0.185],
    [0.032, 0.185],
    [0.032, 0.018],
    [0, 0.018],
  ] as const;
  const fascia = new THREE.Mesh(
    sweepMouldingAlongPath(fasciaProfile, roofPerimeterPath, {
      closed: true,
      elevationY: CLEAR_CEILING_Y - 0.002,
    }),
    mats.steelCharcoal
  );
  fascia.name = 'stahl.roof.cChannelFascia';
  fascia.castShadow = true;

  const flashingPad = 0.0485;
  const flashingPath: readonly [number, number][] = [
    [X0 - 1.1 - flashingPad, Z0 - 0.9 - flashingPad],
    [X4 + CANTILEVER_M + flashingPad, Z0 - 0.9 - flashingPad],
    [X4 + CANTILEVER_M + flashingPad, Z3 + CANTILEVER_M + flashingPad],
    [X3 - CANTILEVER_M - flashingPad, Z3 + CANTILEVER_M + flashingPad],
    [X3 - CANTILEVER_M - flashingPad, Z1 + CANTILEVER_M + flashingPad],
    [X0 - 1.1 - flashingPad, Z1 + CANTILEVER_M + flashingPad],
  ];
  const flashingCap = new THREE.Mesh(
    sweepMouldingAlongPath(
      [
        [0, 0],
        [0.016, 0],
        [0.016, 0.026],
        [-0.036, 0.026],
        [-0.036, 0.014],
        [0, 0.014],
      ] as const,
      flashingPath,
      { closed: true, elevationY: CLEAR_CEILING_Y + 0.204 }
    ),
    mats.anodizedAlum
  );
  flashingCap.name = 'stahl.roof.gravelStopFlashing';
  roofGroup.add(fascia, flashingCap);
  ctx.ceilingMeshGroup.add(roofGroup);

  // Woods Drive Vertical Filleted Robertson Box-Rib Privacy Facade & Carport Wall
  const wallBaseY = 0.0008;
  const wallTopY = CLEAR_CEILING_Y - 0.044;
  const wallH = wallTopY - wallBaseY;
  const wallMidY = wallBaseY + wallH * 0.5;

  const northPrivacyGroup = new THREE.Group();
  northPrivacyGroup.name = 'stahl.northPrivacyWall';
  const northBackMinX = X1 - 0.075;
  const northBackMaxX = X4 - 0.056;
  const revealBottomY = 0.028;
  const revealTopY = CLEAR_CEILING_Y - 0.062;
  const revealWallH = revealTopY - revealBottomY;
  const northBacking = new THREE.Mesh(
    bevelledBox(northBackMaxX - northBackMinX, revealWallH, 0.104, 0.003, 3, 1.5, 1.5),
    mats.plasterOffWhite
  );
  northBacking.position.set((northBackMinX + northBackMaxX) * 0.5, revealBottomY + revealWallH * 0.5, Z0 + 0.104);
  northBacking.castShadow = northBacking.receiveShadow = true;

  const extSkin = new THREE.Mesh(
    bevelledBox(northBackMaxX - northBackMinX, wallH, 0.024, 0.0025, 3, 1.5, 1.5),
    mats.robertsonExteriorTan
  );
  extSkin.position.set((northBackMinX + northBackMaxX) * 0.5, wallMidY, Z0 - 0.069);
  extSkin.castShadow = true;
  northPrivacyGroup.add(northBacking, extSkin);

  const corrFluteGeo = buildFilletedBoxRibFluteGeo(0.068, wallH, 0.038, 'z');
  for (let x = X1 + 0.08; x <= X4 - 0.08; x += 0.1524) {
    if (Math.abs(x - X2) < 0.09 || Math.abs(x - X3) < 0.09) continue;
    const flute = new THREE.Mesh(corrFluteGeo, mats.robertsonExteriorTan);
    flute.position.set(x, wallMidY, Z0 - 0.101);
    flute.castShadow = true;
    northPrivacyGroup.add(flute);
  }
  tagCutaway(northPrivacyGroup, northWoodsCut);
  root.add(northPrivacyGroup);

  const carportWall = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [Z0 + 0.162, wallBaseY],
        [Z1 - 0.062, wallBaseY],
        [Z1 - 0.062, wallTopY],
        [Z0 + 0.162, wallTopY],
      ],
      origin: [X1, 0, 0],
      uAxis: [0, 0, 1],
      vAxis: [0, 1, 0],
      wAxis: [1, 0, 0],
      depthRange: [-0.078, 0.078],
    }),
    mats.robertsonExteriorTan
  );
  carportWall.name = 'stahl.carportWall';
  carportWall.castShadow = carportWall.receiveShadow = true;
  tagCutaway(carportWall, westCarportCut);
  root.add(carportWall);

  const carportTrimGroup = new THREE.Group();
  carportTrimGroup.name = 'stahl.carportWall.detail';
  const carportRibGeo = buildFilletedBoxRibFluteGeo(0.064, wallH - 0.004, 0.032, 'x');
  for (let z = Z0 + 0.28; z <= Z1 - 0.18; z += 0.1524) {
    const rib = new THREE.Mesh(carportRibGeo, mats.robertsonExteriorTan);
    rib.position.set(X1 - 0.095, wallMidY, z);
    carportTrimGroup.add(rib);
  }
  const carportInnerPlaster = new THREE.Mesh(
    bevelledBox(0.016, revealWallH, Z1 - 0.058 - (Z0 + 0.164), 0.002, 2, 1.5, 1.5),
    mats.plasterOffWhite
  );
  carportInnerPlaster.position.set(
    X1 + 0.087,
    revealBottomY + revealWallH * 0.5,
    (Z0 + 0.164 + Z1 - 0.058) * 0.5
  );
  carportInnerPlaster.receiveShadow = true;
  carportTrimGroup.add(carportInnerPlaster);
  tagCutaway(carportTrimGroup, westCarportCut);
  root.add(carportTrimGroup);

  // Modern Recessed Shadow-Gap Base Skirting & Ceiling Track Shadow-Lines
  const shadowGapBase = createSkirtingRun({
    name: 'stahl.trim.shadowGapBase',
    zone: 'stahlMasterSuite',
    points: [
      [X1 + 0.096, Z1 - 0.06],
      [X1 + 0.096, Z0 + 0.157],
      [X4 - 0.06, Z0 + 0.157],
    ],
    roomSide: 'right',
    floorY: 0.0006,
    profile: [
      [0, 0],
      [0.011, 0],
      [0.011, 0.024],
      [0.004, 0.024],
      [0.004, 0.027],
      [0, 0.027],
    ],
    material: mats.steelCharcoal,
    cutawayWalls: [westCarportCut, northWoodsCut],
    floor: 'ground',
    cutawayToleranceM: 0.22,
  });
  root.add(shadowGapBase);

  const ceilingShadowTrack = createSkirtingRun({
    name: 'stahl.trim.ceilingShadowTrack',
    zone: 'stahlMasterSuite',
    points: [
      [X1 + 0.096, Z1 - 0.06],
      [X1 + 0.096, Z0 + 0.157],
      [X4 - 0.06, Z0 + 0.157],
    ],
    roomSide: 'right',
    floorY: CLEAR_CEILING_Y - 0.061,
    profile: [
      [0, 0],
      [0.012, 0],
      [0.012, 0.018],
      [0, 0.018],
    ],
    material: mats.steelCharcoal,
    cutawayWalls: [westCarportCut, northWoodsCut],
    floor: 'ground',
    cutawayToleranceM: 0.22,
  });
  root.add(ceilingShadowTrack);

  // 270-Degree Plate-Glass Curtain Walls & Interactive Arcadia Sliders
  addPlateGlassBay(root, 'stahl.glass.eastBay1', X4, Z0 + 0.062, X4, Z1 - 0.062, mats, eastCliffCut);
  addPlateGlassBay(root, 'stahl.glass.eastBay2', X4, Z1 + 0.062, X4, Z2 - 0.062, mats, eastCliffCut);
  addPlateGlassBay(root, 'stahl.glass.eastBay3', X4, Z2 + 0.062, X4, Z3 - 0.062, mats, eastCliffCut);
  addPlateGlassBay(root, 'stahl.glass.southCliff', X3 + 0.062, Z3, X4 - 0.062, Z3, mats, southCliffCut);

  addArcadiaSlidingGlassWall(ctx, root, {
    doorName: 'stahlArcadiaDiningWest',
    label: 'Arcadia Dining Pool-Terrace Sliding Glass Door',
    axis: 'z',
    fixedCenter: [X3, Z1 + MODULE_M * 0.25],
    sliderCenter: [X3, Z1 + MODULE_M * 0.75],
    leafSpanM: MODULE_M * 0.485,
    slideDeltaM: -MODULE_M * 0.46,
    mats,
    cutaway: westPoolLivingCut,
  });
  addArcadiaSlidingGlassWall(ctx, root, {
    doorName: 'stahlArcadiaLivingWest',
    label: 'Arcadia Living Pavilion Sliding Glass Door',
    axis: 'z',
    fixedCenter: [X3, Z2 + MODULE_M * 0.75],
    sliderCenter: [X3, Z2 + MODULE_M * 0.25],
    leafSpanM: MODULE_M * 0.485,
    slideDeltaM: MODULE_M * 0.46,
    mats,
    cutaway: westPoolLivingCut,
  });
  addArcadiaSlidingGlassWall(ctx, root, {
    doorName: 'stahlArcadiaDenSouth',
    label: 'Arcadia Bedroom 2 / Den Pool Sliding Glass Door',
    axis: 'x',
    fixedCenter: [X1 + MODULE_M * 0.25, Z1],
    sliderCenter: [X1 + MODULE_M * 0.72, Z1],
    leafSpanM: MODULE_M * 0.46,
    slideDeltaM: -MODULE_M * 0.43,
    mats,
    cutaway: southPrivatePoolCut,
  });
  addArcadiaSlidingGlassWall(ctx, root, {
    doorName: 'stahlArcadiaMasterSouth',
    label: 'Arcadia Master Suite Pool Sliding Glass Door',
    axis: 'x',
    fixedCenter: [X2 + MODULE_M * 0.28, Z1],
    sliderCenter: [X2 + MODULE_M * 0.75, Z1],
    leafSpanM: MODULE_M * 0.46,
    slideDeltaM: -MODULE_M * 0.43,
    mats,
    cutaway: southPrivatePoolCut,
  });

  buildKoenigSuspendedFireplace(root, roofGroup, mats);
  buildInfiniliteKitchenCeiling(ctx, root, mats);

  // Emerson-Pryne Recessed Soffit Downlights, Prescolite 64x40 Opal Globes & 2-Way Switch
  const lightingGroup = new THREE.Group();
  lightingGroup.name = 'stahl.lighting.soffitsAndLuminaires';

  const soffitY = CLEAR_CEILING_Y - 0.002;
  const cantileverDownlightCoords: readonly [number, number][] = [
    [-1.15, 2.35],
    [-1.15, 6.05],
    [-1.15, 9.45],
    [1.55, 13.35],
    [4.55, 13.35],
    [7.15, 10.65],
    [7.15, 4.55],
    [7.15, -2.85],
    [-3.05, 1.05],
    [-9.15, 1.05],
  ];
  cantileverDownlightCoords.forEach(([lx, lz], idx) => {
    const onCatwalk = lx > X4 || lz > Z3;
    addEmersonPryneSoffitDownlight(
      ctx,
      lightingGroup,
      `stahl.light.soffitDownlight_${idx + 1}`,
      'stahlCantileverSoffit',
      lx,
      soffitY,
      lz,
      mats,
      {
        hex: 0xffd59c,
        poolY: onCatwalk ? -0.028 : 0.007,
        poolRadius: onCatwalk ? 0.9 : 1.75,
        poolOpacity: onCatwalk ? 0.16 : 0.25,
      }
    );
  });

  const carportGlobeCoords: readonly [number, number][] = [
    [-16.4, -1.65],
    [-14.0, -1.65],
    [-16.4, -4.45],
    [-14.0, -4.45],
  ];
  carportGlobeCoords.forEach(([gx, gz], idx) => {
    addPrescoliteOpalGlobeFixture(
      ctx,
      lightingGroup,
      `stahl.light.carportOpalGlobe_${idx + 1}`,
      'stahlCarportGlobes',
      gx,
      soffitY,
      gz,
      mats,
      { dropM: 0.13, radiusM: 0.095, hex: 0xffdda8, poolRadius: 2.1 }
    );
  });

  addPrescoliteOpalGlobeFixture(
    ctx,
    lightingGroup,
    'stahl.light.livingPrescoliteGlobe',
    'stahlLivingCones',
    4.65,
    soffitY,
    9.25,
    mats,
    { dropM: 0.52, radiusM: 0.155, hex: 0xffd398, poolRadius: 2.3 }
  );
  addEmersonPryneSoffitDownlight(
    ctx,
    lightingGroup,
    'stahl.light.hallwayThresholdDownlight',
    'stahlLivingCones',
    0.72,
    soffitY,
    -0.85,
    mats,
    { hex: 0xffd69e, poolRadius: 1.45, poolOpacity: 0.22 }
  );
  addEmersonPryneSoffitDownlight(
    ctx,
    lightingGroup,
    'stahl.light.masterDressingDownlight',
    'stahlMasterCones',
    -3.55,
    soffitY,
    -2.15,
    mats,
    { hex: 0xffd49c, poolRadius: 1.55, poolOpacity: 0.2 }
  );
  addEmersonPryneSoffitDownlight(
    ctx,
    lightingGroup,
    'stahl.light.denStudyDownlight',
    'stahlDenCones',
    -8.35,
    soffitY,
    -2.15,
    mats,
    { hex: 0xffd49c, poolRadius: 1.55, poolOpacity: 0.2 }
  );
  addEmersonPryneSoffitDownlight(
    ctx,
    lightingGroup,
    'stahl.light.bathCoreDownlight',
    'stahlBathVanity',
    X2 - 0.45,
    soffitY,
    -2.55,
    mats,
    { hex: 0xffecc8, poolRadius: 1.25, poolOpacity: 0.22 }
  );

  ctx.ceilingMeshGroup.add(lightingGroup);

  const carportWestFace = createWallFaceFrame({
    originXZ: [X1 - 0.078, Z0 + 0.2],
    toXZ: [X1 - 0.078, Z1 - 0.06],
    normalXZ: [-1, 0],
    floorY: 0,
    ceilingHeight: CLEAR_CEILING_Y,
    cutaway: westCarportCut,
  });
  const breezewaySwitch = buildCorstonToggleSwitch(ctx, {
    name: 'stahl.sw.breezewaySoffit',
    switchPa: 'plate-breezeway-soffit',
    location: 'Breezeway West carport pier X1/Z1',
    x: 0,
    y: 0,
    z: 0,
    facing: 'west',
    finish: 'BN',
    mountedInZoneId: 'stahlCarport',
    parentGroup: root,
    cutawayWall: westCarportCut,
    gangs: [{ gang: 1, zoneId: 'stahlPoolTerrace', label: 'Cantilever Soffit 2-Way A' }],
  });
  placeOnWall(breezewaySwitch.group, carportWestFace, {
    alongM: carportWestFace.lengthM - 0.34,
    worldY: 1.15,
    standoffM: 0.0006,
    anchor: 'back',
  });

  buildCantileveredCliffCatwalk(root, mats);

  return {
    eastCliffCut,
    southCliffCut,
    northWoodsCut,
    westCarportCut,
    westPoolLivingCut,
    southPrivatePoolCut,
  };
}
