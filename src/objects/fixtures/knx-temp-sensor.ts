import * as THREE from 'three';
import type { UfhZoneId } from '../../engine/viewer/property-scene-profile.ts';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import type { SceneBuilderContext } from '../../engine/viewer/scene-types.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';

export interface RoomKnxTempSensorOptions {
  readonly name: string;
  readonly zone: RoomZoneId;
  readonly ufhZoneId: UfhZoneId;
  readonly sensorPa: string;
  readonly sensorGa: string;
  readonly location: string;
  readonly roomLabel: string;
  readonly defaultTempC: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotY?: number;
  readonly facing?: 'north' | 'south' | 'east' | 'west';
  readonly heatingOnByDefault?: boolean;
  readonly parentGroup?: THREE.Object3D;
  readonly cutawayWall?: CutawayWallDescriptor;
}

const sharedProbeCollarMat = new THREE.MeshStandardMaterial({
  color: 0x3a3228,
  roughness: 0.35,
  metalness: 0.78,
});

const sharedNtcBeadMat = new THREE.MeshStandardMaterial({
  color: 0x181614,
  roughness: 0.3,
  metalness: 0.2,
});

/**
 * Builds a discreet, virtually invisible KNX Bus NTC Temperature Probe (`Ø3mm` flush bead)
 * wired into the KNX universal binary/analog input inside the Corston lightswitch backbox.
 * Has no screen or separate faceplate — visually only a tiny 3mm sensing capsule on the
 * underside edge of the Corston switch plate, while registering the KNX temperature probe
 * metadata in the scene graph.
 */
export function buildRoomKnxTempSensor(
  ctx: SceneBuilderContext,
  options: RoomKnxTempSensorOptions
): THREE.Group {
  const {
    name,
    zone,
    ufhZoneId,
    sensorPa,
    sensorGa,
    location,
    roomLabel,
    defaultTempC,
    x,
    y,
    z,
    rotY,
    facing = 'south',
    parentGroup,
    cutawayWall,
  } = options;

  const resolvedRotY =
    rotY ??
    (facing === 'south'
      ? 0
      : facing === 'north'
        ? Math.PI
        : facing === 'east'
          ? Math.PI / 2
          : -Math.PI / 2);

  const sensorGroup = new THREE.Group();
  sensorGroup.name = name;
  sensorGroup.position.set(x, y, z);
  sensorGroup.rotation.y = resolvedRotY;
  sensorGroup.userData = {
    zone,
    isArchitecturalShell: true,
    isKnxTempSensor: true,
    ufhZoneId,
    switchPa: sensorPa,
    sensorGa,
    switchLocation: location,
    roomLabel,
    defaultTempC,
  };

  if (cutawayWall) {
    sensorGroup.userData = {
      ...sensorGroup.userData,
      isCutawayWall: true,
      cutawayWall,
    };
  }

  // Tiny Ø3.2mm dark-bronze grommet + Ø2.2mm NTC thermistor sensing bead flush with the
  // bottom edge of the Corston switch faceplate (y = -0.044m, z = 0.0025m) — virtually invisible.
  const probeCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0018, 0.0018, 0.0015, 10),
    sharedProbeCollarMat
  );
  probeCollar.name = `${name}.collar`;
  probeCollar.position.set(0, -0.0445, 0.0025);
  sensorGroup.add(probeCollar);

  const ntcBead = new THREE.Mesh(
    new THREE.SphereGeometry(0.0012, 8, 8),
    sharedNtcBeadMat
  );
  ntcBead.name = `${name}.ntcProbe`;
  ntcBead.position.set(0, -0.0454, 0.0025);
  sensorGroup.add(ntcBead);

  (parentGroup ?? ctx.scene).add(sensorGroup);
  return sensorGroup;
}
