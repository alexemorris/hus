import * as THREE from 'three';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import { sharedBoxGeometry, sharedCylinderGeometry } from '../shared/geometry-cache.ts';

const anthraciteCastIronMat = new THREE.MeshStandardMaterial({
  color: 0x383b40, // Dark anthracite/gunmetal cast iron
  roughness: 0.34,
  metalness: 0.68,
});

const castIronShadowMat = new THREE.MeshStandardMaterial({
  color: 0x26282c,
  roughness: 0.42,
  metalness: 0.62,
});

export interface CastIronColumnRadiatorOptions {
  readonly name: string;
  readonly zone: RoomZoneId;
  readonly cx: number;
  readonly floorY: number;
  readonly cz: number;
  readonly width: number;
  readonly height?: number;
  readonly depth?: number;
  readonly rotationY?: number;
  readonly brassMat: THREE.Material;
  readonly cutawayDesc?: CutawayWallDescriptor;
  readonly tagCutawayWall?: (obj: THREE.Object3D, desc: CutawayWallDescriptor) => void;
}

/**
 * Builds a traditional Victorian 4-column free-standing cast-iron radiator with
 * shared section/column/boss/valve geometries and anthracite cast-iron materials.
 */
export function buildCastIronColumnRadiator(options: CastIronColumnRadiatorOptions): THREE.Group {
  const {
    name,
    zone,
    cx,
    floorY,
    cz,
    width,
    height = 0.58,
    depth = 0.16,
    rotationY = 0,
    brassMat,
    cutawayDesc,
    tagCutawayWall,
  } = options;

  const radGroup = new THREE.Group();
  radGroup.name = name;
  radGroup.userData.zone = zone;
  radGroup.position.set(cx, floorY, cz);
  radGroup.rotation.y = rotationY;
  if (cutawayDesc && tagCutawayWall) {
    tagCutawayWall(radGroup, cutawayDesc);
  }

  const effW = Math.min(width, 1.04);
  const effH = Math.min(height, 0.58);
  const effD = Math.min(depth, 0.165);
  const bodyBotY = 0.105;
  const bodyTopY = effH;
  const colH = bodyTopY - bodyBotY;
  const colMidY = (bodyBotY + bodyTopY) * 0.5;

  const headerBarrelGeo = sharedCylinderGeometry(0.03, 0.03, effW - 0.020, 16);
  for (const headerY of [bodyBotY + 0.034, bodyTopY - 0.034] as const) {
    const headerBarrel = new THREE.Mesh(headerBarrelGeo, anthraciteCastIronMat);
    headerBarrel.name = `${radGroup.name}.headerBarrel`;
    headerBarrel.rotation.x = Math.PI / 2;
    headerBarrel.position.set(0, headerY, 0);
    headerBarrel.castShadow = true;
    headerBarrel.receiveShadow = true;
    radGroup.add(headerBarrel);
  }

  const sectionCount = Math.max(10, Math.round(effW / 0.062));
  const sectionSpan = effW - 0.06;
  const colOffsetsX = [-effD * 0.38, -effD * 0.13, effD * 0.13, effD * 0.38] as const;

  const sectionBossGeo = sharedBoxGeometry(effD - 0.008, 0.06, 0.044);
  const endBushGeo = sharedCylinderGeometry(0.025, 0.025, 0.052, 14);
  const colTubeGeo = sharedCylinderGeometry(0.0165, 0.0165, colH - 0.016, 14);
  const midTieGeo = sharedBoxGeometry(effD - 0.02, 0.026, 0.032);
  const footLegGeo = sharedCylinderGeometry(0.018, 0.014, bodyBotY + 0.005, 12);
  const footPadGeo = sharedBoxGeometry(0.034, 0.012, 0.038);

  for (let s = 0; s < sectionCount; s++) {
    const sz = -sectionSpan * 0.5 + (s / (sectionCount - 1)) * sectionSpan;
    const isEndSection = s === 0 || s === sectionCount - 1;
    const isMidFootSection = sectionCount >= 14 && s === Math.floor(sectionCount / 2);

    for (const bossY of [bodyBotY + 0.034, bodyTopY - 0.034] as const) {
      const sectionBoss = new THREE.Mesh(sectionBossGeo, anthraciteCastIronMat);
      sectionBoss.name = `${radGroup.name}.sectionBoss.${s + 1}.${bossY < colMidY ? 'bottom' : 'top'}`;
      sectionBoss.userData.lodTier = 'high';
      sectionBoss.position.set(0, bossY, sz);
      sectionBoss.castShadow = true;
      sectionBoss.receiveShadow = true;
      radGroup.add(sectionBoss);

      if (isEndSection) {
        const endBush = new THREE.Mesh(endBushGeo, castIronShadowMat);
        endBush.name = `${radGroup.name}.endBush.${s + 1}.${bossY < colMidY ? 'bottom' : 'top'}`;
        endBush.userData.lodTier = 'high';
        endBush.rotation.x = Math.PI / 2;
        endBush.position.set(0, bossY, sz);
        radGroup.add(endBush);
      }
    }

    for (const colX of colOffsetsX) {
      const colTube = new THREE.Mesh(colTubeGeo, anthraciteCastIronMat);
      colTube.name = `${radGroup.name}.column`;
      colTube.scale.set(1.18, 1, 1.06);
      colTube.position.set(colX, colMidY, sz);
      colTube.castShadow = true;
      colTube.receiveShadow = true;
      radGroup.add(colTube);
    }

    const midTie = new THREE.Mesh(midTieGeo, castIronShadowMat);
    midTie.name = `${radGroup.name}.midTie.${s + 1}`;
    midTie.userData.lodTier = 'high';
    midTie.position.set(0, colMidY, sz);
    radGroup.add(midTie);

    if (isEndSection || isMidFootSection) {
      for (const footSideX of [-1, 1] as const) {
        const footLeg = new THREE.Mesh(footLegGeo, anthraciteCastIronMat);
        footLeg.name = `${radGroup.name}.foot`;
        footLeg.position.set(footSideX * (effD * 0.41), 0.0625, sz);
        footLeg.rotation.z = footSideX * 0.14;
        footLeg.castShadow = true;
        radGroup.add(footLeg);

        const footPad = new THREE.Mesh(footPadGeo, castIronShadowMat);
        footPad.name = `${radGroup.name}.footPad.${s + 1}.${footSideX < 0 ? 'inner' : 'outer'}`;
        footPad.userData.lodTier = 'high';
        footPad.position.set(footSideX * (effD * 0.45), 0.006, sz);
        radGroup.add(footPad);
      }
    }
  }

  const riserPipeBotY = 0.008;
  const riserPipeTopY = bodyBotY + 0.032;
  const riserPipeH = riserPipeTopY - riserPipeBotY;
  const riserPipeGeo = sharedCylinderGeometry(0.008, 0.008, riserPipeH, 12);
  const floorRoseGeo = sharedCylinderGeometry(0.022, 0.024, 0.008, 14);
  const unionTailGeo = sharedCylinderGeometry(0.012, 0.012, 0.045, 12);

  for (const endSign of [-1, 1] as const) {
    const valveZ = endSign * (sectionSpan * 0.5 + 0.042);
    const pipeY = riserPipeBotY + riserPipeH * 0.5;

    const riserPipe = new THREE.Mesh(riserPipeGeo, brassMat);
    riserPipe.name = `${radGroup.name}.valvePipe`;
    riserPipe.position.set(0, pipeY, valveZ);
    riserPipe.castShadow = true;
    radGroup.add(riserPipe);

    const floorRose = new THREE.Mesh(floorRoseGeo, brassMat);
    floorRose.name = `${radGroup.name}.floorRose.${endSign < 0 ? 'left' : 'right'}`;
    floorRose.userData.lodTier = 'high';
    floorRose.position.set(0, 0.004, valveZ);
    radGroup.add(floorRose);

    const unionTail = new THREE.Mesh(unionTailGeo, brassMat);
    unionTail.name = `${radGroup.name}.unionTail.${endSign < 0 ? 'left' : 'right'}`;
    unionTail.userData.lodTier = 'high';
    unionTail.rotation.x = Math.PI / 2;
    unionTail.position.set(0, bodyBotY + 0.032, valveZ - endSign * 0.02);
    radGroup.add(unionTail);

    const valveHead = new THREE.Mesh(
      sharedCylinderGeometry(
        endSign > 0 ? 0.018 : 0.014,
        0.013,
        endSign > 0 ? 0.052 : 0.036,
        12
      ),
      brassMat
    );
    valveHead.name = `${radGroup.name}.brassValve`;
    valveHead.position.set(0, bodyBotY + 0.068, valveZ);
    radGroup.add(valveHead);
  }

  const bleedPlug = new THREE.Mesh(sharedCylinderGeometry(0.009, 0.009, 0.022, 10), brassMat);
  bleedPlug.name = `${radGroup.name}.bleedPlug`;
  bleedPlug.userData.lodTier = 'high';
  bleedPlug.rotation.x = Math.PI / 2;
  bleedPlug.position.set(0, bodyTopY - 0.032, sectionSpan * 0.5 + 0.022);
  radGroup.add(bleedPlug);

  const wallStayGeo = sharedCylinderGeometry(0.006, 0.006, 0.065, 8);
  for (const stayZ of [-effW * 0.28, effW * 0.28] as const) {
    const wallStay = new THREE.Mesh(wallStayGeo, castIronShadowMat);
    wallStay.name = `${radGroup.name}.wallStay.${stayZ < 0 ? 'left' : 'right'}`;
    wallStay.userData.lodTier = 'high';
    wallStay.rotation.z = Math.PI / 2;
    wallStay.position.set(-effD * 0.5 - 0.025, bodyTopY - 0.08, stayZ);
    radGroup.add(wallStay);
  }

  return radGroup;
}
