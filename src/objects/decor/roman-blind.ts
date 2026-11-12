import * as THREE from 'three';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import { prepGeo } from '../shared/scene-helpers.ts';

export interface WindowRomanBlindOptions {
  readonly name: string;
  readonly zone: RoomZoneId;
  readonly centerX: number;
  /** Window aperture width (m); the blind overhangs by 7cm on each side unless `overhangWidth` is set. */
  readonly width: number;
  /** Optional total overhang width added to `width` (defaults to `0.14`). */
  readonly overhangWidth?: number;
  /** Center Y of the timber/aluminium headrail (m); top of headrail is `railY + 0.02m`. */
  readonly railY: number;
  /** Bottom Y of the raised/part-lowered Roman blind fabric stack (m). */
  readonly bottomY: number;
  /** World Z coordinate of the mounting plane cleanly proud of window architraves. */
  readonly wallFaceZ: number;
  /** +1 when mounted on a North wall facing South (+Z); -1 when mounted on a South wall facing North (-Z). */
  readonly facingZ: 1 | -1;
  readonly cutawayWall?: CutawayWallDescriptor;
  readonly parentGroup?: THREE.Object3D;
}

/**
 * Face-fixed natural oatmeal-linen Roman blind mounted cleanly above the top window
 * architrave crown, with a crisp compact cascade pleat stack leaving ~75–85% clear glazing below.
 */
export function buildWindowRomanBlind(
  scene: THREE.Scene,
  tagCutawayWall: (obj: THREE.Object3D, desc: CutawayWallDescriptor) => void,
  opts: WindowRomanBlindOptions
): THREE.Group {
  const blindGroup = new THREE.Group();
  blindGroup.name = opts.name;
  blindGroup.userData.zone = opts.zone;

  const blindW = opts.width + (opts.overhangWidth ?? 0.14);
  const dirZ = opts.facingZ;

  const linenMat = new THREE.MeshStandardMaterial({
    name: `${opts.name}.oatmealLinenMat`,
    color: 0xd9cdb6,
    roughness: 0.91,
    metalness: 0.0,
  });
  const pleatShadowLinenMat = new THREE.MeshStandardMaterial({
    name: `${opts.name}.linenCreaseMat`,
    color: 0xcabca3,
    roughness: 0.94,
    metalness: 0.0,
  });
  const railMat = new THREE.MeshStandardMaterial({
    name: `${opts.name}.pelmetRailMat`,
    color: 0xebe6dc,
    roughness: 0.56,
    metalness: 0.02,
  });

  // Timber/aluminium headrail pelmet (`topY = railY + 0.02m`, clearing oak ceiling joists by >= 4mm)
  const headRail = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(blindW + 0.016, 0.04, 0.044)),
    railMat
  );
  headRail.name = `${opts.name}.headRail`;
  headRail.position.set(opts.centerX, opts.railY, opts.wallFaceZ + dirZ * 0.022);
  headRail.castShadow = true;
  headRail.receiveShadow = true;
  blindGroup.add(headRail);

  // Main Roman blind backing fabric panel (`panelH >= 0.250m` so walkthrough-door-barge registers `${name}.fabric`)
  const panelTopY = opts.railY - 0.02;
  const panelH = Math.max(0.25, panelTopY - opts.bottomY);
  const panel = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(blindW, panelH, 0.008)),
    linenMat
  );
  panel.name = `${opts.name}.fabric`;
  panel.position.set(
    opts.centerX,
    panelTopY - panelH * 0.5,
    opts.wallFaceZ + dirZ * 0.044
  );
  panel.castShadow = true;
  panel.receiveShadow = true;
  blindGroup.add(panel);

  // Tailored weighted bottom hem bar pocket
  const hemBar = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(blindW - 0.004, 0.018, 0.012)),
    pleatShadowLinenMat
  );
  hemBar.name = `${opts.name}.hemBar`;
  hemBar.position.set(opts.centerX, opts.bottomY + 0.009, opts.wallFaceZ + dirZ * 0.048);
  blindGroup.add(hemBar);

  // Compact cascaded soft rolled linen pleats across the raised blind stack
  const pleatGeo = prepGeo(new THREE.CylinderGeometry(0.024, 0.024, blindW, 14, 1));
  pleatGeo.rotateZ(Math.PI / 2);
  const pleatCount = 4;
  const pleatSpan = Math.max(0.14, panelH - 0.056);
  const pleatStep = pleatSpan / (pleatCount - 1);
  for (let k = 0; k < pleatCount; k++) {
    const pleat = new THREE.Mesh(pleatGeo, k === 0 ? pleatShadowLinenMat : linenMat);
    pleat.name = `${opts.name}.pleat`;
    const pleatY = opts.bottomY + 0.026 + k * pleatStep;
    pleat.position.set(
      opts.centerX,
      pleatY,
      opts.wallFaceZ + dirZ * (0.054 + (pleatCount - k) * 0.0035)
    );
    pleat.scale.set(1, 1.02, 0.68);
    pleat.castShadow = true;
    pleat.receiveShadow = true;
    blindGroup.add(pleat);
  }

  if (opts.cutawayWall) {
    tagCutawayWall(blindGroup, opts.cutawayWall);
  }
  (opts.parentGroup ?? scene).add(blindGroup);
  return blindGroup;
}
