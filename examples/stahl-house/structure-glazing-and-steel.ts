import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  attachAssetInteraction,
  attachAssetMetadata,
  markAssetInteractionBound,
  prepGeo,
  registerHingedDoor,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { SceneBuilderContext } from 'husjs/viewer';
import { bevelledBox } from './sculpted-geometry.ts';
import type { StahlMaterials } from './structure.ts';
import { CATWALK_WIDTH_M, CLEAR_CEILING_Y, GIRDER_DEPTH_M, H_COL_SIZE_M, X3, X4, Z0, Z1, Z2, Z3 } from './terrain.ts';

export function addWideFlangeColumn(
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
  const colTop = yTop - topCapH - 0.0008;
  const h = colTop - colBottom;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, 0, z);

  const basePlate = new THREE.Mesh(bevelledBox(0.112, basePlateH, 0.112, 0.0025, 3), steelMat);
  basePlate.position.y = yBottom + 0.0014 + basePlateH * 0.5;
  basePlate.castShadow = true;
  g.add(basePlate);

  const boltGeo = prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.011, 16));
  for (const bx of [-0.032, 0.032]) {
    for (const bz of [-0.022, 0.022]) {
      const bolt = new THREE.Mesh(boltGeo, boltMat);
      bolt.position.set(bx, yBottom + 0.0014 + basePlateH + 0.0064, bz);
      g.add(bolt);
    }
  }

  const colMidY = colBottom + h * 0.5;
  const fThick = 0.011;
  const wThick = 0.008;
  const flangeGeo = bevelledBox(H_COL_SIZE_M, h, fThick, 0.002, 3);
  const f1 = new THREE.Mesh(flangeGeo, steelMat);
  f1.position.set(0, colMidY, (H_COL_SIZE_M - fThick) * 0.5);
  const f2 = new THREE.Mesh(flangeGeo, steelMat);
  f2.position.set(0, colMidY, -(H_COL_SIZE_M - fThick) * 0.5);
  const web = new THREE.Mesh(
    bevelledBox(wThick, h, H_COL_SIZE_M - 2 * fThick - 0.0016, 0.0015, 2),
    steelMat
  );
  web.position.y = colMidY;
  f1.castShadow = f2.castShadow = web.castShadow = true;
  g.add(f1, f2, web);

  const topCap = new THREE.Mesh(bevelledBox(0.112, topCapH, 0.112, 0.0025, 3), steelMat);
  topCap.position.y = yTop - topCapH * 0.5;
  g.add(topCap);

  parent.add(g);
}

export function addRoofIGirder(
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
  const innerH = GIRDER_DEPTH_M - 2 * flangeT - 0.0016;
  const flangeGeo = bevelledBox(flangeW, flangeT, len, 0.0025, 3);
  const topF = new THREE.Mesh(flangeGeo, mat);
  topF.position.y = (GIRDER_DEPTH_M - flangeT) * 0.5;
  const botF = new THREE.Mesh(flangeGeo, mat);
  botF.position.y = -(GIRDER_DEPTH_M - flangeT) * 0.5;
  const web = new THREE.Mesh(bevelledBox(webT, innerH, len, 0.0018, 2), mat);
  topF.castShadow = botF.castShadow = web.castShadow = true;
  g.add(topF, botF, web);

  const stiffW = (flangeW - webT) * 0.5 - 0.004;
  const stiffGeo = bevelledBox(stiffW, innerH - 0.004, 0.009, 0.0015, 2);
  const stiffCount = Math.max(2, Math.floor(len / 3.05));
  for (let i = 1; i < stiffCount; i++) {
    const sz = -len * 0.5 + (len * i) / stiffCount;
    for (const side of [-1, 1]) {
      const stiff = new THREE.Mesh(stiffGeo, mat);
      stiff.position.set(side * (webT * 0.5 + stiffW * 0.5 + 0.0012), 0, sz);
      g.add(stiff);
    }
  }
  parent.add(g);
}

export function addArcadiaSlidingGlassWall(
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
  const sillBottomY = 0.0008;
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
  const header = new THREE.Mesh(bevelledBox(totalSpan, mainHeaderH, 0.096, 0.003, 3), mats.anodizedAlum);
  header.position.y = leafH + mainHeaderH * 0.5;
  const headerShadowReveal = new THREE.Mesh(
    bevelledBox(totalSpan - 0.004, 0.012, 0.102, 0.002, 2),
    mats.steelCharcoal
  );
  headerShadowReveal.position.y = headerTopY - 0.006;

  const sillBase = new THREE.Mesh(bevelledBox(totalSpan, sillH * 0.55, 0.096, 0.002, 3), mats.anodizedAlum);
  sillBase.position.y = sillBottomY + sillH * 0.275;
  const railGeo = bevelledBox(totalSpan - 0.006, sillH * 0.4, 0.01, 0.0018, 2);
  const railInner = new THREE.Mesh(railGeo, mats.anodizedAlum);
  railInner.position.set(0, sillTopY - sillH * 0.2, -0.024);
  const railOuter = new THREE.Mesh(railGeo, mats.anodizedAlum);
  railOuter.position.set(0, sillTopY - sillH * 0.2, 0.024);
  trackGroup.add(header, headerShadowReveal, sillBase, railInner, railOuter);
  if (cutaway) tagCutaway(trackGroup, cutaway);
  parent.add(trackGroup);

  const fixedPanelBottomY = sillTopY + 0.001;
  const fixedPanelTopY = leafH - 0.001;
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
  const fStileGeo = bevelledBox(0.038, fixedPanelH, 0.042, 0.0025, 3);
  const fStileL = new THREE.Mesh(fStileGeo, mats.anodizedAlum);
  fStileL.position.x = -leafSpanM * 0.5 + 0.019;
  const fStileR = new THREE.Mesh(fStileGeo, mats.anodizedAlum);
  fStileR.position.x = leafSpanM * 0.5 - 0.019;
  const fRailGeo = bevelledBox(leafSpanM - 0.078, 0.026, 0.038, 0.0025, 3);
  const fBotRail = new THREE.Mesh(fRailGeo, mats.anodizedAlum);
  fBotRail.position.y = -fixedPanelH * 0.5 + 0.013;
  const fTopRail = new THREE.Mesh(fRailGeo, mats.anodizedAlum);
  fTopRail.position.y = fixedPanelH * 0.5 - 0.013;
  fixedGroup.add(fGlass, fStileL, fStileR, fBotRail, fTopRail);
  if (cutaway) tagCutaway(fixedGroup, cutaway);
  parent.add(fixedGroup);

  const sliderBaseY = sillTopY + 0.0012;
  const sliderStileH = leafH - sliderBaseY - 0.0012;
  const stileW = 0.042;
  const railH = 0.038;
  const innerLeafSpan = leafSpanM - 2 * stileW - 0.0016;
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
    const stile = new THREE.Mesh(bevelledBox(sw, sh, sd, 0.0025, 3), mats.anodizedAlum);
    stile.position.set(axis === 'x' ? offset : 0, sliderStileH * 0.5, axis === 'z' ? offset : 0);
    sliderLeaf.add(stile);
  }
  const railSpanGeo = bevelledBox(
    axis === 'x' ? innerLeafSpan : 0.04,
    railH,
    axis === 'z' ? innerLeafSpan : 0.04,
    0.0025,
    3
  );
  const topRail = new THREE.Mesh(railSpanGeo, mats.anodizedAlum);
  topRail.position.y = sliderStileH - railH * 0.5;
  const botRail = new THREE.Mesh(railSpanGeo, mats.anodizedAlum);
  botRail.position.y = railH * 0.5;

  const handleOffset = slideDeltaM > 0 ? -leafSpanM * 0.5 + 0.021 : leafSpanM * 0.5 - 0.021;
  const pullHandle = new THREE.Mesh(bevelledBox(0.018, 0.32, 0.056, 0.003, 3), mats.anodizedAlum);
  pullHandle.position.set(axis === 'x' ? handleOffset : 0, 1.02, axis === 'z' ? handleOffset : 0);
  const walnutGrip = new THREE.Mesh(bevelledBox(0.012, 0.24, 0.064, 0.003, 3, 0.4, 0.4), mats.walnutWood);
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

export function addPlateGlassBay(
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
  const bayBottomY = 0.0008;
  const bayTopY = CLEAR_CEILING_Y - 0.038;
  const bayH = bayTopY - bayBottomY;
  const sillH = 0.026;
  const headH = 0.034;
  const mullionW = 0.038;
  const g = new THREE.Group();
  g.name = name;
  g.position.set((x1 + x2) * 0.5, bayBottomY + bayH * 0.5, (z1 + z2) * 0.5);
  g.rotation.y = rotY;

  const sill = new THREE.Mesh(bevelledBox(span, sillH, 0.058, 0.0025, 3), mats.anodizedAlum);
  sill.position.y = -bayH * 0.5 + sillH * 0.5;
  const head = new THREE.Mesh(bevelledBox(span, headH, 0.058, 0.0025, 3), mats.anodizedAlum);
  head.position.y = bayH * 0.5 - headH * 0.5;

  const innerH = bayH - sillH - headH - 0.0016;
  const innerMidY = (sillH - headH) * 0.5;

  const mullion = new THREE.Mesh(bevelledBox(mullionW, innerH, 0.062, 0.0025, 3), mats.anodizedAlum);
  mullion.position.y = innerMidY;
  const jambStopW = 0.022;
  const jambGeo = bevelledBox(jambStopW, innerH, 0.054, 0.002, 3);
  const jambL = new THREE.Mesh(jambGeo, mats.anodizedAlum);
  jambL.position.set(-span * 0.5 + jambStopW * 0.5, innerMidY, 0);
  const jambR = new THREE.Mesh(jambGeo, mats.anodizedAlum);
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

export function buildCantileveredCliffCatwalk(root: THREE.Group, mats: StahlMaterials): void {
  // Cantilevered Slatted Steel Cliff Catwalk
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
      bevelledBox(slatW, slatH, eastSlatMaxZ - eastSlatMinZ, 0.003, 3),
      mats.deckOffWhite
    );
    eastSlat.position.set(slatX, slatY, (eastSlatMinZ + eastSlatMaxZ) * 0.5);
    eastSlat.castShadow = eastSlat.receiveShadow = true;

    const southSlatMinX = X3 - 0.42;
    const southSlatMaxX = slatX + slatW * 0.5;
    const southSlat = new THREE.Mesh(
      bevelledBox(southSlatMaxX - southSlatMinX, slatH, slatW, 0.003, 3),
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
    bevelledBox(trimT, trimH, eastTrimMaxZ - eastTrimMinZ, 0.003, 3),
    mats.deckOffWhite
  );
  eastFascia.position.set(outerEdgeX + trimT * 0.5 + 0.002, trimY, (eastTrimMinZ + eastTrimMaxZ) * 0.5);
  eastFascia.castShadow = true;

  const southTrimMinX = X3 - 0.44;
  const southTrimMaxX = outerEdgeX + 0.001;
  const southFascia = new THREE.Mesh(
    bevelledBox(southTrimMaxX - southTrimMinX, trimH, trimT, 0.003, 3),
    mats.deckOffWhite
  );
  southFascia.position.set((southTrimMinX + southTrimMaxX) * 0.5, trimY, outerEdgeZ + trimT * 0.5 + 0.002);
  southFascia.castShadow = true;
  catwalkGroup.add(eastFascia, southFascia);

  const bearerSpan = outerEdgeX - (X4 + 0.055);
  const bearerGeoEW = bevelledBox(bearerSpan, 0.042, 0.048, 0.003, 3);
  for (const bz of [Z0, (Z0 + Z1) * 0.5, Z1, (Z1 + Z2) * 0.5, Z2, (Z2 + Z3) * 0.5, Z3]) {
    const bearer = new THREE.Mesh(bearerGeoEW, mats.deckOffWhite);
    bearer.position.set(X4 + 0.055 + bearerSpan * 0.5, -0.076, bz);
    catwalkGroup.add(bearer);
  }
  const bearerSpanNS = outerEdgeZ - (Z3 + 0.055);
  const bearerGeoNS = bevelledBox(0.048, 0.042, bearerSpanNS, 0.003, 3);
  for (const bx of [X3, (X3 + X4) * 0.5, X4]) {
    const bearer = new THREE.Mesh(bearerGeoNS, mats.deckOffWhite);
    bearer.position.set(bx, -0.076, Z3 + 0.055 + bearerSpanNS * 0.5);
    catwalkGroup.add(bearer);
  }

  const braceStart = new THREE.Vector3(X4 + 0.058, 0.34, Z3 + 0.058);
  const braceEnd = new THREE.Vector3(X4 + 0.36, -0.024, Z3 + 0.36);
  const braceDir = braceEnd.clone().sub(braceStart);
  const braceLen = braceDir.length();
  const cornerBrace = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.013, 0.013, braceLen, 20)),
    mats.anodizedAlum
  );
  cornerBrace.position.copy(braceStart).addScaledVector(braceDir, 0.5);
  cornerBrace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), braceDir.normalize());
  tagCollisionRole(cornerBrace, 'ignore');
  catwalkGroup.add(cornerBrace);

  root.add(catwalkGroup);

}
