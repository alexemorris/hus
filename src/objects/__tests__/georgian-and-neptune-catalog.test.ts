import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildNeptuneInFrameCabinetRun,
  buildNeptuneKitchenIsland,
  buildNeptuneLarderPantry,
  buildNeptuneMantleCanopyHood,
  buildShawsBelfastSinkAndBridgeTap,
} from '../architectural/neptune-kitchen-joinery.ts';
import {
  buildChequerboardMarbleFloor,
  buildGeorgianAlcoveBookcase,
  buildGeorgianBolectionFireplace,
  buildGeorgianBrickRailingsAndGate,
  buildGeorgianFacadeDressings,
  buildGeorgianTuscanPorticoAndDoor,
  buildNeptuneBootBenchAndPegRail,
  buildTongueAndGrooveDadoPanelling,
  createCarraraNeroChequerboardTextures,
} from '../architectural/georgian-facade-and-fireplace.ts';
import { buildLacancheCluny1000Range } from '../appliances/lacanche-cluny-range.ts';
import {
  buildNeptuneArmchair,
  buildNeptuneArundelDiningSet,
  buildNeptuneChichesterGlazedDresser,
  buildNeptuneCounterStool,
  buildNeptuneOakTablesAndBedsides,
  buildNeptuneUpholsteredSofa,
  buildWhiteCompanyBedStyling,
} from '../furniture/neptune-upholstery-and-dining.ts';
import {
  buildCuratedMirrorsArtAndRugs,
  buildGeorgianAntiqueCasework,
  buildGeorgianFiresideSet,
  buildWhiteCompanyAccessories,
  createRogerOatesRunnerTextures,
} from '../furniture/georgian-antiques-and-styling.ts';
import {
  buildGeorgianCoachLantern,
  buildHeritageInteriorLighting,
} from '../lighting/georgian-and-heritage-lighting.ts';
import {
  buildCrittallWalkInShowerAndTowelRail,
  buildNeptuneChichesterVanity,
} from '../sanitaryware/neptune-vanity-and-shower.ts';
import { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';

const FORBIDDEN_HOUSE_ZONE_RE =
  /\b(familyRoom|bootLobby|livingRoom|entranceHall|sittingRoom|mainBedroom|familyBathroom|upperLanding|bedroom2|bedroom3|bedroom4|courtyard|diningRoom|masterBedroom|annexLiving|annexBedroom|outbuildingGym|outbuildingGarage|outbuildingStore|outbuildingBarn|outbuildingMezzanine|outbuildingStableOffice|outbuildingStableSuite)\b/;

interface BoxFaceRecord {
  readonly meshName: string;
  readonly axis: 'x' | 'y' | 'z';
  readonly sign: -1 | 1;
  readonly coord: number;
  readonly uMin: number;
  readonly uMax: number;
  readonly vMin: number;
  readonly vMax: number;
}

/**
 * Verifies that a catalog builder group:
 * - Is a named `THREE.Group` containing named meshes (`<prefix>.<part>`),
 * - Has zero `NaN` or `Infinity` values across all BufferAttributes, transforms & bounding boxes,
 * - Uses local-origin coordinates (`|center| < 3.5 m`, zero hardcoded house-specific house coordinates or ZoneIds),
 * - Has zero internal z-fighting among axis-aligned opaque box faces (no two meshes share a coplanar
 *    same-normal face within `0.15 mm` with 2D overlap area > `4 cm²`).
 */
function assertCatalogGroupInvariants(group: THREE.Group, expectedPrefix: string): void {
  expect(group).toBeInstanceOf(THREE.Group);
  expect(group.name).toBe(expectedPrefix);

  group.updateMatrixWorld(true);

  let meshCount = 0;
  const faces: BoxFaceRecord[] = [];
  const overallBox = new THREE.Box3();
  const worldQuat = new THREE.Quaternion();

  group.traverse((obj) => {
    expect(obj.name.length, `unnamed Object3D under ${expectedPrefix}`).toBeGreaterThan(0);
    expect(FORBIDDEN_HOUSE_ZONE_RE.test(obj.name), `house-specific zone ID leaked in ${obj.name}`).toBe(false);

    for (const el of obj.matrixWorld.elements) {
      expect(Number.isFinite(el), `non-finite matrixWorld element on ${obj.name}`).toBe(true);
    }

    if (!(obj instanceof THREE.Mesh)) return;
    meshCount++;
    expect(
      obj.name.startsWith(`${expectedPrefix}.`) || obj.name.includes('.'),
      `expected hierarchical mesh name on ${obj.name}`
    ).toBe(true);

    const geo = obj.geometry;
    const pos = geo.getAttribute('position');
    expect(pos, `missing position attribute on ${obj.name}`).toBeDefined();
    expect(pos.count).toBeGreaterThan(0);

    for (const attrName of Object.keys(geo.attributes)) {
      const attr = geo.getAttribute(attrName);
      if (!attr || !('array' in attr)) continue;
      const arr = attr.array as ArrayLike<number>;
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i]!)) {
          throw new Error(`Non-finite vertex attribute ${attrName}[${i}] on ${obj.name}`);
        }
      }
    }

    const meshBox = new THREE.Box3().setFromObject(obj);
    expect(meshBox.isEmpty(), `empty Box3 on ${obj.name}`).toBe(false);
    overallBox.union(meshBox);

    // Collect axis-aligned opaque BoxGeometry faces to detect any coplanar internal z-fighting
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const isTransparent = Boolean(mat && 'transparent' in mat && mat.transparent);
    if (geo instanceof THREE.BoxGeometry && !isTransparent) {
      obj.getWorldQuaternion(worldQuat);
      // Only test faces that remain axis-aligned (`90°` multiples)
      const rx = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat);
      const ry = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat);
      const rz = new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat);
      const isAxisAligned =
        [rx, ry, rz].every(
          (v) =>
            Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) > 0.999
        );

      if (isAxisAligned) {
        const { min, max } = meshBox;
        faces.push(
          { meshName: obj.name, axis: 'x', sign: -1, coord: min.x, uMin: min.y, uMax: max.y, vMin: min.z, vMax: max.z },
          { meshName: obj.name, axis: 'x', sign: 1, coord: max.x, uMin: min.y, uMax: max.y, vMin: min.z, vMax: max.z },
          { meshName: obj.name, axis: 'y', sign: -1, coord: min.y, uMin: min.x, uMax: max.x, vMin: min.z, vMax: max.z },
          { meshName: obj.name, axis: 'y', sign: 1, coord: max.y, uMin: min.x, uMax: max.x, vMin: min.z, vMax: max.z },
          { meshName: obj.name, axis: 'z', sign: -1, coord: min.z, uMin: min.x, uMax: max.x, vMin: min.y, vMax: max.y },
          { meshName: obj.name, axis: 'z', sign: 1, coord: max.z, uMin: min.x, uMax: max.x, vMin: min.y, vMax: max.y }
        );
      }
    }
  });

  expect(meshCount, `expected > 0 meshes in ${expectedPrefix}`).toBeGreaterThan(0);

  // Local-origin purity check (no house-specific world-space offset like X=22m or Z=-14m)
  const center = overallBox.getCenter(new THREE.Vector3());
  expect(Math.abs(center.x)).toBeLessThan(3.5);
  expect(Math.abs(center.y)).toBeLessThan(3.5);
  expect(Math.abs(center.z)).toBeLessThan(3.5);

  // Coplanar same-normal z-fighting check across all axis-aligned BoxGeometry meshes
  const zFightPairs: string[] = [];
  for (let i = 0; i < faces.length; i++) {
    const a = faces[i]!;
    for (let j = i + 1; j < faces.length; j++) {
      const b = faces[j]!;
      if (a.meshName === b.meshName) continue;
      if (a.axis !== b.axis || a.sign !== b.sign) continue;
      if (Math.abs(a.coord - b.coord) > 0.00015) continue; // >= 0.15 mm offset is z-fight-safe

      const overlapU = Math.min(a.uMax, b.uMax) - Math.max(a.uMin, b.uMin);
      const overlapV = Math.min(a.vMax, b.vMax) - Math.max(a.vMin, b.vMin);
      if (overlapU > 0.015 && overlapV > 0.015 && overlapU * overlapV > 0.0009) {
        // Only flag if one face genuinely overlaps another visible face with different material or redundant coplanar surface
        zFightPairs.push(
          `${a.meshName} vs ${b.meshName} on ${a.sign > 0 ? '+' : '-'}${a.axis.toUpperCase()}@${a.coord.toFixed(4)} (overlap ${(overlapU * 1000).toFixed(0)}x${(overlapV * 1000).toFixed(0)}mm)`
        );
      }
    }
  }
  expect(zFightPairs, `coplanar z-fighting in ${expectedPrefix}`).toEqual([]);
}

describe('Catalog builders: Neptune, Lacanche, White Company, Cox & Cox & Georgian architecture', () => {
  it('builds Neptune kitchen joinery & Shaws Belfast sink via husjs/catalog/architectural', () => {
    const interactiveMeshes: THREE.Object3D[] = [];
    const interactions = new InteractionRegistry(interactiveMeshes);

    const chichesterRun = buildNeptuneInFrameCabinetRun(interactions, {
      name: 'chichesterBaseRun',
      collection: 'chichester',
      elevation: 'base',
      bays: [
        { kind: 'drawerBank3', widthM: 0.8 },
        { kind: 'integratedDishwasher', widthM: 0.6 },
        { kind: 'twinPullOutBin', widthM: 0.5 },
        { kind: 'doubleDoor', widthM: 0.9 },
      ],
    });
    assertCatalogGroupInvariants(chichesterRun, 'chichesterBaseRun');

    const suffolkWallRun = buildNeptuneInFrameCabinetRun(interactions, {
      name: 'suffolkWallRun',
      collection: 'suffolk',
      elevation: 'wall',
      bays: [
        { kind: 'singleDoor', widthM: 0.5, hingeSide: 'left' },
        { kind: 'openShelves', widthM: 0.6 },
      ],
    });
    assertCatalogGroupInvariants(suffolkWallRun, 'suffolkWallRun');

    const larder = buildNeptuneLarderPantry(interactions, { name: 'chichesterLarder' });
    assertCatalogGroupInvariants(larder, 'chichesterLarder');

    const canopy = buildNeptuneMantleCanopyHood({
      name: 'chichesterCanopy',
      includeZelligeSplashback: true,
      includeUtensilRail: true,
    });
    assertCatalogGroupInvariants(canopy, 'chichesterCanopy');

    const sink = buildShawsBelfastSinkAndBridgeTap({
      name: 'shawsDouble800',
      includeCarraraDrainerDeck: true,
    });
    assertCatalogGroupInvariants(sink, 'shawsDouble800');

    const island = buildNeptuneKitchenIsland(interactions, { name: 'chichesterIsland' });
    assertCatalogGroupInvariants(island, 'chichesterIsland');

    expect(interactions.listInteractables().length).toBeGreaterThanOrEqual(10);
  });

  it('builds Georgian exterior portico, railings/gate, facade dressings, fireplace, bookcase, dado & chequerboard floor', () => {
    const interactiveMeshes: THREE.Object3D[] = [];
    const interactions = new InteractionRegistry(interactiveMeshes);

    const portico = buildGeorgianTuscanPorticoAndDoor(interactions, {
      name: 'tuscanPortico',
      includePlanters: true,
    });
    assertCatalogGroupInvariants(portico, 'tuscanPortico');

    const railings = buildGeorgianBrickRailingsAndGate(interactions, {
      name: 'frontRailings',
    });
    assertCatalogGroupInvariants(railings, 'frontRailings');

    for (const kind of [
      'cornerQuoins',
      'stringcourse',
      'eavesCornice',
      'chimneyStack',
      'rainwaterDownpipe',
      'completeEnsemble',
    ] as const) {
      const dressing = buildGeorgianFacadeDressings({ name: `dressing_${kind}`, kind });
      assertCatalogGroupInvariants(dressing, `dressing_${kind}`);
    }

    const fireplace = buildGeorgianBolectionFireplace({ interactions }, { name: 'bolectionStove' });
    assertCatalogGroupInvariants(fireplace, 'bolectionStove');

    const bookcase = buildGeorgianAlcoveBookcase({ name: 'alcoveBookcase', interactions });
    assertCatalogGroupInvariants(bookcase, 'alcoveBookcase');

    const dado = buildTongueAndGrooveDadoPanelling({ name: 'hallDado', lengthM: 2.4 });
    assertCatalogGroupInvariants(dado, 'hallDado');

    const bootBench = buildNeptuneBootBenchAndPegRail({ name: 'bootBench', interactions });
    assertCatalogGroupInvariants(bootBench, 'bootBench');

    const chequerMaps = createCarraraNeroChequerboardTextures();
    expect(chequerMaps.colorMap).toBeInstanceOf(THREE.DataTexture);
    expect(chequerMaps.normalMap).toBeInstanceOf(THREE.DataTexture);
    expect(chequerMaps.roughnessMap).toBeInstanceOf(THREE.DataTexture);

    const hallFloor = buildChequerboardMarbleFloor({ name: 'hallChequerFloor', widthM: 2.6, depthM: 3.4 });
    assertCatalogGroupInvariants(hallFloor, 'hallChequerFloor');
  });

  it('builds Lacanche Cluny 1000 range across enamel finishes via husjs/catalog/appliances', () => {
    const interactiveMeshes: THREE.Object3D[] = [];
    const interactions = new InteractionRegistry(interactiveMeshes);

    for (const finish of ['glossBlack', 'frenchBlue', 'ivory', 'armorGreen'] as const) {
      const range = buildLacancheCluny1000Range(interactions, {
        name: `lacanche_${finish}`,
        finish,
      });
      assertCatalogGroupInvariants(range, `lacanche_${finish}`);
    }
    expect(interactions.listInteractables().length).toBe(16); // 4 ranges x (2 oven doors + 2 warming drawers)
  });

  it('builds Neptune upholstery, dining, dresser, stools, occasional & White Company bed styling via husjs/catalog/furniture', () => {
    const interactiveMeshes: THREE.Object3D[] = [];
    const interactions = new InteractionRegistry(interactiveMeshes);

    assertCatalogGroupInvariants(
      buildNeptuneUpholsteredSofa({ name: 'sofaLongIsland', model: 'longIsland', interactions }),
      'sofaLongIsland'
    );
    assertCatalogGroupInvariants(
      buildNeptuneUpholsteredSofa({ name: 'sofaGeorge', model: 'george', interactions }),
      'sofaGeorge'
    );
    assertCatalogGroupInvariants(
      buildNeptuneArmchair({ name: 'chairOlivia', model: 'olivia', interactions }),
      'chairOlivia'
    );
    assertCatalogGroupInvariants(
      buildNeptuneArmchair({ name: 'chairCasey', model: 'casey', interactions }),
      'chairCasey'
    );
    assertCatalogGroupInvariants(
      buildNeptuneArundelDiningSet({ name: 'arundelSet', interactions }),
      'arundelSet'
    );
    assertCatalogGroupInvariants(
      buildNeptuneChichesterGlazedDresser(interactions, { name: 'welshDresser' }),
      'welshDresser'
    );
    assertCatalogGroupInvariants(
      buildNeptuneCounterStool({ name: 'stoolWardley', model: 'wardley', interactions }),
      'stoolWardley'
    );
    assertCatalogGroupInvariants(
      buildNeptuneCounterStool({ name: 'stoolLudlow', model: 'ludlow', interactions }),
      'stoolLudlow'
    );
    for (const kind of ['henleyCoffeeTable', 'chichesterBedsideTable', 'chichesterDaybed'] as const) {
      assertCatalogGroupInvariants(
        buildNeptuneOakTablesAndBedsides({ name: `oak_${kind}`, kind, interactions }),
        `oak_${kind}`
      );
    }
    assertCatalogGroupInvariants(
      buildWhiteCompanyBedStyling({ name: 'savoyKingBedStyling', size: 'king' }),
      'savoyKingBedStyling'
    );
  });

  it('builds George III antiques, fireside set, mirrors, pastoral/botanical art, PBR rugs & White Co. accessories', () => {
    const interactiveMeshes: THREE.Object3D[] = [];
    const interactions = new InteractionRegistry(interactiveMeshes);

    for (const kind of [
      'serpentineConsole',
      'demiLuneCardTable',
      'bowFrontChest',
      'astragalBureauBookcase',
    ] as const) {
      assertCatalogGroupInvariants(
        buildGeorgianAntiqueCasework(interactions, { name: `antique_${kind}`, kind }),
        `antique_${kind}`
      );
    }

    assertCatalogGroupInvariants(
      buildGeorgianFiresideSet({ name: 'firesideSet', interactions }),
      'firesideSet'
    );

    const runnerMaps = createRogerOatesRunnerTextures(4);
    expect(runnerMaps.colorMap).toBeInstanceOf(THREE.DataTexture);

    for (const kind of [
      'regencyGiltOvermantel',
      'regencyGiltPierMirror',
      'coxRoundBrass',
      'coxArchedBrass',
      'scallopedBrass',
      'constableLandscapeOil',
      'curtisBotanicalGrid',
      'zieglerOushak',
      'coxPebbleWool',
      'coxBraidedJute',
      'rogerOatesRunnerSwatch',
    ] as const) {
      assertCatalogGroupInvariants(
        buildCuratedMirrorsArtAndRugs({ name: `curated_${kind}`, kind }),
        `curated_${kind}`
      );
    }

    for (const kind of [
      'kubuLaundryHamper',
      'kubuStorageBasket',
      'glassHurricane',
      'reedDiffuser',
    ] as const) {
      assertCatalogGroupInvariants(
        buildWhiteCompanyAccessories({ name: `whiteCo_${kind}`, kind }),
        `whiteCo_${kind}`
      );
    }
  });

  it('builds Georgian coach lantern, heritage interior lighting & Neptune Chichester sanitaryware', () => {
    const interactiveMeshes: THREE.Object3D[] = [];
    const interactions = new InteractionRegistry(interactiveMeshes);

    assertCatalogGroupInvariants(
      buildGeorgianCoachLantern(null, { name: 'coachLantern', createPointLight: true }),
      'coachLantern'
    );

    for (const kind of [
      'chandelier6Arm',
      'hallLantern',
      'coxFlutedPendant',
      'coxFlutedSconce',
      'whiteCoCeramicLamp',
      'whiteCoAlabasterLamp',
    ] as const) {
      assertCatalogGroupInvariants(
        buildHeritageInteriorLighting(null, { name: `light_${kind}`, kind, createPointLight: true }),
        `light_${kind}`
      );
    }

    assertCatalogGroupInvariants(
      buildNeptuneChichesterVanity(interactions, { name: 'vanitySingle', variant: 'single' }),
      'vanitySingle'
    );
    assertCatalogGroupInvariants(
      buildNeptuneChichesterVanity(interactions, { name: 'vanityDouble', variant: 'double' }),
      'vanityDouble'
    );
    assertCatalogGroupInvariants(
      buildCrittallWalkInShowerAndTowelRail({
        name: 'showerColumn',
        towelWarmerVariant: 'traditionalColumn',
      }),
      'showerColumn'
    );
    assertCatalogGroupInvariants(
      buildCrittallWalkInShowerAndTowelRail({
        name: 'showerLadder',
        frameFinish: 'crittallBlack',
        towelWarmerVariant: 'ladder',
      }),
      'showerLadder'
    );
  });
});
