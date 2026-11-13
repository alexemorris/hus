import * as THREE from 'three';
import type { CircuitId } from '../../core/types/knx.ts';
import type { CutawayWallDescriptor, InteractiveUserData } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import { soundEngine } from '../../engine/audio/sound-engine.ts';
import {
  getBathroomBrassMaterials,
  resolveFixtureFinishToBrassCode,
} from '../sanitaryware/bathroom-materials.ts';
import type { FixtureMetalFinish } from '../sanitaryware/bathroom-spec-types.ts';
import { prepGeo, tagHighLod } from '../shared/scene-helpers.ts';

/**
 * Generic N-gang Corston Architectural antique-brass dolly toggle plate on a KNX push-button
 * coupler. Each gang is its own clickable target (upper half = "up", lower half = "down") carrying
 * the push-button's physical address, gang number and the lighting zone it drives, plus a small
 * amber status LED (zone-on feedback). Home-agnostic: placement and bindings come from the caller.
 */

export type WallFacing = 'north' | 'south' | 'east' | 'west';

export interface CorstonToggleGangSpec {
  /** 1-based gang index on the plate, left to right. */
  readonly gang: number;
  /** Lighting zone whose scene / night / full objects this gang sends to. */
  readonly zoneId: RoomZoneId;
  readonly label: string;
  /** First circuit of the zone (legacy circuit handlers + LED registration). */
  readonly circuitId?: CircuitId;
}

/** The minimal builder context this fixture needs (satisfied by `SceneBuilderContext`). */
export interface KnxFixtureBuildContext {
  readonly scene: THREE.Object3D;
  readonly interactiveMeshes: THREE.Object3D[];
  registerSwitchLedMaterial?(circuitId: CircuitId, mat: THREE.MeshStandardMaterial): void;
}

export interface CorstonToggleSwitchOptions {
  /** Scene-graph name of the plate group (meshes are `${name}.g<gang>.*`). */
  readonly name: string;
  readonly switchPa: string;
  /** Human-readable mounting location ("Kitchen — east door, latch side"). */
  readonly location: string;
  readonly gangs: readonly CorstonToggleGangSpec[];
  /** World (or parent-local) centre of the plate face on the wall. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Explicit yaw; otherwise derived from `facing` (direction the plate faces into the room). */
  readonly rotY?: number;
  readonly facing?: WallFacing;
  /** Room the plate is mounted in (tags the group for room LOD / tracking). */
  readonly mountedInZoneId?: RoomZoneId;
  readonly parentGroup?: THREE.Object3D;
  readonly cutawayWall?: CutawayWallDescriptor;
  /** Reuse an existing LED material for a gang (legacy indicator wiring); default: new per gang. */
  readonly ledMaterialForGang?: (gang: number) => THREE.MeshStandardMaterial | undefined;
  /** Extra flags merged into a gang's clickable meshes (legacy handler flags). */
  readonly extraUserDataForGang?: (gang: number) => InteractiveUserData | undefined;
  /** Status LED intensity at build time (default off). */
  readonly ledInitiallyOn?: boolean;
  /** Optional Corston / Perrin & Rowe metal finish preset (defaults to Corston Antique Brass when omitted). */
  readonly finish?: FixtureMetalFinish;
}

export interface CorstonToggleSwitchHandle {
  readonly group: THREE.Group;
  readonly gangCount: number;
  /** Per-gang LED material (gang number → material). */
  readonly ledMaterials: ReadonlyMap<number, THREE.MeshStandardMaterial>;
  /** Lights / darkens a gang's status LED (e.g. zone mode !== 'off'). */
  setGangLed(gang: number, on: boolean): void;
  /** Tilts a gang's dolly to show the last operated direction. */
  setGangDolly(gang: number, direction: 'up' | 'down'): void;
}

// Dimensions (metres)

const PLATE_HEIGHT = 0.088;
const PLATE_DEPTH = 0.004;
const SINGLE_PLATE_WIDTH = 0.088;
const GANG_PITCH = 0.058;
const DOLLY_TILT_RAD = 0.32;
const LED_ON_INTENSITY = 3.0;
const LED_OFF_INTENSITY = 0.05;

export function corstonPlateWidth(gangCount: number): number {
  return SINGLE_PLATE_WIDTH + Math.max(0, gangCount - 1) * GANG_PITCH;
}

export function facingToRotY(facing: WallFacing): number {
  return facing === 'south' ? 0 : facing === 'north' ? Math.PI : facing === 'east' ? Math.PI / 2 : -Math.PI / 2;
}

// Shared resources

const plateGeoCache = new Map<number, THREE.BoxGeometry>();
function plateGeo(gangCount: number): THREE.BoxGeometry {
  let geo = plateGeoCache.get(gangCount);
  if (!geo) {
    geo = prepGeo(new THREE.BoxGeometry(corstonPlateWidth(gangCount), PLATE_HEIGHT, PLATE_DEPTH));
    plateGeoCache.set(gangCount, geo);
  }
  return geo;
}

const singleHalfGeo = prepGeo(new THREE.BoxGeometry(0.078, 0.032, 0.003));
const multiHalfGeo = prepGeo(new THREE.BoxGeometry(GANG_PITCH - 0.004, 0.032, 0.003));
const collarGeo = prepGeo(new THREE.CylinderGeometry(0.0115, 0.013, 0.006, 16));
const pivotGeo = prepGeo(new THREE.SphereGeometry(0.0075, 10, 10));
const leverGeo = prepGeo(new THREE.CylinderGeometry(0.0028, 0.0048, 0.026, 12));
const tipGeo = prepGeo(new THREE.SphereGeometry(0.0034, 10, 10));
const ledGeo = prepGeo(new THREE.CylinderGeometry(0.0024, 0.0024, 0.002, 10));
const screwGeo = prepGeo(new THREE.CylinderGeometry(0.0022, 0.0022, 0.002, 10));

/** Corston Architectural Detail antique brass (matches corston-power-sockets.ts). */
const brassMat = new THREE.MeshStandardMaterial({ color: 0xb89146, roughness: 0.27, metalness: 0.85 });
const bronzeMat = new THREE.MeshStandardMaterial({ color: 0x5c4422, roughness: 0.4, metalness: 0.8 });

const statusLedMatCache = new Map<string, THREE.MeshStandardMaterial>();
function getSharedLedMaterial(key: string, on: boolean): THREE.MeshStandardMaterial {
  const cacheKey = `${key}:${on ? 1 : 0}`;
  let mat = statusLedMatCache.get(cacheKey);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: 0xffb84d,
      emissive: new THREE.Color(0xff9d2e),
      emissiveIntensity: on ? LED_ON_INTENSITY : LED_OFF_INTENSITY,
    });
    statusLedMatCache.set(cacheKey, mat);
  }
  return mat;
}

function makeInteractive(
  mesh: THREE.Object3D,
  data: InteractiveUserData,
  interactiveMeshes: THREE.Object3D[],
): void {
  Object.assign(mesh.userData, data);
  interactiveMeshes.push(mesh);
}

// Builder

export function buildCorstonToggleSwitch(
  ctx: KnxFixtureBuildContext,
  options: CorstonToggleSwitchOptions,
): CorstonToggleSwitchHandle {
  const { name, switchPa, location, x, y, z, parentGroup, cutawayWall, mountedInZoneId } = options;
  const gangs = [...options.gangs].sort((a, b) => a.gang - b.gang);
  const gangCount = Math.max(1, gangs.length);

  const group = new THREE.Group();
  group.name = name;
  group.position.set(x, y, z);
  group.rotation.y = options.rotY ?? facingToRotY(options.facing ?? 'south');
  group.userData = {
    ...(mountedInZoneId ? { zone: mountedInZoneId } : {}),
    knxPushButtonPa: switchPa,
    switchLocation: location,
    ...(cutawayWall ? { isCutawayWall: true, cutawayWall } : {}),
  };

  const customPal = options.finish
    ? getBathroomBrassMaterials(resolveFixtureFinishToBrassCode(options.finish))
    : null;
  const activeBrassMat = customPal ? customPal.primary : brassMat;
  const activeBronzeMat = customPal ? customPal.darkShadow : bronzeMat;

  const plate = new THREE.Mesh(plateGeo(gangCount), activeBrassMat);
  plate.name = `${name}.backplate`;
  plate.position.set(0, 0, 0.006);
  group.add(plate);

  // Two slotted fixing screws (top / bottom centre) like the Corston plates.
  for (const sy of [0.038, -0.038]) {
    const screw = new THREE.Mesh(screwGeo, activeBronzeMat);
    screw.name = `${name}.screw`;
    screw.rotation.x = Math.PI / 2;
    screw.position.set(0, sy, 0.013);
    tagHighLod(screw, 6);
    group.add(screw);
  }

  const ledMaterials = new Map<number, THREE.MeshStandardMaterial>();
  const dollies = new Map<number, THREE.Group>();
  const halfGeo = gangCount === 1 ? singleHalfGeo : multiHalfGeo;

  gangs.forEach((spec, i) => {
    const offsetX = (i - (gangCount - 1) / 2) * GANG_PITCH;
    const prefix = `${name}.g${spec.gang}`;
    const base: InteractiveUserData = {
      ...options.extraUserDataForGang?.(spec.gang),
      isKNXSwitch: true,
      switchPa,
      switchGang: spec.gang,
      zoneSceneSwitchZoneId: spec.zoneId,
      switchLocation: `${location} · G${spec.gang} ${spec.label}`,
      ...(spec.circuitId ? { circuitId: spec.circuitId } : {}),
    };
    const up: InteractiveUserData = { ...base, switchDirection: 'up' };
    const down: InteractiveUserData = { ...base, switchDirection: 'down' };

    const upper = new THREE.Mesh(halfGeo, activeBrassMat);
    upper.name = `${prefix}.upperHalf`;
    upper.position.set(offsetX, 0.018, 0.0135);
    makeInteractive(upper, up, ctx.interactiveMeshes);
    group.add(upper);

    const lower = new THREE.Mesh(halfGeo, activeBrassMat);
    lower.name = `${prefix}.lowerHalf`;
    lower.position.set(offsetX, -0.018, 0.0135);
    makeInteractive(lower, down, ctx.interactiveMeshes);
    group.add(lower);

    const collar = new THREE.Mesh(collarGeo, activeBronzeMat);
    collar.name = `${prefix}.collar`;
    collar.rotation.x = Math.PI / 2;
    collar.position.set(offsetX, 0, 0.022);
    tagHighLod(collar, 14);
    makeInteractive(collar, up, ctx.interactiveMeshes);
    group.add(collar);

    // Dolly = pivot dome + lever + tip, hinged at the collar so it can tilt up / down.
    const dolly = new THREE.Group();
    dolly.name = `${prefix}.dolly`;
    dolly.position.set(offsetX, 0, 0.027);
    dolly.rotation.x = -DOLLY_TILT_RAD;
    const pivot = new THREE.Mesh(pivotGeo, activeBrassMat);
    pivot.name = `${prefix}.dolly.pivot`;
    tagHighLod(pivot, 14);
    makeInteractive(pivot, up, ctx.interactiveMeshes);
    dolly.add(pivot);
    const lever = new THREE.Mesh(leverGeo, activeBrassMat);
    lever.name = `${prefix}.dolly.lever`;
    lever.rotation.x = Math.PI / 2;
    lever.position.set(0, 0, 0.01);
    tagHighLod(lever, 14);
    makeInteractive(lever, up, ctx.interactiveMeshes);
    dolly.add(lever);
    const tip = new THREE.Mesh(tipGeo, activeBrassMat);
    tip.name = `${prefix}.dolly.tip`;
    tip.position.set(0, 0, 0.023);
    tagHighLod(tip, 14);
    makeInteractive(tip, up, ctx.interactiveMeshes);
    dolly.add(tip);
    group.add(dolly);
    dollies.set(spec.gang, dolly);

    const ledMat =
      options.ledMaterialForGang?.(spec.gang) ??
      getSharedLedMaterial(spec.circuitId ?? `zone:${spec.zoneId}`, options.ledInitiallyOn === true);
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.name = `${prefix}.statusLed`;
    led.rotation.x = Math.PI / 2;
    led.position.set(offsetX, 0.0405, 0.013);
    tagHighLod(led, 14);
    group.add(led);
    ledMaterials.set(spec.gang, ledMat);
    if (spec.circuitId) ctx.registerSwitchLedMaterial?.(spec.circuitId, ledMat);
  });

  (parentGroup ?? ctx.scene).add(group);

  return {
    group,
    gangCount,
    ledMaterials,
    setGangLed: (gang, on) => {
      const mat = ledMaterials.get(gang);
      if (!mat) return;
      mat.emissiveIntensity = on ? LED_ON_INTENSITY : LED_OFF_INTENSITY;
    },
    setGangDolly: (gang, direction) => {
      const dolly = dollies.get(gang);
      if (dolly) dolly.rotation.x = direction === 'up' ? -DOLLY_TILT_RAD : DOLLY_TILT_RAD;
    },
  };
}

/**
 * Synthesizes tactile audio for Corston Architectural antique-brass toggle switches (`'switch'`),
 * KNX room scene recalls (`'scene'`), and UFH hydronic manifold actuators (`'ufh'`).
 */
export function playCorstonSwitchSound(
  kind: 'switch' | 'scene' | 'ufh',
  worldPos?: { readonly x: number; readonly y: number; readonly z: number }
): void {
  soundEngine.triggerSpatialFoley(
    worldPos,
    (tk) => {
      const { now } = tk;
      if (kind === 'switch') {
        tk.tone({
          startTime: now,
          duration: 0.022,
          type: 'triangle',
          freqStart: 2850,
          freqEnd: 1620,
          gainPeak: 0.16,
        });
        tk.tone({
          startTime: now + 0.004,
          duration: 0.032,
          type: 'sine',
          freqStart: 720,
          freqEnd: 290,
          gainPeak: 0.12,
        });
      } else if (kind === 'scene') {
        tk.tone({
          startTime: now,
          duration: 0.16,
          type: 'sine',
          freqStart: 880,
          freqEnd: 880,
          gainPeak: 0.08,
        });
        tk.tone({
          startTime: now + 0.045,
          duration: 0.22,
          type: 'sine',
          freqStart: 1318.5,
          freqEnd: 1318.5,
          gainPeak: 0.07,
        });
      } else {
        tk.tone({
          startTime: now,
          duration: 0.038,
          type: 'sine',
          freqStart: 540,
          freqEnd: 320,
          gainPeak: 0.13,
        });
        tk.tone({
          startTime: now + 0.03,
          duration: 0.045,
          type: 'triangle',
          freqStart: 1120,
          freqEnd: 860,
          gainPeak: 0.08,
        });
      }
    },
    { dryGain: 0.9, wetSend: 0.12, refDistance: 1.4, maxDistance: 14 }
  );
}
