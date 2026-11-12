import * as THREE from 'three';
import { attachAssetMetadata } from '../shared/catalog-smart-metadata.ts';
import type {
  AccessPointEntityState,
  CctvCameraEntityState,
} from '../../core/entities.ts';
import type { InteractiveUserData } from '../../core/types/scene.ts';

export interface UniFiCameraVisualHandle {
  readonly entityId: string;
  readonly rootGroup: THREE.Group;
  readonly statusRingMat: THREE.MeshStandardMaterial;
  readonly frustumGroup: THREE.Group;
  readonly frustumConeMat: THREE.MeshBasicMaterial;
  readonly frustumWireMat: THREE.LineBasicMaterial;
}

export interface UniFiAccessVisualHandle {
  readonly entityId: string;
  readonly rootGroup: THREE.Group;
  readonly statusLedMat: THREE.MeshStandardMaterial;
}

/**
 * Builds a 3D UniFi Protect Bullet Camera (`UVC-AI-Pro` or `UVC-G5-Pro`)
 * with articulated wall mount, optical lens bezel, glowing UniFi status ring LED,
 * and a toggleable 3D Field-of-View (FOV) Frustum Cone.
 */
export function createUniFiProtectCamera3D(
  camera: CctvCameraEntityState,
  interactiveMeshes: THREE.Object3D[]
): UniFiCameraVisualHandle {
  const rootGroup = new THREE.Group();
  rootGroup.name = `unifi-camera-${camera.entityId}`;
  const [px, py, pz] = camera.pose3D.position;
  const [tx, ty, tz] = camera.pose3D.lookAt;
  rootGroup.position.set(px, py, pz);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: camera.model === 'UVC-AI-Pro' ? 0xf3f5f8 : 0xeef1f5,
    roughness: 0.32,
    metalness: 0.15,
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x16191f,
    roughness: 0.25,
    metalness: 0.65,
  });
  const lensGlassMat = new THREE.MeshStandardMaterial({
    color: 0x090d14,
    roughness: 0.08,
    metalness: 0.85,
  });
  const statusRingMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });

  // Aimed head group oriented toward lookAt target
  const headGroup = new THREE.Group();
  const dir = new THREE.Vector3(tx - px, ty - py, tz - pz).normalize();
  const targetQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    dir
  );
  headGroup.quaternion.copy(targetQuat);
  rootGroup.add(headGroup);

  // Wall baseplate & stalk along -Z of head
  const basePlate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.048, 0.052, 0.018, 16),
    bodyMat
  );
  if (!basePlate.name) basePlate.name = 'unifi.device.basePlate';
  basePlate.rotation.x = Math.PI / 2;
  basePlate.position.z = -0.11;
  headGroup.add(basePlate);

  const mountArm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.022, 0.09, 12),
    bodyMat
  );
  if (!mountArm.name) mountArm.name = 'unifi.device.mountArm';
  mountArm.rotation.x = Math.PI / 2;
  mountArm.position.z = -0.065;
  headGroup.add(mountArm);

  // Cylindrical bullet housing
  const bodyLen = camera.model === 'UVC-AI-Pro' ? 0.15 : 0.13;
  const bodyRad = camera.model === 'UVC-AI-Pro' ? 0.044 : 0.04;
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyRad, bodyRad * 0.94, bodyLen, 20),
    bodyMat
  );
  if (!barrel.name) barrel.name = 'unifi.device.barrel';
  barrel.rotation.x = Math.PI / 2;
  barrel.castShadow = true;
  const userData: InteractiveUserData = {
    isUniFiCamera: true,
    cameraEntityId: camera.entityId,
    zoneId: camera.zoneId,
  };
  barrel.userData = userData;
  interactiveMeshes.push(barrel);
  headGroup.add(barrel);

  // Front black optical face & lens
  const bezel = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyRad * 0.92, bodyRad * 0.92, 0.012, 20),
    darkMetalMat
  );
  if (!bezel.name) bezel.name = 'unifi.device.bezel';
  bezel.rotation.x = Math.PI / 2;
  bezel.position.z = bodyLen * 0.5 + 0.004;
  headGroup.add(bezel);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(bodyRad * 0.48, 16, 12),
    lensGlassMat
  );
  if (!lens.name) lens.name = 'unifi.device.lens';
  lens.scale.set(1, 1, 0.45);
  lens.position.z = bodyLen * 0.5 + 0.008;
  headGroup.add(lens);

  // Signature UniFi glowing LED ring around front bezel
  const statusRing = new THREE.Mesh(
    new THREE.TorusGeometry(bodyRad * 0.76, 0.0035, 8, 24),
    statusRingMat
  );
  if (!statusRing.name) statusRing.name = 'unifi.device.statusRing';
  statusRing.position.z = bodyLen * 0.5 + 0.011;
  headGroup.add(statusRing);

  // 3D Field-of-View (FOV) Frustum Cone extending along +Z of headGroup
  const frustumGroup = new THREE.Group();
  frustumGroup.name = `unifi.frustum.${camera.entityId}`;
  frustumGroup.visible = camera.showFrustum3D;
  frustumGroup.userData = { isSecurityFovCone: true, lodIgnore: true };
  const range = camera.pose3D.rangeMeters;
  const halfFovRad = THREE.MathUtils.degToRad(camera.pose3D.horizontalFovDeg * 0.5);
  const farRadius = Math.tan(halfFovRad) * range;

  const coneGeo = new THREE.ConeGeometry(farRadius, range, 4, 1, true);
  // Rotate so apex is at origin (0,0,0) and cone opens along +Z
  coneGeo.rotateY(Math.PI / 4);
  coneGeo.rotateX(-Math.PI / 2);
  coneGeo.translate(0, 0, range * 0.5 + bodyLen * 0.5);

  const frustumConeMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.11,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const frustumMesh = new THREE.Mesh(coneGeo, frustumConeMat);
  frustumMesh.name = `unifi.frustumMesh.${camera.entityId}`;
  frustumMesh.userData = { isSecurityFovCone: true, lodIgnore: true };
  frustumGroup.add(frustumMesh);

  const edgesGeo = new THREE.EdgesGeometry(coneGeo);
  const frustumWireMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.45,
  });
  const frustumLines = new THREE.LineSegments(edgesGeo, frustumWireMat);
  frustumLines.name = `unifi.frustumLines.${camera.entityId}`;
  frustumLines.userData = { isSecurityFovCone: true, lodIgnore: true };
  frustumGroup.add(frustumLines);

  headGroup.add(frustumGroup);
  attachAssetMetadata(rootGroup, {
    name: `UniFi Protect ${camera.model} Security Camera`,
    brand: 'Ubiquiti UniFi',
    collection: 'UniFi Protect',
    sku: camera.model,
    finish: 'IP65 Powder-Coated Aluminium & Polycarbonate',
    category: 'device',
    dimensionsMm: camera.model === 'UVC-G5-Dome' ? [109, 109, 64] : [86, 255, 86],
    productUrl: 'https://uk.store.ui.com/uk/en/category/all-cameras-nvrs',
    schematicUrl: 'https://dl.ui.com/ds/uvc-ai-pro_ds.pdf',
  });

  return {
    entityId: camera.entityId,
    rootGroup,
    statusRingMat,
    frustumGroup,
    frustumConeMat,
    frustumWireMat,
  };
}

/**
 * Builds a 3D UniFi Access G2 Reader Pro / Intercom (`UA-G2-Pro` or `UA-Hub-Door-Mini`)
 * mounted on a brick pier or entrance jamb.
 */
export function createUniFiAccessReader3D(
  accessPoint: AccessPointEntityState,
  interactiveMeshes: THREE.Object3D[]
): UniFiAccessVisualHandle {
  const rootGroup = new THREE.Group();
  rootGroup.name = `unifi-access-${accessPoint.entityId}`;
  const [px, py, pz] = accessPoint.position3D;
  rootGroup.position.set(px, py, pz);
  if (accessPoint.rotationY !== undefined) {
    rootGroup.rotation.y = accessPoint.rotationY;
  }

  const chassisMat = new THREE.MeshStandardMaterial({
    color: 0x1b1f26,
    roughness: 0.28,
    metalness: 0.72,
  });
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0c131f,
    emissive: 0x0ea5e9,
    emissiveIntensity: 0.35,
    roughness: 0.12,
    metalness: 0.4,
  });
  const statusLedMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 2.4,
    roughness: 0.2,
  });

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.175, 0.028),
    chassisMat
  );
  if (!chassis.name) chassis.name = 'unifi.device.chassis';
  chassis.castShadow = true;
  const userData: InteractiveUserData = {
    isUniFiAccessReader: true,
    accessEntityId: accessPoint.entityId,
    zoneId: accessPoint.zoneId,
  };
  chassis.userData = userData;
  interactiveMeshes.push(chassis);
  rootGroup.add(chassis);

  const display = new THREE.Mesh(
    new THREE.BoxGeometry(0.068, 0.125, 0.004),
    screenMat
  );
  if (!display.name) display.name = 'unifi.device.display';
  display.position.set(0, 0.012, 0.015);
  display.userData = userData;
  interactiveMeshes.push(display);
  rootGroup.add(display);

  const statusLedBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.052, 0.007, 0.005),
    statusLedMat
  );
  if (!statusLedBar.name) statusLedBar.name = 'unifi.device.statusLedBar';
  statusLedBar.position.set(0, -0.066, 0.015);
  rootGroup.add(statusLedBar);
  attachAssetMetadata(rootGroup, {
    name: 'UniFi Access G2 Reader Pro Smart Entry Intercom',
    brand: 'Ubiquiti UniFi',
    collection: 'UniFi Access',
    sku: 'UA-G2-Pro',
    finish: 'Anodized Obsidian Aluminium & Gorilla Glass',
    category: 'device',
    dimensionsMm: [73, 35, 160],
    productUrl: 'https://uk.store.ui.com/uk/en/category/all-door-access',
    schematicUrl: 'https://dl.ui.com/ds/ua-g2-pro_ds.pdf',
  });

  return {
    entityId: accessPoint.entityId,
    rootGroup,
    statusLedMat,
  };
}
