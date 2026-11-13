import * as THREE from 'three';
import {
  getBathroomBrassMaterials,
  resolveFixtureFinishToBrassCode,
} from '../sanitaryware/bathroom-materials.ts';
import type { FixtureMetalFinish } from '../sanitaryware/bathroom-spec-types.ts';

export interface FlutedBrassPictureLightMaterials {
  readonly brass: THREE.Material;
  readonly darkBrass: THREE.Material;
  /** Emissive diffuser slit material; callers register it with the light circuit. */
  readonly glow: THREE.Material;
}

export interface FlutedBrassPictureLightOptions {
  /** Base object name, e.g. `livingRoom.eastWallLight.1`; sub-meshes get `.backplate`, `.shade`, `.bulb`. */
  readonly name: string;
  readonly zone: string;
  /** Width of the horizontal reeded shade across the top of the picture. */
  readonly shadeWidth?: number;
  /** Optional metal finish override across all 9 finishes + Corston presets (uses `activeMats.brass` / `activeMats.darkBrass` when omitted). */
  readonly finish?: FixtureMetalFinish;
}

/**
 * Fluted antique-brass horizontal picture light: stepped rosette backplate with beaded rim, swan-neck arm,
 * reeded cylindrical shade with gadrooned end caps and finials, and a warm downward diffuser slit.
 *
 * Built in a local frame where the wall face is the XY plane and the fitting projects towards +Z; position
 * and yaw the returned group onto the wall. No lights are attached here.
 */
export function buildFlutedBrassPictureLight(
  mats: FlutedBrassPictureLightMaterials,
  options: FlutedBrassPictureLightOptions
): THREE.Group {
  const { name } = options;
  const overridePal = options.finish
    ? getBathroomBrassMaterials(resolveFixtureFinishToBrassCode(options.finish))
    : null;
  const activeMats: FlutedBrassPictureLightMaterials = overridePal
    ? { brass: overridePal.primary, darkBrass: overridePal.darkShadow, glow: mats.glow }
    : mats;
  const wallLightGroup = new THREE.Group();
  wallLightGroup.name = name;
  wallLightGroup.userData.zone = options.zone;

  // Circular Stepped Antique-Brass Wall Rosette Backplate with beaded rim (facing +Z into the room)
  const backplate = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.048, 0.014, 24), activeMats.brass);
  backplate.name = `${name}.backplate`;
  backplate.rotation.x = Math.PI / 2;
  backplate.position.set(0, 0, 0.007);
  backplate.castShadow = true;
  wallLightGroup.add(backplate);

  const beadedRim = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.004, 10, 28), activeMats.darkBrass);
  if (!beadedRim.name) beadedRim.name = 'fixture.pictureLight.beadedRim';
  beadedRim.position.set(0, 0, 0.012);
  wallLightGroup.add(beadedRim);

  const centerBoss = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.016, 16), activeMats.brass);
  if (!centerBoss.name) centerBoss.name = 'fixture.pictureLight.centerBoss';
  centerBoss.rotation.x = Math.PI / 2;
  centerBoss.position.set(0, 0, 0.018);
  wallLightGroup.add(centerBoss);

  // Curved Swan-Neck Antique-Brass Arm arching outward (+Z) and slightly down to hold the horizontal shade
  const swanArmRise = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0075, 0.095, 12), activeMats.brass);
  if (!swanArmRise.name) swanArmRise.name = 'fixture.pictureLight.swanArmRise';
  swanArmRise.rotation.x = Math.PI * 0.38;
  swanArmRise.position.set(0, 0.022, 0.062);
  swanArmRise.castShadow = true;
  wallLightGroup.add(swanArmRise);

  const swanArch = new THREE.Mesh(
    new THREE.TorusGeometry(0.032, 0.0065, 10, 18, Math.PI * 0.85),
    activeMats.brass
  );
  if (!swanArch.name) swanArch.name = 'fixture.pictureLight.swanArch';
  swanArch.rotation.y = Math.PI / 2;
  swanArch.rotation.z = Math.PI * 0.12;
  swanArch.position.set(0, 0.014, 0.105);
  wallLightGroup.add(swanArch);

  // Knurled brass knuckle joint & central shade strap ring at z = 0.132m, y = -0.014m
  const shadeZ = 0.132;
  const shadeY = -0.014;
  const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.024, 14), activeMats.darkBrass);
  if (!knuckle.name) knuckle.name = 'fixture.pictureLight.knuckle';
  knuckle.position.set(0, shadeY + 0.026, shadeZ);
  wallLightGroup.add(knuckle);

  const centerStrap = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 10, 20), activeMats.darkBrass);
  if (!centerStrap.name) centerStrap.name = 'fixture.pictureLight.centerStrap';
  centerStrap.rotation.y = Math.PI / 2;
  centerStrap.position.set(0, shadeY, shadeZ);
  wallLightGroup.add(centerStrap);

  // Horizontal Fluted / Reeded Cylindrical Brass Picture-Light Shade across the top of the picture
  const shadeW = options.shadeWidth ?? 0.34;
  const shadeR = 0.022;
  const shadeCore = new THREE.Mesh(new THREE.CylinderGeometry(shadeR, shadeR, shadeW, 20), activeMats.brass);
  shadeCore.name = `${name}.shade`;
  shadeCore.rotation.z = Math.PI / 2;
  shadeCore.position.set(0, shadeY, shadeZ);
  shadeCore.castShadow = true;
  wallLightGroup.add(shadeCore);

  // 10 Fluted longitudinal brass reeds along the top/front arc of the cylindrical shade
  for (let r = 0; r < 10; r++) {
    const angle = -Math.PI * 0.25 + (r / 9) * Math.PI * 1.35;
    const ry = shadeY + Math.sin(angle) * (shadeR + 0.0018);
    const rz = shadeZ + Math.cos(angle) * (shadeR + 0.0018);
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, shadeW - 0.016, 8), activeMats.brass);
    if (!reed.name) reed.name = 'fixture.pictureLight.reed';
    reed.rotation.z = Math.PI / 2;
    reed.position.set(0, ry, rz);
    wallLightGroup.add(reed);
  }

  // Gadrooned / stepped antique-brass end caps + turned end finials
  for (const endSign of [-1, 1] as const) {
    const endCap = new THREE.Mesh(
      new THREE.CylinderGeometry(shadeR + 0.004, shadeR + 0.002, 0.018, 18),
      activeMats.darkBrass
    );
    if (!endCap.name) endCap.name = 'fixture.pictureLight.endCap';
    endCap.rotation.z = Math.PI / 2;
    endCap.position.set(endSign * (shadeW * 0.5 + 0.006), shadeY, shadeZ);
    wallLightGroup.add(endCap);

    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 10), activeMats.brass);
    if (!finial.name) finial.name = 'fixture.pictureLight.finial';
    finial.scale.set(1.3, 0.85, 0.85);
    finial.position.set(endSign * (shadeW * 0.5 + 0.018), shadeY, shadeZ);
    wallLightGroup.add(finial);
  }

  // Warm Downward Diffuser Slit illuminating the picture beneath
  const glowSlit = new THREE.Mesh(new THREE.BoxGeometry(shadeW - 0.024, 0.012, 0.026), mats.glow);
  glowSlit.name = `${name}.bulb`;
  glowSlit.position.set(0, shadeY - shadeR + 0.001, shadeZ - 0.002);
  glowSlit.rotation.x = 0.22; // Angled slightly back toward the picture
  wallLightGroup.add(glowSlit);

  return wallLightGroup;
}
