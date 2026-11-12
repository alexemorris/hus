import * as THREE from 'three';
import { attachAssetMetadata } from '../shared/catalog-smart-metadata.ts';
import {
  buildPorsche992FrontFasciaAndHeadlights,
  buildPorsche992RearAeroTaillightAndDiffuser,
  buildPorsche992SideMirrorsHandlesAndIntakes,
} from './porsche-992/porsche-fascia-lights-and-aero.ts';
import {
  buildPorsche992BodyAndUnderbody,
  createPorsche992Materials,
} from './porsche-992/porsche-materials-and-body.ts';
import {
  buildPorsche992GlazingAndInteriorCabin,
  buildPorsche992WheelsAndBrakes,
} from './porsche-992/porsche-wheels-and-cabin.ts';

export * from './porsche-992/porsche-materials-and-body.ts';
export * from './porsche-992/porsche-fascia-lights-and-aero.ts';
export * from './porsche-992/porsche-wheels-and-cabin.ts';

export interface Porsche992TurboSOptions {
  readonly namePrefix?: string;
  readonly zone?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
}

/**
 * Builds an authentic, showroom-grade 3D model of a Porsche 911 (992.2) Turbo S Coupé
 * in Ocean Blue Metallic in local vehicle coordinates (origin at wheel-contact plane center).
 */
export function buildPorsche992TurboS(
  parent: THREE.Object3D,
  options: Porsche992TurboSOptions = {}
): THREE.Group {
  const {
    namePrefix = 'porsche992TurboS',
    zone,
    position = [0, 0, 0],
    rotationY = 0,
  } = options;

  const carGroup = new THREE.Group();
  carGroup.name = namePrefix;
  if (zone !== undefined) {
    carGroup.userData.zone = zone;
  }
  carGroup.position.set(position[0], position[1], position[2]);
  carGroup.rotation.y = rotationY;
  parent.add(carGroup);

  const mats = createPorsche992Materials();

  buildPorsche992BodyAndUnderbody(carGroup, mats, namePrefix);
  buildPorsche992GlazingAndInteriorCabin(carGroup, mats, namePrefix);
  buildPorsche992FrontFasciaAndHeadlights(carGroup, mats, namePrefix);
  buildPorsche992SideMirrorsHandlesAndIntakes(carGroup, mats, namePrefix);
  buildPorsche992RearAeroTaillightAndDiffuser(carGroup, mats, namePrefix);
  buildPorsche992WheelsAndBrakes(carGroup, mats, namePrefix);

  carGroup.traverse((obj) => {
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

  return attachAssetMetadata(carGroup, {
    name: 'Porsche 911 Turbo S Coupé (992)',
    brand: 'Porsche',
    collection: '911 (Type 992)',
    sku: 'POR-992-TURBO-S',
    finish: 'GT Silver Metallic & PCCB Ceramic Composite Brakes',
    category: 'vehicle',
    dimensionsMm: [4535, 1900, 1303],
    productUrl: 'https://www.porsche.com/uk/models/911/911-turbo-models/911-turbo-s/',
    schematicUrl: 'https://www.porsche.com/uk/models/911/911-turbo-models/911-turbo-s/technical-data/',
  });
}
