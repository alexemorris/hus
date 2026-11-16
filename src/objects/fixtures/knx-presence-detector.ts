import * as THREE from 'three';
import type { InteractiveUserData } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { KnxFixtureBuildContext } from './corston-toggle-switch.ts';
import { prepGeo, tagHighLod } from '../shared/scene-helpers.ts';

/**
 * Generic flush ceiling KNX presence detector (PIR + lux cell): white bezel, faceted Fresnel dome,
 * green activity LED. Home-agnostic — position, address and detection field come from the caller.
 */

export interface KnxPresenceDetectorOptions {
  readonly name: string;
  readonly presenceDetectorPa: string;
  readonly zoneId: RoomZoneId;
  /** Point on the ceiling surface the detector is mounted to. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Extra flags merged into the clickable meshes (e.g. legacy kitchen/utility sensor flags). */
  readonly userData?: InteractiveUserData;
  readonly parentGroup?: THREE.Object3D;
  /** Default true: register bezel + dome as interactive (click toggles simulated presence). */
  readonly interactive?: boolean;
}

export interface KnxPresenceDetectorHandle {
  readonly group: THREE.Group;
  readonly ledMaterial: THREE.MeshStandardMaterial;
  setDetected(detected: boolean): void;
}

const LED_ON_INTENSITY = 2.6;
const LED_OFF_INTENSITY = 0.04;

const bezelGeo = prepGeo(new THREE.CylinderGeometry(0.05, 0.047, 0.012, 24));
const domeGeo = prepGeo(new THREE.SphereGeometry(0.031, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.5));
const luxGeo = prepGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.003, 10));
const ledGeo = prepGeo(new THREE.SphereGeometry(0.0025, 8, 6));

const housingMat = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.55, metalness: 0.02 });
const fresnelMat = new THREE.MeshStandardMaterial({
  color: 0xfbfbf7,
  roughness: 0.3,
  metalness: 0.0,
  flatShading: true,
});
const luxMat = new THREE.MeshStandardMaterial({ color: 0x1e2631, roughness: 0.2, metalness: 0.6 });
const sharedActivityLedMat = new THREE.MeshStandardMaterial({
  color: 0x4be07a,
  emissive: new THREE.Color(0x32c864),
  emissiveIntensity: LED_OFF_INTENSITY,
});

export function buildKnxPresenceDetector(
  ctx: KnxFixtureBuildContext,
  options: KnxPresenceDetectorOptions,
): KnxPresenceDetectorHandle {
  const { name, presenceDetectorPa, zoneId, x, y, z, parentGroup } = options;
  const interactive = options.interactive ?? true;
  const data: InteractiveUserData = { ...options.userData, presenceDetectorPa, zoneId };

  const group = new THREE.Group();
  group.name = name;
  group.position.set(x, y, z);
  group.userData = { zone: zoneId, presenceDetectorPa };

  const bezel = new THREE.Mesh(bezelGeo, housingMat);
  bezel.name = `${name}.bezel`;
  bezel.position.y = -0.006;
  group.add(bezel);

  const dome = new THREE.Mesh(domeGeo, fresnelMat);
  dome.name = `${name}.fresnelDome`;
  dome.rotation.x = Math.PI;
  dome.position.y = -0.012;
  group.add(dome);

  const lux = new THREE.Mesh(luxGeo, luxMat);
  lux.name = `${name}.luxWindow`;
  lux.position.set(0.039, -0.0125, 0);
  tagHighLod(lux, 14);
  group.add(lux);

  const ledMaterial = sharedActivityLedMat;
  const led = new THREE.Mesh(ledGeo, ledMaterial);
  led.name = `${name}.activityLed`;
  led.position.set(-0.039, -0.0125, 0);
  tagHighLod(led, 14);
  group.add(led);

  for (const mesh of [bezel, dome, led]) {
    Object.assign(mesh.userData, data);
    if (interactive) ctx.interactiveMeshes.push(mesh);
  }

  (parentGroup ?? ctx.scene).add(group);

  return {
    group,
    ledMaterial,
    setDetected: (detected) => {
      ledMaterial.emissiveIntensity = detected ? LED_ON_INTENSITY : LED_OFF_INTENSITY;
    },
  };
}
