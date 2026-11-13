import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { detectZFighting } from '../../engine/diagnostics/z-fighting-detector.ts';
import { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import {
  buildNeptuneInFrameCabinetRun,
  buildNeptuneKitchenIsland,
  buildNeptuneLarderPantry,
  buildNeptuneMantleCanopyHood,
  buildShawsBelfastSinkAndBridgeTap,
} from '../architectural/neptune-kitchen-joinery.ts';
import { buildCorstonPowerSocket } from '../fixtures/corston-power-sockets.ts';
import { buildCorstonToggleSwitch } from '../fixtures/corston-toggle-switch.ts';
import { buildFlutedBrassPictureLight } from '../fixtures/fluted-brass-picture-light.ts';
import {
  buildGeorgianCoachLantern,
  buildHeritageInteriorLighting,
} from '../lighting/georgian-and-heritage-lighting.ts';
import {
  ALL_BRASSWARE_FINISH_CODES,
  type BrasswareFinishCode,
  buildBcDesignsCopperBoatBath,
  buildLefroyBrooksLaChapellePedestalBasin,
  buildLefroyBrooksLaChapelleWashstand,
  buildLefroyBrooksLissaDoonWashstand,
  buildPerrinRoweBasinTap,
  buildPerrinRoweKitchenTap,
  buildThomasCrapperDownhamBasin,
  getBathroomBrassMaterials,
  getTapMountAnchor,
  mountTapOnFixture,
  type PerrinRoweBasinLeverStyle,
  type PerrinRoweBasinTapCollection,
  type PerrinRoweBasinTapMount,
  type PerrinRoweKitchenTapModel,
} from '../sanitaryware/index.ts';
import * as vanityModule from '../sanitaryware/neptune-vanity-and-shower.ts';

function assertZeroZFighting(root: THREE.Object3D, label: string): void {
  const findings = detectZFighting(root, { epsilonM: 0.00035 });
  if (findings.length > 0) {
    const details = findings
      .slice(0, 5)
      .map(
        (f) =>
          `${f.meshA} vs ${f.meshB} (diff=${f.planeDistanceDiffMm.toFixed(3)}mm, area=${f.overlapAreaCm2.toFixed(2)}cm2)`
      )
      .join('; ');
    throw new Error(`${label} had ${findings.length} z-fighting overlaps: ${details}`);
  }
}

function collectMeshMaterials(root: THREE.Object3D): Set<THREE.Material> {
  const mats = new Set<THREE.Material>();
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = (child as THREE.Mesh).material;
      if (Array.isArray(m)) {
        for (const item of m) mats.add(item);
      } else if (m) {
        mats.add(m);
      }
    }
  });
  return mats;
}

function countMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) count++;
  });
  return count;
}

describe('Catalog parameterization: 9-finish metal matrix & composable tap slots', () => {
  it('re-exports unified tap builders, anchors, and finish constants from husjs/catalog barrels', () => {
    expect(ALL_BRASSWARE_FINISH_CODES).toEqual([
      'CP',
      'NI',
      'PF',
      'BN',
      'BR',
      'SB',
      'AB',
      'BZ',
      'IG',
    ]);
    expect(typeof buildPerrinRoweBasinTap).toBe('function');
    expect(typeof buildPerrinRoweKitchenTap).toBe('function');
    expect(typeof getTapMountAnchor).toBe('function');
    expect(typeof mountTapOnFixture).toBe('function');
    expect(typeof vanityModule.buildNeptuneChichesterVanity).toBe('function');
  });

  it('provides distinct cached PBR palettes for all 9 BrasswareFinishCode finishes', () => {
    const primaryColors = new Set<number>();
    for (const code of ALL_BRASSWARE_FINISH_CODES) {
      const palette = getBathroomBrassMaterials(code);
      expect(palette.primary).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(palette.knurled).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(palette.darkShadow).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(getBathroomBrassMaterials(code)).toBe(palette);
      primaryColors.add(palette.primary.color.getHex());
    }
    expect(primaryColors.size).toBe(9);
  });

  it('builds Perrin & Rowe basin taps across all 4 collections × 3 mounts × lever styles × 9 finishes with 0 z-fighting', () => {
    const collections: readonly PerrinRoweBasinTapCollection[] = [
      'armstrong',
      'traditional',
      'langbourn',
      'deco',
    ];
    const mounts: readonly PerrinRoweBasinTapMount[] = [
      '3-hole-deck',
      'monobloc-deck',
      '2-hole-wall',
    ];
    const leverStyles: readonly PerrinRoweBasinLeverStyle[] = [
      'metal',
      'whitePorcelain',
      'blackPorcelain',
      'crosshead',
    ];

    for (const collection of collections) {
      for (const mount of mounts) {
        const tap = buildPerrinRoweBasinTap({
          namePrefix: `tap_${collection}_${mount}`,
          collection,
          mount,
          finish: 'CP',
          includeWaste: mount !== '2-hole-wall',
        });
        expect(countMeshes(tap)).toBeGreaterThan(4);
        assertZeroZFighting(tap, `basinTap(${collection}, ${mount})`);
      }
    }

    for (const leverStyle of leverStyles) {
      const tap = buildPerrinRoweBasinTap({
        namePrefix: `tap_lever_${leverStyle}`,
        collection: 'traditional',
        mount: '3-hole-deck',
        finish: 'NI',
        leverStyle,
        includeWaste: true,
        slottedWaste: false,
      });
      expect(countMeshes(tap)).toBeGreaterThan(6);
      assertZeroZFighting(tap, `basinTap(leverStyle=${leverStyle})`);
    }

    for (const finish of ALL_BRASSWARE_FINISH_CODES) {
      const pal = getBathroomBrassMaterials(finish);
      const tap = buildPerrinRoweBasinTap({
        collection: 'armstrong',
        mount: 'monobloc-deck',
        finish,
      });
      expect(collectMeshMaterials(tap).has(pal.primary)).toBe(true);
    }
  });

  it('builds Perrin & Rowe kitchen taps across all 4 models, lever styles, and 9 finishes with 0 z-fighting', () => {
    const models: readonly PerrinRoweKitchenTapModel[] = [
      'phoenician-bridge',
      'armstrong-bridge',
      'monobloc-swan',
      'wall-bridge',
    ];

    for (const model of models) {
      for (const leverStyle of ['whitePorcelain', 'blackPorcelain', 'metal'] as const) {
        const tap = buildPerrinRoweKitchenTap({
          namePrefix: `kitchenTap_${model}_${leverStyle}`,
          model,
          finish: 'IG',
          leverStyle,
          includeRinseSpray: model === 'phoenician-bridge' || model === 'armstrong-bridge',
        });
        expect(countMeshes(tap)).toBeGreaterThan(5);
        assertZeroZFighting(tap, `kitchenTap(${model}, ${leverStyle})`);
      }
    }

    for (const finish of ALL_BRASSWARE_FINISH_CODES) {
      const pal = getBathroomBrassMaterials(finish);
      const tap = buildPerrinRoweKitchenTap({
        model: 'phoenician-bridge',
        finish,
        includeRinseSpray: false,
      });
      expect(collectMeshMaterials(tap).has(pal.primary)).toBe(true);
    }
  });

  it('supports composable tap swapping, hardwareFinish, wasteFinish, and TapMountAnchor on Neptune Chichester vanities', () => {
    const interactions = new InteractionRegistry([]);

    const doubleDeco = vanityModule.buildNeptuneChichesterVanity(interactions, {
      name: 'vanityDoubleDeco',
      variant: 'double',
      paintColor: 0x36454f,
      brassFinish: 'NI',
      hardwareFinish: 'NI',
      wasteFinish: 'CP',
      tap: {
        collection: 'deco',
        mount: '3-hole-deck',
        finish: 'NI',
        leverStyle: 'crosshead',
      },
    });
    const doubleAnchor = getTapMountAnchor(doubleDeco);
    expect(doubleAnchor).not.toBeNull();
    expect(doubleAnchor?.holeCount).toBe(3);
    expect(doubleAnchor?.deckPositions?.length).toBe(2);
    expect(doubleDeco.getObjectByName('vanityDoubleDeco.basinTap_1')).toBeDefined();
    expect(doubleDeco.getObjectByName('vanityDoubleDeco.basinTap_2')).toBeDefined();
    expect(collectMeshMaterials(doubleDeco).has(getBathroomBrassMaterials('NI').primary)).toBe(true);
    expect(collectMeshMaterials(doubleDeco).has(getBathroomBrassMaterials('CP').primary)).toBe(true);
    assertZeroZFighting(doubleDeco, 'vanityDoubleDeco');

    const singleWallReady = vanityModule.buildNeptuneChichesterVanity(null, {
      name: 'vanitySingleNoTap',
      variant: 'single',
      hardwareFinish: 'BZ',
      wasteFinish: 'BZ',
      tap: 'none',
    });
    const singleAnchor = getTapMountAnchor(singleWallReady);
    expect(singleAnchor?.holeCount).toBe(0);
    expect(singleWallReady.getObjectByName('vanitySingleNoTap.perrinRowe3HoleMixer_1')).toBeUndefined();
    expect(singleWallReady.getObjectByName('vanitySingleNoTap.basinTap_1')).toBeUndefined();

    // Dynamically mount a custom tap onto the tapless single vanity via mountTapOnFixture
    const customTap = buildPerrinRoweBasinTap({
      namePrefix: 'mountedLangbournMonobloc',
      collection: 'langbourn',
      mount: 'monobloc-deck',
      finish: 'BZ',
    });
    mountTapOnFixture(singleWallReady, customTap, 'deck');
    expect(customTap.parent).toBe(singleWallReady);
    expect(customTap.position.toArray()).toEqual(singleAnchor!.deckPosition);
    assertZeroZFighting(singleWallReady, 'vanitySingleWithMountedTap');
  });

  it('supports composable taps, tap="none", and mountTapOnFixture across Downham, La Chapelle, Lissa Doon & Shaws Belfast sink', () => {
    // Thomas Crapper Downham cloakroom basin
    const downhamDefault = buildThomasCrapperDownhamBasin({
      namePrefix: 'downhamDefault',
      finish: 'SB',
    });
    const downhamAnchor = getTapMountAnchor(downhamDefault);
    expect(downhamAnchor).not.toBeNull();
    expect(downhamAnchor?.holeCount).toBe(0);
    // Crucial for golden scene.snap: no userData pollution on default build!
    expect(downhamDefault.userData.tapMountAnchor).toBeUndefined();

    const downhamWithWallTap = buildThomasCrapperDownhamBasin({
      namePrefix: 'downhamWall',
      finish: 'IG',
      wasteFinish: 'BZ',
      tap: {
        collection: 'traditional',
        mount: '2-hole-wall',
        finish: 'IG',
        leverStyle: 'whitePorcelain',
      },
    });
    expect(downhamWithWallTap.getObjectByName('downhamWall.basinTap')).toBeDefined();
    expect(collectMeshMaterials(downhamWithWallTap).has(getBathroomBrassMaterials('IG').primary)).toBe(true);
    expect(collectMeshMaterials(downhamWithWallTap).has(getBathroomBrassMaterials('BZ').primary)).toBe(true);
    assertZeroZFighting(downhamWithWallTap, 'downhamWithWallTap');

    // Lefroy Brooks La Chapelle washstand (ceramic basin geometry preserved)
    const laChapelleBaselineFights = detectZFighting(
      buildLefroyBrooksLaChapelleWashstand({ namePrefix: 'laChapelleBase' }),
      { epsilonM: 0.00035 }
    ).length;

    const laChapelleNoTap = buildLefroyBrooksLaChapelleWashstand({
      namePrefix: 'laChapelleWallReady',
      standFinish: 'CP',
      brasswareFinish: 'CP',
      tap: 'none',
    });
    expect(getTapMountAnchor(laChapelleNoTap)?.holeCount).toBe(0);
    expect(laChapelleNoTap.getObjectByName('laChapelleWallReady.deco3HoleMixer3142')).toBeUndefined();
    expect(
      detectZFighting(laChapelleNoTap, { epsilonM: 0.00035 }).length
    ).toBeLessThanOrEqual(laChapelleBaselineFights);

    const laChapelleArmstrong = buildLefroyBrooksLaChapelleWashstand({
      namePrefix: 'laChapelleArmstrong',
      standFinish: 'NI',
      brasswareFinish: 'NI',
      tap: {
        collection: 'armstrong',
        mount: '3-hole-deck',
        finish: 'NI',
      },
    });
    const mountedArmstrong = laChapelleArmstrong.getObjectByName('laChapelleArmstrong.basinTap')!;
    expect(mountedArmstrong).toBeDefined();
    assertZeroZFighting(mountedArmstrong, 'laChapelleArmstrong.basinTap');
    expect(
      detectZFighting(laChapelleArmstrong, { epsilonM: 0.00035 }).length
    ).toBeLessThanOrEqual(laChapelleBaselineFights);

    // Lefroy Brooks La Chapelle pedestal basin & Lissa Doon washstand
    const pedestalWithTap = buildLefroyBrooksLaChapellePedestalBasin({
      namePrefix: 'pedestalTrad',
      finish: 'BR',
      tap: {
        collection: 'traditional',
        mount: '3-hole-deck',
        finish: 'BR',
        leverStyle: 'blackPorcelain',
      },
    });
    expect(pedestalWithTap.getObjectByName('pedestalTrad.basinTap')).toBeDefined();
    assertZeroZFighting(pedestalWithTap, 'pedestalWithTap');

    const lissaDoonMonobloc = buildLefroyBrooksLissaDoonWashstand({
      namePrefix: 'lissaMonobloc',
      finish: 'BZ',
      tap: {
        collection: 'langbourn',
        mount: 'monobloc-deck',
        finish: 'BZ',
      },
    });
    expect(getTapMountAnchor(lissaDoonMonobloc)?.holeCount).toBe(1);
    expect(lissaDoonMonobloc.getObjectByName('lissaMonobloc.basinTap')).toBeDefined();
    assertZeroZFighting(lissaDoonMonobloc, 'lissaDoonMonobloc');

    // Shaws Belfast sink & bridge tap
    const shawsArmstrong = buildShawsBelfastSinkAndBridgeTap({
      name: 'shawsArmstrong',
      finish: 'NI',
      tap: {
        model: 'armstrong-bridge',
        finish: 'NI',
        leverStyle: 'metal',
        includeRinseSpray: true,
      },
    });
    expect(shawsArmstrong.getObjectByName('shawsArmstrong.kitchenTap')).toBeDefined();
    expect(collectMeshMaterials(shawsArmstrong).has(getBathroomBrassMaterials('NI').primary)).toBe(true);
    assertZeroZFighting(shawsArmstrong, 'shawsArmstrong');

    const shawsNoTap = buildShawsBelfastSinkAndBridgeTap({
      name: 'shawsNoTap',
      finish: 'BZ',
      tap: 'none',
    });
    expect(getTapMountAnchor(shawsNoTap)?.holeCount).toBe(0);
    expect(shawsNoTap.getObjectByName('shawsNoTap.phoenician4471BridgeTap')).toBeUndefined();
    const customSwan = buildPerrinRoweKitchenTap({
      namePrefix: 'customMonoblocSwan',
      model: 'monobloc-swan',
      finish: 'BZ',
    });
    mountTapOnFixture(shawsNoTap, customSwan, 'deck');
    expect(customSwan.parent).toBe(shawsNoTap);
    assertZeroZFighting(shawsNoTap, 'shawsWithCustomSwan');
  });

  it('supports BC Designs Boat Bath exteriorFinish variants and Neptune kitchen hardwareFinish', () => {
    for (const exteriorFinish of ['copper', 'tin', 'polishedBrass', 'painted'] as const) {
      const bath = buildBcDesignsCopperBoatBath({
        namePrefix: `boatBath_${exteriorFinish}`,
        brassFinish: 'NI',
        exteriorFinish,
        exteriorPaintColor: exteriorFinish === 'painted' ? 0x2b3a4a : undefined,
      });
      expect(countMeshes(bath)).toBeGreaterThan(4);
      assertZeroZFighting(bath, `boatBath(${exteriorFinish})`);
    }

    const cabRun = buildNeptuneInFrameCabinetRun(null, {
      name: 'cabRunNi',
      hardwareFinish: 'NI',
      bays: [
        { kind: 'drawerBank3', widthM: 0.8 },
        { kind: 'doubleDoor', widthM: 0.9 },
      ],
    });
    expect(collectMeshMaterials(cabRun).has(getBathroomBrassMaterials('NI').primary)).toBe(true);
    assertZeroZFighting(cabRun, 'cabRunNi');

    const larder = buildNeptuneLarderPantry(null, { name: 'larderCp', hardwareFinish: 'CP' });
    expect(collectMeshMaterials(larder).has(getBathroomBrassMaterials('CP').primary)).toBe(true);
    assertZeroZFighting(larder, 'larderCp');

    const canopy = buildNeptuneMantleCanopyHood({ name: 'canopyBz', hardwareFinish: 'BZ' });
    expect(collectMeshMaterials(canopy).has(getBathroomBrassMaterials('BZ').primary)).toBe(true);
    assertZeroZFighting(canopy, 'canopyBz');

    const island = buildNeptuneKitchenIsland(null, { name: 'islandIg', hardwareFinish: 'IG' });
    expect(collectMeshMaterials(island).has(getBathroomBrassMaterials('IG').primary)).toBe(true);
    assertZeroZFighting(island, 'islandIg');
  });

  it('supports finish presets & 9-finish codes on Corston switches/sockets, picture light, and heritage lighting', () => {
    const scene = new THREE.Group();
    const sw = buildCorstonToggleSwitch(
      { scene, interactiveMeshes: [] },
      {
        name: 'swPolishedNickel',
        switchPa: '1.1.10',
        location: 'Hall',
        x: 0,
        y: 1.15,
        z: 0,
        finish: 'polishedNickel',
        gangs: [
          { gang: 1, zoneId: 'hall' as never, label: 'Pendant' },
          { gang: 2, zoneId: 'hall' as never, label: 'Lantern' },
        ],
      }
    );
    expect(collectMeshMaterials(sw.group).has(getBathroomBrassMaterials('NI').primary)).toBe(true);
    assertZeroZFighting(sw.group, 'corstonSwitch(polishedNickel)');

    const sockScene = new THREE.Group();
    const sock = buildCorstonPowerSocket(
      { scene: sockScene, interactiveMeshes: [] } as never,
      () => {},
      {
        name: 'sockBronze',
        zone: 'hall',
        kind: 'double',
        x: 0,
        y: 0.45,
        z: 0,
        facing: 'south',
        finish: 'bronze',
      }
    );
    expect(collectMeshMaterials(sock).has(getBathroomBrassMaterials('BZ').primary)).toBe(true);

    const pic = buildFlutedBrassPictureLight(
      {
        brass: new THREE.MeshStandardMaterial({ color: 0xb89146 }),
        darkBrass: new THREE.MeshStandardMaterial({ color: 0x5c4422 }),
        glow: new THREE.MeshStandardMaterial({ color: 0xffe0a0 }),
      },
      { name: 'picChrome', zone: 'hall', finish: 'CP' }
    );
    expect(collectMeshMaterials(pic).has(getBathroomBrassMaterials('CP').primary)).toBe(true);
    assertZeroZFighting(pic, 'pictureLight(CP)');

    const coach = buildGeorgianCoachLantern(null, { name: 'coachBronze', finish: 'BZ' });
    expect(collectMeshMaterials(coach).has(getBathroomBrassMaterials('BZ').primary)).toBe(true);
    assertZeroZFighting(coach, 'coachLantern(BZ)');

    for (const [kind, finish] of [
      ['chandelier6Arm', 'IG'],
      ['hallLantern', 'NI'],
      ['coxFlutedPendant', 'CP'],
      ['coxFlutedSconce', 'PF'],
    ] as const satisfies ReadonlyArray<readonly [string, BrasswareFinishCode]>) {
      const light = buildHeritageInteriorLighting(null, {
        name: `light_${kind}_${finish}`,
        kind,
        finish,
      });
      expect(collectMeshMaterials(light).has(getBathroomBrassMaterials(finish).primary)).toBe(true);
      assertZeroZFighting(light, `heritageLight(${kind}, ${finish})`);
    }
  });
});
