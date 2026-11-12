import * as THREE from 'three';
import type { InteractiveUserData } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { KnxFixtureBuildContext } from './corston-toggle-switch.ts';
import { prepGeo, tagHighLod } from '../shared/scene-helpers.ts';

/**
 * Generic flush ceiling KNX presence detector (PIR + lux cell): white bezel, faceted Fresnel dome,
 * green activity LED. Home-agnostic — position, address and detection field come from the caller.
 */

export interface PresenceCoverageShape {
  /** XZ polygon vertices `[x, z]` (same space as the detector position). */
  readonly polygon: readonly (readonly [number, number])[];
  readonly minY: number;
  readonly maxY: number;
}

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

/**
 * Dev overlay: outline of a detector's field on its floor plane plus vertical edges up to
 * `maxY`. Not added to the scene — the caller decides (e.g. a "show PIR coverage" toggle).
 */
export function createPresenceCoverageOutline(
  coverage: PresenceCoverageShape,
  color = 0x32c864,
): THREE.LineSegments {
  const pts: THREE.Vector3[] = [];
  const poly = coverage.polygon;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    pts.push(new THREE.Vector3(ax, coverage.minY, az), new THREE.Vector3(bx, coverage.minY, bz));
    pts.push(new THREE.Vector3(ax, coverage.maxY, az), new THREE.Vector3(bx, coverage.maxY, bz));
    pts.push(new THREE.Vector3(ax, coverage.minY, az), new THREE.Vector3(ax, coverage.maxY, az));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'knx.presenceCoverage';
  lines.renderOrder = 999;
  lines.userData = { isDevOverlay: true, excludeFromRaycast: true };
  return lines;
}
