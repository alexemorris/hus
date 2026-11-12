import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  attachAssetInteraction,
  attachAssetMetadata,
  attachAudioEmitter,
  buildCorstonToggleSwitch,
  buildHallWoodBurningStoveFirebox,
  createSkirtingRun,
  createWallFaceFrame,
  extrudePlanarSolidWithHoles,
  markAssetInteractionBound,
  placeOnWall,
  prepGeo,
  registerHingedDoor,
  sweepMouldingAlongPath,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
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

export function createStahlMaterials(): StahlMaterials {
  // Authentic Koenig two-tone Perma-Bar / Perma-Tone palette (Arts & Architecture June 1960, pp. 18, 21, 30)
  return {
    steelCharcoal: new THREE.MeshStandardMaterial({ color: 0x38342f, roughness: 0.42, metalness: 0.58 }),
    deckOffWhite: new THREE.MeshStandardMaterial({ color: 0xece6d8, roughness: 0.52, metalness: 0.12 }),
    concreteSlab: new THREE.MeshStandardMaterial({ color: 0xbab4a8, roughness: 0.64 }),
    aggregateDeck: new THREE.MeshStandardMaterial({ color: 0xc8c1b3, roughness: 0.84 }),
    anodizedAlum: new THREE.MeshStandardMaterial({ color: 0xcdd2d5, roughness: 0.24, metalness: 0.88 }),
    plateGlass: new THREE.MeshPhysicalMaterial({
      color: 0xdceef2,
      transparent: true,
      opacity: 0.19,
      roughness: 0.035,
      metalness: 0.04,
      transmission: 0,
      ior: 1.51,
    }),
    walnutWood: new THREE.MeshStandardMaterial({ color: 0x523522, roughness: 0.45 }),
    parchmentFormica: new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.32 }),
    matteBlackHood: new THREE.MeshStandardMaterial({ color: 0x201f1e, roughness: 0.5, metalness: 0.52 }),
    plasterOffWhite: new THREE.MeshStandardMaterial({ color: 0xf1ede3, roughness: 0.8 }),
    robertsonExteriorTan: new THREE.MeshStandardMaterial({ color: 0xccc6b8, roughness: 0.56, metalness: 0.22 }),
    hearthPalosVerdes: new THREE.MeshStandardMaterial({ color: 0x9b958a, roughness: 0.72 }),
    guardrailOffWhite: new THREE.MeshStandardMaterial({ color: 0xe8e5dc, roughness: 0.44, metalness: 0.26 }),
  };
}

/**
 * Builds a true Bethlehem Steel `4" WF` (`102 × 102 mm`) wide-flange H-column at `(x, z)`
 * with welded base plate, 4 anchor bolt nuts, and welded top moment-connection gusset collar.
 */
function addWideFlangeColumn(
  parent: THREE.Object3D,
  name: string,
  x: number,
  z: number,
  yBottom: number,
  yTop: number,
  steelMat: THREE.Material,
  boltMat: THREE.Material
): void {
  const basePlateH = 0.012;
  const topCapH = 0.012;
  const colBottom = yBottom + 0.0014 + basePlateH + 0.0008;
  const colTop = yTop - topCapH - 0.0006;
  const h = colTop - colBottom;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, 0, z);

  // Welded 156 x 156 mm steel base plate & 4 corner anchor bolts
  const basePlate = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.112, basePlateH, 0.112)), steelMat);
  basePlate.position.y = yBottom + 0.0014 + basePlateH * 0.5;
  basePlate.castShadow = true;
  g.add(basePlate);

  const boltGeo = prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.011, 8));
  for (const bx of [-0.032, 0.032]) {
    for (const bz of [-0.022, 0.022]) {
      const bolt = new THREE.Mesh(boltGeo, boltMat);
      bolt.position.set(bx, yBottom + 0.0014 + basePlateH + 0.0064, bz);
      g.add(bolt);
    }
  }

  // True 3-plate wide-flange H-section (2 flanges 11 mm + web 8 mm)
  const colMidY = colBottom + h * 0.5;
  const fThick = 0.011;
  const wThick = 0.008;
  const f1 = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(H_COL_SIZE_M, h, fThick)), steelMat);
  f1.position.set(0, colMidY, (H_COL_SIZE_M - fThick) * 0.5);
  const f2 = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(H_COL_SIZE_M, h, fThick)), steelMat);
  f2.position.set(0, colMidY, -(H_COL_SIZE_M - fThick) * 0.5);
  const web = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(wThick, h, H_COL_SIZE_M - 2 * fThick - 0.0012)), steelMat);
  web.position.y = colMidY;
  f1.castShadow = f2.castShadow = web.castShadow = true;
  g.add(f1, f2, web);

  // Welded top bearing / moment-connection gusset cap beneath corrugated steel deck
  const topCap = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.112, topCapH, 0.112)), steelMat);
  topCap.position.y = yTop - topCapH * 0.5;
  g.add(topCap);

  parent.add(g);
}

/**
 * Builds a `305 mm` (`12" WF`) wide-flange I-beam roof girder between `(x1, z1)` and `(x2, z2)`
 * with top/bottom flanges, central web, and welded web stiffener gusset plates.
 */
function addRoofIGirder(
  parent: THREE.Object3D,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  yBottom: number,
  mat: THREE.Material
): void {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const rotY = Math.atan2(x2 - x1, z2 - z1);
  const g = new THREE.Group();
  g.position.set((x1 + x2) * 0.5, yBottom + GIRDER_DEPTH_M * 0.5, (z1 + z2) * 0.5);
  g.rotation.y = rotY;
  const flangeW = 0.142;
  const flangeT = 0.014;
  const webT = 0.01;
  const innerH = GIRDER_DEPTH_M - 2 * flangeT - 0.0012;
  const topF = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(flangeW, flangeT, len)), mat);
  topF.position.y = (GIRDER_DEPTH_M - flangeT) * 0.5;
  const botF = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(flangeW, flangeT, len)), mat);
  botF.position.y = -(GIRDER_DEPTH_M - flangeT) * 0.5;
  const web = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(webT, innerH, len)), mat);
  topF.castShadow = botF.castShadow = web.castShadow = true;
  g.add(topF, botF, web);

  // Welded vertical web stiffener plates every ~3.05 m (10 ft) along girder span
  const stiffW = (flangeW - webT) * 0.5 - 0.004;
  const stiffGeo = prepGeo(new THREE.BoxGeometry(stiffW, innerH - 0.004, 0.009));
  const stiffCount = Math.max(2, Math.floor(len / 3.05));
  for (let i = 1; i < stiffCount; i++) {
    const sz = -len * 0.5 + (len * i) / stiffCount;
    for (const side of [-1, 1]) {
      const stiff = new THREE.Mesh(stiffGeo, mat);
      stiff.position.set(side * (webT * 0.5 + stiffW * 0.5 + 0.001), 0, sz);
      g.add(stiff);
    }
  }
  parent.add(g);
}

/**
 * Extrudes a true continuous T-Steel / H. H. Robertson `5"` (`127 mm`) 18-gauge trapezoidal
 * corrugated steel roof deck section spanning `xMin..xMax` and `zMin..zMax` (flutes running E-W).
 */
function buildTrapezoidalRoofDeckMesh(
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
  const shape = new THREE.Shape();
  shape.moveTo(zMin, topY);
  shape.lineTo(zMax, topY);
  shape.lineTo(zMax, troughTopY);

  const count = Math.floor((zMax - zMin - 0.08) / pitch);
  const startZ = zMin + ((zMax - zMin) - count * pitch) * 0.5;
  for (let i = count - 1; i >= 0; i--) {
    const z0 = startZ + i * pitch;
    const crestR = z0 + pitch * 0.72;
    const botR = z0 + pitch * 0.58;
    const botL = z0 + pitch * 0.22;
    const crestL = z0 + pitch * 0.08;
    shape.lineTo(crestR, troughTopY);
    shape.lineTo(botR, soffitY);
    shape.lineTo(botL, soffitY);
    shape.lineTo(crestL, troughTopY);
  }
  shape.lineTo(zMin, troughTopY);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: spanX, bevelEnabled: false, steps: 1 });
  // Rotate so shape X (zMin..zMax) -> world +Z, shape Y -> world +Y, extrude +Z -> world +X
  geo.rotateY(Math.PI * 0.5);
  geo.scale(-1, 1, 1);
  // After rotateY(90) then scale(-1,1,1): Let's use explicit Matrix4 for exact handedness & outward normals!
  const cleanGeo = new THREE.ExtrudeGeometry(shape, { depth: spanX, bevelEnabled: false, steps: 1 });
  // Map local (x=worldZ, y=worldY, z=0..spanX) -> world (xMin + spanX - z, y, x) which is determinant +1 (proper right-handed rotation!)
  cleanGeo.rotateY(-Math.PI * 0.5);
  // rotateY(-90 deg): (x', y', z') = (-z, y, x) -> x' in [-spanX, 0], y' = y, z' = x (zMin..zMax)!
  cleanGeo.translate(xMax, 0, 0);
  geo.dispose();

  const mesh = new THREE.Mesh(prepGeo(cleanGeo), mat);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/**
 * Registers an interactive Bellevue / Arcadia satin anodized-aluminum sliding glass door wall
 * (`2.42 m` tall leaf inside `184 mm` header/roller track assembly up to `2.604 m` soffit) with:
 * - recessed stainless/aluminum floor sill track (`0.6 mm` z-fight clearance),
 * - neoprene glazing gaskets & extruded pull handle,
 * - `registerHingedDoor` + `linearSlideOffset` (`arcadiaPivots === 4` & acoustic portal `h <= 2.45`),
 * - `attachAssetMetadata` + `attachAssetInteraction({ kind: 'slide', audio: { openPreset: 'sashWindowSlide' } })` + `markAssetInteractionBound`.
 */
function addArcadiaSlidingGlassWall(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  options: {
    readonly doorName: string;
    readonly label: string;
    readonly axis: 'x' | 'z';
    readonly fixedCenter: readonly [number, number];
    readonly sliderCenter: readonly [number, number];
    readonly leafSpanM: number;
    readonly slideDeltaM: number;
    readonly mats: StahlMaterials;
    readonly cutaway?: CutawayWallDescriptor;
  }
): void {
  const { doorName, label, axis, fixedCenter, sliderCenter, leafSpanM, slideDeltaM, mats, cutaway } = options;
  const leafH = 2.42;
  const headerTopY = CLEAR_CEILING_Y - 0.038;
  const headerH = headerTopY - leafH;
  const sillBottomY = 0.0006;
  const sillTopY = 0.022;
  const sillH = sillTopY - sillBottomY;
  const rotY = axis === 'z' ? Math.PI / 2 : 0;

  const midX = (fixedCenter[0] + sliderCenter[0]) * 0.5;
  const midZ = (fixedCenter[1] + sliderCenter[1]) * 0.5;
  const totalSpan = leafSpanM * 2 + 0.048;

  const trackGroup = new THREE.Group();
  trackGroup.name = `${doorName}.trackFrame`;
  trackGroup.position.set(midX, 0, midZ);
  trackGroup.rotation.y = rotY;

  const mainHeaderH = headerH - 0.014;
  const header = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(totalSpan, mainHeaderH, 0.096)), mats.anodizedAlum);
  header.position.y = leafH + mainHeaderH * 0.5;
  const headerShadowReveal = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(totalSpan - 0.004, 0.012, 0.102)),
    mats.steelCharcoal
  );
  headerShadowReveal.position.y = headerTopY - 0.006;

  // Dual-rail recessed anodized-aluminum floor sill track
  const sillBase = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(totalSpan, sillH * 0.55, 0.096)), mats.anodizedAlum);
  sillBase.position.y = sillBottomY + sillH * 0.275;
  const railGeo = prepGeo(new THREE.BoxGeometry(totalSpan - 0.006, sillH * 0.42, 0.01));
  const railInner = new THREE.Mesh(railGeo, mats.anodizedAlum);
  railInner.position.set(0, sillTopY - sillH * 0.21, -0.024);
  const railOuter = new THREE.Mesh(railGeo, mats.anodizedAlum);
  railOuter.position.set(0, sillTopY - sillH * 0.21, 0.024);
  trackGroup.add(header, headerShadowReveal, sillBase, railInner, railOuter);
  if (cutaway) tagCutaway(trackGroup, cutaway);
  parent.add(trackGroup);

  // Fixed plate-glass panel
  const fixedPanelBottomY = sillTopY + 0.0008;
  const fixedPanelTopY = leafH - 0.0008;
  const fixedPanelH = fixedPanelTopY - fixedPanelBottomY;
  const fixedGroup = new THREE.Group();
  fixedGroup.name = `${doorName}.fixedPanel`;
  fixedGroup.position.set(fixedCenter[0], fixedPanelBottomY + fixedPanelH * 0.5, fixedCenter[1]);
  fixedGroup.rotation.y = rotY;
  const fGlass = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(leafSpanM - 0.078, fixedPanelH - 0.056, 0.014)),
    mats.plateGlass
  );
  fGlass.name = `${doorName}.fixed.glass`;
  const fStileL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.038, fixedPanelH, 0.042)), mats.anodizedAlum);
  fStileL.position.x = -leafSpanM * 0.5 + 0.019;
  const fStileR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.038, fixedPanelH, 0.042)), mats.anodizedAlum);
  fStileR.position.x = leafSpanM * 0.5 - 0.019;
  const fBotRail = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(leafSpanM - 0.078, 0.026, 0.038)), mats.anodizedAlum);
  fBotRail.position.y = -fixedPanelH * 0.5 + 0.013;
  const fTopRail = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(leafSpanM - 0.078, 0.026, 0.038)), mats.anodizedAlum);
  fTopRail.position.y = fixedPanelH * 0.5 - 0.013;
  fixedGroup.add(fGlass, fStileL, fStileR, fBotRail, fTopRail);
  if (cutaway) tagCutaway(fixedGroup, cutaway);
  parent.add(fixedGroup);

  // Sliding Arcadia leaf
  const sliderBaseY = sillTopY + 0.0012;
  const sliderStileH = leafH - sliderBaseY - 0.0012;
  const stileW = 0.042;
  const railH = 0.038;
  const innerLeafSpan = leafSpanM - 2 * stileW - 0.0012;
  const sliderLeaf = new THREE.Group();
  sliderLeaf.name = doorName;
  sliderLeaf.position.set(
    sliderCenter[0] + (axis === 'z' ? -0.026 : 0),
    sliderBaseY,
    sliderCenter[1] + (axis === 'x' ? 0.026 : 0)
  );
  const stiles: [number, number, number, number][] =
    axis === 'x'
      ? [
          [stileW, sliderStileH, 0.042, -leafSpanM * 0.5 + stileW * 0.5],
          [stileW, sliderStileH, 0.042, leafSpanM * 0.5 - stileW * 0.5],
        ]
      : [
          [0.042, sliderStileH, stileW, -leafSpanM * 0.5 + stileW * 0.5],
          [0.042, sliderStileH, stileW, leafSpanM * 0.5 - stileW * 0.5],
        ];
  for (const [sw, sh, sd, offset] of stiles) {
    const stile = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(sw, sh, sd)), mats.anodizedAlum);
    stile.position.set(axis === 'x' ? offset : 0, sliderStileH * 0.5, axis === 'z' ? offset : 0);
    sliderLeaf.add(stile);
  }
  const topRail = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(axis === 'x' ? innerLeafSpan : 0.04, railH, axis === 'z' ? innerLeafSpan : 0.04)),
    mats.anodizedAlum
  );
  topRail.position.y = sliderStileH - railH * 0.5;
  const botRail = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(axis === 'x' ? innerLeafSpan : 0.04, railH, axis === 'z' ? innerLeafSpan : 0.04)),
    mats.anodizedAlum
  );
  botRail.position.y = railH * 0.5;

  // Extruded Arcadia satin-aluminum & walnut-inlay vertical pull bar + latch escutcheon
  const handleOffset = slideDeltaM > 0 ? -leafSpanM * 0.5 + 0.021 : leafSpanM * 0.5 - 0.021;
  const pullHandle = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.018, 0.32, 0.056)), mats.anodizedAlum);
  pullHandle.position.set(axis === 'x' ? handleOffset : 0, 1.02, axis === 'z' ? handleOffset : 0);
  const walnutGrip = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.012, 0.24, 0.062)), mats.walnutWood);
  walnutGrip.position.copy(pullHandle.position);

  const sGlassH = sliderStileH - 2 * railH - 0.002;
  const sGlass = new THREE.Mesh(
    prepGeo(
      new THREE.BoxGeometry(
        axis === 'x' ? innerLeafSpan - 0.002 : 0.014,
        sGlassH,
        axis === 'z' ? innerLeafSpan - 0.002 : 0.014
      )
    ),
    mats.plateGlass
  );
  sGlass.name = `${doorName}.glass`;
  sGlass.position.y = railH + sGlassH * 0.5 + 0.001;
  sliderLeaf.add(topRail, botRail, pullHandle, walnutGrip, sGlass);
  if (cutaway) tagCutaway(sliderLeaf, cutaway);
  parent.add(sliderLeaf);

  const slideVec: [number, number, number] = [
    axis === 'x' ? slideDeltaM : 0,
    0,
    axis === 'z' ? slideDeltaM : 0,
  ];
  const hingeOffset: [number, number, number] =
    axis === 'x' ? [-leafSpanM * 0.5, 0, 0] : [0, 0, -leafSpanM * 0.5];
  const pivot = registerHingedDoor(ctx, {
    parent,
    door: sliderLeaf,
    hingeOffset,
    axis: 'y',
    openAngle: 0,
  });
  pivot.userData.linearSlideOffset = new THREE.Vector3(slideVec[0], slideVec[1], slideVec[2]);

  attachAssetMetadata(sliderLeaf, {
    id: doorName,
    name: label,
    brand: 'Bellevue Metal Products / Arcadia',
    collection: 'Case Study House #22 Merit Specified Sliding Glass Doors (1960)',
    sku: 'ARC-CSH22-AL88',
    finish: 'Clear Satin Anodized Extruded Aluminum & 1/4" Polished Plate Glass',
    category: 'architectural',
    dimensionsMm: [Math.round(leafSpanM * 1000), 44, Math.round(leafH * 1000)],
  });
  const slideSpec = attachAssetInteraction(sliderLeaf, {
    kind: 'slide',
    id: `door:${doorName}`,
    label: `Slide ${label}`,
    slideDelta: slideVec,
    acousticPortal: true,
    audio: {
      openPreset: 'sashWindowSlide',
      closePreset: 'sashWindowSlide',
      volume: 0.55,
    },
  });
  markAssetInteractionBound(ctx, slideSpec, `door:${doorName}`);
}

/**
 * Fixed floor-to-ceiling polished plate-glass curtain bay (`0.0006..2.604 m`)
 * with slim satin anodized-aluminum mullions, recessed floor sill channel, transom head channel & neoprene gasket stops.
 */
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
  const sillH = 0.026;
  const headH = 0.034;
  const mullionW = 0.038;
  const g = new THREE.Group();
  g.name = name;
  g.position.set((x1 + x2) * 0.5, bayBottomY + bayH * 0.5, (z1 + z2) * 0.5);
  g.rotation.y = rotY;

  const sill = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(span, sillH, 0.058)), mats.anodizedAlum);
  sill.position.y = -bayH * 0.5 + sillH * 0.5;
  const head = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(span, headH, 0.058)), mats.anodizedAlum);
  head.position.y = bayH * 0.5 - headH * 0.5;

  const innerH = bayH - sillH - headH - 0.0012;
  const innerMidY = (sillH - headH) * 0.5;

  // Slim center vertical 10-ft module anodized-aluminum mullion + outer jamb stops
  const mullion = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(mullionW, innerH, 0.062)), mats.anodizedAlum);
  mullion.position.y = innerMidY;
  const jambStopW = 0.022;
  const jambL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(jambStopW, innerH, 0.054)), mats.anodizedAlum);
  jambL.position.set(-span * 0.5 + jambStopW * 0.5, innerMidY, 0);
  const jambR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(jambStopW, innerH, 0.054)), mats.anodizedAlum);
  jambR.position.set(span * 0.5 - jambStopW * 0.5, innerMidY, 0);

  const paneW = (span - 2 * jambStopW - mullionW) * 0.5 - 0.002;
  const paneOffset = mullionW * 0.5 + paneW * 0.5 + 0.001;
  const paneL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(paneW, innerH - 0.002, 0.014)), mats.plateGlass);
  paneL.name = `${name}.glass`;
  paneL.position.set(-paneOffset, innerMidY, 0);
  const paneR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(paneW, innerH - 0.002, 0.014)), mats.plateGlass);
  paneR.name = `${name}.glassRight`;
  paneR.position.set(paneOffset, innerMidY, 0);

  g.add(sill, head, mullion, jambL, jambR, paneL, paneR);
  if (cutaway) tagCutaway(g, cutaway);
  parent.add(g);
}

/**
 * Flush round recessed `Emerson-Pryne` architectural soffit downlight (`140 mm` satin aluminum trim ring
 * + black micro-baffle + warm `2700K` opal lens) wired to `ctx.lightGroups[circuitId].emissives` + `addGlowPool`
 * (`0` extra `THREE.PointLight`s to stay strictly within the 10-PointLight scene budget!).
 */
function addEmersonPryneSoffitDownlight(
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

  const trimRing = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.072, 0.072, 0.008, 20)), mats.anodizedAlum);
  trimRing.position.y = -0.004;
  const baffle = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.056, 0.056, 0.012, 18)), mats.matteBlackHood);
  baffle.position.y = -0.0065;
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0xfff8eb,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 1.75,
    roughness: 0.25,
  });
  const lens = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.006, 18)), lensMat);
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
 * Prescolite / Litecraft mid-century satin opal-glass globe pendant or ceiling drum luminaire
 * (`0` extra `THREE.PointLight`s; enriches twilight glow via `emissives` + `addGlowPool`).
 */
function addPrescoliteOpalGlobeFixture(
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

  const canopy = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.052, 0.058, 0.016, 16)), mats.anodizedAlum);
  canopy.position.y = -0.008;
  g.add(canopy);

  if (dropM > radiusM + 0.03) {
    const stemLen = dropM - radiusM - 0.014;
    const stem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.005, 0.005, stemLen, 10)), mats.anodizedAlum);
    stem.position.y = -0.016 - stemLen * 0.5;
    g.add(stem);
  }

  const neck = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.028, 0.034, 0.018, 14)), mats.anodizedAlum);
  neck.position.y = -dropM + radiusM + 0.004;

  const opalMat = new THREE.MeshStandardMaterial({
    color: 0xfffaf0,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 1.55,
    roughness: 0.32,
  });
  const globe = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(radiusM, 18, 14)), opalMat);
  globe.position.y = -dropM;
  g.add(neck, globe);
  tagCollisionRole(g, 'ignore');
  parent.add(g);

  if (grp) grp.emissives.push(opalMat);
  ctx.addGlowPool(circuitId as never, x, 0.007, z, options?.poolRadius ?? 1.8, 0.22);
}

/**
 * Sculpts Pierre Koenig's signature freestanding 4-sided / double-sided suspended black matte
 * sheet-steel fireplace (`stahl.fireplace.assembly`) on grid line `Z2 = 6.096 m` between Living & Dining:
 * - Raised Palos Verdes stone / cast-concrete hearth platform (`2.16 × 0.32 × 0.98 m`),
 * - Tapered trapezoidal/box matte-black sheet-steel hood framed by `4"` (`102 mm`) black steel corner L-angles,
 * - Open North (Dining) & South (Living) viewing faces with translucent black woven wire-mesh spark screens & pull rings,
 * - Steel log grate, ceramic gas/oak log bed, flickering warm ember/flame glow (`buildHallWoodBurningStoveFirebox`),
 * - Interactive steel damper lever + spatial crackle audio (`attachAudioEmitter`) + `attachAssetMetadata`,
 * - Roof-penetrating cylindrical/oval matte-black steel chimney flue stack, flashing collar & rain cap!
 */
function buildKoenigSuspendedFireplace(
  root: THREE.Group,
  roofGroup: THREE.Group,
  mats: StahlMaterials
): void {
  const fpX = 2.95;
  const fpZ = Z2;
  const fpGroup = new THREE.Group();
  fpGroup.name = 'stahl.fireplace.assembly';
  fpGroup.position.set(fpX, 0, fpZ);

  // Raised cast-concrete / Palos Verdes stone hearth plinth (`Y = 0.0006..0.32 m`)
  const hearthH = 0.32;
  const hearthW = 2.16;
  const hearthD = 0.98;
  const plinth = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(hearthW, hearthH - 0.036, hearthD)),
    mats.hearthPalosVerdes
  );
  plinth.name = 'stahl.fireplace.hearthPlinth';
  plinth.position.y = 0.0006 + (hearthH - 0.036) * 0.5;
  plinth.castShadow = plinth.receiveShadow = true;

  // Cantilevered honed concrete hearth cap slab with crisp shadow reveal
  const hearthCap = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(hearthW + 0.04, 0.034, hearthD + 0.04)),
    mats.concreteSlab
  );
  hearthCap.name = 'stahl.fireplace.hearthCap';
  hearthCap.position.y = hearthH - 0.016;
  hearthCap.castShadow = hearthCap.receiveShadow = true;

  // Recessed refractory firebrick pit pan on top of hearth
  const firePanMat = new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 0.88 });
  const firePan = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.48, 0.022, 0.54)), firePanMat);
  firePan.position.y = hearthH + 0.012;
  fpGroup.add(plinth, hearthCap, firePan);

  // Four continuous 4" (96 mm) matte-black steel corner L-angles rising from hearth to ceiling soffit
  const hoodBotY = 1.04;
  const hoodTopY = CLEAR_CEILING_Y - 0.038;
  const hoodW = 1.72;
  const hoodD = 0.7;
  const angleLeg = 0.072;
  const angleT = 0.01;
  const postBottomY = hearthH + 0.002;
  const postH = hoodTopY - postBottomY;
  const postMidY = postBottomY + postH * 0.5;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (hoodW * 0.5 - angleT * 0.5);
      const cz = sz * (hoodD * 0.5 - angleT * 0.5);
      const legX = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(angleLeg, postH, angleT)), mats.matteBlackHood);
      legX.position.set(cx - sx * (angleLeg * 0.5 - angleT * 0.5), postMidY, cz);
      const legZ = new THREE.Mesh(
        prepGeo(new THREE.BoxGeometry(angleT, postH, angleLeg - angleT - 0.001)),
        mats.matteBlackHood
      );
      legZ.position.set(cx, postMidY, cz - sz * (angleLeg * 0.5 + angleT * 0.5));
      legX.castShadow = legZ.castShadow = true;
      fpGroup.add(legX, legZ);
    }
  }

  // Tapered trapezoidal matte-black sheet-steel hood (`Y = 1.04..2.604 m`):
  // Wide flared lower apron (`1.04..1.42 m`) tapering smoothly into the upper suspended hood (`1.42..2.604 m`)
  const apronBotY = hoodBotY + 0.05;
  const apronTopY = 1.42;
  const upperW = 1.56;
  const upperD = 0.58;

  // Sculpted 4-sided tapered lower apron + upper matte-black steel hood body
  const apronShape = new THREE.Shape();
  apronShape.moveTo(-hoodW * 0.5 + angleT + 0.002, apronBotY);
  apronShape.lineTo(hoodW * 0.5 - angleT - 0.002, apronBotY);
  apronShape.lineTo(upperW * 0.5, apronTopY);
  apronShape.lineTo(-upperW * 0.5, apronTopY);
  apronShape.closePath();
  const apronGeo = new THREE.ExtrudeGeometry(apronShape, {
    depth: upperD,
    bevelEnabled: false,
    steps: 1,
  });
  apronGeo.translate(0, 0, -upperD * 0.5);
  const hoodApron = new THREE.Mesh(prepGeo(apronGeo), mats.matteBlackHood);
  hoodApron.name = 'stahl.fireplace.taperedApron';
  hoodApron.castShadow = true;

  const upperHoodH = hoodTopY - apronTopY - 0.001;
  const upperHood = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(upperW, upperHoodH, upperD)),
    mats.matteBlackHood
  );
  upperHood.name = 'stahl.fireplace.hoodBody';
  upperHood.position.y = apronTopY + 0.001 + upperHoodH * 0.5;
  upperHood.castShadow = true;

  // Perimeter horizontal steel angle lintel collar around `hoodBotY`
  const lintelH = 0.048;
  const lintelFrontBackGeo = prepGeo(new THREE.BoxGeometry(hoodW - 2 * angleLeg - 0.002, lintelH, 0.014));
  for (const sz of [-1, 1]) {
    const bar = new THREE.Mesh(lintelFrontBackGeo, mats.matteBlackHood);
    bar.position.set(0, hoodBotY + lintelH * 0.5, sz * (hoodD * 0.5 - 0.018));
    fpGroup.add(bar);
  }
  const lintelSideGeo = prepGeo(new THREE.BoxGeometry(0.014, lintelH, hoodD - 2 * angleLeg - 0.002));
  for (const sx of [-1, 1]) {
    const bar = new THREE.Mesh(lintelSideGeo, mats.matteBlackHood);
    bar.position.set(sx * (hoodW * 0.5 - 0.018), hoodBotY + lintelH * 0.5, 0);
    fpGroup.add(bar);
  }

  // Translucent black woven wire-mesh spark firescreens on both North (Dining) & South (Living) faces
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x161616,
    roughness: 0.72,
    metalness: 0.65,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
  });
  const screenH = hoodBotY - (hearthH + 0.028);
  const screenMidY = hearthH + 0.028 + screenH * 0.5;
  const screenFaceGeo = prepGeo(new THREE.BoxGeometry(hoodW - 0.18, screenH, 0.004));
  for (const [tag, sz] of [
    ['northDining', -(hoodD * 0.5 - 0.045)],
    ['southLiving', hoodD * 0.5 - 0.045],
  ] as const) {
    const scr = new THREE.Mesh(screenFaceGeo, screenMat);
    scr.name = `stahl.fireplace.meshScreen.${tag}`;
    scr.position.set(0, screenMidY, sz);
    fpGroup.add(scr);
    for (const px of [-0.045, 0.045]) {
      const pull = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.014, 0.0025, 8, 16)), mats.anodizedAlum);
      pull.position.set(px, screenMidY + 0.06, sz + (sz > 0 ? 0.008 : -0.008));
      fpGroup.add(pull);
    }
  }

  // Heavy wrought-steel log cradle grate + ceramic gas burner bar + dual-facing glowing log & ember bed
  const grateBarGeo = prepGeo(new THREE.BoxGeometry(1.12, 0.016, 0.018));
  for (const gz of [-0.14, -0.07, 0, 0.07, 0.14]) {
    const gBar = new THREE.Mesh(grateBarGeo, mats.matteBlackHood);
    gBar.position.set(0, hearthH + 0.044, gz);
    fpGroup.add(gBar);
  }
  const gasPipe = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.011, 0.011, 0.96, 10)), mats.matteBlackHood);
  gasPipe.rotation.z = Math.PI * 0.5;
  gasPipe.position.set(0, hearthH + 0.036, 0);
  fpGroup.add(gasPipe);

  // Sculpted glowing ember bed & ceramic gas logs visible cleanly from BOTH North (Dining) & South (Living)
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
  // Hide solid single-sided stove backplate liners so the fire is authentically open 360°/double-sided!
  fireInsert.traverse((child) => {
    if (child.name.includes('fireboxBack') || child.name.includes('fireboxLiner') || child.name.includes('doorGlass')) {
      child.visible = false;
    }
  });

  // Add full-width ceramic gas logs & warm flickering-style ember bed spanning the double-sided hearth
  const emberMat = new THREE.MeshStandardMaterial({
    color: 0xff7426,
    emissive: new THREE.Color(0xff4e08),
    emissiveIntensity: 2.6,
    roughness: 0.55,
  });
  const wideEmberBed = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.92, 0.024, 0.28)), emberMat);
  wideEmberBed.name = 'stahl.fireplace.emberBed';
  wideEmberBed.position.set(0, hearthH + 0.038, 0);

  const ceramicLogMat = new THREE.MeshStandardMaterial({
    color: 0x3a2519,
    emissive: new THREE.Color(0xd94406),
    emissiveIntensity: 0.95,
    roughness: 0.85,
  });
  const logSpecs: readonly [number, number, number, number, number, number][] = [
    [-0.18, hearthH + 0.088, -0.04, 0.044, 0.58, 0.08],
    [0.16, hearthH + 0.092, 0.045, 0.046, 0.62, -0.09],
    [0.0, hearthH + 0.132, 0.0, 0.038, 0.52, 0.22],
  ];
  logSpecs.forEach(([lx, ly, lz, rad, len, yaw], idx) => {
    const log = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(rad * 0.9, rad, len, 12)), ceramicLogMat);
    log.name = `stahl.fireplace.ceramicLog_${idx + 1}`;
    log.rotation.z = Math.PI * 0.5;
    log.rotation.y = yaw;
    log.position.set(lx, ly, lz);
    fpGroup.add(log);
  });

  // Brushed-steel throat damper lever on East face of hood + interactive fire/damper toggle
  const damperLever = new THREE.Group();
  damperLever.name = 'stahl.fireplace.damperLever';
  damperLever.position.set(upperW * 0.5 + 0.008, 1.52, 0);
  const leverArm = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.045, 0.012, 0.012)), mats.anodizedAlum);
  leverArm.position.x = 0.022;
  const leverKnob = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.014, 10, 10)), mats.walnutWood);
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

  // Cylindrical/oval matte-black steel chimney flue stack penetrating above the 5" roof deck (`roofGroup` so it hides cleanly in roof cutaway!)
  const roofTopY = CLEAR_CEILING_Y + DECK_DEPTH_M;
  const flueGroup = new THREE.Group();
  flueGroup.name = 'stahl.fireplace.roofFlueStack';
  flueGroup.position.set(fpX, roofTopY, fpZ);

  const flashingCollar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.24, 0.28, 0.045, 22)),
    mats.steelCharcoal
  );
  flashingCollar.position.y = 0.026;
  flashingCollar.scale.set(1.35, 1, 0.85);

  const fluePipe = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.19, 0.19, 0.62, 22)),
    mats.matteBlackHood
  );
  fluePipe.position.y = 0.35;
  fluePipe.scale.set(1.35, 1, 0.85);
  fluePipe.castShadow = true;

  const rainCapStruts = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.42, 0.075, 0.016)),
    mats.matteBlackHood
  );
  rainCapStruts.position.y = 0.695;
  const rainCap = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.27, 0.31, 0.042, 22)),
    mats.matteBlackHood
  );
  rainCap.position.y = 0.745;
  rainCap.scale.set(1.32, 1, 0.88);
  rainCap.castShadow = true;

  flueGroup.add(flashingCollar, fluePipe, rainCapStruts, rainCap);
  roofGroup.add(flueGroup);
}

/**
 * Builds the full-bay Integrated Ceilings & Grilleworks "Infinilite" suspended translucent
 * opal-acrylic grid luminous ceiling (`stahl.kitchen.infiniliteCeiling`) over the North kitchen bay
 * (`X3..X4, Z0..Z1`), framed by a slim walnut & satin-aluminum perimeter fascia (`Y = 2.38..2.46 m`),
 * casting a warm `2950K` architectural glow when switched on via `stahlKitchenLuminous`.
 */
function buildInfiniliteKitchenCeiling(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials
): void {
  const ceilGroup = new THREE.Group();
  ceilGroup.name = 'stahl.kitchen.infiniliteCeiling';

  const centerX = 3.05;
  const centerZ = -2.85;
  const totalW = 4.68; // Full-bay coverage across North kitchen work & peninsula zone
  const totalD = 3.72;
  const soffitY = 2.385;
  const fasciaH = 0.076;
  const frameT = 0.032;

  ceilGroup.position.set(centerX, soffitY, centerZ);

  // Slim American black walnut perimeter fascia + anodized-aluminum bottom reveal lip
  const frontFasciaGeo = prepGeo(new THREE.BoxGeometry(totalW, fasciaH, frameT));
  for (const sz of [-1, 1]) {
    const f = new THREE.Mesh(frontFasciaGeo, mats.walnutWood);
    f.position.set(0, fasciaH * 0.5, sz * (totalD * 0.5 - frameT * 0.5));
    f.castShadow = true;
    ceilGroup.add(f);
  }
  const sideFasciaGeo = prepGeo(new THREE.BoxGeometry(frameT, fasciaH, totalD - 2 * frameT - 0.002));
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(sideFasciaGeo, mats.walnutWood);
    f.position.set(sx * (totalW * 0.5 - frameT * 0.5), fasciaH * 0.5, 0);
    f.castShadow = true;
    ceilGroup.add(f);
  }

  // Stainless hanger wires up to the 2.642 m roof soffit
  const hangerTop = CLEAR_CEILING_Y - 0.038 - soffitY - fasciaH;
  if (hangerTop > 0.04) {
    const rodGeo = prepGeo(new THREE.CylinderGeometry(0.0035, 0.0035, hangerTop, 8));
    for (const hx of [-totalW * 0.42, 0, totalW * 0.42]) {
      for (const hz of [-totalD * 0.42, totalD * 0.42]) {
        const rod = new THREE.Mesh(rodGeo, mats.anodizedAlum);
        rod.position.set(hx, fasciaH + hangerTop * 0.5, hz);
        ceilGroup.add(rod);
      }
    }
  }

  // Anodized-aluminum T-bar grid (`4 × 3` modular cells) + recessed translucent opal-acrylic diffuser panels
  const innerW = totalW - 2 * frameT - 0.004;
  const innerD = totalD - 2 * frameT - 0.004;
  const cols = 4;
  const rows = 3;
  const tBarW = 0.018;
  const tBarH = 0.016;

  for (let c = 1; c < cols; c++) {
    const tx = -innerW * 0.5 + (innerW * c) / cols;
    const bar = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tBarW, tBarH, innerD)), mats.anodizedAlum);
    bar.position.set(tx, tBarH * 0.5, 0);
    ceilGroup.add(bar);
  }
  const segSpanX = innerW / cols - tBarW - 0.002;
  const crossBarGeo = prepGeo(new THREE.BoxGeometry(segSpanX, tBarH, tBarW));
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
  const cellW = innerW / cols - tBarW - 0.004;
  const cellD = innerD / rows - tBarW - 0.004;
  const cellGeo = prepGeo(new THREE.BoxGeometry(cellW, 0.012, cellD));
  for (let c = 0; c < cols; c++) {
    const cx = -innerW * 0.5 + (innerW * (c + 0.5)) / cols;
    for (let r = 0; r < rows; r++) {
      const cz = -innerD * 0.5 + (innerD * (r + 0.5)) / rows;
      const panel = new THREE.Mesh(cellGeo, opalPanelMat);
      panel.name = `stahl.kitchen.infinilitePanel_${c}_${r}`;
      panel.position.set(cx, 0.018, cz);
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

/**
 * Installs a clean `root.add` reconciliation hook so:
 * 1) Any switch/dimmer mounted near `X3 = 0` (`westPoolLivingCut`) by `interiors.ts` is tagged with
 *    `westPoolLivingCut` (`0` `MISSING_CUTAWAY_TAG` warnings in `husjs audit --house stahl-house --strict`!),
 * 2) Legacy placeholder `stahl.living.fireplace` or `stahl.kitchen.luminousPanel` / `lumFrame` added by an
 *    older `interiors.ts` is cleanly deduplicated so `structure.ts`'s full HABS double-sided fireplace and
 *    full-bay Infinilite luminous ceiling never z-fight or double-render!
 */
function installInteriorsReconciliationHook(
  root: THREE.Group,
  westPoolLivingCut: CutawayWallDescriptor
): void {
  const origAdd = root.add.bind(root);
  root.add = (...objects: THREE.Object3D[]): THREE.Group => {
    const kept: THREE.Object3D[] = [];
    for (const obj of objects) {
      if (obj.name === 'stahl.living.fireplace') {
        // Superseded by `stahl.fireplace.assembly` in `structure.ts`
        continue;
      }
      if (obj.name === 'stahl.kitchen.joinery') {
        // Remove legacy 3.42 x 1.82 m placeholder `stahl.kitchen.luminousPanel` & walnut frame if present
        const toRemove: THREE.Object3D[] = [];
        for (const ch of obj.children) {
          if (
            ch.name === 'stahl.kitchen.luminousPanel' || ch.name === 'stahl.kitchen.luminousCeilingGrid' ||
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

  // =========================================================================
  // 1. Cantilevered 30" (762 mm) Board-Formed Concrete Grade Beams & Caissons
  // =========================================================================
  const beamH = 0.762;
  const beamW = 0.36;
  const beamTopY = -0.182;
  const beamCenterY = beamTopY - beamH * 0.5;
  const beamBotY = beamTopY - beamH;
  const gradeBeamGroup = new THREE.Group();
  gradeBeamGroup.name = 'stahl.foundation.gradeBeams';

  const formConeMat = new THREE.MeshStandardMaterial({ color: 0x7b766c, roughness: 0.78 });
  const formConeGeo = prepGeo(new THREE.CylinderGeometry(0.018, 0.018, beamW + 0.008, 10));

  for (const z of [Z0, Z1, Z2, Z3]) {
    const minX = z <= Z1 ? X0 : X3 - 1.2;
    const maxX = X4 + CATWALK_WIDTH_M;
    const span = maxX - minX;
    const beam = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(span, beamH, beamW)), mats.concreteSlab);
    beam.position.set((minX + maxX) * 0.5, beamCenterY, z);
    beam.castShadow = beam.receiveShadow = true;
    gradeBeamGroup.add(beam);

    // Board-formed snap-tie cone dimples along cantilevered East overhang (`X > 3.2`)
    for (let tx = 3.5; tx <= maxX - 0.25; tx += 0.76) {
      for (const ty of [beamCenterY + 0.19, beamCenterY - 0.19]) {
        const tie = new THREE.Mesh(formConeGeo, formConeMat);
        tie.rotation.x = Math.PI * 0.5;
        tie.position.set(tx, ty, z);
        gradeBeamGroup.add(tie);
      }
    }
  }

  const beamHalfW = beamW * 0.5 + 0.0012;
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
      beam.castShadow = beam.receiveShadow = true;
      gradeBeamGroup.add(beam);
    }
  }

  // Under-slab structural pan soffit ribs visible beneath the cantilevered SE living corner (`X = 3.25..6.08, Z = 9.22..12.18`)
  for (const sz of [7.62, 10.62]) {
    const subJoist = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(2.68, 0.26, 0.22)), mats.concreteSlab);
    subJoist.position.set(4.58, beamTopY - 0.131, sz);
    subJoist.castShadow = true;
    gradeBeamGroup.add(subJoist);
  }

  // Deep reinforced concrete caisson piers & pile caps anchored 35 ft into bedrock
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
      prepGeo(new THREE.CylinderGeometry(0.46, 0.42, 0.24, 18)),
      mats.concreteSlab
    );
    pileCollar.position.set(cx, caissonTopY - 0.12, cz);
    const caisson = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.38, 0.41, h - 0.242, 18)),
      mats.concreteSlab
    );
    caisson.position.set(cx, groundY + (h - 0.242) * 0.5, cz);
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

  // Polished Watco-Dennis sealed L-shaped concrete floor slabs (`Y = 0.000 m`)
  const privSlabMaxX = X3 - 0.001;
  const privateSlab = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(privSlabMaxX - X0, 0.18, Z1 - Z0)),
    mats.concreteSlab
  );
  privateSlab.name = 'stahl.slab.privateWing';
  privateSlab.position.set((X0 + privSlabMaxX) * 0.5, -0.09, (Z0 + Z1) * 0.5);
  privateSlab.receiveShadow = true;

  const publicSlab = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(X4 - X3, 0.18, Z3 - Z0)),
    mats.concreteSlab
  );
  publicSlab.name = 'stahl.slab.publicPavilion';
  publicSlab.position.set((X3 + X4) * 0.5, -0.09, (Z0 + Z3) * 0.5);
  publicSlab.receiveShadow = true;
  root.add(privateSlab, publicSlab);

  // =========================================================================
  // 2. Bethlehem Steel 4" WF H-Columns & 12" WF Roof Girders + Corrugated Deck
  // =========================================================================
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

  // Primary E-W 12" WF girders along Z0..Z3
  addRoofIGirder(roofGroup, X0 - 1.1, Z0, X4 + CANTILEVER_M, Z0, girderY, mats.steelCharcoal);
  addRoofIGirder(roofGroup, X0 - 1.1, Z1, X4 + CANTILEVER_M, Z1, girderY, mats.steelCharcoal);
  addRoofIGirder(roofGroup, X3 - CANTILEVER_M, Z2, X4 + CANTILEVER_M, Z2, girderY, mats.steelCharcoal);
  addRoofIGirder(roofGroup, X3 - CANTILEVER_M, Z3, X4 + CANTILEVER_M, Z3, girderY, mats.steelCharcoal);

  // Coped N-S 12" WF girders along X0..X4
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

  // Continuous extruded T-Steel / Robertson 5" (127 mm) trapezoidal corrugated steel roof deck (non-overlapping L-plan)
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

  // Exterior perimeter C-channel steel fascia + anodized gravel-stop parapet flashing & lower drip edge
  const fPad = 0.0015;
  const roofPerimeterPath: readonly [number, number][] = [
    [X0 - 1.1 - fPad, Z0 - 0.9 - fPad],
    [X4 + CANTILEVER_M + fPad, Z0 - 0.9 - fPad],
    [X4 + CANTILEVER_M + fPad, Z3 + CANTILEVER_M + fPad],
    [X3 - CANTILEVER_M - fPad, Z3 + CANTILEVER_M + fPad],
    [X3 - CANTILEVER_M - fPad, Z1 + CANTILEVER_M + fPad],
    [X0 - 1.1 - fPad, Z1 + CANTILEVER_M + fPad],
  ];
  // True C-channel fascia profile with lower drip edge & upper parapet return
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

  // Satin-aluminum gravel-stop coping flashing cap cleanly above C-channel fascia (`0.8 mm` clearance)
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

  // =========================================================================
  // 3. Woods Drive Vertical Robertson Steel Privacy Facade & Carport Wall
  // =========================================================================
  const wallBaseY = 0.0006;
  const wallTopY = CLEAR_CEILING_Y - 0.044;
  const wallH = wallTopY - wallBaseY;
  const wallMidY = wallBaseY + wallH * 0.5;

  const northPrivacyGroup = new THREE.Group();
  northPrivacyGroup.name = 'stahl.northPrivacyWall';
  const northBackMinX = X1 - 0.075;
  const northBackMaxX = X4 - 0.056;
  // Interior plaster wall stops at Y = 0.028 m above floor & Y = 2.578 m below ceiling to create crisp modern shadow-gap reveals!
  const revealBottomY = 0.028;
  const revealTopY = CLEAR_CEILING_Y - 0.062;
  const revealWallH = revealTopY - revealBottomY;
  const northBacking = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(northBackMaxX - northBackMinX, revealWallH, 0.104)),
    mats.plasterOffWhite
  );
  northBacking.position.set((northBackMinX + northBackMaxX) * 0.5, revealBottomY + revealWallH * 0.5, Z0 + 0.104);
  northBacking.castShadow = northBacking.receiveShadow = true;

  // Exterior Robertson sheet-steel skin + vertical box-ribbed flutes in Koenig warm putty-tan (#CCC6B8)
  const extSkin = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(northBackMaxX - northBackMinX, wallH, 0.024)),
    mats.robertsonExteriorTan
  );
  extSkin.position.set((northBackMinX + northBackMaxX) * 0.5, wallMidY, Z0 - 0.069);
  extSkin.castShadow = true;
  northPrivacyGroup.add(northBacking, extSkin);

  const corrFluteGeo = prepGeo(new THREE.BoxGeometry(0.068, wallH, 0.038));
  for (let x = X1 + 0.08; x <= X4 - 0.08; x += 0.1524) {
    if (Math.abs(x - X2) < 0.09 || Math.abs(x - X3) < 0.09) continue;
    const flute = new THREE.Mesh(corrFluteGeo, mats.robertsonExteriorTan);
    flute.position.set(x, wallMidY, Z0 - 0.102);
    flute.castShadow = true;
    northPrivacyGroup.add(flute);
  }
  tagCutaway(northPrivacyGroup, northWoodsCut);
  root.add(northPrivacyGroup);

  // Carport storage/utility divider wall at `X = X1` (tagged `westCarportCut` & named `stahl.carportWall` for test invariant)
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

  // Carport side vertical Robertson steel ribs & interior Bedroom 2 plaster lining
  const carportTrimGroup = new THREE.Group();
  carportTrimGroup.name = 'stahl.carportWall.detail';
  const carportRibGeo = prepGeo(new THREE.BoxGeometry(0.032, wallH - 0.004, 0.064));
  for (let z = Z0 + 0.28; z <= Z1 - 0.18; z += 0.1524) {
    const rib = new THREE.Mesh(carportRibGeo, mats.robertsonExteriorTan);
    rib.position.set(X1 - 0.095, wallMidY, z);
    carportTrimGroup.add(rib);
  }
  const carportInnerPlaster = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.016, revealWallH, (Z1 - 0.058) - (Z0 + 0.164))),
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

  // =========================================================================
  // 4. Modern Recessed Shadow-Gap Base Skirting & Ceiling Track Shadow-Lines
  // =========================================================================
  // Recessed dark anodized/charcoal shadow-gap reveal base trim (`createSkirtingRun`) & ceiling shadow track
  // along the North privacy wall (Private Wing & Kitchen) and West Bedroom 2 wall (`cutawayWalls` auto-splits!)
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

  // =========================================================================
  // 5. 270° Plate-Glass Curtain Walls & Interactive Arcadia Aluminum Sliders
  // =========================================================================
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

  // =========================================================================
  // 6. Double-Sided Suspended Fireplace & Full-Bay Infinilite Kitchen Ceiling
  // =========================================================================
  buildKoenigSuspendedFireplace(root, roofGroup, mats);
  buildInfiniliteKitchenCeiling(ctx, root, mats);

  // =========================================================================
  // 7. Emerson-Pryne Recessed Soffit Downlights, Opal Globes & 2-Way Switch
  // =========================================================================
  const lightingGroup = new THREE.Group();
  lightingGroup.name = 'stahl.lighting.soffitsAndLuminaires';

  // Cantilevered East, South & Pool-Court overhang Emerson-Pryne flush soffit downlights (`stahlCantileverSoffit`)
  const soffitY = CLEAR_CEILING_Y - 0.002;
  const cantileverDownlightCoords: readonly [number, number][] = [
    [-1.15, 2.35],  // North stepping-bridge overhang
    [-1.15, 6.05],  // South stepping-bridge overhang
    [-1.15, 9.45],  // West living overhang
    [1.55, 13.35],  // South cliff overhang W
    [4.55, 13.35],  // South cliff overhang E
    [7.15, 10.65],  // East cliff overhang Living
    [7.15, 4.55],   // East cliff overhang Dining
    [7.15, -2.85],  // East cliff overhang Kitchen
    [-3.05, 1.05],  // Private wing South breezeway E
    [-9.15, 1.05],  // Private wing South breezeway W
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

  // Carport & arrival breezeway Prescolite weatherproof opal ceiling globes (`stahlCarportGlobes`)
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

  // Interior architectural perimeter & hallway wash downlights (`0` extra PointLights!)
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

  // Roof-mounted luminaire group hides cleanly when ceiling cutaway is active
  ctx.ceilingMeshGroup.add(lightingGroup);

  // Arrow-Hart satin stainless-steel (`finish: 'BN'`) 2-way breezeway/hallway soffit toggle switch
  // mounted via `createWallFaceFrame` + `placeOnWall` (`+0.5 mm` standoff & automatic `westCarportCut` tag!)
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

  // =========================================================================
  // 8. Cantilevered Slatted Steel Cliff Catwalk & 2-Rail Off-White Guardrail
  // =========================================================================
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

  // Signature diagonal steel corner brace strut at SE column (X4, Z3) -> outer catwalk mitre
  const braceStart = new THREE.Vector3(X4 + 0.058, 0.34, Z3 + 0.058);
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

  return {
    eastCliffCut,
    southCliffCut,
    northWoodsCut,
    westCarportCut,
    westPoolLivingCut,
    southPrivatePoolCut,
  };
}
