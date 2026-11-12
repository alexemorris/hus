import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  extrudePlanarSolidWithHoles,
  prepGeo,
  registerHingedDoor,
  sweepMouldingAlongPath,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { SceneBuilderContext } from 'husjs/viewer';
import {
  CANTILEVER_M,
  CATWALK_WIDTH_M,
  CLEAR_CEILING_Y,
  DECK_DEPTH_M,
  GIRDER_DEPTH_M,
  H_COL_SIZE_M,
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
}

export function createStahlMaterials(): StahlMaterials {
  return {
    steelCharcoal: new THREE.MeshStandardMaterial({ color: 0x232629, roughness: 0.44, metalness: 0.72 }),
    deckOffWhite: new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.56, metalness: 0.14 }),
    concreteSlab: new THREE.MeshStandardMaterial({ color: 0xbab6ac, roughness: 0.68 }),
    aggregateDeck: new THREE.MeshStandardMaterial({ color: 0xc8c2b5, roughness: 0.84 }),
    anodizedAlum: new THREE.MeshStandardMaterial({ color: 0xcbd1d5, roughness: 0.26, metalness: 0.88 }),
    plateGlass: new THREE.MeshPhysicalMaterial({
      color: 0xdff0f4,
      transparent: true,
      opacity: 0.2,
      roughness: 0.04,
      metalness: 0.05,
      transmission: 0,
      ior: 1.5,
    }),
    walnutWood: new THREE.MeshStandardMaterial({ color: 0x4c3221, roughness: 0.48 }),
    parchmentFormica: new THREE.MeshStandardMaterial({ color: 0xefeadd, roughness: 0.34 }),
    matteBlackHood: new THREE.MeshStandardMaterial({ color: 0x191a1c, roughness: 0.52, metalness: 0.58 }),
    plasterOffWhite: new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.82 }),
  };
}

/** Builds a true wide-flange `102 × 102 mm` (`4" × 4"`) H-column at `(x, z)`. */
function addWideFlangeColumn(parent: THREE.Object3D, x: number, z: number, yBottom: number, yTop: number, mat: THREE.Material): void {
  const h = yTop - yBottom;
  const g = new THREE.Group();
  g.position.set(x, yBottom + h * 0.5, z);
  const fThick = 0.011;
  const wThick = 0.008;
  const f1 = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(H_COL_SIZE_M, h, fThick)), mat);
  f1.position.z = (H_COL_SIZE_M - fThick) * 0.5;
  const f2 = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(H_COL_SIZE_M, h, fThick)), mat);
  f2.position.z = -(H_COL_SIZE_M - fThick) * 0.5;
  const web = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(wThick, h, H_COL_SIZE_M - 2 * fThick - 0.001)), mat);
  f1.castShadow = f2.castShadow = web.castShadow = true;
  g.add(f1, f2, web);
  parent.add(g);
}

/** Builds a `305 mm` (`12"`) wide-flange I-beam roof girder between `(x1, z1)` and `(x2, z2)`. */
function addRoofIGirder(parent: THREE.Object3D, x1: number, z1: number, x2: number, z2: number, yBottom: number, mat: THREE.Material): void {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const rotY = Math.atan2(x2 - x1, z2 - z1);
  const g = new THREE.Group();
  g.position.set((x1 + x2) * 0.5, yBottom + GIRDER_DEPTH_M * 0.5, (z1 + z2) * 0.5);
  g.rotation.y = rotY;
  const flangeW = 0.14;
  const flangeT = 0.014;
  const topF = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(flangeW, flangeT, len)), mat);
  topF.position.y = (GIRDER_DEPTH_M - flangeT) * 0.5;
  const botF = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(flangeW, flangeT, len)), mat);
  botF.position.y = -(GIRDER_DEPTH_M - flangeT) * 0.5;
  const web = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.01, GIRDER_DEPTH_M - 2 * flangeT - 0.001, len)), mat);
  topF.castShadow = botF.castShadow = web.castShadow = true;
  g.add(topF, botF, web);
  parent.add(g);
}

/**
 * Registers an interactive clear-anodized Arcadia aluminum sliding glass door leaf (`2.42 m` tall
 * leaf inside `220 mm` header/roller track assembly up to `2.642 m` soffit) so:
 * 1) Clicking or pressing `F` slides the glass panel smoothly along `slideVec` (`linearSlideOffset`),
 * 2) `InteractionRegistry.getExteriorDoorAcousticPortals()` automatically detects it as an exterior
 *    walkthrough portal (`h = 2.42 <= 2.45`) and opens up the `'hills-city'` soundscape!
 */
function addArcadiaSlidingGlassWall(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  options: {
    readonly doorName: string;
    readonly axis: 'x' | 'z';
    readonly fixedCenter: readonly [number, number];
    readonly sliderCenter: readonly [number, number];
    readonly leafSpanM: number;
    readonly slideDeltaM: number;
    readonly mats: StahlMaterials;
    readonly cutaway?: CutawayWallDescriptor;
  }
): void {
  const { doorName, axis, fixedCenter, sliderCenter, leafSpanM, slideDeltaM, mats, cutaway } = options;
  const leafH = 2.42; // Fits inside 2.45 m exterior portal height threshold + 0.22 m Arcadia top header track
  const headerTopY = CLEAR_CEILING_Y - 0.038;
  const headerH = headerTopY - leafH;
  const sillBottomY = 0.0006;
  const sillTopY = 0.024;
  const sillH = sillTopY - sillBottomY;
  const rotY = axis === 'z' ? Math.PI / 2 : 0;

  // Continuous Arcadia anodized aluminum head track & sill track across both panels
  const midX = (fixedCenter[0] + sliderCenter[0]) * 0.5;
  const midZ = (fixedCenter[1] + sliderCenter[1]) * 0.5;
  const totalSpan = leafSpanM * 2 + 0.05;
  const header = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(totalSpan, headerH, 0.095)), mats.anodizedAlum);
  header.position.set(midX, leafH + headerH * 0.5, midZ);
  header.rotation.y = rotY;
  const sill = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(totalSpan, sillH, 0.095)), mats.anodizedAlum);
  sill.position.set(midX, sillBottomY + sillH * 0.5, midZ);
  sill.rotation.y = rotY;
  if (cutaway) {
    tagCutaway(header, cutaway);
    tagCutaway(sill, cutaway);
  }
  parent.add(header, sill);

  // Fixed plate-glass panel (seated cleanly between sillTopY and header bottom leafH)
  const fixedPanelBottomY = sillTopY + 0.0006;
  const fixedPanelTopY = leafH - 0.0006;
  const fixedPanelH = fixedPanelTopY - fixedPanelBottomY;
  const fixedGroup = new THREE.Group();
  fixedGroup.name = `${doorName}.fixedPanel`;
  fixedGroup.position.set(fixedCenter[0], fixedPanelBottomY + fixedPanelH * 0.5, fixedCenter[1]);
  fixedGroup.rotation.y = rotY;
  const fGlass = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(leafSpanM - 0.078, fixedPanelH - 0.01, 0.016)), mats.plateGlass);
  fGlass.name = `${doorName}.fixed.glass`;
  const fStileL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.038, fixedPanelH, 0.044)), mats.anodizedAlum);
  fStileL.position.x = -leafSpanM * 0.5 + 0.019;
  const fStileR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.038, fixedPanelH, 0.044)), mats.anodizedAlum);
  fStileR.position.x = leafSpanM * 0.5 - 0.019;
  fixedGroup.add(fGlass, fStileL, fStileR);
  if (cutaway) tagCutaway(fixedGroup, cutaway);
  parent.add(fixedGroup);

  // Sliding Arcadia leaf (registered via registerHingedDoor + linearSlideOffset for smooth linear slide!)
  const sliderBaseY = sillTopY + 0.001;
  const sliderStileH = leafH - sliderBaseY - 0.001;
  const stileW = 0.042;
  const topRailH = 0.042;
  const innerLeafSpan = leafSpanM - 2 * stileW - 0.001;
  const sliderLeaf = new THREE.Group();
  sliderLeaf.name = doorName;
  sliderLeaf.position.set(
    sliderCenter[0] + (axis === 'z' ? -0.026 : 0),
    sliderBaseY,
    sliderCenter[1] + (axis === 'x' ? 0.026 : 0)
  );
  const stiles: [number, number, number, number][] = axis === 'x'
    ? [
        [stileW, sliderStileH, 0.044, -leafSpanM * 0.5 + stileW * 0.5],
        [stileW, sliderStileH, 0.044, leafSpanM * 0.5 - stileW * 0.5],
      ]
    : [
        [0.044, sliderStileH, stileW, -leafSpanM * 0.5 + stileW * 0.5],
        [0.044, sliderStileH, stileW, leafSpanM * 0.5 - stileW * 0.5],
      ];
  for (const [sw, sh, sd, offset] of stiles) {
    const stile = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(sw, sh, sd)), mats.anodizedAlum);
    stile.position.set(axis === 'x' ? offset : 0, sliderStileH * 0.5, axis === 'z' ? offset : 0);
    sliderLeaf.add(stile);
  }
  const topRail = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(axis === 'x' ? innerLeafSpan : 0.044, topRailH, axis === 'z' ? innerLeafSpan : 0.044)),
    mats.anodizedAlum
  );
  topRail.position.y = sliderStileH - topRailH * 0.5;
  const pullHandle = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.022, 0.28, 0.048)), mats.anodizedAlum);
  pullHandle.position.set(
    axis === 'x' ? (slideDeltaM > 0 ? -leafSpanM * 0.5 + 0.021 : leafSpanM * 0.5 - 0.021) : 0,
    1.02,
    axis === 'z' ? (slideDeltaM > 0 ? -leafSpanM * 0.5 + 0.021 : leafSpanM * 0.5 - 0.021) : 0
  );
  const sGlassH = sliderStileH - topRailH - 0.002;
  const sGlass = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(axis === 'x' ? innerLeafSpan - 0.002 : 0.016, sGlassH, axis === 'z' ? innerLeafSpan - 0.002 : 0.016)),
    mats.plateGlass
  );
  sGlass.name = `${doorName}.glass`;
  sGlass.position.y = sGlassH * 0.5 + 0.001;
  sliderLeaf.add(topRail, pullHandle, sGlass);
  if (cutaway) tagCutaway(sliderLeaf, cutaway);
  parent.add(sliderLeaf);

  const hingeOffset: [number, number, number] =
    axis === 'x' ? [-leafSpanM * 0.5, 0, 0] : [0, 0, -leafSpanM * 0.5];
  const pivot = registerHingedDoor(ctx, {
    parent,
    door: sliderLeaf,
    hingeOffset,
    axis: 'y',
    openAngle: 0,
  });
  pivot.userData.linearSlideOffset = new THREE.Vector3(
    axis === 'x' ? slideDeltaM : 0,
    0,
    axis === 'z' ? slideDeltaM : 0
  );
}

/** Fixed floor-to-ceiling polished plate-glass curtain bay (`0.00..2.642 m`). */
function addPlateGlassBay(
  parent: THREE.Object3D,
  name: string,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  mats: StahlMaterials,
  cutaway?: CutawayWallDescriptor
): void {
  const span = Math.hypot(x2 - x1, z2 - z1);
  const rotY = Math.atan2(x2 - x1, z2 - z1) + Math.PI * 0.5;
  const bayBottomY = 0.0006;
  const bayTopY = CLEAR_CEILING_Y - 0.038;
  const bayH = bayTopY - bayBottomY;
  const sillH = 0.03;
  const headH = 0.036;
  const mullionW = 0.038;
  const g = new THREE.Group();
  g.name = name;
  g.position.set((x1 + x2) * 0.5, bayBottomY + bayH * 0.5, (z1 + z2) * 0.5);
  g.rotation.y = rotY;

  const sill = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(span, sillH, 0.06)), mats.anodizedAlum);
  sill.position.y = -bayH * 0.5 + sillH * 0.5;
  const head = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(span, headH, 0.06)), mats.anodizedAlum);
  head.position.y = bayH * 0.5 - headH * 0.5;
  const innerH = bayH - sillH - headH - 0.001;
  const innerMidY = (sillH - headH) * 0.5;
  const mullion = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(mullionW, innerH, 0.064)), mats.anodizedAlum);
  mullion.position.y = innerMidY;
  const paneW = (span - 0.04 - mullionW) * 0.5 - 0.002;
  const paneOffset = mullionW * 0.5 + paneW * 0.5 + 0.001;
  const paneL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(paneW, innerH - 0.001, 0.018)), mats.plateGlass);
  paneL.name = `${name}.glass`;
  paneL.position.set(-paneOffset, innerMidY, 0);
  const paneR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(paneW, innerH - 0.001, 0.018)), mats.plateGlass);
  paneR.name = `${name}.glassRight`;
  paneR.position.set(paneOffset, innerMidY, 0);
  g.add(sill, head, mullion, paneL, paneR);
  if (cutaway) tagCutaway(g, cutaway);
  parent.add(g);
}

export function buildStahlStructure(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials
): {
  readonly eastCliffCut: CutawayWallDescriptor;
  readonly southCliffCut: CutawayWallDescriptor;
  readonly northWoodsCut: CutawayWallDescriptor;
  readonly westCarportCut: CutawayWallDescriptor;
} {
  // Cantilevered 762 mm (30") concrete grade beams + deep bedrock caissons + retaining wall
  const beamH = 0.762;
  const beamW = 0.36;
  const beamTopY = -0.182;
  const beamCenterY = beamTopY - beamH * 0.5;
  const beamBotY = beamTopY - beamH;
  const gradeBeamGroup = new THREE.Group();
  gradeBeamGroup.name = 'stahl.foundation.gradeBeams';
  for (const z of [Z0, Z1, Z2, Z3]) {
    const minX = z <= Z1 ? X0 : X3 - 1.2;
    const maxX = X4 + CATWALK_WIDTH_M;
    const beam = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(maxX - minX, beamH, beamW)), mats.concreteSlab);
    beam.position.set((minX + maxX) * 0.5, beamCenterY, z);
    beam.castShadow = true;
    gradeBeamGroup.add(beam);
  }
  const beamHalfW = beamW * 0.5 + 0.001;
  const nsBeamSpans: readonly [number, number][] = [
    [Z0 + beamHalfW, Z1 - beamHalfW],
    [Z1 + beamHalfW, Z2 - beamHalfW],
    [Z2 + beamHalfW, Z3 - beamHalfW],
    [Z3 + beamHalfW, Z3 + CATWALK_WIDTH_M],
  ];
  for (const x of [X3, X4]) {
    for (const [zMin, zMax] of nsBeamSpans) {
      const beam = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(beamW, beamH, zMax - zMin)), mats.concreteSlab);
      beam.position.set(x, beamCenterY, (zMin + zMax) * 0.5);
      beam.castShadow = true;
      gradeBeamGroup.add(beam);
    }
  }

  // Deep reinforced concrete caissons & stepped cliffside retaining stem walls inboard of the cantilever crest
  const caissonTopY = beamBotY - 0.004;
  const caissonCoords: readonly [number, number][] = [
    [3.06, Z0],
    [3.06, Z1],
    [3.06, Z2],
    [3.06, 9.04],
    [X3, 9.04],
  ];
  for (const [cx, cz] of caissonCoords) {
    const groundY = Math.min(-2.6, stahlTerrainSampler.sampleTerrainY(cx, cz) - 1.35);
    const h = caissonTopY - groundY;
    const caisson = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.36, 0.40, h, 18)), mats.concreteSlab);
    caisson.position.set(cx, groundY + h * 0.5, cz);
    caisson.castShadow = true;
    gradeBeamGroup.add(caisson);
  }
  const retainTopY = beamBotY - 0.002;
  const retainBotY = -3.85;
  const retainH = retainTopY - retainBotY;
  const retainCenterY = retainBotY + retainH * 0.5;
  const retainEastMinZ = Z0 + 0.19;
  const retainEastMaxZ = 9.04 + 0.17;
  const retainEast = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.34, retainH, retainEastMaxZ - retainEastMinZ)),
    mats.concreteSlab
  );
  retainEast.position.set(3.06, retainCenterY, (retainEastMinZ + retainEastMaxZ) * 0.5);

  const retainLivingSouthMinX = X3 - 0.175;
  const retainLivingSouthMaxX = 3.06 - 0.17 - 0.002;
  const retainLivingSouth = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(retainLivingSouthMaxX - retainLivingSouthMinX, retainH, 0.34)),
    mats.concreteSlab
  );
  retainLivingSouth.position.set((retainLivingSouthMinX + retainLivingSouthMaxX) * 0.5, retainCenterY, 9.04);

  // Engineered concrete pool-terrace perimeter stem wall directly supporting southDeck/westDeck
  const terraceStemTopY = -0.152;
  const terraceStemBotY = -0.64;
  const terraceStemH = terraceStemTopY - terraceStemBotY;
  const terraceStemMidY = terraceStemBotY + terraceStemH * 0.5;
  const terraceStemMinX = -13.73;
  const terraceStemMaxX = X3 - 0.185;
  const retainSouth = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(terraceStemMaxX - terraceStemMinX, terraceStemH, 0.34)),
    mats.concreteSlab
  );
  retainSouth.position.set((terraceStemMinX + terraceStemMaxX) * 0.5, terraceStemMidY, 9.35);

  const westStemMinZ = Z1 + 0.02;
  const westStemMaxZ = 9.35 - 0.17 - 0.002;
  const retainWest = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.34, terraceStemH, westStemMaxZ - westStemMinZ)),
    mats.concreteSlab
  );
  retainWest.position.set(-13.56, terraceStemMidY, (westStemMinZ + westStemMaxZ) * 0.5);

  gradeBeamGroup.add(retainEast, retainLivingSouth, retainSouth, retainWest);
  root.add(gradeBeamGroup);

  // Polished concrete L-shaped interior floor slabs (`Y = 0.000 m`)
  const privSlabMaxX = X3 - 0.001;
  const privateSlab = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(privSlabMaxX - X0, 0.18, Z1 - Z0)), mats.concreteSlab);
  privateSlab.position.set((X0 + privSlabMaxX) * 0.5, -0.09, (Z0 + Z1) * 0.5);
  privateSlab.receiveShadow = true;
  const publicSlab = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(X4 - X3, 0.18, Z3 - Z0)), mats.concreteSlab);
  publicSlab.position.set((X3 + X4) * 0.5, -0.09, (Z0 + Z3) * 0.5);
  publicSlab.receiveShadow = true;
  root.add(privateSlab, publicSlab);

  // Exposed 102 x 102 mm (4" x 4") wide-flange steel H-columns at every 6.096 m grid intersection
  const columnsGroup = new THREE.Group();
  columnsGroup.name = 'stahl.steel.columns';
  const gridCols: readonly [number, number][] = [
    [X0, Z0], [X1, Z0], [X2, Z0], [X3, Z0], [X4, Z0],
    [X0, Z1], [X1, Z1], [X2, Z1], [X3, Z1], [X4, Z1],
    [X3, Z2], [X4, Z2],
    [X3, Z3], [X4, Z3],
  ];
  for (const [cx, cz] of gridCols) {
    addWideFlangeColumn(columnsGroup, cx, cz, 0.0006, CLEAR_CEILING_Y - 0.0006, mats.steelCharcoal);
  }
  root.add(columnsGroup);

  // Primary 305 mm (12") I-beam roof girders + 2.286 m (7'-6") cantilevered overhangs + fluted 18-ga T&G steel deck
  const roofGroup = new THREE.Group();
  roofGroup.name = 'stahl.steel.roof';
  const girderY = CLEAR_CEILING_Y + DECK_DEPTH_M + 0.0006;

  // E-W primary girders along Z0..Z3
  addRoofIGirder(roofGroup, X0 - 1.1, Z0, X4 + CANTILEVER_M, Z0, girderY, mats.steelCharcoal);
  addRoofIGirder(roofGroup, X0 - 1.1, Z1, X4 + CANTILEVER_M, Z1, girderY, mats.steelCharcoal);
  addRoofIGirder(roofGroup, X3 - CANTILEVER_M, Z2, X4 + CANTILEVER_M, Z2, girderY, mats.steelCharcoal);
  addRoofIGirder(roofGroup, X3 - CANTILEVER_M, Z3, X4 + CANTILEVER_M, Z3, girderY, mats.steelCharcoal);

  // N-S secondary framing beams cleanly coped between E-W girders along X0..X4
  const girderClearHalf = 0.07 + 0.001;
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

  // Corrugated T&G steel roof deck (non-overlapping L-shape with exposed fluted soffit ribs)
  const privDeckMinX = X0 - 1.1;
  const privDeckMaxX = X3 - CANTILEVER_M - 0.001;
  const privDeckW = privDeckMaxX - privDeckMinX;
  const privDeckD = (Z1 + CANTILEVER_M) - (Z0 - 0.9);
  const privDeck = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(privDeckW, DECK_DEPTH_M, privDeckD)), mats.deckOffWhite);
  privDeck.position.set((privDeckMinX + privDeckMaxX) * 0.5, CLEAR_CEILING_Y + DECK_DEPTH_M * 0.5, ((Z0 - 0.9) + (Z1 + CANTILEVER_M)) * 0.5);
  privDeck.castShadow = true;

  const pubDeckW = (X4 + CANTILEVER_M) - (X3 - CANTILEVER_M);
  const pubDeckD = (Z3 + CANTILEVER_M) - (Z0 - 0.9);
  const pubDeck = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(pubDeckW, DECK_DEPTH_M, pubDeckD)), mats.deckOffWhite);
  pubDeck.position.set(((X3 - CANTILEVER_M) + (X4 + CANTILEVER_M)) * 0.5, CLEAR_CEILING_Y + DECK_DEPTH_M * 0.5, ((Z0 - 0.9) + (Z3 + CANTILEVER_M)) * 0.5);
  pubDeck.castShadow = true;
  roofGroup.add(privDeck, pubDeck);

  // Exposed fluted soffit ribs every 0.305 m across the L-deck underside
  const ribCenterY = CLEAR_CEILING_Y - 0.0185;
  const ribGeoPriv = prepGeo(new THREE.BoxGeometry(privDeckW, 0.036, 0.065));
  for (let z = Z0 - 0.75; z <= Z1 + CANTILEVER_M - 0.1; z += 0.305) {
    const rib = new THREE.Mesh(ribGeoPriv, mats.deckOffWhite);
    rib.position.set((privDeckMinX + privDeckMaxX) * 0.5, ribCenterY, z);
    roofGroup.add(rib);
  }
  const ribGeoPub = prepGeo(new THREE.BoxGeometry(pubDeckW, 0.036, 0.065));
  for (let z = Z0 - 0.75; z <= Z3 + CANTILEVER_M - 0.1; z += 0.305) {
    const rib = new THREE.Mesh(ribGeoPub, mats.deckOffWhite);
    rib.position.set(((X3 - CANTILEVER_M) + (X4 + CANTILEVER_M)) * 0.5, ribCenterY, z);
    roofGroup.add(rib);
  }

  // Charcoal C-channel perimeter fascia trim offset outward by 1 mm from roof deck edge
  const fPad = 0.001;
  const fasciaProfile = [[0, 0], [0.045, 0], [0.045, 0.22], [0, 0.22]] as const;
  const fascia = new THREE.Mesh(
    sweepMouldingAlongPath(
      fasciaProfile,
      [
        [X0 - 1.1 - fPad, Z0 - 0.9 - fPad],
        [X4 + CANTILEVER_M + fPad, Z0 - 0.9 - fPad],
        [X4 + CANTILEVER_M + fPad, Z3 + CANTILEVER_M + fPad],
        [X3 - CANTILEVER_M - fPad, Z3 + CANTILEVER_M + fPad],
        [X3 - CANTILEVER_M - fPad, Z1 + CANTILEVER_M + fPad],
        [X0 - 1.1 - fPad, Z1 + CANTILEVER_M + fPad],
      ],
      { closed: true, elevationY: CLEAR_CEILING_Y + 0.02 }
    ),
    mats.steelCharcoal
  );
  roofGroup.add(fascia);
  ctx.ceilingMeshGroup.add(roofGroup);

  // Windowless North corrugated charcoal-steel street privacy facade along Woods Drive (`Z = Z0`)
  const wallBaseY = 0.0006;
  const wallTopY = CLEAR_CEILING_Y - 0.038;
  const wallH = wallTopY - wallBaseY;
  const wallMidY = wallBaseY + wallH * 0.5;
  const northWoodsCut: CutawayWallDescriptor = { axis: 'z', coord: Z0, minSpan: X1 - 0.2, maxSpan: X4 + 0.2, floor: 'ground', outwardSide: 'north' };
  const northPrivacyGroup = new THREE.Group();
  northPrivacyGroup.name = 'stahl.northPrivacyWall';
  const northBackMinX = X1 - 0.08;
  const northBackMaxX = X4 - 0.052;
  const northBacking = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(northBackMaxX - northBackMinX, wallH, 0.11)), mats.plasterOffWhite);
  northBacking.position.set((northBackMinX + northBackMaxX) * 0.5, wallMidY, Z0 + 0.107);
  northBacking.castShadow = true;
  northPrivacyGroup.add(northBacking);

  const corrFluteGeo = prepGeo(new THREE.BoxGeometry(0.075, wallH, 0.045));
  for (let x = X1 + 0.08; x <= X4 - 0.08; x += 0.16) {
    const flute = new THREE.Mesh(corrFluteGeo, mats.steelCharcoal);
    flute.position.set(x, wallMidY, Z0 - 0.075);
    flute.castShadow = true;
    northPrivacyGroup.add(flute);
  }
  tagCutaway(northPrivacyGroup, northWoodsCut);
  root.add(northPrivacyGroup);

  // Carport storage/utility divider wall at `X = X1` (west enclosure wall of private wing)
  const westCarportCut: CutawayWallDescriptor = { axis: 'x', coord: X1, minSpan: Z0, maxSpan: Z1, floor: 'ground', outwardSide: 'west' };
  const carportWall = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [[Z0 + 0.163, wallBaseY], [Z1 - 0.052, wallBaseY], [Z1 - 0.052, CLEAR_CEILING_Y - 0.038], [Z0 + 0.163, CLEAR_CEILING_Y - 0.038]],
      origin: [X1, 0, 0],
      uAxis: [0, 0, 1],
      vAxis: [0, 1, 0],
      wAxis: [1, 0, 0],
      depthRange: [-0.08, 0.08],
    }),
    mats.steelCharcoal
  );
  carportWall.name = 'stahl.carportWall';
  carportWall.castShadow = true;
  tagCutaway(carportWall, westCarportCut);
  root.add(carportWall);

  // 270° Floor-to-Ceiling Plate Glass Curtain Walls & Arcadia Sliding Glass Doors
  const eastCliffCut: CutawayWallDescriptor = { axis: 'x', coord: X4, minSpan: Z0, maxSpan: Z3, floor: 'ground', outwardSide: 'east' };
  const southCliffCut: CutawayWallDescriptor = { axis: 'z', coord: Z3, minSpan: X3, maxSpan: X4, floor: 'ground', outwardSide: 'south' };
  const westPoolLivingCut: CutawayWallDescriptor = { axis: 'x', coord: X3, minSpan: Z1, maxSpan: Z3, floor: 'ground', outwardSide: 'west' };
  const southPrivatePoolCut: CutawayWallDescriptor = { axis: 'z', coord: Z1, minSpan: X1, maxSpan: X3, floor: 'ground', outwardSide: 'south' };

  // East cliff curtain wall (`X = X4`, 3 bays `Z0..Z3` overlooking downtown LA)
  addPlateGlassBay(root, 'stahl.glass.eastBay1', X4, Z0 + 0.06, X4, Z1 - 0.06, mats, eastCliffCut);
  addPlateGlassBay(root, 'stahl.glass.eastBay2', X4, Z1 + 0.06, X4, Z2 - 0.06, mats, eastCliffCut);
  addPlateGlassBay(root, 'stahl.glass.eastBay3', X4, Z2 + 0.06, X4, Z3 - 0.06, mats, eastCliffCut);

  // South cliff curtain wall (`Z = Z3`, `X3..X4` overlooking Sunset Strip & Santa Monica Bay)
  addPlateGlassBay(root, 'stahl.glass.southCliff', X3 + 0.06, Z3, X4 - 0.06, Z3, mats, southCliffCut);

  // West pool-facing Arcadia sliding glass walls on Living & Dining bays (`X = X3`, `Z1..Z3`)
  addArcadiaSlidingGlassWall(ctx, root, {
    doorName: 'stahlArcadiaDiningWest',
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
    axis: 'z',
    fixedCenter: [X3, Z2 + MODULE_M * 0.75],
    sliderCenter: [X3, Z2 + MODULE_M * 0.25],
    leafSpanM: MODULE_M * 0.485,
    slideDeltaM: MODULE_M * 0.46,
    mats,
    cutaway: westPoolLivingCut,
  });

  // Private wing South pool-facing Arcadia sliding glass doors (`Z = Z1`, `X1..X3`)
  addArcadiaSlidingGlassWall(ctx, root, {
    doorName: 'stahlArcadiaDenSouth',
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
    axis: 'x',
    fixedCenter: [X2 + MODULE_M * 0.28, Z1],
    sliderCenter: [X2 + MODULE_M * 0.75, Z1],
    leafSpanM: MODULE_M * 0.46,
    slideDeltaM: -MODULE_M * 0.43,
    mats,
    cutaway: southPrivatePoolCut,
  });

  // Cantilevered off-white longitudinal slatted steel window-washer catwalk along East + South cliff (HABS CA-2702 & /tmp/stahl_cliff_ref.png)
  const catwalkGroup = new THREE.Group();
  catwalkGroup.name = 'stahl.cliffCatwalk';

  const slatCount = 6;
  const slatW = 0.056;
  const slatH = 0.024;
  const slatY = -0.042;
  const innerOffset = 0.085;
  const slatPitch = (CATWALK_WIDTH_M - 0.04) / (slatCount - 1);
  const outerEdgeX = X4 + innerOffset + (slatCount - 1) * slatPitch + slatW * 0.5;
  const outerEdgeZ = Z3 + innerOffset + (slatCount - 1) * slatPitch + slatW * 0.5;

  // Longitudinal off-white steel slats mitred cleanly around the SE promontory corner (0 coplanar overlap!)
  for (let i = 0; i < slatCount; i++) {
    const offset = innerOffset + i * slatPitch;
    const slatX = X4 + offset;
    const slatZ = Z3 + offset;

    const eastSlatMinZ = Z0 - 0.12;
    const eastSlatMaxZ = slatZ - slatW * 0.5 - 0.002;
    const eastSlat = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(slatW, slatH, eastSlatMaxZ - eastSlatMinZ)),
      mats.deckOffWhite
    );
    eastSlat.position.set(slatX, slatY, (eastSlatMinZ + eastSlatMaxZ) * 0.5);
    eastSlat.castShadow = eastSlat.receiveShadow = true;

    const southSlatMinX = X3 - 0.42;
    const southSlatMaxX = slatX + slatW * 0.5;
    const southSlat = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(southSlatMaxX - southSlatMinX, slatH, slatW)),
      mats.deckOffWhite
    );
    southSlat.position.set((southSlatMinX + southSlatMaxX) * 0.5, slatY, slatZ);
    southSlat.castShadow = southSlat.receiveShadow = true;

    catwalkGroup.add(eastSlat, southSlat);
  }

  // Crisp off-white perimeter fascia trim & transverse steel outrigger bearer angles over the cantilevered grade beams
  const trimH = 0.068;
  const trimT = 0.022;
  const trimY = -0.056;
  const eastTrimMinZ = Z0 - 0.14;
  const eastTrimMaxZ = outerEdgeZ + trimT + 0.002;
  const eastFascia = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(trimT, trimH, eastTrimMaxZ - eastTrimMinZ)),
    mats.deckOffWhite
  );
  eastFascia.position.set(outerEdgeX + trimT * 0.5 + 0.002, trimY, (eastTrimMinZ + eastTrimMaxZ) * 0.5);
  eastFascia.castShadow = true;

  const southTrimMinX = X3 - 0.44;
  const southTrimMaxX = outerEdgeX + 0.001;
  const southFascia = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(southTrimMaxX - southTrimMinX, trimH, trimT)),
    mats.deckOffWhite
  );
  southFascia.position.set((southTrimMinX + southTrimMaxX) * 0.5, trimY, outerEdgeZ + trimT * 0.5 + 0.002);
  southFascia.castShadow = true;
  catwalkGroup.add(eastFascia, southFascia);

  const bearerSpan = outerEdgeX - (X4 + 0.055);
  const bearerGeoEW = prepGeo(new THREE.BoxGeometry(bearerSpan, 0.042, 0.048));
  for (const bz of [Z0, (Z0 + Z1) * 0.5, Z1, (Z1 + Z2) * 0.5, Z2, (Z2 + Z3) * 0.5, Z3]) {
    const bearer = new THREE.Mesh(bearerGeoEW, mats.deckOffWhite);
    bearer.position.set(X4 + 0.055 + bearerSpan * 0.5, -0.076, bz);
    catwalkGroup.add(bearer);
  }
  const bearerSpanNS = outerEdgeZ - (Z3 + 0.055);
  const bearerGeoNS = prepGeo(new THREE.BoxGeometry(0.048, 0.042, bearerSpanNS));
  for (const bx of [X3, (X3 + X4) * 0.5, X4]) {
    const bearer = new THREE.Mesh(bearerGeoNS, mats.deckOffWhite);
    bearer.position.set(bx, -0.076, Z3 + 0.055 + bearerSpanNS * 0.5);
    catwalkGroup.add(bearer);
  }

  // Signature diagonal steel corner brace strut at SE column (X4, Z3) -> outer catwalk mitre (visible in /tmp/stahl_cliff_ref.png)
  const braceStart = new THREE.Vector3(X4 + 0.056, 0.34, Z3 + 0.056);
  const braceEnd = new THREE.Vector3(X4 + 0.36, -0.024, Z3 + 0.36);
  const braceDir = braceEnd.clone().sub(braceStart);
  const braceLen = braceDir.length();
  const cornerBrace = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.013, 0.013, braceLen, 10)),
    mats.anodizedAlum
  );
  cornerBrace.position.copy(braceStart).addScaledVector(braceDir, 0.5);
  cornerBrace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), braceDir.normalize());
  tagCollisionRole(cornerBrace, 'ignore');
  catwalkGroup.add(cornerBrace);

  root.add(catwalkGroup);

  return { eastCliffCut, southCliffCut, northWoodsCut, westCarportCut };
}
