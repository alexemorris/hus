import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createTimberBoxGeometry } from '../geometry/timber-piece-uvs.ts';
import { applyMetricBoxUVs } from '../textures/metric-masonry-uvs.ts';
import { createPropertySceneLayers } from '../viewer/scene-content.ts';
import {
  BEVEL_MIN_LENGTH_M,
  BEVEL_MIN_THICKNESS_M,
  applySelectiveBevelModifier,
  hasDefaultBoxUvs,
  type RoundedBoxParameters,
} from './bevel-modifier.ts';

function getRoundedParams(geo: THREE.BufferGeometry): RoundedBoxParameters {
  return (geo as unknown as { parameters: RoundedBoxParameters }).parameters;
}

describe('applySelectiveBevelModifier', () => {
  it('uses 1-segment chamfers by default on desktop, reserves 2-segment fillets for large hero joinery/masonry/worktops, and skips tiny sub-parts (< 22 mm or < 80 mm)', () => {
    expect(BEVEL_MIN_THICKNESS_M).toBe(0.022);
    expect(BEVEL_MIN_LENGTH_M).toBe(0.08);

    const oakMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });

    const desktopScene = new THREE.Scene();
    const desktopLayers = createPropertySceneLayers(desktopScene);
    const standardCabinetDoor = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.024), oakMat);
    standardCabinetDoor.name = 'kitchen.cabinetry.doorPanel';
    const heroWorktop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.045, 0.95), oakMat);
    heroWorktop.name = 'kitchen.island.worktop';
    const thinSubPart = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.52, 0.014), oakMat);
    thinSubPart.name = 'joinery.door.thinTrim';
    const shortSubPart = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.035), oakMat);
    shortSubPart.name = 'joinery.door.shortStop';
    desktopScene.add(standardCabinetDoor, heroWorktop, thinSubPart, shortSubPart);
    applySelectiveBevelModifier(desktopLayers, { isConstrainedMobile: false });

    // Standard cabinet door (minDim = 24 mm < 38 mm) gets crisp 1-segment chamfer (< 40% triangle cost)
    expect(standardCabinetDoor.geometry.type).toBe('RoundedBoxGeometry');
    expect(getRoundedParams(standardCabinetDoor.geometry).segments).toBe(1);

    // Large hero worktop (maxDim >= 0.65, midDim >= 0.25, minDim >= 0.038) gets 2-segment fillet on desktop
    expect(heroWorktop.geometry.type).toBe('RoundedBoxGeometry');
    expect(getRoundedParams(heroWorktop.geometry).segments).toBe(2);

    // Tiny sub-parts (minDim < 0.022 m or maxDim < 0.08 m) are skipped completely
    expect(thinSubPart.geometry.type).toBe('BoxGeometry');
    expect(shortSubPart.geometry.type).toBe('BoxGeometry');

    // Constrained mobile uses segments = 1 even on hero worktops
    const mobileScene = new THREE.Scene();
    const mobileLayers = createPropertySceneLayers(mobileScene);
    const mobileHeroWorktop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.045, 0.95), oakMat);
    mobileHeroWorktop.name = 'kitchen.island.worktop';
    mobileScene.add(mobileHeroWorktop);
    applySelectiveBevelModifier(mobileLayers, { isConstrainedMobile: true });

    expect(mobileHeroWorktop.geometry.type).toBe('RoundedBoxGeometry');
    expect(getRoundedParams(mobileHeroWorktop.geometry).segments).toBe(1);
    expect(heroWorktop.geometry.getAttribute('position').count).toBeGreaterThan(
      mobileHeroWorktop.geometry.getAttribute('position').count
    );
  });

  it('smoothly interpolates custom per-face UVs (timber grain & metric masonry) while sharing position/normal buffers and honouring opt-out flags', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const oakMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });

    const defaultBox = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.04, 0.044), oakMat);
    defaultBox.name = 'joinery.doorStileDefault';
    expect(hasDefaultBoxUvs(defaultBox.geometry.getAttribute('uv') as THREE.BufferAttribute)).toBe(
      true
    );

    const timberGeo = createTimberBoxGeometry(0.11, 2.04, 0.044, {
      grainAxis: 'y',
      materialGrainAxis: 'v',
      seed: ['doorStile', 1],
    });
    expect(hasDefaultBoxUvs(timberGeo.getAttribute('uv') as THREE.BufferAttribute)).toBe(false);
    const origTimberUv = (timberGeo.getAttribute('uv') as THREE.BufferAttribute).clone();
    const timberStile = new THREE.Mesh(timberGeo, oakMat);
    timberStile.name = 'joinery.doorStileTimber';

    const metricGeo = applyMetricBoxUVs(new THREE.BoxGeometry(1.2, 0.15, 0.35), {
      tileW: 1.15,
      tileH: 1.15,
      ox: 2.4,
      oy: 0.075,
      oz: -1.1,
    });
    const origMetricUv = (metricGeo.getAttribute('uv') as THREE.BufferAttribute).clone();
    const stoneStep = new THREE.Mesh(metricGeo, oakMat);
    stoneStep.name = 'entrance.stoneStep';

    const sculptedBrickWall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.24), oakMat);
    sculptedBrickWall.name = 'joinery.sculptedCushionOrBrick';
    sculptedBrickWall.geometry.userData.isSculpted = true;

    const lockedBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.04), oakMat);
    lockedBox.name = 'joinery.doorLeafLocked';
    lockedBox.geometry.userData.bevelLocked = true;

    const noBevelBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.04), oakMat);
    noBevelBox.name = 'joinery.doorLeafNoBevel';
    noBevelBox.userData.noBevel = true;

    scene.add(defaultBox, timberStile, stoneStep, sculptedBrickWall, lockedBox, noBevelBox);
    applySelectiveBevelModifier(layers, { segments: 2 });

    expect(defaultBox.geometry.type).toBe('RoundedBoxGeometry');
    expect(timberStile.geometry.type).toBe('RoundedBoxGeometry');
    expect(stoneStep.geometry.type).toBe('RoundedBoxGeometry');
    expect(sculptedBrickWall.geometry.type).toBe('BoxGeometry');
    expect(lockedBox.geometry.type).toBe('BoxGeometry');
    expect(noBevelBox.geometry.type).toBe('BoxGeometry');

    expect(timberStile.geometry.getAttribute('position')).toBe(
      defaultBox.geometry.getAttribute('position')
    );
    expect(timberStile.geometry.getAttribute('normal')).toBe(
      defaultBox.geometry.getAttribute('normal')
    );
    expect(timberStile.geometry.getAttribute('uv')).not.toBe(
      defaultBox.geometry.getAttribute('uv')
    );

    const verifyInterpolatedFaceCorners = (
      roundedGeo: THREE.BufferGeometry,
      srcUv: THREE.BufferAttribute,
      dims: [number, number, number]
    ) => {
      const refBox = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
      const bPos = refBox.getAttribute('position');
      const rPos = roundedGeo.getAttribute('position');
      const rUv = roundedGeo.getAttribute('uv');
      const vertsPerSide = rPos.count / 6;

      for (let side = 0; side < 6; side++) {
        for (let k = 0; k < 4; k++) {
          const srcIdx = side * 4 + k;
          const bx = bPos.getX(srcIdx);
          const by = bPos.getY(srcIdx);
          const bz = bPos.getZ(srcIdx);
          let bestVi = side * vertsPerSide;
          let bestDist = Infinity;
          for (let vi = side * vertsPerSide; vi < (side + 1) * vertsPerSide; vi++) {
            const dx = rPos.getX(vi) - bx;
            const dy = rPos.getY(vi) - by;
            const dz = rPos.getZ(vi) - bz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestDist) {
              bestDist = d2;
              bestVi = vi;
            }
          }
          expect(rUv.getX(bestVi)).toBeCloseTo(srcUv.getX(srcIdx), 4);
          expect(rUv.getY(bestVi)).toBeCloseTo(srcUv.getY(srcIdx), 4);
        }
      }
    };

    verifyInterpolatedFaceCorners(timberStile.geometry, origTimberUv, [0.11, 2.04, 0.044]);
    verifyInterpolatedFaceCorners(stoneStep.geometry, origMetricUv, [1.2, 0.15, 0.35]);
  });

  it('bevels joinery, trim, sills, plinths, stiles/rails, mantels, steps, wall cabinets, and floor mirrors within [1.2 mm, 3.5 mm] while excluding structural walls, slabs, and thin < 22 mm sub-parts', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const oakMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.52 });
    const plasterMat = new THREE.MeshStandardMaterial({
      color: 0xf4f1ea,
      roughness: 0.9,
      metalness: 0,
    });

    const makeMesh = (name: string, w: number, h: number, d: number, mat = oakMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.name = name;
      return m;
    };

    const cabinetDoor = makeMesh('kitchen.cabinetry.doorPanel', 0.58, 0.72, 0.022);
    const windowSill = makeMesh('northWall.opening.windowSill', 1.24, 0.055, 0.19);
    const plinthBlock = makeMesh('hall.door.plinthBlock_left', 0.072, 0.168, 0.028);
    const doorStile = makeMesh('joinery.door.stile_left', 0.11, 2.04, 0.044);
    const doorRail = makeMesh('joinery.door.lockRail', 0.62, 0.18, 0.044);
    const fireplaceMantel = makeMesh('living.fireplace.mantelShelf', 1.48, 0.055, 0.21);
    const fireplaceHearth = makeMesh('living.fireplace.hearth', 1.52, 0.04, 0.48);
    const stoneStep = makeMesh('entrance.portico.stoneStep', 2.2, 0.15, 1.3);
    const wallCabinet = makeMesh('kitchen.wallCabinet.carcass', 0.8, 0.9, 0.35);
    const floorMirror = makeMesh('bedroom.floorMirror.frame', 0.85, 1.85, 0.045);

    const thinPanel = makeMesh('joinery.door.fieldedPanel', 0.36, 0.52, 0.014);
    const microButton = makeMesh('kitchen.espresso.button', 0.012, 0.012, 0.008);
    const hiddenCore = makeMesh('joinery.solidDoorCore', 0.76, 1.98, 0.044);
    const northWall = makeMesh('shell.northWall', 4.2, 2.7, 0.24, plasterMat);
    const plasterLining = makeMesh('hall.plasterLining', 3.1, 2.6, 0.018, plasterMat);
    const floorSlab = makeMesh('ground.floorSlab', 4.8, 0.22, 3.8, plasterMat);
    const ceilingSlab = makeMesh('ground.ceilingSlab', 4.8, 0.18, 3.8, plasterMat);
    const cutawaySegment = makeMesh('segment_01', 1.4, 2.7, 0.24, plasterMat);
    layers.cutawayWallGroups.north.add(cutawaySegment);

    const brickWall = makeMesh('exterior.brickWallSegment', 1.8, 2.4, 0.225, plasterMat);
    brickWall.geometry.userData.isSculpted = true;

    scene.add(
      cabinetDoor,
      windowSill,
      plinthBlock,
      doorStile,
      doorRail,
      fireplaceMantel,
      fireplaceHearth,
      stoneStep,
      wallCabinet,
      floorMirror,
      thinPanel,
      microButton,
      hiddenCore,
      northWall,
      plasterLining,
      floorSlab,
      ceilingSlab,
      brickWall
    );

    applySelectiveBevelModifier(layers, { isConstrainedMobile: false });

    const expectedBevelled = [
      cabinetDoor,
      windowSill,
      plinthBlock,
      doorStile,
      doorRail,
      fireplaceMantel,
      fireplaceHearth,
      stoneStep,
      wallCabinet,
      floorMirror,
    ];
    for (const mesh of expectedBevelled) {
      expect(mesh.geometry.type, `${mesh.name} should be bevelled`).toBe('RoundedBoxGeometry');
      const r = getRoundedParams(mesh.geometry).radius;
      expect(r, `${mesh.name} radius >= 1.2 mm`).toBeGreaterThanOrEqual(0.0012 - 1e-6);
      expect(r, `${mesh.name} radius <= 3.5 mm`).toBeLessThanOrEqual(0.0035 + 1e-4);
    }

    // Hero pieces get segments = 2; smaller joinery members get segments = 1
    expect(getRoundedParams(fireplaceHearth.geometry).segments).toBe(2);
    expect(getRoundedParams(stoneStep.geometry).segments).toBe(2);
    expect(getRoundedParams(wallCabinet.geometry).segments).toBe(2);
    expect(getRoundedParams(cabinetDoor.geometry).segments).toBe(1);
    expect(getRoundedParams(doorStile.geometry).segments).toBe(1);

    const expectedExcluded = [
      thinPanel,
      microButton,
      hiddenCore,
      northWall,
      plasterLining,
      floorSlab,
      ceilingSlab,
      cutawaySegment,
      brickWall,
    ];
    for (const mesh of expectedExcluded) {
      expect(mesh.geometry.type, `${mesh.name} must remain un-bevelled`).toBe('BoxGeometry');
    }
  });
});
