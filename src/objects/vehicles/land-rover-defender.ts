import * as THREE from 'three';
import { attachAssetMetadata } from '../shared/catalog-smart-metadata.ts';
import {
  buildDefender110FrontFasciaAndHeadlights,
  buildDefender110SignatureExteriorAccessories,
  buildDefender110TailgateTaillightsAndExhaust,
} from './defender-110/defender-exterior-trim-and-lights.ts';
import {
  buildDefender110MonocoqueAndCladding,
  createDefender110Materials,
} from './defender-110/defender-materials-and-monocoque.ts';
import {
  buildDefender110GlazingTrimAndCabinInterior,
  buildDefender110WheelsAndSpare,
} from './defender-110/defender-wheels-and-interior.ts';

export * from './defender-110/defender-materials-and-monocoque.ts';
export * from './defender-110/defender-exterior-trim-and-lights.ts';
export * from './defender-110/defender-wheels-and-interior.ts';

export interface LandRoverDefenderOptions {
  readonly namePrefix?: string;
  readonly zone?: string;
  readonly positionXZ?: readonly [number, number];
  readonly fallbackGroundY?: number;
  readonly fallbackNormal?: readonly [number, number, number];
  readonly yaw?: number;
  readonly sampleTerrainY?: (wx: number, wz: number) => number;
}

/**
 * Builds an authentic, showroom-grade 3D model of a Black Land Rover Defender 110
 * (L663 V8 Carpathian / Black Pack Edition in Santorini Black Metallic) aligned to
 * an optional terrain height sampler across its 4 wheel contact patches.
 */
export function buildLandRoverDefender(
  parent: THREE.Object3D,
  options: LandRoverDefenderOptions = {}
): THREE.Group {
  const {
    namePrefix = 'landRoverDefender',
    zone,
    positionXZ: [worldCenterX, worldCenterZ] = [0, 0],
    fallbackGroundY = 0,
    fallbackNormal: [nx, ny, nz] = [0, 1, 0],
    yaw = 0,
    sampleTerrainY,
  } = options;

  const defenderGroup = new THREE.Group();
  defenderGroup.name = namePrefix;
  if (zone !== undefined) {
    defenderGroup.userData.zone = zone;
  }

  const sampleGroundY = (wx: number, wz: number): number => {
    if (sampleTerrainY) {
      const gy = sampleTerrainY(wx, wz);
      if (Number.isFinite(gy)) return gy;
    }
    return fallbackGroundY - (nx * (wx - worldCenterX) + nz * (wz - worldCenterZ)) / ny;
  };

  const toWorldXZ = (localX: number, localZ: number): [number, number] => {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    return [
      worldCenterX + localX * cosY + localZ * sinY,
      worldCenterZ - localX * sinY + localZ * cosY,
    ];
  };

  const yCenterGround = sampleGroundY(worldCenterX, worldCenterZ);
  const [frontAxleWX, frontAxleWZ] = toWorldXZ(-1.51, 0);
  const [rearAxleWX, rearAxleWZ] = toWorldXZ(1.51, 0);
  const [leftTrackWX, leftTrackWZ] = toWorldXZ(0, -0.86);
  const [rightTrackWX, rightTrackWZ] = toWorldXZ(0, 0.86);

  const yFrontAxle = sampleGroundY(frontAxleWX, frontAxleWZ);
  const yRearAxle = sampleGroundY(rearAxleWX, rearAxleWZ);
  const yLeftTrack = sampleGroundY(leftTrackWX, leftTrackWZ);
  const yRightTrack = sampleGroundY(rightTrackWX, rightTrackWZ);

  const wheelContactAvgY =
    0.25 * (yFrontAxle + yRearAxle + yLeftTrack + yRightTrack);
  const baseGroundY = 0.5 * (yCenterGround + wheelContactAvgY);

  const pitchZ = Math.atan2(yRearAxle - yFrontAxle, 3.022);
  const rollX = Math.atan2(yLeftTrack - yRightTrack, 1.72);

  defenderGroup.rotation.order = 'YXZ';
  defenderGroup.position.set(worldCenterX, baseGroundY, worldCenterZ);
  defenderGroup.rotation.set(rollX, yaw, pitchZ);
  parent.add(defenderGroup);

  const mats = createDefender110Materials();

  buildDefender110MonocoqueAndCladding(defenderGroup, mats, namePrefix);
  buildDefender110SignatureExteriorAccessories(defenderGroup, mats, namePrefix);
  buildDefender110FrontFasciaAndHeadlights(defenderGroup, mats, namePrefix);
  buildDefender110TailgateTaillightsAndExhaust(defenderGroup, mats, namePrefix);
  buildDefender110WheelsAndSpare(defenderGroup, mats, namePrefix);
  buildDefender110GlazingTrimAndCabinInterior(defenderGroup, mats, namePrefix);

  defenderGroup.traverse((obj) => {
    if (zone !== undefined) {
      obj.userData.zone = zone;
    }
    if (!obj.name) {
      obj.name = `${namePrefix}.part`;
    }
    if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.BufferGeometry) {
      if (!obj.geometry.boundingSphere) {
        obj.geometry.computeBoundingSphere();
      }
    }
  });

  return attachAssetMetadata(defenderGroup, {
    name: 'Land Rover Defender 110 P400 X-Dynamic HSE',
    brand: 'Land Rover',
    collection: 'Defender 110 (L663)',
    sku: 'LR-DEF110-P400-GRN',
    finish: 'Pangea Green Satin Metallic & Narvik Black Pack',
    category: 'vehicle',
    dimensionsMm: [5018, 2008, 1967],
    productUrl: 'https://www.landrover.co.uk/defender/defender-110/index.html',
    schematicUrl: 'https://www.landrover.co.uk/defender/defender-110/specifications.html',
  });
}
