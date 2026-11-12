import * as THREE from 'three';
import {
  attachAssetMetadata,
  mmFromMetres,
  wireCatalogHingedDoor,
  wireCatalogSlidingDrawer,
} from '../shared/catalog-smart-metadata.ts';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import { getOrCreateCachedTexture } from '../../engine/textures/texture-registry.ts';
import type { CatalogInteractionContext } from '../architectural/neptune-kitchen-joinery.ts';
import { attachDrawerBoxBehindFront } from '../joinery/cabinet-interior.ts';
import {
  addNamedBox,
  addNamedCyl,
  deriveNormalAndRoughnessFromHeight,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getBurnishedCopperCatalogMaterial,
  getCandle2200kFilamentMaterial,
  getCharacterOakMaterial,
  getClearArchitecturalGlassMaterial,
  getDarkAntiquedBrassMaterial,
  getMatteCastIronMaterial,
  getPaintedJoineryMaterial,
  getRegencyGiltwoodMaterial,
  getSilveredMirrorPlateMaterial,
  getTimberGrainMaps,
  getWovenFabricMaps,
  makeRgbaDataTexture,
  type PbrDataMapBundle,
  seamlessFbm2D,
  seamlessValueNoise2D,
  sharedSphereGeometry,
  sharedTorusGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import { createSculptedCushionGeometry } from './barker-and-stonehouse-sofas.ts';
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

let cachedBurrWalnutMat: THREE.MeshPhysicalMaterial | null = null;
function getBurrWalnutMaterial(): THREE.MeshPhysicalMaterial {
  if (!cachedBurrWalnutMat) {
    const maps = getTimberGrainMaps('george3-burr-walnut', 0x5c3a24, 34, 0.24, false);
    cachedBurrWalnutMat = new THREE.MeshPhysicalMaterial({
      name: 'catalog.georgeIIIBurrWalnut',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughnessMap: maps.roughnessMap,
      roughness: 0.24,
      metalness: 0.02,
      clearcoat: 0.65,
      clearcoatRoughness: 0.18,
    });
  }
  return cachedBurrWalnutMat;
}

let cachedFlameMahoganyMat: THREE.MeshPhysicalMaterial | null = null;
function getFlameMahoganyMaterial(): THREE.MeshPhysicalMaterial {
  if (!cachedFlameMahoganyMat) {
    const maps = getTimberGrainMaps('george3-flame-mahogany', 0x4e2718, 32, 0.22, false);
    cachedFlameMahoganyMat = new THREE.MeshPhysicalMaterial({
      name: 'catalog.georgeIIIFlameMahogany',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: maps.roughnessMap,
      roughness: 0.22,
      metalness: 0.02,
      clearcoat: 0.72,
      clearcoatRoughness: 0.16,
    });
  }
  return cachedFlameMahoganyMat;
}

function addSwanNeckBailPull(
  parent: THREE.Object3D,
  namePrefix: string,
  x: number,
  y: number,
  z: number
): void {
  const brassMat = getAgedBrassMaterial();
  for (const [rSide, sx] of [
    ['L', -0.034],
    ['R', 0.034],
  ] as const) {
    const rose = addNamedCyl(
      parent,
      `${namePrefix}.rose_${rSide}`,
      0.011,
      0.012,
      0.004,
      12,
      x + sx,
      y,
      z + 0.002,
      brassMat,
      true
    );
    rose.rotation.x = Math.PI * 0.5;
  }
  const bail = new THREE.Mesh(sharedTorusGeometry(0.034, 0.0038, 8, 16, Math.PI), brassMat);
  bail.name = `${namePrefix}.swanNeckBail`;
  bail.rotation.z = Math.PI;
  bail.position.set(x, y - 0.002, z + 0.012);
  tagHighLod(bail);
  parent.add(bail);
}

export type GeorgianAntiqueCaseworkKind =
  | 'serpentineConsole'
  | 'demiLuneCardTable'
  | 'bowFrontChest'
  | 'astragalBureauBookcase';

export interface GeorgianAntiqueCaseworkOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly kind?: GeorgianAntiqueCaseworkKind;
}

/**
 * George III & Regency English antique casework:
 * - `'serpentineConsole'` (`980 x 450 x 755 mm` crossbanded burr walnut `#5C3A24` w/ boxwood stringing & brass lion-mask ring pulls)
 * - `'demiLuneCardTable'` (`940 x 465 x 745 mm` flame mahogany `#4E2718` semicircular fold-over card table w/ tapered legs & spade feet)
 * - `'bowFrontChest'` (`1050 x 530 x 1040 mm` `2-over-3` flame mahogany chest of drawers w/ brass swan-neck bails & splayed bracket feet)
 * - `'astragalBureauBookcase'` (`1020 x 530 x 2120 mm` 13-pane Gothic astragal-glazed mahogany bookcase over slant-front bureau & 4 drawers).
 */
export function buildGeorgianAntiqueCasework(
  ctx: CatalogInteractionContext = null,
  opts: GeorgianAntiqueCaseworkOptions = {}
): THREE.Group {
  const kind = opts.kind ?? 'serpentineConsole';
  const namePrefix =
    opts.name ??
    (kind === 'serpentineConsole'
      ? 'georgeIIISerpentineConsole'
      : kind === 'demiLuneCardTable'
        ? 'regencyDemiLuneCardTable'
        : kind === 'bowFrontChest'
          ? 'georgeIIIBowFrontChest'
          : 'georgeIIIAstragalBureauBookcase');

  const walnutMat = getBurrWalnutMaterial();
  const mahoganyMat = getFlameMahoganyMaterial();
  const boxwoodStringMat = getPaintedJoineryMaterial(0xd9c28e, 0.36, `${namePrefix}.boxwoodInlay`);
  const brassMat = getAgedBrassMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const oakMat = getCharacterOakMaterial();
  const registry = resolveRegistry(ctx);

  const root = new THREE.Group();
  root.name = namePrefix;

  if (kind === 'serpentineConsole') {
    const w = 0.98;
    const d = 0.45;
    const h = 0.755;
    const topT = 0.026;
    const friezeH = 0.145;
    const legH = h - topT;

    // 4 tapered square Hepplewhite legs w/ boxwood stringing & brass spade ferrules
    for (const [lTag, sx, sz] of [
      ['FL', -1, 1],
      ['FR', 1, 1],
      ['BL', -1, -1],
      ['BR', 1, -1],
    ] as const) {
      const lx = sx * (w * 0.5 - 0.045);
      const lz = sz * (d * 0.5 - 0.045);
      addNamedCyl(
        root,
        `${namePrefix}.taperedLeg_${lTag}`,
        0.024,
        0.015,
        legH - 0.041,
        4,
        lx,
        0.04 + (legH - 0.041) * 0.5,
        lz,
        walnutMat
      ).rotation.y = Math.PI * 0.25;
      addNamedCyl(
        root,
        `${namePrefix}.spadeFoot_${lTag}`,
        0.016,
        0.013,
        0.04,
        4,
        lx,
        0.02,
        lz,
        brassMat,
        true
      ).rotation.y = Math.PI * 0.25;
    }

    // Serpentine shaped top & frieze built with extruded S-curve front profile (`0` overlapping coplanar faces)
    const makeSerpentineExtrude = (width: number, depth: number, thick: number): THREE.BufferGeometry => {
      const hw = width * 0.5;
      const rear = -depth * 0.5;
      const frontEdge = depth * 0.5 - 0.032;
      const shape = new THREE.Shape();
      shape.moveTo(-hw, rear);
      shape.lineTo(hw, rear);
      shape.lineTo(hw, frontEdge);
      shape.bezierCurveTo(hw * 0.55, frontEdge - 0.024, hw * 0.35, frontEdge + 0.038, 0, frontEdge + 0.036);
      shape.bezierCurveTo(-hw * 0.35, frontEdge + 0.038, -hw * 0.55, frontEdge - 0.024, -hw, frontEdge);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: thick,
        bevelEnabled: true,
        bevelThickness: 0.003,
        bevelSize: 0.003,
        bevelSegments: 2,
        curveSegments: 20,
      });
      geo.rotateX(Math.PI * 0.5);
      geo.computeVertexNormals();
      return geo;
    };

    const topMesh = new THREE.Mesh(makeSerpentineExtrude(w, d, topT), walnutMat);
    topMesh.name = `${namePrefix}.crossbandedSerpentineTop`;
    topMesh.position.set(0, h, 0);
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    root.add(topMesh);

    // Frieze carcass aprons + interactive central serpentine frieze drawer w/ boxwood stringing & lion-mask pulls
    const friezeMidY = h - topT - friezeH * 0.5;
    addNamedBox(
      root,
      `${namePrefix}.friezeBack`,
      w - 0.1,
      friezeH,
      0.022,
      0,
      friezeMidY,
      -(d * 0.5 - 0.045),
      walnutMat
    );
    for (const [sSide, sx] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.friezeSide${sSide}`,
        0.022,
        friezeH,
        d - 0.11,
        sx * (w * 0.5 - 0.045),
        friezeMidY,
        0,
        walnutMat
      );
    }

    const drGroup = new THREE.Group();
    drGroup.name = `${namePrefix}.friezeDrawer`;
    drGroup.position.set(0, friezeMidY, d * 0.5 - 0.03);
    root.add(drGroup);

    const drW = w - 0.13;
    const drH = friezeH - 0.016;
    addNamedBox(drGroup, `${drGroup.name}.front`, drW, drH, 0.024, 0, 0, 0, walnutMat);
    // Boxwood stringing inlay border proud by 1 mm
    addNamedBox(drGroup, `${drGroup.name}.boxwoodStringTop`, drW - 0.028, 0.003, 0.002, 0, drH * 0.5 - 0.014, 0.013, boxwoodStringMat, true);
    addNamedBox(drGroup, `${drGroup.name}.boxwoodStringBottom`, drW - 0.028, 0.003, 0.002, 0, -(drH * 0.5 - 0.014), 0.013, boxwoodStringMat, true);

    // Twin brass lion-mask ring pulls
    for (const [pTag, px] of [
      ['Left', -drW * 0.26],
      ['Right', drW * 0.26],
    ] as const) {
      const mask = new THREE.Mesh(sharedSphereGeometry(0.015, 12, 10), brassMat);
      mask.name = `${drGroup.name}.lionMask_${pTag}`;
      mask.scale.set(0.95, 1.15, 0.55);
      mask.position.set(px, 0.006, 0.016);
      tagHighLod(mask);
      drGroup.add(mask);

      const ring = new THREE.Mesh(sharedTorusGeometry(0.017, 0.003, 8, 16), brassMat);
      ring.name = `${drGroup.name}.lionRing_${pTag}`;
      ring.position.set(px, -0.011, 0.019);
      tagHighLod(ring);
      drGroup.add(ring);
    }

    attachDrawerBoxBehindFront(drGroup, drW - 0.024, drH - 0.016, d - 0.12, '+z', false);
    wireCatalogSlidingDrawer(registry, {
      drawer: drGroup,
      slideDelta: [0, 0, 0.26],
      label: 'Open Console Frieze Drawer',
    });
  } else if (kind === 'demiLuneCardTable') {
    // 940 x 465 x 745 mm Regency flame-mahogany semicircular demi-lune fold-over card table
    const radius = 0.47; // W 940 mm, D 470 mm (~465 mm)
    const h = 0.745;
    const leafT = 0.016;
    const friezeH = 0.115;
    const rearOffsetZ = -radius * 0.5;

    // Double fold-over semicircular flame-mahogany top leaves (`lowerLeaf` + `upperFoldedLeaf` separated by brass edge hinge)
    const semiLower = addNamedCyl(
      root,
      `${namePrefix}.lowerDemiLuneTop`,
      radius,
      radius,
      leafT,
      32,
      0,
      h - leafT * 1.5 - 0.001,
      rearOffsetZ,
      mahoganyMat
    );
    semiLower.geometry = new THREE.CylinderGeometry(radius, radius, leafT, 32, 1, false, -Math.PI * 0.5, Math.PI);

    const semiUpper = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, leafT, 32, 1, false, -Math.PI * 0.5, Math.PI),
      mahoganyMat
    );
    semiUpper.name = `${namePrefix}.upperFoldOverLeaf`;
    semiUpper.position.set(0, h - leafT * 0.5, rearOffsetZ);
    semiUpper.castShadow = true;
    semiUpper.receiveShadow = true;
    root.add(semiUpper);

    // Semicircular crossbanded frieze apron + boxwood stringing band
    const friezeR = radius - 0.028;
    const friezeCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(friezeR, friezeR, friezeH, 28, 1, false, -Math.PI * 0.5, Math.PI),
      mahoganyMat
    );
    friezeCyl.name = `${namePrefix}.demiLuneFrieze`;
    friezeCyl.position.set(0, h - leafT * 2 - friezeH * 0.5 - 0.002, rearOffsetZ);
    friezeCyl.castShadow = true;
    root.add(friezeCyl);

    const stringBand = new THREE.Mesh(
      new THREE.CylinderGeometry(friezeR + 0.002, friezeR + 0.002, 0.004, 28, 1, false, -Math.PI * 0.5, Math.PI),
      boxwoodStringMat
    );
    stringBand.name = `${namePrefix}.boxwoodFriezeStringing`;
    stringBand.position.set(0, h - leafT * 2 - friezeH + 0.014, rearOffsetZ);
    tagHighLod(stringBand);
    root.add(stringBand);

    // 4 tapered square mahogany legs arranged around the demi-lune perimeter (`-78°, -24°, +24°, +78°` from `+Z`)
    const legTop = h - leafT * 2 - friezeH - 0.002;
    const legAngles = [-1.34, -0.44, 0.44, 1.34];
    legAngles.forEach((ang, idx) => {
      const lx = Math.sin(ang) * (friezeR - 0.024);
      const lz = rearOffsetZ + Math.cos(ang) * (friezeR - 0.024);
      const leg = addNamedCyl(
        root,
        `${namePrefix}.taperedMahoganyLeg_${idx + 1}`,
        0.022,
        0.014,
        legTop - 0.036,
        4,
        lx,
        0.036 + (legTop - 0.036) * 0.5,
        lz,
        mahoganyMat
      );
      leg.rotation.y = Math.PI * 0.25 + ang;
      addNamedCyl(
        root,
        `${namePrefix}.spadeFoot_${idx + 1}`,
        0.016,
        0.013,
        0.036,
        4,
        lx,
        0.018,
        lz,
        brassMat,
        true
      ).rotation.y = Math.PI * 0.25 + ang;
    });
  } else if (kind === 'bowFrontChest') {
    // 1050 x 530 x 1040 mm George III 2-over-3 bow-front flame-mahogany chest of drawers
    const w = 1.05;
    const d = 0.53;
    const h = 1.04;
    const footH = 0.115;
    const topT = 0.026;
    const bodyH = h - footH - topT;
    const bodyBotY = footH;

    // 4 splayed French bracket feet + shaped apron drop
    for (const [fTag, sx, sz] of [
      ['FL', -1, 1],
      ['FR', 1, 1],
      ['BL', -1, -1],
      ['BR', 1, -1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.bracketFoot_${fTag}`,
        0.11,
        footH,
        0.085,
        sx * (w * 0.5 - 0.055),
        footH * 0.5,
        sz * (d * 0.5 - 0.055),
        mahoganyMat
      );
    }

    // Carcass sides, back & top
    const sideT = 0.024;
    const carcassD = d - 0.055;
    const carcassCz = -0.025;
    for (const [sSide, sx] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.sideCheek${sSide}`,
        sideT,
        bodyH,
        carcassD,
        sx * (w * 0.5 - sideT * 0.5),
        bodyBotY + bodyH * 0.5,
        carcassCz,
        mahoganyMat
      );
    }
    addNamedBox(
      root,
      `${namePrefix}.backPanel`,
      w - sideT * 2,
      bodyH,
      0.018,
      0,
      bodyBotY + bodyH * 0.5,
      -d * 0.5 + 0.012,
      oakMat
    );

    // Bow-front top slab (`ExtrudeGeometry` gentle convex arc along `+Z`)
    const makeBowExtrude = (width: number, rearZ: number, edgeZ: number, bowApexZ: number, thick: number): THREE.BufferGeometry => {
      const hw = width * 0.5;
      const sh = new THREE.Shape();
      sh.moveTo(-hw, rearZ);
      sh.lineTo(hw, rearZ);
      sh.lineTo(hw, edgeZ);
      sh.quadraticCurveTo(0, bowApexZ, -hw, edgeZ);
      sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, {
        depth: thick,
        bevelEnabled: true,
        bevelThickness: 0.0025,
        bevelSize: 0.0025,
        bevelSegments: 2,
        curveSegments: 20,
      });
      geo.rotateX(Math.PI * 0.5);
      geo.computeVertexNormals();
      return geo;
    };

    const topMesh = new THREE.Mesh(
      makeBowExtrude(w + 0.028, -d * 0.5, d * 0.5 - 0.048, d * 0.5 + 0.032, topT),
      mahoganyMat
    );
    topMesh.name = `${namePrefix}.bowFrontTop`;
    topMesh.position.set(0, h, 0);
    topMesh.castShadow = true;
    root.add(topMesh);

    // 2-over-3 graduated bow-front drawers (top row: 2 short drawers; rows 2..4: 3 full-width graduated drawers)
    const innerW = w - sideT * 2;
    const railH = 0.018;
    const availH = bodyH - railH * 5;
    const rowRatios = [0.19, 0.23, 0.27, 0.31];
    let yCursor = h - topT - railH;

    rowRatios.forEach((ratio, rIdx) => {
      const rowH = availH * ratio;
      const rowCy = yCursor - rowH * 0.5;

      addNamedBox(
        root,
        `${namePrefix}.dustBoardRail_${rIdx + 1}`,
        innerW,
        railH,
        carcassD - 0.042,
        0,
        yCursor + railH * 0.5,
        carcassCz + 0.011,
        mahoganyMat
      );

      if (rIdx === 0) {
        // Top 2 short drawers separated by center stile
        addNamedBox(
          root,
          `${namePrefix}.topCenterStile`,
          0.02,
          rowH,
          0.04,
          0,
          rowCy,
          d * 0.5 - 0.045,
          mahoganyMat
        );
        const shortW = (innerW - 0.028) * 0.5;
        for (const [dTag, sign] of [
          ['topLeftDrawer', -1],
          ['topRightDrawer', 1],
        ] as const) {
          const dCx = sign * (shortW * 0.5 + 0.012);
          const dg = new THREE.Group();
          dg.name = `${namePrefix}.${dTag}`;
          dg.position.set(dCx, rowCy, d * 0.5 - 0.042);
          root.add(dg);

          addNamedBox(dg, `${dg.name}.front`, shortW, rowH - 0.006, 0.024, 0, 0, 0, mahoganyMat);
          addSwanNeckBailPull(dg, `${dg.name}.pull`, 0, 0, 0.012);
          attachDrawerBoxBehindFront(dg, shortW - 0.02, rowH - 0.014, d - 0.14, '+z', false);
          wireCatalogSlidingDrawer(registry, {
            drawer: dg,
            slideDelta: [0, 0, 0.32],
            label: 'Open Top Short Drawer',
          });
        }
      } else {
        // Graduated full-width bow-front drawer
        const dg = new THREE.Group();
        dg.name = `${namePrefix}.longDrawer_${rIdx}`;
        dg.position.set(0, rowCy, 0);
        root.add(dg);

        const bowFront = new THREE.Mesh(
          makeBowExtrude(innerW - 0.006, d * 0.5 - 0.068, d * 0.5 - 0.052, d * 0.5 + 0.018, rowH - 0.006),
          mahoganyMat
        );
        bowFront.name = `${dg.name}.bowFront`;
        bowFront.position.set(0, (rowH - 0.006) * 0.5, 0);
        bowFront.castShadow = true;
        dg.add(bowFront);

        addSwanNeckBailPull(dg, `${dg.name}.pullLeft`, -innerW * 0.27, 0, d * 0.5 - 0.018);
        addSwanNeckBailPull(dg, `${dg.name}.pullRight`, innerW * 0.27, 0, d * 0.5 - 0.018);
        // Brass keyhole escutcheon at center
        addNamedBox(dg, `${dg.name}.escutcheon`, 0.018, 0.032, 0.003, 0, 0.01, d * 0.5 + 0.002, brassMat, true);

        wireCatalogSlidingDrawer(registry, {
          drawer: dg,
          slideDelta: [0, 0, 0.34],
          label: 'Open Bow-Front Mahogany Drawer',
        });
      }

      yCursor -= rowH + railH;
    });
    addNamedBox(
      root,
      `${namePrefix}.bottomRail`,
      innerW,
      railH,
      carcassD - 0.026,
      0,
      bodyBotY + railH * 0.5,
      carcassCz + 0.013,
      mahoganyMat
    );
  } else {
    // 'astragalBureauBookcase': 1020 x 530 x 2120 mm George III 13-pane Gothic-glazed mahogany bureau bookcase
    const w = 1.02;
    const baseD = 0.53;
    const upperD = 0.33;
    const totalH = 2.12;
    const footH = 0.1;
    const drawersTopY = 0.78;
    const bureauTopY = 1.06;
    const rearZ = -baseD * 0.5;
    const frontZ = baseD * 0.5;
    const sideT = 0.024;

    // Bracket feet
    for (const [fTag, sx, sz] of [
      ['FL', -1, 1],
      ['FR', 1, 1],
      ['BL', -1, -1],
      ['BR', 1, -1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.bracketFoot_${fTag}`,
        0.11,
        footH,
        0.09,
        sx * (w * 0.5 - 0.055),
        footH * 0.5,
        sz * (baseD * 0.5 - 0.05),
        mahoganyMat
      );
    }

    // Lower drawer chest (`y = footH .. drawersTopY`) + 4 graduated drawers
    const lowerH = drawersTopY - footH;
    for (const [sSide, sx] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.lowerSide${sSide}`,
        sideT,
        lowerH,
        baseD - 0.024,
        sx * (w * 0.5 - sideT * 0.5),
        footH + lowerH * 0.5,
        -0.012,
        mahoganyMat
      );
    }
    const lowerBackH = bureauTopY - 0.022 - footH;
    addNamedBox(
      root,
      `${namePrefix}.lowerBack`,
      w - sideT * 2,
      lowerBackH,
      0.018,
      0,
      footH + lowerBackH * 0.5,
      rearZ + 0.009,
      oakMat
    );

    const innerW = w - sideT * 2;
    const railH = 0.016;
    const availDrH = lowerH - railH * 5;
    const drRatios = [0.21, 0.24, 0.26, 0.29];
    let yTop = drawersTopY - railH;
    drRatios.forEach((ratio, idx) => {
      const dh = availDrH * ratio;
      const dCy = yTop - dh * 0.5;
      addNamedBox(root, `${namePrefix}.drawerRail_${idx + 1}`, innerW, railH, baseD - 0.056, 0, yTop + railH * 0.5, 0.004, mahoganyMat);

      const dg = new THREE.Group();
      dg.name = `${namePrefix}.graduatedDrawer_${idx + 1}`;
      dg.position.set(0, dCy, frontZ - 0.014);
      root.add(dg);
      addNamedBox(dg, `${dg.name}.front`, innerW - 0.008, dh - 0.006, 0.022, 0, 0, 0, mahoganyMat);
      addSwanNeckBailPull(dg, `${dg.name}.pullL`, -innerW * 0.27, 0, 0.011);
      addSwanNeckBailPull(dg, `${dg.name}.pullR`, innerW * 0.27, 0, 0.011);
      attachDrawerBoxBehindFront(dg, innerW - 0.024, dh - 0.012, baseD - 0.1, '+z', false);
      wireCatalogSlidingDrawer(registry, {
        drawer: dg,
        slideDelta: [0, 0, 0.34],
        label: 'Open Bureau Graduated Drawer',
      });
      yTop -= dh + railH;
    });

    // Slant-front writing desk section (`y = drawersTopY .. bureauTopY`): angled fall-front flap + pigeonhole interior!
    const deskH = bureauTopY - drawersTopY;
    const deskTopD = upperD + 0.02;
    addNamedBox(
      root,
      `${namePrefix}.bureauWritingDeck`,
      innerW,
      0.02,
      baseD - 0.04,
      0,
      drawersTopY + 0.01,
      0,
      mahoganyMat
    );
    addNamedBox(
      root,
      `${namePrefix}.bureauTopLedge`,
      w,
      0.022,
      deskTopD,
      0,
      bureauTopY - 0.011,
      rearZ + deskTopD * 0.5,
      mahoganyMat
    );
    // Interior baize writing surface & pigeonhole dividers visible if fall-front opens
    const baizeMat = getPaintedJoineryMaterial(0x284b36, 0.85, `${namePrefix}.greenBaize`);
    for (let p = -2; p <= 2; p++) {
      addNamedBox(
        root,
        `${namePrefix}.pigeonholeDivider_${p + 3}`,
        0.01,
        deskH - 0.06,
        0.18,
        p * 0.16,
        drawersTopY + deskH * 0.5,
        rearZ + 0.12,
        oakMat,
        true
      );
    }
    // Slanted bureau fall-front door (`42°` slope from `(drawersTopY, frontZ)` up to `(bureauTopY, rearZ + deskTopD)`)
    const dzSlope = frontZ - (rearZ + deskTopD);
    const dySlope = deskH - 0.022;
    const flapLen = Math.hypot(dzSlope, dySlope);
    const flapAngle = Math.atan2(dzSlope, dySlope);
    const fallFlap = new THREE.Group();
    fallFlap.name = `${namePrefix}.slantFallFront`;
    fallFlap.position.set(0, drawersTopY + 0.02 + dySlope * 0.5, (frontZ + rearZ + deskTopD) * 0.5);
    root.add(fallFlap);

    const flapSlab = addNamedBox(
      fallFlap,
      `${fallFlap.name}.mahoganySlab`,
      w - 0.012,
      flapLen,
      0.022,
      0,
      0,
      0,
      mahoganyMat
    );
    flapSlab.rotation.x = -flapAngle;
    const flapBaize = addNamedBox(
      fallFlap,
      `${fallFlap.name}.greenBaizeLining`,
      w - 0.09,
      flapLen - 0.08,
      0.003,
      0,
      -0.003,
      -0.013,
      baizeMat,
      true
    );
    flapBaize.rotation.x = -flapAngle;
    wireCatalogHingedDoor(registry, {
      parent: root,
      door: fallFlap,
      hingeOffset: [0, -dySlope * 0.5, dzSlope * 0.5],
      axis: 'x',
      openAngle: Math.PI * 0.5 - flapAngle,
      label: 'Open Slant-Front Writing Bureau',
    });

    // Upper 13-pane Gothic astragal-glazed mahogany bookcase (`y = bureauTopY .. totalH`, `D = upperD`)
    const crownH = 0.095;
    const upperH = totalH - bureauTopY - crownH;
    const upperMidY = bureauTopY + upperH * 0.5;
    const upperFrontZ = rearZ + upperD;
    const upperCz = rearZ + upperD * 0.5;

    for (const [sSide, sx] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.upperSide${sSide}`,
        sideT,
        upperH,
        upperD - 0.022,
        sx * (w * 0.5 - sideT * 0.5),
        upperMidY,
        rearZ + (upperD - 0.022) * 0.5,
        mahoganyMat
      );
    }
    addNamedBox(root, `${namePrefix}.upperBack`, innerW, upperH, 0.016, 0, upperMidY, rearZ + 0.008, mahoganyMat);
    addNamedBox(root, `${namePrefix}.upperCeiling`, innerW, 0.02, upperD - 0.042, 0, bureauTopY + upperH - 0.01, rearZ + 0.018 + (upperD - 0.042) * 0.5, mahoganyMat);

    // Dentil swan-neck/stepped George III cornice (`totalH - crownH .. totalH`)
    addNamedBox(
      root,
      `${namePrefix}.dentilFrieze`,
      w + 0.02,
      crownH * 0.48,
      upperD + 0.018,
      0,
      totalH - crownH + crownH * 0.24,
      rearZ + (upperD + 0.018) * 0.5,
      mahoganyMat
    );
    addNamedBox(
      root,
      `${namePrefix}.mouldedCorniceCrown`,
      w + 0.068,
      crownH * 0.52,
      upperD + 0.052,
      0,
      totalH - crownH * 0.26,
      rearZ + (upperD + 0.052) * 0.5,
      mahoganyMat
    );

    // 3 mahogany shelves stocked with leather-bound antiquarian volumes
    const folioColors = [0x5c231b, 0x2a3a2f, 0x6b4a2b, 0x243040, 0x7c5c36];
    for (let s = 0; s < 3; s++) {
      const sy = bureauTopY + ((s + 1) / 4) * upperH;
      addNamedBox(root, `${namePrefix}.bookShelf_${s + 1}`, innerW - 0.004, 0.02, upperD - 0.055, 0, sy, upperCz - 0.01, mahoganyMat);
      let bx = -innerW * 0.42;
      for (let b = 0; b < 9; b++) {
        const bt = 0.032 + ((b + s) % 3) * 0.008;
        const bh = 0.19 + ((b * 3 + s) % 3) * 0.018;
        const bMat = getPaintedJoineryMaterial(folioColors[(b + s * 2) % folioColors.length]!, 0.52, `${namePrefix}.folio_${s}_${b}`);
        addNamedBox(
          root,
          `${namePrefix}.antiquarianBook_${s + 1}_${b + 1}`,
          bt - 0.001,
          bh,
          0.175,
          bx + bt * 0.5,
          sy + 0.0105 + bh * 0.5,
          upperCz - 0.01,
          bMat,
          true
        );
        bx += bt + 0.003;
      }
    }

    // Linked 13-pane Gothic astragal-glazed double doors
    const leafW = (w - 0.016) * 0.5;
    const leafH = upperH - 0.012;
    const dStile = 0.042;
    let leftBookPivot: THREE.Object3D | null = null;
    let rightBookPivot: THREE.Object3D | null = null;

    for (const [dTag, sign] of [
      ['bookcaseDoorLeft', -1],
      ['bookcaseDoorRight', 1],
    ] as const) {
      const dg = new THREE.Group();
      dg.name = `${namePrefix}.${dTag}`;
      dg.position.set(sign * (leafW * 0.5 + 0.002), upperMidY, upperFrontZ - 0.011);
      root.add(dg);

      addNamedBox(dg, `${dg.name}.stileL`, dStile, leafH, 0.022, -(leafW * 0.5 - dStile * 0.5), 0, 0, mahoganyMat);
      addNamedBox(dg, `${dg.name}.stileR`, dStile, leafH, 0.022, leafW * 0.5 - dStile * 0.5, 0, 0, mahoganyMat);
      const gW = leafW - dStile * 2;
      const gH = leafH - dStile * 2;
      addNamedBox(dg, `${dg.name}.railTop`, gW, dStile, 0.022, 0, leafH * 0.5 - dStile * 0.5, 0, mahoganyMat);
      addNamedBox(dg, `${dg.name}.railBottom`, gW, dStile, 0.022, 0, -(leafH * 0.5 - dStile * 0.5), 0, mahoganyMat);
      addNamedBox(dg, `${dg.name}.glassPane`, gW, gH, 0.004, 0, 0, 0, glassMat);

      // George III 13-pane diamond/Gothic astragal lattice bars (`0.009 m` moulded mahogany bars on front of glass)
      const diagLen = Math.hypot(gW * 0.48, gH * 0.24) - 0.014;
      const diagAng = Math.atan2(gW * 0.48, gH * 0.24);
      for (const [rowIdx, ry] of [
        [1, gH * 0.24],
        [2, -gH * 0.24],
      ] as const) {
        for (const [sideIdx, sx] of [
          [1, -1],
          [2, 1],
        ] as const) {
          const barA = addNamedBox(dg, `${dg.name}.gothicAstragalA_${rowIdx}_${sideIdx}`, 0.0085, diagLen, 0.01, sx * gW * 0.24, ry + gH * 0.12, 0.007, mahoganyMat, true);
          barA.rotation.z = sx * diagAng;
          const barB = addNamedBox(dg, `${dg.name}.gothicAstragalB_${rowIdx}_${sideIdx}`, 0.0085, diagLen, 0.01, sx * gW * 0.24, ry - gH * 0.12, 0.007, mahoganyMat, true);
          barB.rotation.z = -sx * diagAng;
        }
      }
      addNamedBox(dg, `${dg.name}.brassEscutcheon`, 0.014, 0.048, 0.004, -sign * (leafW * 0.5 - 0.021), -0.08, 0.013, brassMat, true);

      const pivot = wireCatalogHingedDoor(registry, {
        parent: root,
        door: dg,
        hingeOffset: [sign * (leafW * 0.5 - 0.01), 0, 0],
        axis: 'y',
        openAngle: sign < 0 ? -Math.PI * 0.58 : Math.PI * 0.58,
        label: 'Open Astragal Bookcase Doors',
        linkGroup: 'astragalBookcaseDoors',
      });
      if (sign < 0) leftBookPivot = pivot;
      else rightBookPivot = pivot;
    }
    if (registry && leftBookPivot && rightBookPivot) {
      registry.linkDoorPair(leftBookPivot, rightBookPivot);
    }
  }

  const caseMetaMap: Record<GeorgianAntiqueCaseworkKind, readonly [string, string, readonly [number, number, number]]> = {
    serpentineConsole: ['George III Serpentine Flame-Mahogany Console Table', 'GEO3-SERP-1160', [1160, 480, 840]],
    demiLuneCardTable: ['Regency Satinwood-Inlaid Demi-Lune Card Table', 'REG-DEMI-940', [940, 465, 745]],
    bowFrontChest: ['George III 2-over-3 Bow-Front Mahogany Chest of Drawers', 'GEO3-BOW-1060', [1060, 530, 1040]],
    astragalBureauBookcase: ['George III 13-Pane Gothic Astragal Bureau Bookcase', 'GEO3-BUR-1040', [1040, 540, 2160]],
  };
  const caseMeta = caseMetaMap[kind];
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: caseMeta[0],
    brand: '1stDibs Georgian Period Antiques',
    collection: 'George III & Regency Mahogany',
    sku: caseMeta[1],
    finish: 'Cuban Flame Mahogany, Boxwood Stringing & Swan-Neck Brass',
    category: 'antiques',
    dimensionsMm: caseMeta[2],
    productUrl: 'https://www.1stdibs.com/furniture/storage-case-pieces/',
    schematicUrl: 'https://www.1stdibs.com/furniture/georgian-casework-provenance.pdf',
  });
}

export interface GeorgianFiresideSetOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly fenderWidthM?: number;
  readonly fenderDepthM?: number;
  readonly fenderHeightM?: number;
  readonly includeCoalScuttle?: boolean;
  readonly includeFireIrons?: boolean;
  readonly interactions?: InteractionRegistry;
}

/**
 * English country-house Georgian fireside set:
 * - Pierced-brass & deep-buttoned chestnut-leather Club Fender (`1360 x 380 x 460 mm`, `SeatInteractable`)
 * - Burnished copper helmet coal scuttle (`300 x 430 x 360 mm`) with anthracite coals & brass swing bail
 * - 4-piece turned Aged Brass fire-irons companion stand (`H 660 mm`: poker, tongs, pierced shovel & hearth brush).
 */
export function buildGeorgianFiresideSet(
  opts: GeorgianFiresideSetOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianFiresideSet';
  const w = opts.fenderWidthM ?? 1.36;
  const d = opts.fenderDepthM ?? 0.38;
  const h = opts.fenderHeightM ?? 0.46;

  const brassMat = getAgedBrassMaterial();
  const darkBrassMat = getDarkAntiquedBrassMaterial();
  const copperMat = getBurnishedCopperCatalogMaterial();
  const ironMat = getMatteCastIronMaterial(0x1b1d1f);
  const leatherMaps = getWovenFabricMaps('club-fender-chestnut', 0x5c2f1e, 'leather');
  const leatherMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.chestnutLeather`,
    map: leatherMaps.colorMap,
    normalMap: leatherMaps.normalMap,
    roughnessMap: leatherMaps.roughnessMap,
    roughness: 0.44,
    metalness: 0.03,
  });

  const root = new THREE.Group();
  root.name = namePrefix;

  // U-shaped moulded Aged Brass kerb plinth (`z = -d/2 .. +d/2`, open toward `-Z` fireplace!)
  const kerbH = 0.048;
  const kerbW = 0.055;
  const frontZ = d * 0.5 - kerbW * 0.5;
  addNamedBox(root, `${namePrefix}.fenderKerbFront`, w, kerbH, kerbW, 0, kerbH * 0.5, frontZ, brassMat);
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.fenderKerbSide${sTag}`,
      kerbW,
      kerbH,
      d - kerbW,
      sign * (w * 0.5 - kerbW * 0.5),
      kerbH * 0.5,
      -kerbW * 0.5,
      brassMat
    );
  }

  // Turned brass vertical spindles & top rail supporting the L-shaped buttoned chestnut-leather corner seats
  const seatT = 0.095;
  const railY = h - seatT - 0.012;
  const spindleBot = kerbH;
  const spindleH = railY - spindleBot - 0.008;

  // Central dipped brass front rail (classic English club fender dip in middle for firelight view!)
  const cornerSeatW = 0.44;
  const centerGapW = w - cornerSeatW * 2;
  const dipRailY = kerbH + 0.16;
  addNamedBox(
    root,
    `${namePrefix}.fenderCenterDipRail`,
    centerGapW,
    0.018,
    0.022,
    0,
    dipRailY,
    frontZ,
    brassMat
  );
  for (let sp = -2; sp <= 2; sp++) {
    addNamedCyl(
      root,
      `${namePrefix}.centerDipSpindle_${sp + 3}`,
      0.008,
      0.008,
      dipRailY - kerbH - 0.008,
      10,
      sp * (centerGapW * 0.18),
      kerbH + (dipRailY - kerbH) * 0.5,
      frontZ,
      brassMat,
      true
    );
  }

  // Left & Right L-shaped buttoned chestnut-leather seats + brass spindles underneath
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const frontArmCx = sign * (w * 0.5 - cornerSeatW * 0.5);
    addNamedBox(
      root,
      `${namePrefix}.topBrassRailFront${sTag}`,
      cornerSeatW,
      0.018,
      0.028,
      frontArmCx,
      railY,
      frontZ,
      brassMat
    );
    addNamedBox(
      root,
      `${namePrefix}.topBrassRailSide${sTag}`,
      0.028,
      0.018,
      d - kerbW,
      sign * (w * 0.5 - kerbW * 0.5),
      railY,
      -kerbW * 0.5,
      brassMat
    );

    // Turned brass spindles along front & return
    for (let i = 0; i < 4; i++) {
      const sx = sign * (w * 0.5 - 0.045 - i * 0.115);
      addNamedCyl(
        root,
        `${namePrefix}.frontSpindle_${sTag}_${i + 1}`,
        0.009,
        0.009,
        spindleH,
        10,
        sx,
        spindleBot + spindleH * 0.5,
        frontZ,
        brassMat,
        true
      );
    }
    for (let j = 1; j <= 2; j++) {
      const sz = frontZ - j * 0.125;
      addNamedCyl(
        root,
        `${namePrefix}.sideSpindle_${sTag}_${j}`,
        0.009,
        0.009,
        spindleH,
        10,
        sign * (w * 0.5 - kerbW * 0.5),
        spindleBot + spindleH * 0.5,
        sz,
        brassMat,
        true
      );
    }

    // L-shaped buttoned chestnut-leather seat pads (2 non-overlapping sculpted cushions per corner)
    const seatDepth = 0.165;
    const seatCy = h - seatT * 0.5;
    const frontPad = new THREE.Mesh(
      createSculptedCushionGeometry(cornerSeatW + 0.016, seatT, seatDepth, 6, 4, 4, 0.54, 'standard'),
      leatherMat
    );
    frontPad.name = `${namePrefix}.leatherSeatFront${sTag}`;
    frontPad.position.set(frontArmCx, seatCy, d * 0.5 - seatDepth * 0.5 + 0.008);
    frontPad.castShadow = true;
    root.add(frontPad);

    const returnLen = d - seatDepth + 0.006;
    const returnPad = new THREE.Mesh(
      createSculptedCushionGeometry(seatDepth, seatT, returnLen, 4, 4, 6, 0.54, 'standard'),
      leatherMat
    );
    returnPad.name = `${namePrefix}.leatherSeatReturn${sTag}`;
    returnPad.position.set(
      sign * (w * 0.5 - seatDepth * 0.5 + 0.008),
      seatCy,
      -d * 0.5 + returnLen * 0.5
    );
    returnPad.castShadow = true;
    root.add(returnPad);

    // Deep-buttoned leather tufts (`3` brass/leather buttons along front seat top)
    for (let b = -1; b <= 1; b++) {
      const btn = new THREE.Mesh(sharedSphereGeometry(0.008, 10, 8), darkBrassMat);
      btn.name = `${namePrefix}.leatherTuftButton_${sTag}_${b + 2}`;
      btn.scale.set(1, 0.45, 1);
      btn.position.set(frontArmCx + b * 0.12, h + 0.002, d * 0.5 - seatDepth * 0.5 + 0.008);
      tagHighLod(btn);
      root.add(btn);
    }
  }

  // Burnished Copper Helmet Coal Scuttle (`300 x 430 x 360 mm`) to the right of the Club Fender
  if (opts.includeCoalScuttle ?? true) {
    const scGroup = new THREE.Group();
    scGroup.name = `${namePrefix}.copperHelmetCoalScuttle`;
    scGroup.position.set(w * 0.5 + 0.24, 0, 0.02);
    scGroup.rotation.y = -0.25;
    root.add(scGroup);

    addNamedCyl(scGroup, `${scGroup.name}.pedestalFoot`, 0.095, 0.115, 0.055, 18, 0, 0.0275, 0, copperMat, true);
    const bodyBucket = addNamedCyl(
      scGroup,
      `${scGroup.name}.helmetBody`,
      0.145,
      0.098,
      0.26,
      20,
      0,
      0.185,
      0.03,
      copperMat
    );
    bodyBucket.rotation.x = 0.34;
    // Projecting copper pouring scoop lip + anthracite coal lumps inside
    const scoop = addNamedCyl(
      scGroup,
      `${scGroup.name}.pouringScoop`,
      0.135,
      0.142,
      0.11,
      18,
      0,
      0.295,
      0.1,
      copperMat,
      true
    );
    scoop.rotation.x = 0.58;

    for (let c = 0; c < 5; c++) {
      const coal = new THREE.Mesh(sharedSphereGeometry(0.034, 7, 6), ironMat);
      coal.name = `${scGroup.name}.anthraciteCoal_${c + 1}`;
      coal.position.set((c - 2) * 0.032, 0.255 + (c % 2) * 0.018, 0.06 + (c % 3) * 0.02);
      tagHighLod(coal);
      scGroup.add(coal);
    }

    const bail = new THREE.Mesh(sharedTorusGeometry(0.148, 0.006, 8, 20, Math.PI), brassMat);
    bail.name = `${scGroup.name}.brassSwingHandle`;
    bail.position.set(0, 0.24, 0.02);
    tagHighLod(bail);
    scGroup.add(bail);
  }

  // 4-piece Aged Brass fire-irons companion stand (`H 660 mm`) to the left of the Club Fender
  if (opts.includeFireIrons ?? true) {
    const fiGroup = new THREE.Group();
    fiGroup.name = `${namePrefix}.brassFireIronsSet`;
    fiGroup.position.set(-(w * 0.5 + 0.21), 0, -0.02);
    root.add(fiGroup);

    const standH = 0.66;
    addNamedCyl(fiGroup, `${fiGroup.name}.standWeightedBase`, 0.095, 0.105, 0.028, 18, 0, 0.014, 0, brassMat, true);
    addNamedCyl(fiGroup, `${fiGroup.name}.standCenterStem`, 0.008, 0.01, standH - 0.06, 12, 0, 0.028 + (standH - 0.06) * 0.5, 0, brassMat);
    addNamedCyl(fiGroup, `${fiGroup.name}.standUrnFinial`, 0.014, 0.02, 0.044, 12, 0, standH - 0.01, 0, brassMat, true);
    const hookRing = new THREE.Mesh(sharedTorusGeometry(0.052, 0.005, 8, 18), brassMat);
    hookRing.name = `${fiGroup.name}.toolGalleryRing`;
    hookRing.rotation.x = Math.PI * 0.5;
    hookRing.position.set(0, standH - 0.065, 0);
    tagHighLod(hookRing);
    fiGroup.add(hookRing);

    // 4 hanging fire tools: poker, tongs, pierced shovel & hearth brush
    const tools: readonly [string, number, number][] = [
      ['poker', -0.046, 0.02],
      ['tongs', 0.046, 0.02],
      ['piercedShovel', -0.032, -0.038],
      ['hearthBrush', 0.032, -0.038],
    ];
    for (const [tName, tx, tz] of tools) {
      addNamedCyl(
        fiGroup,
        `${fiGroup.name}.${tName}_handle`,
        0.012,
        0.009,
        0.075,
        10,
        tx,
        standH - 0.09,
        tz,
        brassMat,
        true
      );
      addNamedCyl(
        fiGroup,
        `${fiGroup.name}.${tName}_shaft`,
        0.0045,
        0.0045,
        0.42,
        8,
        tx,
        standH - 0.335,
        tz,
        brassMat,
        true
      );
      if (tName === 'piercedShovel') {
        addNamedBox(fiGroup, `${fiGroup.name}.shovelPan`, 0.078, 0.095, 0.006, tx, 0.078, tz + 0.008, brassMat, true);
      } else if (tName === 'hearthBrush') {
        addNamedBox(fiGroup, `${fiGroup.name}.brushBristleHead`, 0.065, 0.075, 0.028, tx, 0.075, tz, ironMat, true);
      }
    }
  }

  const seatInteractable = new SeatInteractable({
    id: `seat:${namePrefix}`,
    label: 'Georgian Leather Club Fender',
    aliases: ['sit on club fender', 'fireside seat'],
    anchor: root,
    clickableTargets: collectSeatClickableMeshes(root),
    localSeatPos: [-w * 0.32, h, d * 0.3],
    localFootOffset: [0, 0, d * 0.5 + 0.44],
    localForward: [0, 0, 1],
    seatedEyeHeightM: 0.72,
    proximityRadiusM: 1.0,
    material: 'leather',
  });
  root.userData.seatInteractable = seatInteractable;
  if (opts.interactions) {
    opts.interactions.registerAnimatedInteractable(seatInteractable);
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Acres Farm Tufted Leather Club Fender & Brass Fireside Companion Set',
    brand: 'Acres Farm',
    collection: 'Bespoke Club Fenders',
    sku: 'AF-CF-1360-AB',
    finish: 'Chestnut Bridle Leather & Aged Brass Spindles',
    category: 'furniture',
    dimensionsMm: mmFromMetres(w, d, h),
    productUrl: 'https://www.acresfarm.co.uk/club-fenders/',
    schematicUrl: 'https://www.acresfarm.co.uk/measuring-guide/club-fender-dimensions.pdf',
  });
}

export type CuratedMirrorArtOrRugKind =
  | 'regencyGiltOvermantel'
  | 'regencyGiltPierMirror'
  | 'coxRoundBrass'
  | 'coxArchedBrass'
  | 'scallopedBrass'
  | 'constableLandscapeOil'
  | 'curtisBotanicalGrid'
  | 'zieglerOushak'
  | 'coxPebbleWool'
  | 'coxBraidedJute'
  | 'rogerOatesRunnerSwatch';

export interface CuratedMirrorsArtAndRugsOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly kind?: CuratedMirrorArtOrRugKind;
  readonly widthM?: number;
  readonly heightM?: number;
  /** Depth/length along Z for floor rugs (default `2.70` m). */
  readonly lengthM?: number;
  /** Grid layout for `'curtisBotanicalGrid'` (`'2x2'` default or `'1x4'`). */
  readonly botanicalLayout?: '2x2' | '1x4';
}

function getConstablePastoralCanvasTexture(): THREE.DataTexture {
  return getOrCreateCachedTexture('catalog:art:constable-pastoral:v1', () => {
    const w = 192;
    const h = 128;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const v = 1 - y / h; // v=0 top sky, v=1 foreground meadow
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const n1 = seamlessFbm2D(u, v, 3, 4, 8101);
        const n2 = seamlessFbm2D(u + 0.37, v + 0.19, 7, 3, 8209);
        const horizon = 0.54 + Math.sin(u * Math.PI * 2) * 0.035 + (n1 - 0.5) * 0.04;
        let r = 0;
        let g = 0;
        let b = 0;

        if (v < horizon) {
          // Suffolk cumulus clouds over soft cerulean sky
          const skyGrad = v / horizon;
          const cloud = Math.max(0, n1 * 0.72 + n2 * 0.38 - 0.42) * 2.1;
          r = 148 + skyGrad * 46 + cloud * 58;
          g = 171 + skyGrad * 36 + cloud * 50;
          b = 192 + skyGrad * 20 + cloud * 38;
        } else {
          // Winding Stour river gleam + golden haymeadow & dark ancient English oaks
          const landT = (v - horizon) / (1 - horizon);
          const treeMass =
            (u < 0.28 || (u > 0.66 && u < 0.88)) && landT < 0.52 + (n2 - 0.5) * 0.25;
          const riverGleam =
            Math.abs(u - (0.46 + Math.sin(landT * 4.5) * 0.12)) < 0.08 + landT * 0.06 &&
            landT > 0.18 &&
            landT < 0.68;

          if (treeMass) {
            r = 46 + n2 * 38;
            g = 62 + n1 * 44;
            b = 36 + n2 * 24;
          } else if (riverGleam) {
            r = 166 + n1 * 42;
            g = 178 + n1 * 38;
            b = 176 + n1 * 36;
          } else {
            r = 98 + landT * 34 + (n1 - 0.5) * 44;
            g = 108 + landT * 18 + (n2 - 0.5) * 38;
            b = 58 + landT * 12 + (n1 - 0.5) * 24;
          }
        }
        // Subtle aged-varnish warmth & oil canvas weave
        const weave = ((x + y) & 1) * 3;
        const o = (y * w + x) * 4;
        data[o] = Math.max(0, Math.min(255, Math.round(r * 0.96 + 8 + weave)));
        data[o + 1] = Math.max(0, Math.min(255, Math.round(g * 0.93 + 5 + weave)));
        data[o + 2] = Math.max(0, Math.min(255, Math.round(b * 0.84 + weave)));
        data[o + 3] = 255;
      }
    }
    return makeRgbaDataTexture(data, w, h, 'catalog.constablePastoralOil', true);
  });
}

function getCurtisBotanicalPlateTexture(plateIdx: number): THREE.DataTexture {
  return getOrCreateCachedTexture(`catalog:art:curtis-botanical:${plateIdx}:v1`, () => {
    const w = 96;
    const h = 128;
    const data = new Uint8Array(w * h * 4);
    const petalPalette: readonly [number, number, number][] = [
      [182, 74, 82],
      [204, 152, 58],
      [104, 92, 156],
      [194, 108, 72],
    ];
    const [pr, pg, pb] = petalPalette[plateIdx % petalPalette.length]!;

    for (let y = 0; y < h; y++) {
      const v = y / h;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        // Cream wash-line mount border + inner engraving plate
        const inMount = u < 0.14 || u > 0.86 || v < 0.12 || v > 0.88;
        const isWashLine =
          !inMount &&
          (Math.abs(u - 0.16) < 0.008 ||
            Math.abs(u - 0.84) < 0.008 ||
            Math.abs(v - 0.14) < 0.007 ||
            Math.abs(v - 0.86) < 0.007);

        let r = 241;
        let g = 236;
        let b = 224;

        if (inMount) {
          r = 234;
          g = 228;
          b = 214;
        } else if (isWashLine) {
          r = 164;
          g = 158;
          b = 142;
        } else {
          // Botanical stem, leaves & blossom silhouette on antique laid rag paper
          const stemX = 0.5 + Math.sin(v * Math.PI * 1.6 + plateIdx) * 0.07;
          const distStem = Math.abs(u - stemX);
          const bloomDist = Math.hypot(u - (0.5 + ((plateIdx % 2) - 0.5) * 0.06), (v - 0.64) * 1.25);
          const leafL = Math.hypot((u - (stemX - 0.11)) * 1.4, (v - 0.42) * 2.2);
          const leafR = Math.hypot((u - (stemX + 0.11)) * 1.4, (v - 0.48) * 2.2);

          if (bloomDist < 0.13) {
            const shade = 0.78 + Math.cos(Math.atan2(v - 0.64, u - 0.5) * 5) * 0.22;
            r = pr * shade;
            g = pg * shade;
            b = pb * shade;
          } else if ((distStem < 0.014 && v > 0.2 && v < 0.66) || leafL < 0.11 || leafR < 0.11) {
            r = 68;
            g = 98;
            b = 62;
          }
        }

        const o = (y * w + x) * 4;
        data[o] = Math.max(0, Math.min(255, Math.round(r)));
        data[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
        data[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
        data[o + 3] = 255;
      }
    }
    return makeRgbaDataTexture(data, w, h, `catalog.curtisBotanical.${plateIdx + 1}`, true);
  });
}

/**
 * Reusable procedural PBR map bundle for **Roger Oates** Venetian ecru/indigo herringbone flatweave stair & hall runners
 * (can be applied directly to `createStaircase` runner materials or floor runners).
 */
export function createRogerOatesRunnerTextures(
  repeatY = 4
): PbrDataMapBundle {
  return getOrCreateCachedTexture(`catalog:rug:roger-oates:${repeatY}:v1`, () => {
    const w = 128;
    const h = 128;
    const color = new Uint8Array(w * h * 4);
    const height = new Float32Array(w * h);
    const rough = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
      const v = y / h;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        // Venetian flatweave border stripes: outer indigo selvedge, ecru pin, twin indigo tramlines, warm oatmeal herringbone center
        const edgeU = Math.min(u, 1 - u);
        const herring = Math.sin((v * 24 + (((Math.floor(u * 24) & 1) === 0 ? 1 : -1) * u * 24)) * Math.PI);
        const slub = (seamlessValueNoise2D(u, v, 16, 16, 8401) - 0.5) * 12;

        let r = 219;
        let g = 211;
        let b = 196;

        if (edgeU < 0.045 || (edgeU > 0.075 && edgeU < 0.115) || (edgeU > 0.14 && edgeU < 0.158)) {
          // Venetian Indigo stripe (#2C3E55)
          r = 46;
          g = 64;
          b = 88;
        } else if (edgeU >= 0.045 && edgeU <= 0.075) {
          // Warm ecru rib (#EAE3D3)
          r = 234;
          g = 227;
          b = 211;
        } else if (Math.abs(u - 0.5) < 0.014) {
          // Subtle central indigo pin-stripe
          r = 58;
          g = 76;
          b = 100;
        }

        const idx = y * w + x;
        const o = idx * 4;
        const delta = herring * 7 + slub;
        color[o] = Math.max(0, Math.min(255, Math.round(r + delta)));
        color[o + 1] = Math.max(0, Math.min(255, Math.round(g + delta)));
        color[o + 2] = Math.max(0, Math.min(255, Math.round(b + delta)));
        color[o + 3] = 255;
        height[idx] = 0.5 + herring * 0.18;
        rough[idx] = 0.89 - herring * 0.03;
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      w,
      h,
      2.2,
      'catalog.rogerOatesRunner',
      1,
      repeatY
    );
    return {
      colorMap: makeRgbaDataTexture(color, w, h, 'catalog.rogerOatesRunner.color', true, 1, repeatY),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

function getRugPbrMaps(kind: 'zieglerOushak' | 'coxPebbleWool' | 'coxBraidedJute'): PbrDataMapBundle {
  return getOrCreateCachedTexture(`catalog:rug:${kind}:v1`, () => {
    const size = 192;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = y * size + x;
        const o = idx * 4;

        if (kind === 'zieglerOushak') {
          // Antique faded madder terracotta, warm ivory & slate-indigo Oushak medallion + guard borders
          const du = Math.abs(u - 0.5) * 2;
          const dv = Math.abs(v - 0.5) * 2;
          const borderDist = Math.max(du, dv);
          const abrashed = (seamlessFbm2D(u, v, 5, 3, 8609) - 0.5) * 22;
          const knot = ((x ^ y) & 1) * 5;

          const floralMotif =
            Math.sin(u * Math.PI * 16) * Math.cos(v * Math.PI * 20) +
            Math.cos((u + v) * Math.PI * 12) * 0.5;
          const medDist = Math.hypot(du * 1.15, dv * 0.85);

          let r = 216;
          let g = 206;
          let b = 188; // Warm parchment ivory field

          if (borderDist > 0.74 && borderDist < 0.9) {
            // Wide faded madder border (#A96855) with indigo/sage palmettes
            if (floralMotif > 0.45) {
              r = 76;
              g = 91;
              b = 104;
            } else {
              r = 169;
              g = 106;
              b = 86;
            }
          } else if (borderDist >= 0.7 && borderDist <= 0.74) {
            // Slate indigo inner guard stripe
            r = 74;
            g = 88;
            b = 102;
          } else if (medDist < 0.34 && Math.abs(floralMotif) > 0.18) {
            // Central Oushak star medallion in soft madder & sage
            r = 164;
            g = 108;
            b = 90;
          } else if (floralMotif > 0.68) {
            // Scattered botanical vine motifs across ivory field
            r = 132;
            g = 136;
            b = 118;
          }

          color[o] = Math.max(0, Math.min(255, Math.round(r + abrashed + knot)));
          color[o + 1] = Math.max(0, Math.min(255, Math.round(g + abrashed * 0.9 + knot)));
          color[o + 2] = Math.max(0, Math.min(255, Math.round(b + abrashed * 0.8 + knot)));
          color[o + 3] = 255;
          height[idx] = 0.5 + ((x + y) % 2) * 0.1;
          rough[idx] = 0.91;
        } else if (kind === 'coxPebbleWool') {
          // Cox & Cox chunky woven oatmeal pebble-wool loop (#E3DDD0)
          const loopX = Math.sin(u * Math.PI * 48);
          const loopY = Math.sin((v * 32 + ((Math.floor(u * 24) & 1) * 0.5)) * Math.PI * 2);
          const pebble = Math.max(0, loopX * 0.5 + 0.5) * Math.max(0, loopY * 0.5 + 0.5);
          const fleck = (seamlessValueNoise2D(u, v, 24, 24, 8713) - 0.5) * 18;
          const d = (pebble - 0.35) * 24 + fleck;
          color[o] = Math.max(0, Math.min(255, Math.round(227 + d)));
          color[o + 1] = Math.max(0, Math.min(255, Math.round(221 + d)));
          color[o + 2] = Math.max(0, Math.min(255, Math.round(208 + d)));
          color[o + 3] = 255;
          height[idx] = 0.38 + pebble * 0.42;
          rough[idx] = 0.94 - pebble * 0.04;
        } else {
          // Cox & Cox braided golden jute w/ herringbone cotton border
          const du = Math.abs(u - 0.5) * 2;
          const dv = Math.abs(v - 0.5) * 2;
          const isCottonBorder = Math.max(du, dv) > 0.89;
          const braid = Math.sin((u * 36 + ((Math.floor(v * 36) & 1) * 0.5)) * Math.PI * 2);
          const fibre = (seamlessFbm2D(u, v, 12, 3, 8821) - 0.5) * 26;
          if (isCottonBorder) {
            color[o] = Math.max(0, Math.min(255, Math.round(212 + braid * 8)));
            color[o + 1] = Math.max(0, Math.min(255, Math.round(203 + braid * 8)));
            color[o + 2] = Math.max(0, Math.min(255, Math.round(184 + braid * 8)));
            color[o + 3] = 255;
            height[idx] = 0.52 + braid * 0.08;
            rough[idx] = 0.89;
          } else {
            const d = braid * 14 + fibre;
            color[o] = Math.max(0, Math.min(255, Math.round(186 + d)));
            color[o + 1] = Math.max(0, Math.min(255, Math.round(154 + d * 0.88)));
            color[o + 2] = Math.max(0, Math.min(255, Math.round(108 + d * 0.72)));
            color[o + 3] = 255;
            height[idx] = 0.45 + braid * 0.25;
            rough[idx] = 0.91;
          }
        }
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      2.4,
      `catalog.rug.${kind}`
    );
    return {
      colorMap: makeRgbaDataTexture(color, size, size, `catalog.rug.${kind}.color`, true),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

/**
 * Curated Regency & Cox & Cox Mirrors, English Pastoral & Botanical Framed Art, and Procedural PBR Rugs:
 * - Mirrors: `'regencyGiltOvermantel'` (`1280 x 75 x 840 mm` triple-plate w/ Corinthian half-columns & ball-beaded cornice),
 *   `'regencyGiltPierMirror'` (`760 x 65 x 1420 mm`), `'coxRoundBrass'` (`Ø800 mm`),
 *   `'coxArchedBrass'` (`800 x 1100` or `800 x 1800 mm`), `'scallopedBrass'` (`550 x 750 mm`)
 * - Art: `'constableLandscapeOil'` (`1070 x 55 x 770 mm`), `'curtisBotanicalGrid'` (`2x2` or `1x4` `340 x 440 mm` engravings)
 * - Rugs (`0` z-fight bevelled edges + fringe): `'zieglerOushak'`, `'coxPebbleWool'`, `'coxBraidedJute'`, `'rogerOatesRunnerSwatch'`.
 */

/**
 * Evaluates a Regency / George III bell-curved segmental arch top height y(x) for x in [-halfW, +halfW]:
 * flat shoulder blocks at outer jambs transitioning via an S-curve (swan-neck / bell inflection)
 * into a graceful segmental arch crown.
 */
function evalRegencyBellArchY(x: number, halfW: number, shoulderY: number, archRise: number): number {
  const u = Math.min(1, Math.abs(x) / Math.max(1e-4, halfW));
  if (u >= 0.92) {
    return shoulderY;
  }
  const t = u / 0.92;
  const cosBell = 0.5 * (1 + Math.cos(Math.PI * t));
  const segDome = Math.sqrt(Math.max(0, 1 - t * t * 0.82)) - Math.sqrt(0.18);
  const segNorm = segDome / (1 - Math.sqrt(0.18));
  return shoulderY + archRise * (0.58 * cosBell + 0.42 * segNorm);
}

/**
 * Sweeps a 2D moulding cross-section (offsetOut from inner sight line, zDepth from wall)
 * around a closed bell-arched overmantel sight aperture, producing a watertight sculpted giltwood frame.
 */
function buildSweptArchedMouldingGeometry(
  innerHalfW: number,
  baseInnerY: number,
  shoulderInnerY: number,
  archRise: number,
  profile: ReadonlyArray<readonly [number, number]>
): THREE.BufferGeometry {
  const pathPts: Array<{ x: number; y: number; nx: number; ny: number; miter: number }> = [];
  const rawPts: Array<readonly [number, number]> = [];

  rawPts.push([-innerHalfW, baseInnerY]);
  rawPts.push([innerHalfW, baseInnerY]);

  const jambSteps = 6;
  for (let j = 1; j <= jambSteps; j++) {
    rawPts.push([innerHalfW, baseInnerY + (j / jambSteps) * (shoulderInnerY - baseInnerY)]);
  }

  const archSteps = 44;
  for (let a = 1; a < archSteps; a++) {
    const x = innerHalfW - (a / archSteps) * (innerHalfW * 2);
    const y = evalRegencyBellArchY(x, innerHalfW, shoulderInnerY, archRise);
    rawPts.push([x, y]);
  }

  for (let j = 0; j < jambSteps; j++) {
    rawPts.push([-innerHalfW, shoulderInnerY - (j / jambSteps) * (shoulderInnerY - baseInnerY)]);
  }

  const N = rawPts.length;
  for (let i = 0; i < N; i++) {
    const prev = rawPts[(i - 1 + N) % N]!;
    const curr = rawPts[i]!;
    const next = rawPts[(i + 1) % N]!;

    let tx1 = curr[0] - prev[0];
    let ty1 = curr[1] - prev[1];
    const l1 = Math.hypot(tx1, ty1) || 1;
    tx1 /= l1;
    ty1 /= l1;

    let tx2 = next[0] - curr[0];
    let ty2 = next[1] - curr[1];
    const l2 = Math.hypot(tx2, ty2) || 1;
    tx2 /= l2;
    ty2 /= l2;

    const n1x = ty1;
    const n1y = -tx1;
    const n2x = ty2;
    const n2y = -tx2;

    let mx = n1x + n2x;
    let my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-4) {
      mx = n2x;
      my = n2y;
    } else {
      mx /= ml;
      my /= ml;
    }
    const dot = Math.max(0.45, mx * n2x + my * n2y);
    const miter = Math.min(1.65, 1 / dot);
    pathPts.push({ x: curr[0], y: curr[1], nx: mx, ny: my, miter });
  }

  const P = profile.length;
  const positions = new Float32Array(N * P * 3);
  const uvs = new Float32Array(N * P * 2);
  const indices: number[] = [];

  let arcLen = 0;
  for (let i = 0; i < N; i++) {
    const pt = pathPts[i]!;
    if (i > 0) {
      const prev = pathPts[i - 1]!;
      arcLen += Math.hypot(pt.x - prev.x, pt.y - prev.y);
    }
    for (let p = 0; p < P; p++) {
      const [outDist, zPos] = profile[p]!;
      const vi = i * P + p;
      positions[vi * 3] = pt.x + pt.nx * outDist * pt.miter;
      positions[vi * 3 + 1] = pt.y + pt.ny * outDist * pt.miter;
      positions[vi * 3 + 2] = zPos;
      uvs[vi * 2] = arcLen;
      uvs[vi * 2 + 1] = p / Math.max(1, P - 1);
    }
  }

  for (let i = 0; i < N; i++) {
    const iNext = (i + 1) % N;
    for (let p = 0; p < P - 1; p++) {
      const pNext = p + 1;
      const a = i * P + p;
      const b = iNext * P + p;
      const c = iNext * P + pNext;
      const d = i * P + pNext;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

function buildArchedPlateShape(
  halfW: number,
  baseY: number,
  shoulderY: number,
  archRise: number
): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, baseY);
  shape.lineTo(halfW, baseY);
  shape.lineTo(halfW, shoulderY);
  const steps = 44;
  for (let a = 1; a <= steps; a++) {
    const x = halfW - (a / steps) * (halfW * 2);
    const y = evalRegencyBellArchY(x, halfW, shoulderY, archRise);
    shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

export function buildCuratedMirrorsArtAndRugs(
  opts: CuratedMirrorsArtAndRugsOptions = {}
): THREE.Group {
  const kind = opts.kind ?? 'regencyGiltOvermantel';
  const namePrefix = opts.name ?? `curated_${kind}`;

  const giltMat = getRegencyGiltwoodMaterial();
  const brassMat = getAgedBrassMaterial();
  const darkEbonisedMat = getPaintedJoineryMaterial(0x232220, 0.36, `${namePrefix}.ebonised`);
  const mirrorMat = getSilveredMirrorPlateMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  if (kind === 'regencyGiltOvermantel') {
    const w = opts.widthM ?? 1.28;
    const h = opts.heightM ?? 1.06;
    const frameW = 0.068;
    const earOut = 0.044;
    const crestReserve = 0.095;

    // Warm burnished water-gilt highlight material for pearl beads, acanthus ears & foliate cresting
    const burnishedGiltMat = new THREE.MeshStandardMaterial({
      name: `${namePrefix}.burnishedWaterGilt`,
      color: 0xd9b35c,
      roughness: 0.22,
      metalness: 0.82,
    });
    const bevelMirrorMat = new THREE.MeshPhysicalMaterial({
      name: `${namePrefix}.bevelMirrorEdge`,
      color: 0xdde5ea,
      roughness: 0.045,
      metalness: 0.94,
      clearcoat: 0.7,
      clearcoatRoughness: 0.04,
    });

    const bodyHalfW = w * 0.5 - earOut;
    const innerHalfW = Math.max(0.28, bodyHalfW - frameW);
    const baseInnerY = 0.064;
    const crownInnerTopY = h - crestReserve - frameW;
    const archRise = Math.min(0.22, Math.max(0.13, (crownInnerTopY - baseInnerY) * 0.24));
    const shoulderInnerY = crownInnerTopY - archRise;

    // Ebonised pine backboard fitted behind the glass (z = 0.001..0.011)
    const backShape = buildArchedPlateShape(
      innerHalfW + 0.018,
      baseInnerY - 0.016,
      shoulderInnerY + 0.008,
      archRise + 0.01
    );
    const backMesh = new THREE.Mesh(
      prepGeo(new THREE.ExtrudeGeometry(backShape, { depth: 0.01, bevelEnabled: false, curveSegments: 24 })),
      darkEbonisedMat
    );
    backMesh.name = `${namePrefix}.archedBackboard`;
    backMesh.position.z = 0.001;
    root.add(backMesh);

    // Bevelled outer mirror border (z = 0.0125..0.017) + crisp inner flat silvered mirror plate (z = 0.0175..0.0205)
    const outerGlassShape = buildArchedPlateShape(innerHalfW + 0.003, baseInnerY - 0.002, shoulderInnerY, archRise);
    const bevelGlassMesh = new THREE.Mesh(
      prepGeo(
        new THREE.ExtrudeGeometry(outerGlassShape, {
          depth: 0.004,
          bevelEnabled: true,
          bevelThickness: 0.0015,
          bevelSize: 0.002,
          bevelSegments: 2,
          curveSegments: 24,
        })
      ),
      bevelMirrorMat
    );
    bevelGlassMesh.name = `${namePrefix}.bevelledMirrorBorder`;
    bevelGlassMesh.position.z = 0.0125;
    root.add(bevelGlassMesh);

    const bevelMargin = 0.028;
    const flatGlassShape = buildArchedPlateShape(
      innerHalfW - bevelMargin,
      baseInnerY + bevelMargin,
      shoulderInnerY - bevelMargin * 0.65,
      Math.max(0.08, archRise - bevelMargin * 0.35)
    );
    const centerGlassMesh = new THREE.Mesh(
      prepGeo(new THREE.ExtrudeGeometry(flatGlassShape, { depth: 0.003, bevelEnabled: false, curveSegments: 24 })),
      mirrorMat
    );
    centerGlassMesh.name = `${namePrefix}.silveredMirrorPlate`;
    centerGlassMesh.position.z = 0.0175;
    root.add(centerGlassMesh);

    // Swept George III / Regency bell-arched ogee + hollow-cove moulded giltwood frame
    const ogeeCoveProfile: ReadonlyArray<readonly [number, number]> = [
      [-0.002, 0.0205],
      [0.0, 0.028],
      [0.010, 0.029],
      [0.015, 0.023],
      [0.026, 0.026],
      [0.038, 0.044],
      [0.048, 0.056],
      [0.058, 0.048],
      [0.068, 0.030],
      [0.070, 0.003],
      [-0.002, 0.003],
      [-0.002, 0.0205],
    ];
    const sweptFrameMesh = new THREE.Mesh(
      buildSweptArchedMouldingGeometry(innerHalfW, baseInnerY, shoulderInnerY, archRise, ogeeCoveProfile),
      giltMat
    );
    sweptFrameMesh.name = `${namePrefix}.sweptOgeeCoveFrame`;
    sweptFrameMesh.castShadow = true;
    sweptFrameMesh.receiveShadow = true;
    root.add(sweptFrameMesh);

    // Burnished outer astragal highlight rib swept along the crest of the ogee frame
    const highlightRibProfile: ReadonlyArray<readonly [number, number]> = [
      [0.044, 0.0545],
      [0.048, 0.0585],
      [0.052, 0.0545],
      [0.048, 0.0525],
      [0.044, 0.0545],
    ];
    const highlightRibMesh = new THREE.Mesh(
      buildSweptArchedMouldingGeometry(innerHalfW, baseInnerY, shoulderInnerY, archRise, highlightRibProfile),
      burnishedGiltMat
    );
    highlightRibMesh.name = `${namePrefix}.burnishedAstragalHighlight`;
    highlightRibMesh.castShadow = true;
    root.add(highlightRibMesh);

    // Delicate inner pearl/beaded sight-edge fillet along jambs, base & bell-curved arch
    const beadR = 0.0046;
    const beadZ = 0.0295;
    const beadGeo = sharedSphereGeometry(beadR, 8, 6);
    let beadIdx = 0;
    const addPearl = (px: number, py: number) => {
      beadIdx++;
      const b = new THREE.Mesh(beadGeo, burnishedGiltMat);
      b.name = `${namePrefix}.sightPearlBead_${beadIdx}`;
      b.position.set(px, py, beadZ);
      tagHighLod(b);
      root.add(b);
    };

    const beadInset = -0.005;
    const bHalfW = innerHalfW - beadInset;
    const bBaseY = baseInnerY + beadInset;
    const bShoulderY = shoulderInnerY;
    const nBotBeads = Math.max(18, Math.round((bHalfW * 2) / 0.022));
    for (let i = 0; i <= nBotBeads; i++) {
      addPearl(-bHalfW + (i / nBotBeads) * (bHalfW * 2), bBaseY);
    }
    const nSideBeads = Math.max(12, Math.round((bShoulderY - bBaseY) / 0.022));
    for (let i = 1; i < nSideBeads; i++) {
      const py = bBaseY + (i / nSideBeads) * (bShoulderY - bBaseY);
      addPearl(-bHalfW, py);
      addPearl(bHalfW, py);
    }
    const nArchBeads = Math.max(28, Math.round((bHalfW * 2.35) / 0.022));
    for (let i = 0; i <= nArchBeads; i++) {
      const px = -bHalfW + (i / nArchBeads) * (bHalfW * 2);
      const py = evalRegencyBellArchY(px, innerHalfW, shoulderInnerY, archRise) - beadInset;
      addPearl(px, py);
    }

    // Carved acanthus scroll ears & turned rosettes at base corners
    const latheScrollPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.018, 0.003),
      new THREE.Vector2(0.026, 0.011),
      new THREE.Vector2(0.021, 0.019),
      new THREE.Vector2(0.011, 0.024),
      new THREE.Vector2(0.0, 0.026),
    ];
    const rosetteGeo = prepGeo(new THREE.LatheGeometry(latheScrollPts, 18));

    for (const [sTag, sign] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      const earBaseX = sign * (innerHalfW + frameW - 0.006);
      const earVolute = new THREE.Mesh(
        sharedTorusGeometry(0.036, 0.011, 10, 22, Math.PI * 1.35),
        burnishedGiltMat
      );
      earVolute.name = `${namePrefix}.acanthusScrollEar${sTag}`;
      earVolute.position.set(earBaseX + sign * 0.012, 0.048, 0.032);
      earVolute.rotation.z = sign > 0 ? -Math.PI * 0.25 : -Math.PI * 0.75;
      earVolute.castShadow = true;
      root.add(earVolute);

      const rosette = new THREE.Mesh(rosetteGeo, burnishedGiltMat);
      rosette.name = `${namePrefix}.acanthusEarRosette${sTag}`;
      rosette.rotation.x = Math.PI * 0.5;
      rosette.position.set(earBaseX + sign * 0.016, 0.038, 0.032);
      rosette.castShadow = true;
      root.add(rosette);

      const leafPlume = new THREE.Mesh(sharedSphereGeometry(0.016, 12, 10), giltMat);
      leafPlume.name = `${namePrefix}.acanthusStileLeaf${sTag}`;
      leafPlume.scale.set(0.75, 2.4, 0.72);
      leafPlume.rotation.z = -sign * 0.22;
      leafPlume.position.set(earBaseX + sign * 0.008, 0.098, 0.033);
      root.add(leafPlume);

      const shoulderClasp = new THREE.Mesh(rosetteGeo, burnishedGiltMat);
      shoulderClasp.name = `${namePrefix}.shoulderRosette${sTag}`;
      shoulderClasp.rotation.x = Math.PI * 0.5;
      shoulderClasp.scale.setScalar(0.78);
      shoulderClasp.position.set(sign * (innerHalfW + frameW * 0.62), shoulderInnerY + 0.018, 0.038);
      tagHighLod(shoulderClasp);
      root.add(shoulderClasp);
    }

    // Central George III / Regency carved acanthus & shell foliate cresting at the apex
    const apexOuterY = crownInnerTopY + frameW;
    const cartouche = new THREE.Mesh(rosetteGeo, burnishedGiltMat);
    cartouche.name = `${namePrefix}.crestCartouche`;
    cartouche.rotation.x = Math.PI * 0.5;
    cartouche.scale.set(1.35, 1.0, 1.55);
    cartouche.position.set(0, apexOuterY + 0.012, 0.036);
    cartouche.castShadow = true;
    root.add(cartouche);

    const centralFinial = new THREE.Mesh(sharedSphereGeometry(0.018, 12, 10), burnishedGiltMat);
    centralFinial.name = `${namePrefix}.crestCentralAcorn`;
    centralFinial.scale.set(0.85, 1.95, 0.75);
    centralFinial.position.set(0, apexOuterY + 0.048, 0.038);
    centralFinial.castShadow = true;
    root.add(centralFinial);

    for (const [sTag, sign] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      const crestScroll = new THREE.Mesh(
        sharedTorusGeometry(0.048, 0.0095, 10, 22, Math.PI * 1.15),
        burnishedGiltMat
      );
      crestScroll.name = `${namePrefix}.crestAcanthusScroll${sTag}`;
      crestScroll.position.set(sign * 0.056, apexOuterY + 0.004, 0.035);
      crestScroll.rotation.z = sign > 0 ? Math.PI * 0.12 : -Math.PI * 1.12;
      crestScroll.castShadow = true;
      root.add(crestScroll);

      const trailingLeaf = new THREE.Mesh(sharedSphereGeometry(0.013, 10, 8), giltMat);
      trailingLeaf.name = `${namePrefix}.crestTrailingLeaf${sTag}`;
      trailingLeaf.scale.set(2.3, 0.65, 0.65);
      trailingLeaf.rotation.z = -sign * 0.28;
      trailingLeaf.position.set(sign * 0.125, apexOuterY - 0.012, 0.035);
      tagHighLod(trailingLeaf);
      root.add(trailingLeaf);
    }
  } else if (kind === 'regencyGiltPierMirror') {
    const w = opts.widthM ?? 0.76;
    const h = opts.heightM ?? 1.42;
    const d = 0.065;
    const frameW = 0.055;

    addNamedBox(root, `${namePrefix}.backing`, w - frameW * 2 - 0.004, h - 0.204, 0.012, 0, 0.06 + (h - 0.2) * 0.5, 0.006, darkEbonisedMat);
    addNamedBox(root, `${namePrefix}.mirrorPlate`, w - frameW * 2, h - 0.2, 0.006, 0, 0.06 + (h - 0.2) * 0.5, 0.016, mirrorMat);
    for (const [sSide, sx] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      addNamedCyl(root, `${namePrefix}.reededPilaster${sSide}`, 0.022, 0.024, h - 0.12, 16, sx * (w * 0.5 - frameW * 0.5), (h - 0.12) * 0.5 + 0.03, 0.026, giltMat);
    }
    addNamedBox(root, `${namePrefix}.baseRail`, w, 0.055, 0.044, 0, 0.0275, 0.022, giltMat);
    addNamedBox(root, `${namePrefix}.topFrieze`, w - 0.02, 0.08, 0.042, 0, h - 0.099, 0.021, giltMat);
    addNamedBox(root, `${namePrefix}.corniceCap`, w + 0.04, 0.058, d, 0, h - 0.029, d * 0.5, giltMat);
  } else if (kind === 'coxRoundBrass') {
    const rad = (opts.widthM ?? 0.8) * 0.5;
    const backDisc = addNamedCyl(root, `${namePrefix}.backingDisc`, rad - 0.008, rad - 0.008, 0.01, 36, 0, rad, 0.005, darkEbonisedMat);
    backDisc.rotation.x = Math.PI * 0.5;
    const glassDisc = addNamedCyl(root, `${namePrefix}.mirrorGlass`, rad - 0.014, rad - 0.014, 0.005, 36, 0, rad, 0.014, mirrorMat);
    glassDisc.rotation.x = Math.PI * 0.5;
    const brassRim = new THREE.Mesh(sharedTorusGeometry(rad - 0.006, 0.012, 12, 40), brassMat);
    brassRim.name = `${namePrefix}.agedBrassRim`;
    brassRim.position.set(0, rad, 0.016);
    root.add(brassRim);
  } else if (kind === 'coxArchedBrass') {
    const w = opts.widthM ?? 0.8;
    const h = opts.heightM ?? 1.1;
    const r = w * 0.5;
    const rectH = Math.max(0.25, h - r);

    const br = r - 0.003;
    const archShape = new THREE.Shape();
    archShape.moveTo(-br, 0.003);
    archShape.lineTo(br, 0.003);
    archShape.lineTo(br, rectH);
    archShape.absarc(0, rectH, br, 0, Math.PI, false);
    archShape.closePath();

    const backGeo = new THREE.ExtrudeGeometry(archShape, { depth: 0.012, bevelEnabled: false, curveSegments: 24 });
    const backMesh = new THREE.Mesh(backGeo, darkEbonisedMat);
    backMesh.name = `${namePrefix}.archedBacking`;
    root.add(backMesh);

    const innerShape = new THREE.Shape();
    const ir = r - 0.018;
    innerShape.moveTo(-ir, 0.018);
    innerShape.lineTo(ir, 0.018);
    innerShape.lineTo(ir, rectH);
    innerShape.absarc(0, rectH, ir, 0, Math.PI, false);
    innerShape.closePath();
    const mirrorGeo = new THREE.ExtrudeGeometry(innerShape, { depth: 0.005, bevelEnabled: false, curveSegments: 24 });
    const mirrorMesh = new THREE.Mesh(mirrorGeo, mirrorMat);
    mirrorMesh.name = `${namePrefix}.archedMirrorGlass`;
    mirrorMesh.position.z = 0.013;
    root.add(mirrorMesh);

    // Slim Cox & Cox Aged Brass perimeter frame (`0` overlap with glass)
    for (const [sTag, sx] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      addNamedBox(root, `${namePrefix}.brassSideRim${sTag}`, 0.018, rectH, 0.026, sx * (r - 0.009), rectH * 0.5, 0.014, brassMat);
    }
    addNamedBox(root, `${namePrefix}.brassBottomRim`, w - 0.036, 0.018, 0.026, 0, 0.009, 0.014, brassMat);
    const archRim = new THREE.Mesh(sharedTorusGeometry(r - 0.009, 0.011, 10, 32, Math.PI), brassMat);
    archRim.name = `${namePrefix}.brassArchRim`;
    archRim.position.set(0, rectH, 0.016);
    root.add(archRim);
  } else if (kind === 'scallopedBrass') {
    const w = opts.widthM ?? 0.55;
    const h = opts.heightM ?? 0.75;
    addNamedBox(root, `${namePrefix}.backing`, w - 0.04, h - 0.04, 0.01, 0, h * 0.5, 0.005, darkEbonisedMat);
    addNamedBox(root, `${namePrefix}.mirrorPlate`, w - 0.06, h - 0.06, 0.005, 0, h * 0.5, 0.014, mirrorMat);
    // Scalloped wave aged-brass lobes around the perimeter
    const lobesX = 5;
    const lobesY = 7;
    for (let i = 0; i < lobesX; i++) {
      const lx = -(w * 0.5 - 0.06) + (i / (lobesX - 1)) * (w - 0.12);
      for (const [eTag, ey, rotZ] of [
        ['Top', h - 0.03, 0],
        ['Bot', 0.03, Math.PI],
      ] as const) {
        const lobe = new THREE.Mesh(sharedTorusGeometry(0.042, 0.008, 8, 14, Math.PI), brassMat);
        lobe.name = `${namePrefix}.scallop${eTag}_${i + 1}`;
        lobe.rotation.z = rotZ;
        lobe.position.set(lx, ey, 0.017);
        tagHighLod(lobe);
        root.add(lobe);
      }
    }
    for (let j = 0; j < lobesY; j++) {
      const ly = 0.06 + (j / (lobesY - 1)) * (h - 0.12);
      for (const [sTag, sx, rotZ] of [
        ['Left', 0.03 - w * 0.5, Math.PI * 0.5],
        ['Right', w * 0.5 - 0.03, -Math.PI * 0.5],
      ] as const) {
        const lobe = new THREE.Mesh(sharedTorusGeometry(0.042, 0.008, 8, 14, Math.PI), brassMat);
        lobe.name = `${namePrefix}.scallop${sTag}_${j + 1}`;
        lobe.rotation.z = rotZ;
        lobe.position.set(sx, ly, 0.017);
        tagHighLod(lobe);
        root.add(lobe);
      }
    }
  } else if (kind === 'constableLandscapeOil') {
    // 1070 x 55 x 770 mm procedural English pastoral oil painting in swept giltwood Hogarth frame
    const w = opts.widthM ?? 1.07;
    const h = opts.heightM ?? 0.77;
    const d = 0.055;
    const frameW = 0.078;

    const canvasMat = new THREE.MeshStandardMaterial({
      name: `${namePrefix}.oilCanvas`,
      map: getConstablePastoralCanvasTexture(),
      roughness: 0.58,
      metalness: 0.02,
    });
    const innerW = w - frameW * 2;
    const innerH = h - frameW * 2;
    addNamedBox(root, `${namePrefix}.stretcherBacking`, innerW - 0.002, innerH - 0.002, 0.016, 0, h * 0.5, 0.008, darkEbonisedMat);
    addNamedBox(root, `${namePrefix}.pastoralOilCanvas`, innerW, innerH, 0.006, 0, h * 0.5, 0.02, canvasMat);

    // Swept giltwood Hogarth frame (4 non-overlapping rails + corner cartouches)
    addNamedBox(root, `${namePrefix}.giltFrameTop`, w, frameW, d, 0, h - frameW * 0.5, d * 0.5, giltMat);
    addNamedBox(root, `${namePrefix}.giltFrameBottom`, w, frameW, d, 0, frameW * 0.5, d * 0.5, giltMat);
    addNamedBox(root, `${namePrefix}.giltFrameLeft`, frameW, innerH, d, -(w * 0.5 - frameW * 0.5), h * 0.5, d * 0.5, giltMat);
    addNamedBox(root, `${namePrefix}.giltFrameRight`, frameW, innerH, d, w * 0.5 - frameW * 0.5, h * 0.5, d * 0.5, giltMat);

    // Aged Brass gallery picture light / nameplate plaque on bottom rail
    addNamedBox(root, `${namePrefix}.artistPlaque`, 0.14, 0.022, 0.004, 0, frameW * 0.5, d + 0.003, brassMat, true);
  } else if (kind === 'curtisBotanicalGrid') {
    // 2x2 or 1x4 grid of 340 x 440 mm William Curtis antique botanical engravings w/ wash-line mounts & ebonised/gilt frames
    const layout = opts.botanicalLayout ?? '2x2';
    const frameW = 0.34;
    const frameH = 0.44;
    const gap = 0.065;
    const cols = layout === '1x4' ? 4 : 2;
    const rows = layout === '1x4' ? 1 : 2;

    let plateIdx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = (c - (cols - 1) * 0.5) * (frameW + gap);
        const cy = (r + 0.5) * (frameH + gap) - gap * 0.5;
        const fg = new THREE.Group();
        fg.name = `${namePrefix}.plate_${plateIdx + 1}`;
        fg.position.set(cx, cy, 0);
        root.add(fg);

        const rimW = 0.022;
        const innerW = frameW - rimW * 2;
        const innerH = frameH - rimW * 2;
        const printMat = new THREE.MeshStandardMaterial({
          name: `${fg.name}.botanicalPrint`,
          map: getCurtisBotanicalPlateTexture(plateIdx),
          roughness: 0.78,
        });

        addNamedBox(fg, `${fg.name}.backing`, innerW - 0.002, innerH - 0.002, 0.008, 0, 0, 0.004, darkEbonisedMat, true);
        addNamedBox(fg, `${fg.name}.engravingSheet`, innerW, innerH, 0.003, 0, 0, 0.01, printMat);
        addNamedBox(fg, `${fg.name}.glazing`, innerW, innerH, 0.002, 0, 0, 0.015, glassMat, true);

        // Ebonised Hogarth outer frame + inner gilt sight-edge slip
        addNamedBox(fg, `${fg.name}.frameTop`, frameW, rimW, 0.024, 0, frameH * 0.5 - rimW * 0.5, 0.012, darkEbonisedMat, true);
        addNamedBox(fg, `${fg.name}.frameBottom`, frameW, rimW, 0.024, 0, -(frameH * 0.5 - rimW * 0.5), 0.012, darkEbonisedMat, true);
        addNamedBox(fg, `${fg.name}.frameLeft`, rimW, innerH, 0.024, -(frameW * 0.5 - rimW * 0.5), 0, 0.012, darkEbonisedMat, true);
        addNamedBox(fg, `${fg.name}.frameRight`, rimW, innerH, 0.024, frameW * 0.5 - rimW * 0.5, 0, 0.012, darkEbonisedMat, true);

        plateIdx++;
      }
    }
  } else {
    // Procedural PBR Rugs (`zieglerOushak`, `coxPebbleWool`, `coxBraidedJute`, `rogerOatesRunnerSwatch`)
    const isRunner = kind === 'rogerOatesRunnerSwatch';
    const rugW = opts.widthM ?? (isRunner ? 0.72 : 2.0);
    const rugL = opts.lengthM ?? (isRunner ? 2.8 : 2.9);
    const pileH = kind === 'coxPebbleWool' ? 0.014 : 0.009;

    const maps = isRunner
      ? createRogerOatesRunnerTextures(Math.max(2, Math.round(rugL * 1.6)))
      : getRugPbrMaps(kind);

    const rugMat = new THREE.MeshStandardMaterial({
      name: `${namePrefix}.rugMat`,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: maps.roughnessMap,
      roughness: 0.92,
      metalness: 0.0,
    });

    // Bevelled ExtrudeGeometry rug pad sitting cleanly at `y = 0.001` so zero z-fighting with floor!
    const hw = rugW * 0.5;
    const hl = rugL * 0.5;
    const rugShape = new THREE.Shape();
    rugShape.moveTo(-hw, -hl);
    rugShape.lineTo(hw, -hl);
    rugShape.lineTo(hw, hl);
    rugShape.lineTo(-hw, hl);
    rugShape.closePath();
    const rugGeo = new THREE.ExtrudeGeometry(rugShape, {
      depth: pileH,
      bevelEnabled: true,
      bevelThickness: 0.0025,
      bevelSize: 0.004,
      bevelSegments: 2,
    });
    rugGeo.rotateX(Math.PI * 0.5);
    // Normalize UVs to [0..1] across [-hw..hw] x [-hl..hl] so border patterns frame the rug edges accurately!
    const posAttr = rugGeo.getAttribute('position');
    const uvAttr = rugGeo.getAttribute('uv');
    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const pz = posAttr.getZ(i);
      uvAttr.setXY(
        i,
        Math.max(0, Math.min(1, (px + hw) / rugW)),
        Math.max(0, Math.min(1, (pz + hl) / rugL))
      );
    }
    uvAttr.needsUpdate = true;
    rugGeo.computeVertexNormals();

    const rugMesh = new THREE.Mesh(rugGeo, rugMat);
    rugMesh.name = `${namePrefix}.wovenPileBody`;
    rugMesh.position.set(0, pileH + 0.003, 0);
    rugMesh.castShadow = false;
    rugMesh.receiveShadow = true;
    root.add(rugMesh);

    // Knotted cotton end fringes on Ziegler Oushak & Pebble Wool rugs (strictly outside `±hl`, zero overlap!)
    if (kind === 'zieglerOushak' || kind === 'coxPebbleWool') {
      const fringeMat = getPaintedJoineryMaterial(0xe8e0cf, 0.9, `${namePrefix}.cottonFringe`);
      const fringeLen = 0.036;
      for (const [eTag, sign] of [
        ['North', -1],
        ['South', 1],
      ] as const) {
        const fMesh = addNamedBox(
          root,
          `${namePrefix}.cottonFringe${eTag}`,
          rugW - 0.012,
          0.003,
          fringeLen,
          0,
          0.0025,
          sign * (hl + fringeLen * 0.5 + 0.005),
          fringeMat,
          true
        );
        fMesh.castShadow = false;
      }
    }
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: `Georgian Curated Mirror, Botanical Art & Rug (${kind})`,
    brand: 'okadirect & Roger Oates',
    collection: 'Heritage Mirrors & Flatweave Runners',
    sku: `CUR-${kind.toUpperCase()}`,
    finish: 'Water-Gilded Regency Leaf / Hand-Knotted Wool',
    category: 'decor',
    productUrl: 'https://www.rogeroates.com/runners-rugs/',
    schematicUrl: 'https://www.rogeroates.com/technical/flatweave-specification.pdf',
  });
}

export type WhiteCompanyAccessoryKind =
  | 'kubuLaundryHamper'
  | 'kubuStorageBasket'
  | 'glassHurricane'
  | 'reedDiffuser';

export interface WhiteCompanyAccessoriesOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly kind?: WhiteCompanyAccessoryKind;
  readonly scent?: 'seychelles' | 'firTree';
}

/**
 * **The White Company** home & bathroom accessories:
 * - `'kubuLaundryHamper'` (`460 x 360 x 620 mm` woven grey-brown Kubu rattan hamper w/ removable piped white cotton-linen liner & lid)
 * - `'kubuStorageBasket'` (`380 x 420 x 280 mm` woven Kubu rattan open basket)
 * - `'glassHurricane'` (`180 x 180 x 320 mm` Aged Brass & glass hurricane lantern w/ glowing 2200K pillar candle)
 * - `'reedDiffuser'` (*Seychelles* / *Fir Tree* `Ø78 x 260 mm` apothecary glass bottle + natural rattan reeds + stoneware tray).
 */
export function buildWhiteCompanyAccessories(
  opts: WhiteCompanyAccessoriesOptions = {}
): THREE.Group {
  const kind = opts.kind ?? 'kubuLaundryHamper';
  const namePrefix = opts.name ?? `whiteCompany_${kind}`;

  const kubuMaps = getWovenFabricMaps('whiteco-kubu', 0x9b856b, 'kubu');
  const kubuMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.kubuRattan`,
    map: kubuMaps.colorMap,
    normalMap: kubuMaps.normalMap,
    roughnessMap: kubuMaps.roughnessMap,
    roughness: 0.85,
  });
  const linerMaps = getWovenFabricMaps('whiteco-liner', 0xf3efe6, 'linen');
  const linerMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.cottonLinenLiner`,
    map: linerMaps.colorMap,
    normalMap: linerMaps.normalMap,
    roughness: 0.86,
  });
  const brassMat = getAgedBrassMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const flameMat = getCandle2200kFilamentMaterial();
  const oakMat = getCharacterOakMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  if (kind === 'kubuLaundryHamper') {
    const w = 0.46;
    const d = 0.36;
    const h = 0.62;
    const lidH = 0.036;
    const linerFoldH = 0.048;
    const bodyH = h - lidH - linerFoldH;

    addNamedBox(root, `${namePrefix}.kubuBody`, w, bodyH, d, 0, bodyH * 0.5, 0, kubuMat);
    // Piped white cotton-linen fold-over liner collar strictly above kubuBody (`y = bodyH .. bodyH + linerFoldH`)
    addNamedBox(
      root,
      `${namePrefix}.cottonLinerFoldOver`,
      w + 0.014,
      linerFoldH,
      d + 0.014,
      0,
      bodyH + linerFoldH * 0.5,
      0,
      linerMat
    );
    // Woven Kubu rattan lid resting cleanly above liner (`y = h - lidH .. h`) + leather/linen pull loop
    addNamedBox(
      root,
      `${namePrefix}.kubuLid`,
      w + 0.012,
      lidH,
      d + 0.012,
      0,
      h - lidH * 0.5,
      0,
      kubuMat
    );
    addNamedBox(
      root,
      `${namePrefix}.lidLeatherTab`,
      0.048,
      0.008,
      0.034,
      0,
      h + 0.004,
      d * 0.5 - 0.02,
      oakMat,
      true
    );
  } else if (kind === 'kubuStorageBasket') {
    const w = 0.38;
    const d = 0.42;
    const h = 0.28;
    const wallT = 0.022;
    // Hollow woven Kubu storage basket (4 disjoint walls + floor)
    addNamedBox(root, `${namePrefix}.basketBase`, w, 0.02, d, 0, 0.01, 0, kubuMat);
    addNamedBox(root, `${namePrefix}.wallFront`, w, h - 0.02, wallT, 0, 0.02 + (h - 0.02) * 0.5, d * 0.5 - wallT * 0.5, kubuMat);
    addNamedBox(root, `${namePrefix}.wallBack`, w, h - 0.02, wallT, 0, 0.02 + (h - 0.02) * 0.5, -(d * 0.5 - wallT * 0.5), kubuMat);
    addNamedBox(root, `${namePrefix}.wallLeft`, wallT, h - 0.02, d - wallT * 2, -(w * 0.5 - wallT * 0.5), 0.02 + (h - 0.02) * 0.5, 0, kubuMat);
    addNamedBox(root, `${namePrefix}.wallRight`, wallT, h - 0.02, d - wallT * 2, w * 0.5 - wallT * 0.5, 0.02 + (h - 0.02) * 0.5, 0, kubuMat);
  } else if (kind === 'glassHurricane') {
    const w = 0.18;
    const h = 0.32;
    const postS = 0.009;
    const bodyH = h - 0.024;
    const waxMat = getPaintedJoineryMaterial(0xf6f2e8, 0.64, `${namePrefix}.wax`);

    addNamedBox(root, `${namePrefix}.brassBase`, w, 0.012, w, 0, 0.006, 0, brassMat, true);
    for (const [pTag, sx, sz] of [
      ['FL', -1, 1],
      ['FR', 1, 1],
      ['BL', -1, -1],
      ['BR', 1, -1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.brassPost_${pTag}`,
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
    addNamedBox(root, `${namePrefix}.topRimL`, postS, 0.012, w, -(w * 0.5 - postS * 0.5), h - 0.006, 0, brassMat, true);
    addNamedBox(root, `${namePrefix}.topRimR`, postS, 0.012, w, w * 0.5 - postS * 0.5, h - 0.006, 0, brassMat, true);
    addNamedBox(root, `${namePrefix}.topRimF`, w - postS * 2, 0.012, postS, 0, h - 0.006, w * 0.5 - postS * 0.5, brassMat, true);
    addNamedBox(root, `${namePrefix}.topRimB`, w - postS * 2, 0.012, postS, 0, h - 0.006, -(w * 0.5 - postS * 0.5), brassMat, true);

    const paneW = w - postS * 2 - 0.002;
    addNamedBox(root, `${namePrefix}.glassF`, paneW, bodyH - 0.004, 0.003, 0, 0.012 + bodyH * 0.5, w * 0.5 - postS * 0.5, glassMat, true);
    addNamedBox(root, `${namePrefix}.glassB`, paneW, bodyH - 0.004, 0.003, 0, 0.012 + bodyH * 0.5, -(w * 0.5 - postS * 0.5), glassMat, true);
    addNamedBox(root, `${namePrefix}.glassL`, 0.003, bodyH - 0.004, paneW, -(w * 0.5 - postS * 0.5), 0.012 + bodyH * 0.5, 0, glassMat, true);
    addNamedBox(root, `${namePrefix}.glassR`, 0.003, bodyH - 0.004, paneW, w * 0.5 - postS * 0.5, 0.012 + bodyH * 0.5, 0, glassMat, true);

    addNamedCyl(root, `${namePrefix}.pillarCandle`, 0.038, 0.038, 0.145, 14, 0, 0.013 + 0.0725, 0, waxMat, true);
    const fl = new THREE.Mesh(sharedSphereGeometry(0.008, 8, 8), flameMat);
    fl.name = `${namePrefix}.candleFlame`;
    fl.scale.set(0.7, 1.9, 0.7);
    fl.position.set(0, 0.172, 0);
    tagHighLod(fl);
    root.add(fl);
  } else {
    // 'reedDiffuser': White Company *Seychelles* / *Fir Tree* Ø78 x 260 mm apothecary glass bottle + rattan reeds + ceramic tray
    const isFirTree = (opts.scent ?? 'seychelles') === 'firTree';
    const ceramicMat = getPaintedJoineryMaterial(0xefece4, 0.38, `${namePrefix}.ceramicTray`);
    const oilMat = new THREE.MeshPhysicalMaterial({
      name: `${namePrefix}.fragranceOil`,
      color: isFirTree ? 0xc8b98b : 0xefe7cf,
      roughness: 0.08,
      transmission: 0,
      transparent: true,
      opacity: 0.72,
    });
    const labelMat = getPaintedJoineryMaterial(isFirTree ? 0x2c3a2f : 0xf7f5ef, 0.6, `${namePrefix}.label`);

    // Ceramic coaster tray (`Ø145 x 14 mm`)
    addNamedCyl(root, `${namePrefix}.ceramicTray`, 0.072, 0.068, 0.014, 22, 0, 0.007, 0, ceramicMat, true);

    // Apothecary glass bottle (`Ø78 x 115 mm`) + fragrance oil + silver/brass neck collar
    addNamedCyl(root, `${namePrefix}.apothecaryGlassBottle`, 0.039, 0.039, 0.11, 20, 0, 0.014 + 0.055, 0, glassMat, true);
    addNamedCyl(root, `${namePrefix}.fragranceOilLevel`, 0.035, 0.035, 0.072, 16, 0, 0.018 + 0.036, 0, oilMat, true);
    addNamedCyl(root, `${namePrefix}.frontLabelBand`, 0.0398, 0.0398, 0.052, 20, 0, 0.014 + 0.055, 0, labelMat, true);
    addNamedCyl(root, `${namePrefix}.neckCollar`, 0.017, 0.019, 0.024, 16, 0, 0.124 + 0.012, 0, brassMat, true);

    // 7 fanned natural rattan reeds reaching `H 260 mm`
    for (let r = 0; r < 7; r++) {
      const ang = (r / 7) * Math.PI * 2;
      const tilt = 0.14;
      const reedLen = 0.22;
      const reed = addNamedCyl(
        root,
        `${namePrefix}.rattanReed_${r + 1}`,
        0.0018,
        0.0018,
        reedLen,
        6,
        Math.sin(ang) * 0.012,
        0.15 + reedLen * 0.45,
        Math.cos(ang) * 0.012,
        oakMat,
        true
      );
      reed.rotation.z = -Math.sin(ang) * tilt;
      reed.rotation.x = Math.cos(ang) * tilt;
    }
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: `The White Company Home Accessory (${kind})`,
    brand: 'The White Company',
    collection: 'Home & Utility',
    sku: `TWC-${kind.toUpperCase()}`,
    finish: 'Natural Kubu Rattan & Belgian Linen',
    category: 'decor',
    productUrl: 'https://www.thewhitecompany.com/uk/Home-Accessories/c/home-accessories',
    schematicUrl: 'https://www.thewhitecompany.com/uk/help/product-care',
  });
}
