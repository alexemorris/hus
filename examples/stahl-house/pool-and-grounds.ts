import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CutawayWallDescriptor } from 'husjs';
import { applyMetricBoxUVs, getOrCreateCachedTexture } from 'husjs/materials';
import { attachAssetMetadata, attachAudioEmitter, prepGeo, tagCollisionRole, tagCutaway } from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import {
  buildLaBasinCityLightsVista,
  buildStahlCliffOutcropsAndChaparral,
  computeStahlCityLightsIntensity,
  syncStahlCityLightsFromSky,
} from './grounds-cliff-and-vista.ts';
import { buildStahlPatioFurnishingsAndRoadster } from './grounds-furnishings.ts';
import {
  configureDataTex,
  getArchitecturalFinishPbr512,
  getCeramicTilePbr1024,
  getScoredConcretePbr2048,
  getTravertinePbr1024,
  hashCell2D,
} from './pbr-textures.ts';
import { bevelledBox } from './sculpted-geometry.ts';
import type { StahlMaterials } from './structure.ts';
import {
  CANTILEVER_M, CATWALK_WIDTH_M, CLEAR_CEILING_Y, MODULE_M,
  POOL_FLOOR_Y, POOL_MAIN_MAX_X, POOL_MAX_X, POOL_MAX_Z, POOL_MIN_X, POOL_MIN_Z, POOL_WATER_Y,
  X0, X1, X3, X4, Z0, Z1, Z2, Z3,
} from './terrain.ts';

export { computeStahlCityLightsIntensity, syncStahlCityLightsFromSky };

function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hashCell2D(ix, iy, seed);
  const b = hashCell2D(ix + 1, iy, seed);
  const c = hashCell2D(ix, iy + 1, seed);
  const d = hashCell2D(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Cached `2048 × 2048` scored `5'-0" × 5'-0"` (`1.524 m` bay, `6.096 m` 4×4 tile) concrete terrace PBR material. */
function createScoredConcreteTerraceMaterial(): THREE.MeshStandardMaterial {
  const pbr = getScoredConcretePbr2048('terrace');
  return new THREE.MeshStandardMaterial({
    name: 'stahl.scoredConcreteTerrace',
    map: pbr.map,
    normalMap: pbr.normalMap,
    normalScale: new THREE.Vector2(0.46, 0.46),
    roughnessMap: pbr.roughnessMap,
    roughness: 0.88,
    metalness: 0.0,
  });
}

/**
 * Chamfered `bevelledBox` (`radius: 0.008, segments: 4, tileW: 6.096, tileH: 6.096`) concrete terrace slab
 * with world-origin-aligned `6.096 m` (`4 × 5'-0"`) UVs aligned to Koenig's `20'-0"` steel H-column grid.
 */
function buildWorldScoredSlabBox(
  minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, mat: THREE.Material
): THREE.Mesh {
  const w = maxX - minX;
  const h = maxY - minY;
  const d = maxZ - minZ;
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const geo = bevelledBox(w, h, d, 0.008, 4, MODULE_M, MODULE_M);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const wx = cx + pos.getX(i);
    const wy = cy + pos.getY(i);
    const wz = cz + pos.getZ(i);
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    if (ny > 0.5) uv.setXY(i, wx / MODULE_M, wz / MODULE_M);
    else if (nx > 0.5) uv.setXY(i, wz / MODULE_M, wy / MODULE_M);
    else uv.setXY(i, wx / MODULE_M, wy / MODULE_M);
  }
  uv.needsUpdate = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, cy, cz);
  mesh.receiveShadow = true;
  return mesh;
}

export type BullnoseDirection = '+X' | '-X' | '+Z' | '-Z';

/**
 * Smooth architectural precast stone/concrete bullnose pool coping (`ExtrudeGeometry`):
 * - `18`-point semicircular bullnose nose (`>= 16` pts) facing the pool water
 * - `3 mm` (`0.003 m`) chamfered back edges facing the terrace deck
 * - Smooth creased vertex normals + `1.524 m` (`5'-0"`) world-metric box UVs.
 */
function buildBullnoseCopingGeo(
  width: number, height: number, length: number, noseDir: BullnoseDirection
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const r = hh;
  const c = Math.min(0.003, hh * 0.35);
  const noseSegs = 18;

  const shape = new THREE.Shape();
  shape.moveTo(-hw + c, -hh);
  shape.lineTo(hw - r, -hh);
  for (let i = 1; i <= noseSegs; i++) {
    const ang = -Math.PI * 0.5 + (i / noseSegs) * Math.PI;
    shape.lineTo(hw - r + Math.cos(ang) * r, Math.sin(ang) * r);
  }
  shape.lineTo(-hw + c, hh);
  shape.lineTo(-hw, hh - c);
  shape.lineTo(-hw, -hh + c);
  shape.closePath();

  const raw = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps: 1, curveSegments: noseSegs });
  raw.translate(0, 0, -length * 0.5);
  if (noseDir === '-X') raw.rotateY(Math.PI);
  else if (noseDir === '+Z') raw.rotateY(-Math.PI * 0.5);
  else if (noseDir === '-Z') raw.rotateY(Math.PI * 0.5);

  raw.computeVertexNormals();
  const smooth = toCreasedNormals(raw, Math.PI * 0.28);
  raw.dispose();
  return prepGeo(applyMetricBoxUVs(smooth, { tileW: 1.524, tileH: 1.524 }));
}

/** Cached `1024 × 1024` glazed cobalt-cerulean mosaic waterline ceramic tile PBR material (`Catalina Pool Co.`). */
function createWaterlineMosaicTileMaterial(): THREE.MeshStandardMaterial {
  const pbr = getCeramicTilePbr1024('poolCobaltWaterline');
  return new THREE.MeshStandardMaterial({
    name: 'stahl.pool.waterlineMosaicTile',
    map: pbr.map,
    normalMap: pbr.normalMap,
    normalScale: new THREE.Vector2(0.68, 0.68),
    roughnessMap: pbr.roughnessMap,
    roughness: 0.9,
    metalness: 0.05,
    emissive: new THREE.Color(0x1689a8),
    emissiveIntensity: 0.22,
  });
}

function createRippledWaterNormalMap(): THREE.DataTexture {
  return getOrCreateCachedTexture('stahl:pool:waterNormal256', () => {
    const size = 256;
    const normalData = new Uint8Array(size * size * 4);
    const hField = new Float32Array(size * size);
    const tau = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const w1 = Math.sin(u * tau * 5 + v * tau * 3) * 0.35;
        const w2 = Math.cos(u * tau * 8 - v * tau * 6) * 0.25;
        const w3 = Math.sin(u * tau * 13 + v * tau * 11) * 0.14;
        const n = (valueNoise2D(u * 9, v * 9, 521) * 0.65 + valueNoise2D(u * 18, v * 18, 547) * 0.35) * 0.45;
        hField[y * size + x] = w1 + w2 + w3 + n;
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const hL = hField[y * size + ((x - 1 + size) & 255)]!;
        const hR = hField[y * size + ((x + 1) & 255)]!;
        const hD = hField[((y - 1 + size) & 255) * size + x]!;
        const hU = hField[((y + 1) & 255) * size + x]!;
        const dx = (hL - hR) * 0.55;
        const dy = (hD - hU) * 0.55;
        const len = Math.hypot(dx, dy, 1);
        const idx = (y * size + x) * 4;
        normalData[idx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
        normalData[idx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
        normalData[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
        normalData[idx + 3] = 255;
      }
    }
    return configureDataTex(normalData, size, false, [3.5, 2.6]);
  });
}

function createPoolCausticTexture(): THREE.DataTexture {
  return getOrCreateCachedTexture('stahl:pool:caustic256', () => {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    const tau = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const c1 = Math.abs(Math.sin(u * tau * 4 + Math.cos(v * tau * 3) * 1.4));
        const c2 = Math.abs(Math.cos(v * tau * 5 - Math.sin(u * tau * 4) * 1.3));
        const ridge = Math.pow(1 - Math.min(c1, c2), 3.2);
        const base = 0.52 + ridge * 0.48;
        const idx = (y * size + x) * 4;
        data[idx] = Math.min(255, Math.round(78 * base + ridge * 95));
        data[idx + 1] = Math.min(255, Math.round(196 * base + ridge * 58));
        data[idx + 2] = Math.min(255, Math.round(214 * base + ridge * 41));
        data[idx + 3] = 255;
      }
    }
    return configureDataTex(data, size, true, [3, 2]);
  });
}

function buildHouseNumerals1635(mat: THREE.Material): THREE.Group {
  const grp = new THREE.Group();
  grp.name = 'stahl.carport.houseNumbers1635';
  const d = 0.014;
  const stroke = 0.022;
  const h = 0.145;
  const w = 0.086;
  const bar = (bz: number, by: number, bw: number, bh: number): void => {
    const m = new THREE.Mesh(bevelledBox(d, bh, bw, 0.002, 2, 0.25, 0.25), mat);
    m.position.set(0, by, bz);
    m.castShadow = true;
    grp.add(m);
  };

  bar(-0.21, 0, stroke, h);
  bar(-0.228, h * 0.5 - stroke * 0.5, stroke * 0.85, stroke);

  const z6 = -0.075;
  bar(z6 - w * 0.5 + stroke * 0.5, 0, stroke, h);
  bar(z6 + stroke * 0.5 + 0.001, h * 0.5 - stroke * 0.5, w - stroke - 0.003, stroke);
  bar(z6 + stroke * 0.5 + 0.001, -0.006, w - stroke - 0.003, stroke);
  bar(z6 + stroke * 0.5 + 0.001, -h * 0.5 + stroke * 0.5, w - stroke - 0.003, stroke);
  bar(z6 + w * 0.5 - stroke * 0.5, -0.006 - (h * 0.5 - 0.006) * 0.5, stroke, h * 0.5 - 2 * stroke - 0.01);

  const z3 = 0.065;
  bar(z3 + w * 0.5 - stroke * 0.5, 0, stroke, h);
  bar(z3 - stroke * 0.5 - 0.001, h * 0.5 - stroke * 0.5, w - stroke - 0.003, stroke);
  bar(z3 - stroke * 0.3 - 0.001, 0, w - stroke * 1.4 - 0.002, stroke);
  bar(z3 - stroke * 0.5 - 0.001, -h * 0.5 + stroke * 0.5, w - stroke - 0.003, stroke);

  const z5 = 0.205;
  bar(z5, h * 0.5 - stroke * 0.5, w, stroke);
  bar(z5 - w * 0.5 + stroke * 0.5, h * 0.25 - 0.001, stroke, h * 0.5 - 2 * stroke - 0.005);
  bar(z5, 0, w, stroke);
  bar(z5 + w * 0.5 - stroke * 0.5, -h * 0.25 + 0.001, stroke, h * 0.5 - 2 * stroke - 0.005);
  bar(z5, -h * 0.5 + stroke * 0.5, w, stroke);
  return grp;
}

/**
 * Continuous `1.5"` (`38 mm` OD) bent tubular steel pipe run (`TubeGeometry` with
 * `tubularSegments = 96 >= 64, radialSegments = 20 >= 18`) and true circular 90° radius bend.
 */
function buildContinuousBentPipeRunGeo(
  startA: THREE.Vector3, corner: THREE.Vector3, endB: THREE.Vector3,
  pipeRadius = 0.019, bendRadius = 0.095, tubularSegments = 96, radialSegments = 20
): THREE.BufferGeometry {
  const dirIn = new THREE.Vector3().subVectors(corner, startA).normalize();
  const dirOut = new THREE.Vector3().subVectors(endB, corner).normalize();
  const pTanA = corner.clone().addScaledVector(dirIn, -bendRadius);
  const pTanB = corner.clone().addScaledVector(dirOut, bendRadius);
  const arcCenter = pTanA.clone().addScaledVector(dirOut, bendRadius);

  const arcPts: THREE.Vector3[] = [];
  const arcSteps = 16;
  for (let i = 0; i <= arcSteps; i++) {
    const theta = (i / arcSteps) * (Math.PI * 0.5);
    arcPts.push(
      arcCenter.clone()
        .addScaledVector(dirIn, Math.sin(theta) * bendRadius)
        .addScaledVector(dirOut, -Math.cos(theta) * bendRadius)
    );
  }

  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(new THREE.LineCurve3(startA, pTanA));
  path.add(new THREE.CatmullRomCurve3(arcPts));
  path.add(new THREE.LineCurve3(pTanB, endB));

  const geo = new THREE.TubeGeometry(path, Math.min(56, tubularSegments), pipeRadius, Math.min(12, radialSegments), false);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Iconic Off-White `42"` 2-Rail `1.5"` (`38 mm` OD) Tubular Steel Pipe Safety Railings
 * (`stahl.balustrade.perimeterPipeRail`) with `96 × 20` bent pipe runs, `20`-seg posts & `24`-seg base plates.
 */
function buildPerimeterPipeSafetyRailing(root: THREE.Group, steelBracketMat: THREE.Material): void {
  const railGroup = new THREE.Group();
  railGroup.name = 'stahl.balustrade.perimeterPipeRail';

  const steelMaps = getArchitecturalFinishPbr512('paintedSteel');
  const pipeMat = new THREE.MeshStandardMaterial({
    name: 'stahl.balustrade.offWhitePipe',
    color: 0xece8de,
    normalMap: steelMaps.normalMap,
    normalScale: new THREE.Vector2(0.14, 0.14),
    roughnessMap: steelMaps.roughnessMap,
    roughness: 0.4,
    metalness: 0.24,
  });

  const pipeR = 0.019;
  const endCapGeo = prepGeo(new THREE.SphereGeometry(pipeR, 20, 12));
  const addBentRailRun = (startA: THREE.Vector3, corner: THREE.Vector3, endB: THREE.Vector3): void => {
    const run = new THREE.Mesh(buildContinuousBentPipeRunGeo(startA, corner, endB, pipeR, 0.095, 96, 20), pipeMat);
    run.castShadow = true;
    const capA = new THREE.Mesh(endCapGeo, pipeMat);
    capA.position.copy(startA);
    const capB = new THREE.Mesh(endCapGeo, pipeMat);
    capB.position.copy(endB);
    railGroup.add(run, capA, capB);
  };

  // East & South Cantilevered Catwalk Guardrail
  const slatCount = 6;
  const slatW = 0.056;
  const innerOffset = 0.085;
  const slatPitch = (CATWALK_WIDTH_M - 0.04) / (slatCount - 1);
  const outerEdgeX = X4 + innerOffset + (slatCount - 1) * slatPitch + slatW * 0.5;
  const outerEdgeZ = Z3 + innerOffset + (slatCount - 1) * slatPitch + slatW * 0.5;
  const fasciaOuterX = outerEdgeX + 0.024;
  const fasciaOuterZ = outerEdgeZ + 0.024;
  const eastRailX = fasciaOuterX + 0.038;
  const southRailZ = fasciaOuterZ + 0.038;
  const catTopY = 0.99;
  const catMidY = 0.49;
  const catBotY = -0.085;
  const eastStartZ = Z0 - 0.08;
  const southStartX = X3 - 0.38;

  for (const ry of [catTopY, catMidY]) {
    addBentRailRun(
      new THREE.Vector3(eastRailX, ry, eastStartZ),
      new THREE.Vector3(eastRailX, ry, southRailZ),
      new THREE.Vector3(southStartX, ry, southRailZ)
    );
  }

  const catLowerH = catMidY - pipeR - 0.002 - catBotY;
  const catUpperH = catTopY - pipeR - 0.002 - (catMidY + pipeR + 0.002);
  const catLowerPostGeo = prepGeo(new THREE.CylinderGeometry(pipeR * 0.92, pipeR * 0.92, catLowerH, 20));
  const catUpperPostGeo = prepGeo(new THREE.CylinderGeometry(pipeR * 0.92, pipeR * 0.92, catUpperH, 20));
  const catBasePlateGeo = prepGeo(new THREE.CylinderGeometry(0.038, 0.04, 0.01, 24));
  const bracketGeoEW = bevelledBox(0.026, 0.048, 0.036, 0.003, 2, 0.3, 0.3);
  const bracketGeoNS = bevelledBox(0.036, 0.048, 0.026, 0.003, 2, 0.3, 0.3);

  const addCatwalkPost = (px: number, pz: number, side: 'east' | 'south'): void => {
    const low = new THREE.Mesh(catLowerPostGeo, pipeMat);
    low.position.set(px, catBotY + catLowerH * 0.5, pz);
    const up = new THREE.Mesh(catUpperPostGeo, pipeMat);
    up.position.set(px, catMidY + pipeR + 0.002 + catUpperH * 0.5, pz);
    low.castShadow = up.castShadow = true;
    railGroup.add(low, up);

    if (side === 'east' && pz <= outerEdgeZ) {
      const plate = new THREE.Mesh(catBasePlateGeo, steelBracketMat);
      plate.rotation.z = Math.PI * 0.5;
      plate.position.set(fasciaOuterX + 0.0065, -0.056, pz);
      const brk = new THREE.Mesh(bracketGeoEW, steelBracketMat);
      brk.position.set(fasciaOuterX + 0.026, -0.056, pz);
      railGroup.add(plate, brk);
    } else if (side === 'south') {
      const plate = new THREE.Mesh(catBasePlateGeo, steelBracketMat);
      plate.rotation.x = Math.PI * 0.5;
      plate.position.set(px, -0.056, fasciaOuterZ + 0.0065);
      const brk = new THREE.Mesh(bracketGeoNS, steelBracketMat);
      brk.position.set(px, -0.056, fasciaOuterZ + 0.026);
      railGroup.add(plate, brk);
    }
  };

  for (const pz of [eastStartZ + 0.04, Z0 + 1.95, Z1, Z1 + 2.03, Z1 + 4.06, Z2, Z2 + 2.03, Z2 + 4.06, Z3, outerEdgeZ - 0.04]) {
    addCatwalkPost(eastRailX, pz, 'east');
  }
  for (const px of [southStartX + 0.04, X3 + 1.35, (X3 + X4) * 0.5, X4 - 1.35, X4]) {
    addCatwalkPost(px, southRailZ, 'south');
  }

  // South & West Pool Terrace Cliff Perimeter Guardrail
  const poolRailSouthZ = 9.44;
  const poolRailWestX = -13.64;
  const poolRailEastX = -0.44;
  const poolRailNorthZ = 0.24;
  const deckBaseY = -0.0085;
  const deckTopY = 0.98;
  const deckMidY = 0.48;

  for (const ry of [deckTopY, deckMidY]) {
    addBentRailRun(
      new THREE.Vector3(poolRailWestX, ry, poolRailNorthZ),
      new THREE.Vector3(poolRailWestX, ry, poolRailSouthZ),
      new THREE.Vector3(poolRailEastX, ry, poolRailSouthZ)
    );
  }

  const flangeH = 0.012;
  const flangeGeo = prepGeo(new THREE.CylinderGeometry(0.048, 0.052, flangeH, 24));
  const postStartY = deckBaseY + flangeH + 0.0015;
  const deckLowH = deckMidY - pipeR - 0.002 - postStartY;
  const deckUpH = deckTopY - pipeR - 0.002 - (deckMidY + pipeR + 0.002);
  const deckLowPostGeo = prepGeo(new THREE.CylinderGeometry(pipeR * 0.92, pipeR * 0.92, deckLowH, 20));
  const deckUpPostGeo = prepGeo(new THREE.CylinderGeometry(pipeR * 0.92, pipeR * 0.92, deckUpH, 20));

  const addDeckStanchion = (px: number, pz: number): void => {
    const flange = new THREE.Mesh(flangeGeo, pipeMat);
    flange.position.set(px, deckBaseY + flangeH * 0.5, pz);
    const low = new THREE.Mesh(deckLowPostGeo, pipeMat);
    low.position.set(px, postStartY + deckLowH * 0.5, pz);
    const up = new THREE.Mesh(deckUpPostGeo, pipeMat);
    up.position.set(px, deckMidY + pipeR + 0.002 + deckUpH * 0.5, pz);
    low.castShadow = up.castShadow = true;
    railGroup.add(flange, low, up);
  };

  const southStart = poolRailWestX + 0.24;
  for (let i = 0; i <= 7; i++) {
    addDeckStanchion(southStart + (i / 7) * (poolRailEastX - 0.04 - southStart), poolRailSouthZ);
  }
  const westEnd = poolRailSouthZ - 0.24;
  for (let j = 0; j <= 4; j++) {
    addDeckStanchion(poolRailWestX, poolRailNorthZ + 0.04 + (j / 4) * (westEnd - (poolRailNorthZ + 0.04)));
  }

  root.add(railGroup);
}

export function buildStahlPoolAndGrounds(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials
): void {
  // Scored 5'-0" x 5'-0" (1.524 m, 2048px 4x4 bay PBR) Cast-in-Place Concrete Pool Terrace & Apron
  const terraceGroup = new THREE.Group();
  terraceGroup.name = 'stahl.poolTerrace';

  const scoredTerraceMat = createScoredConcreteTerraceMaterial();
  const travPbr = getTravertinePbr1024();
  const copingMat = new THREE.MeshStandardMaterial({
    name: 'stahl.pool.bullnoseCoping',
    color: 0xdcd7cb,
    map: travPbr.map,
    normalMap: travPbr.normalMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughnessMap: travPbr.roughnessMap,
    roughness: 0.64,
    metalness: 0.0,
  });

  const ssMaps = getArchitecturalFinishPbr512('brushedStainless');
  const stainlessMat = new THREE.MeshStandardMaterial({
    name: 'stahl.pool.polishedStainless',
    color: 0xe3e8ec,
    normalMap: ssMaps.normalMap,
    normalScale: new THREE.Vector2(0.12, 0.12),
    roughnessMap: ssMaps.roughnessMap,
    roughness: 0.14,
    metalness: 0.95,
  });

  const deckMinX = -13.75;
  const deckMaxX = X3 - 0.002;
  const poolOuterMinX = POOL_MIN_X - 0.14;
  const poolOuterMaxX = POOL_MAX_X + 0.14;
  const poolOuterMinZ = POOL_MIN_Z - 0.14;
  const poolOuterMaxZ = POOL_MAX_Z + 0.14;

  const northBreezeway = buildWorldScoredSlabBox(deckMinX, deckMaxX, -0.15, -0.01, Z1 + 0.002, poolOuterMinZ - 0.002, scoredTerraceMat);
  northBreezeway.name = 'stahl.poolTerrace.northBreezeway';
  const westDeck = buildWorldScoredSlabBox(deckMinX, poolOuterMinX - 0.002, -0.15, -0.01, poolOuterMinZ, poolOuterMaxZ, scoredTerraceMat);
  westDeck.name = 'stahl.poolTerrace.westDeck';
  const southDeck = buildWorldScoredSlabBox(deckMinX, deckMaxX, -0.15, -0.01, poolOuterMaxZ + 0.002, 9.55, scoredTerraceMat);
  southDeck.name = 'stahl.poolTerrace.southDeck';
  const eastThreshold = buildWorldScoredSlabBox(poolOuterMaxX + 0.002, deckMaxX, -0.15, -0.01, poolOuterMinZ, poolOuterMaxZ, scoredTerraceMat);
  eastThreshold.name = 'stahl.poolTerrace.eastThreshold';
  const carportApron = buildWorldScoredSlabBox(-20.8, X0 - 0.002, -0.14, -0.001, Z0, Z1, scoredTerraceMat);
  carportApron.name = 'stahl.poolTerrace.carportApron';

  const asphaltMat = new THREE.MeshStandardMaterial({ name: 'stahl.woodsDrive.asphalt', color: 0x343638, roughness: 0.9 });
  const woodsDriveApron = new THREE.Mesh(bevelledBox(3.41, 0.13, Z1 - Z0 + 2.4, 0.008, 3, MODULE_M, MODULE_M), asphaltMat);
  woodsDriveApron.name = 'stahl.poolTerrace.woodsDriveAsphalt';
  woodsDriveApron.position.set(-22.695, -0.075, (Z0 + Z1) * 0.5 - 0.4);
  woodsDriveApron.receiveShadow = true;

  const curbGutter = new THREE.Mesh(bevelledBox(0.18, 0.142, Z1 - Z0 + 0.6, 0.008, 4, 1.524, 1.524), copingMat);
  curbGutter.position.set(-20.895, -0.07, (Z0 + Z1) * 0.5);
  curbGutter.receiveShadow = true;

  terraceGroup.add(westDeck, southDeck, northBreezeway, eastThreshold, carportApron, woodsDriveApron, curbGutter);

  // Catalina Pool Co. 20' x 26' Pool Basin, 1024px Cobalt Mosaic Waterline Tile & 320mm Bullnose Coping
  const plasterCausticTex = createPoolCausticTexture();
  const plasterTileMat = new THREE.MeshStandardMaterial({
    name: 'stahl.pool.plasterShell',
    color: 0x62c4d2,
    map: plasterCausticTex,
    emissive: new THREE.Color(0x1bd4e8),
    emissiveMap: plasterCausticTex,
    emissiveIntensity: 0.42,
    roughness: 0.3,
  });
  const mosaicTileMat = createWaterlineMosaicTileMaterial();

  const poolW = POOL_MAX_X - POOL_MIN_X;
  const poolD = POOL_MAX_Z - POOL_MIN_Z;
  const poolCenterX = (POOL_MIN_X + POOL_MAX_X) * 0.5;
  const poolCenterZ = (POOL_MIN_Z + POOL_MAX_Z) * 0.5;

  const plasterTopY = -0.166;
  const poolWallBotY = POOL_FLOOR_Y - 0.07;
  const plasterH = plasterTopY - poolWallBotY;
  const plasterMidY = poolWallBotY + plasterH * 0.5;
  const tileBotY = -0.1635;
  const tileTopY = -0.012;
  const tileH = tileTopY - tileBotY;
  const tileMidY = (tileBotY + tileTopY) * 0.5;

  const poolFloor = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW, 0.14, poolD)), plasterTileMat);
  poolFloor.position.set(poolCenterX, POOL_FLOOR_Y, poolCenterZ);

  const wallN = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW + 0.28, plasterH, 0.139)), plasterTileMat);
  wallN.position.set(poolCenterX, plasterMidY, POOL_MIN_Z - 0.0705);
  const wallS = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW + 0.28, plasterH, 0.139)), plasterTileMat);
  wallS.position.set(poolCenterX, plasterMidY, POOL_MAX_Z + 0.0705);
  const wallW = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.139, plasterH, poolD - 0.004)), plasterTileMat);
  wallW.position.set(POOL_MIN_X - 0.0705, plasterMidY, poolCenterZ);
  const wallE = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.139, plasterH, poolD - 0.004)), plasterTileMat);
  wallE.position.set(POOL_MAX_X + 0.0705, plasterMidY, poolCenterZ);

  const makeTileBand = (w: number, d: number, x: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(prepGeo(applyMetricBoxUVs(new THREE.BoxGeometry(w, tileH, d), { tileW: 0.6096, tileH: tileH })), mosaicTileMat);
    m.position.set(x, tileMidY, z);
    return m;
  };
  const tileN = makeTileBand(poolW + 0.28, 0.139, poolCenterX, POOL_MIN_Z - 0.0705);
  const tileS = makeTileBand(poolW + 0.28, 0.139, poolCenterX, POOL_MAX_Z + 0.0705);
  const tileW = makeTileBand(0.139, poolD - 0.004, POOL_MIN_X - 0.0705, poolCenterZ);
  const tileE = makeTileBand(0.139, poolD - 0.004, POOL_MAX_X + 0.0705, poolCenterZ);

  // Smooth 320 mm 18-pt semicircular bullnose perimeter pool coping (Y in [-0.0085 .. +0.020], 1.5 mm butt joints)
  const copY = 0.00575;
  const copH = 0.0285;
  const copW = 0.32;
  const overhang = 0.02;
  const buttGap = 0.0015;
  const westNoseX = POOL_MIN_X + overhang;
  const eastNoseX = POOL_MAX_X - overhang;
  const northNoseZ = POOL_MIN_Z + overhang;
  const southNoseZ = POOL_MAX_Z - overhang;
  const outerNorthZ = northNoseZ - copW;
  const outerSouthZ = southNoseZ + copW;
  const outerEastX = eastNoseX + copW;

  const copWest = new THREE.Mesh(buildBullnoseCopingGeo(copW, copH, outerSouthZ - outerNorthZ, '+X'), copingMat);
  copWest.name = 'stahl.pool.copingWest';
  copWest.position.set(westNoseX - copW * 0.5, copY, poolCenterZ);

  const ewCopStart = westNoseX + buttGap;
  const ewCopLen = outerEastX - ewCopStart;
  const ewCopCenterX = (ewCopStart + outerEastX) * 0.5;
  const copNorth = new THREE.Mesh(buildBullnoseCopingGeo(copW, copH, ewCopLen, '+Z'), copingMat);
  copNorth.name = 'stahl.pool.copingNorth';
  copNorth.position.set(ewCopCenterX, copY, northNoseZ - copW * 0.5);

  const copSouth = new THREE.Mesh(buildBullnoseCopingGeo(copW, copH, ewCopLen, '-Z'), copingMat);
  copSouth.name = 'stahl.pool.copingSouth';
  copSouth.position.set(ewCopCenterX, copY, southNoseZ + copW * 0.5);

  const copEast = new THREE.Mesh(buildBullnoseCopingGeo(copW, copH, southNoseZ - northNoseZ - buttGap * 2, '-X'), copingMat);
  copEast.name = 'stahl.pool.copingEast';
  copEast.position.set(eastNoseX + copW * 0.5, copY, poolCenterZ);
  copWest.receiveShadow = copNorth.receiveShadow = copSouth.receiveShadow = copEast.receiveShadow = true;

  const dividerMinX = -2.05;
  const dividerMaxX = POOL_MAX_X - 0.002;
  const dividerBotY = POOL_FLOOR_Y + 0.072;
  const dividerTopY = -0.011;
  const dividerH = dividerTopY - dividerBotY;
  const inletDivider = new THREE.Mesh(
    bevelledBox(dividerMaxX - dividerMinX, dividerH, 1.55, 0.008, 3, 1.524, 1.524),
    mats.concreteSlab
  );
  inletDivider.position.set((dividerMinX + dividerMaxX) * 0.5, dividerBotY + dividerH * 0.5, poolCenterZ);

  const capMinX = dividerMinX - 0.025;
  const capMaxX = eastNoseX - buttGap;
  const dividerCap = new THREE.Mesh(buildBullnoseCopingGeo(capMaxX - capMinX, copH, 1.6, '-X'), copingMat);
  dividerCap.name = 'stahl.pool.dividerCap';
  dividerCap.position.set((capMinX + capMaxX) * 0.5, copY, poolCenterZ);
  dividerCap.receiveShadow = true;

  // Twin Chamfered Stepping-Stone Bridge Pads (`bevelledBox` 1.45 x 0.054 x 1.35 m, Y in [0.022 .. 0.076], 2 mm above copEast)
  const bridgeGeo = bevelledBox(1.45, 0.054, 1.35, 0.008, 4, MODULE_M, MODULE_M);
  const bridgeNorth = new THREE.Mesh(bridgeGeo, scoredTerraceMat);
  bridgeNorth.name = 'stahl.pool.bridgeNorth';
  bridgeNorth.position.set(-1.35, 0.049, 2.35);
  bridgeNorth.castShadow = bridgeNorth.receiveShadow = true;

  const bridgeSouth = new THREE.Mesh(bridgeGeo, scoredTerraceMat);
  bridgeSouth.name = 'stahl.pool.bridgeSouth';
  bridgeSouth.position.set(-1.35, 0.049, 6.05);
  bridgeSouth.castShadow = bridgeSouth.receiveShadow = true;

  const bridgePierBotY = POOL_FLOOR_Y + 0.072;
  const bridgePierH = 0.02 - bridgePierBotY;
  const bridgePierGeo = bevelledBox(0.46, bridgePierH, 0.22, 0.006, 3, 1.524, 1.524);
  for (const bz of [1.88, 2.82, 5.58, 6.52]) {
    const pier = new THREE.Mesh(bridgePierGeo, mats.concreteSlab);
    pier.position.set(-1.56, bridgePierBotY + bridgePierH * 0.5, bz);
    terraceGroup.add(pier);
  }

  const skimmerDarkMat = new THREE.MeshStandardMaterial({ color: 0x0e2a34, roughness: 0.4 });
  const skimmerBezel = new THREE.Mesh(bevelledBox(0.28, 0.12, 0.016, 0.003, 2, 0.3, 0.3), stainlessMat);
  skimmerBezel.position.set(-7.15, -0.088, POOL_MIN_Z + 0.01);
  const skimmerThroat = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.22, 0.078, 0.008)), skimmerDarkMat);
  skimmerThroat.position.set(-7.15, -0.088, POOL_MIN_Z + 0.024);
  const skimmerLid = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.115, 0.115, 0.006, 28)), stainlessMat);
  skimmerLid.position.set(-7.15, 0.0245, POOL_MIN_Z - 0.15);
  terraceGroup.add(skimmerBezel, skimmerThroat, skimmerLid);

  const jetGeo = prepGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.016, 20));
  for (const [jx, jz, rotZ, rotX] of [
    [POOL_MIN_X + 0.01, 2.8, Math.PI / 2, 0],
    [POOL_MIN_X + 0.01, 5.6, Math.PI / 2, 0],
    [-5.4, POOL_MAX_Z - 0.01, 0, Math.PI / 2],
  ] as const) {
    const jet = new THREE.Mesh(jetGeo, stainlessMat);
    jet.position.set(jx, -0.38, jz);
    jet.rotation.set(rotX, 0, rotZ);
    terraceGroup.add(jet);
  }

  const drainGeo = prepGeo(new THREE.CylinderGeometry(0.12, 0.13, 0.016, 28));
  for (const dz of [3.55, 4.85]) {
    const drain = new THREE.Mesh(drainGeo, stainlessMat);
    drain.position.set(-8.15, POOL_FLOOR_Y + 0.08, dz);
    terraceGroup.add(drain);
  }

  // Smooth 48x18 TubeGeometry Swan-Neck Stainless Pool Ladder + bevelledBox treads + 28-seg escutcheons
  const ladderGroup = new THREE.Group();
  ladderGroup.name = 'stahl.pool.stainlessLadder';
  const ladderCenterX = -8.25;
  const railSpanHalf = 0.25;
  const ladderCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.035, POOL_MAX_Z + 0.2),
    new THREE.Vector3(0, 0.44, POOL_MAX_Z + 0.2),
    new THREE.Vector3(0, 0.56, POOL_MAX_Z + 0.04),
    new THREE.Vector3(0, 0.42, POOL_MAX_Z - 0.14),
    new THREE.Vector3(0, 0.04, POOL_MAX_Z - 0.16),
    new THREE.Vector3(0, -0.94, POOL_MAX_Z - 0.16),
  ]);
  const ladderTubeGeo = prepGeo(new THREE.TubeGeometry(ladderCurve, 48, 0.019, 18, false));
  const escutcheonGeo = prepGeo(new THREE.CylinderGeometry(0.044, 0.048, 0.012, 28));
  const bumperGeo = prepGeo(new THREE.CylinderGeometry(0.026, 0.028, 0.136, 20));
  for (const sx of [-railSpanHalf, railSpanHalf]) {
    const rail = new THREE.Mesh(ladderTubeGeo, stainlessMat);
    rail.position.x = ladderCenterX + sx;
    rail.castShadow = true;
    const escutcheon = new THREE.Mesh(escutcheonGeo, stainlessMat);
    escutcheon.position.set(ladderCenterX + sx, 0.0275, POOL_MAX_Z + 0.2);
    const bumper = new THREE.Mesh(bumperGeo, stainlessMat);
    bumper.rotation.x = Math.PI / 2;
    bumper.position.set(ladderCenterX + sx, -0.9, POOL_MAX_Z - 0.071);
    ladderGroup.add(rail, escutcheon, bumper);
  }
  const treadGeo = bevelledBox(railSpanHalf * 2 - 0.042, 0.022, 0.088, 0.004, 3, 0.35, 0.35);
  for (const ty of [-0.26, -0.54, -0.82]) {
    const tread = new THREE.Mesh(treadGeo, stainlessMat);
    tread.position.set(ladderCenterX, ty, POOL_MAX_Z - 0.16);
    ladderGroup.add(tread);
  }
  terraceGroup.add(ladderGroup);

  const waterMat = new THREE.MeshPhysicalMaterial({
    name: 'stahl.pool.waterSurface',
    color: 0x35cbe0,
    emissive: new THREE.Color(0x10a8be),
    emissiveIntensity: 0.3,
    normalMap: createRippledWaterNormalMap(),
    normalScale: new THREE.Vector2(0.28, 0.28),
    transparent: true,
    opacity: 0.74,
    roughness: 0.06,
    metalness: 0.04,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    transmission: 0,
    ior: 1.333,
  });
  const waterMesh = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW - 0.006, 0.032, poolD - 0.006)), waterMat);
  waterMesh.name = 'stahl.pool.water';
  waterMesh.position.set(poolCenterX, POOL_WATER_Y, poolCenterZ);
  attachAudioEmitter(waterMesh, {
    id: 'stahl-pool-water-lap',
    preset: 'waterFeature',
    zoneId: 'stahlPoolTerrace',
    volume: 0.26,
    refDistance: 2.4,
    maxDistance: 15.0,
  });

  terraceGroup.add(
    poolFloor, wallN, wallS, wallW, wallE, tileN, tileS, tileW, tileE,
    copWest, copNorth, copSouth, copEast, inletDivider, dividerCap, bridgeNorth, bridgeSouth, waterMesh
  );
  root.add(terraceGroup);

  // Underwater pool circuit (`stahlPoolUnderwater` — strict 1 PointLight)
  const poolGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlPoolUnderwater;
  const nicheMat = new THREE.MeshStandardMaterial({
    name: 'stahl.pool.underwaterNicheLens',
    color: 0xe6feff,
    emissive: new THREE.Color(0x42e8f5),
    emissiveIntensity: 2.6,
    roughness: 0.15,
  });
  const nicheRingGeo = prepGeo(new THREE.CylinderGeometry(0.135, 0.135, 0.018, 28));
  const nicheLensGeo = prepGeo(new THREE.CylinderGeometry(0.102, 0.102, 0.014, 24));
  for (const [nx, nz, rotZ, rotX, lOffX, lOffZ] of [
    [POOL_MAIN_MAX_X - 0.012, 2.55, Math.PI / 2, 0, -0.018, 0],
    [POOL_MAIN_MAX_X - 0.012, 5.85, Math.PI / 2, 0, -0.018, 0],
    [-6.2, POOL_MAX_Z - 0.012, 0, Math.PI / 2, 0, -0.018],
  ] as const) {
    const ring = new THREE.Mesh(nicheRingGeo, stainlessMat);
    ring.rotation.set(rotX, 0, rotZ);
    ring.position.set(nx, -0.68, nz);
    const lens = new THREE.Mesh(nicheLensGeo, nicheMat);
    lens.rotation.set(rotX, 0, rotZ);
    lens.position.set(nx + lOffX, -0.68, nz + lOffZ);
    terraceGroup.add(ring, lens);
  }
  const poolLight = new THREE.PointLight(0x3be6f8, 3.6, 14.0, 2);
  poolLight.position.set(-5.6, -0.35, poolCenterZ);
  terraceGroup.add(poolLight);
  if (poolGrp) {
    poolGrp.emissives.push(nicheMat, plasterTileMat, mosaicTileMat, waterMat);
    poolGrp.lights.push(poolLight);
  }

  // Cantilever overhang soffit wash (`stahlCantileverSoffit` — strict 1 PointLight; total PointLights === 2)
  const soffitGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlCantileverSoffit;
  const soffitStripMat = new THREE.MeshStandardMaterial({
    color: 0xfff8ea,
    emissive: new THREE.Color(0xffdca8),
    emissiveIntensity: 1.6,
  });
  const soffitBar = new THREE.Mesh(bevelledBox(0.06, 0.03, Z3 - Z1, 0.004, 2, 0.5, 0.5), soffitStripMat);
  soffitBar.position.set(X3 - CANTILEVER_M * 0.6, CLEAR_CEILING_Y - 0.054, (Z1 + Z3) * 0.5);
  const soffitLight = new THREE.PointLight(0xffdca8, 2.2, 10.5, 2);
  soffitLight.position.set(X3 - 1.0, 2.35, 6.1);
  root.add(soffitBar, soffitLight);
  if (soffitGrp) {
    soffitGrp.emissives.push(soffitStripMat);
    soffitGrp.lights.push(soffitLight);
  }

  // 2-Car Carport, 1635 Woods Drive Street Entry Pier, Storage Lockers & Utility Meter
  const carportGroup = new THREE.Group();
  carportGroup.name = 'stahl.carport.details';

  const pierGroup = new THREE.Group();
  pierGroup.name = 'stahl.carport.streetEntryPier1635';
  const pierMinZ = Z0 + 0.08;
  const pierMaxZ = Z0 + 1.34;
  const pierH = CLEAR_CEILING_Y - 0.04;
  const steelMaps = getArchitecturalFinishPbr512('paintedSteel');
  const pierPuttyMat = new THREE.MeshStandardMaterial({
    name: 'stahl.robertsonDeckingPutty',
    color: 0xd0cabd,
    normalMap: steelMaps.normalMap,
    normalScale: new THREE.Vector2(0.16, 0.16),
    roughnessMap: steelMaps.roughnessMap,
    roughness: 0.58,
    metalness: 0.22,
  });
  const pierCore = new THREE.Mesh(bevelledBox(0.09, pierH, pierMaxZ - pierMinZ, 0.004, 3, 0.85, 0.85), pierPuttyMat);
  pierCore.position.set(X0 - 0.11, pierH * 0.5 + 0.001, (pierMinZ + pierMaxZ) * 0.5);
  pierCore.castShadow = pierCore.receiveShadow = true;
  pierGroup.add(pierCore);

  const vRibGeo = bevelledBox(0.022, pierH, 0.068, 0.003, 2, 0.6, 0.6);
  for (let rz = pierMinZ + 0.06; rz <= pierMaxZ - 0.06; rz += 0.16) {
    const vRib = new THREE.Mesh(vRibGeo, pierPuttyMat);
    vRib.position.set(X0 - 0.168, pierH * 0.5 + 0.001, rz);
    vRib.castShadow = true;
    pierGroup.add(vRib);
  }

  const addressPlaque = new THREE.Mesh(bevelledBox(0.016, 0.24, 0.64, 0.003, 3, 0.5, 0.5), mats.steelCharcoal);
  addressPlaque.position.set(X0 - 0.189, 1.56, (pierMinZ + pierMaxZ) * 0.5);
  const numerals = buildHouseNumerals1635(mats.anodizedAlum);
  numerals.position.set(X0 - 0.206, 1.56, (pierMinZ + pierMaxZ) * 0.5);
  pierGroup.add(addressPlaque, numerals);
  carportGroup.add(pierGroup);

  const westCarportCut: CutawayWallDescriptor = {
    axis: 'x', coord: X1, minSpan: Z0, maxSpan: Z1, floor: 'ground', outwardSide: 'west',
  };

  const lockerGroup = new THREE.Group();
  lockerGroup.name = 'stahl.carport.storageLockers';
  const lockerMinZ = -5.84;
  const lockerMaxZ = -2.36;
  const lockerW = lockerMaxZ - lockerMinZ;
  const lockerDepth = 0.32;
  const lockerH = 2.28;
  const lockerWallX = X1 - 0.082;

  const lockerCarcass = new THREE.Mesh(bevelledBox(lockerDepth, lockerH, lockerW, 0.005, 3, 0.85, 0.85), mats.steelCharcoal);
  lockerCarcass.position.set(lockerWallX - lockerDepth * 0.5, lockerH * 0.5 + 0.061, (lockerMinZ + lockerMaxZ) * 0.5);
  lockerCarcass.castShadow = lockerCarcass.receiveShadow = true;

  const lockerPlinth = new THREE.Mesh(bevelledBox(lockerDepth - 0.04, 0.058, lockerW - 0.02, 0.003, 2, 0.6, 0.6), mats.matteBlackHood);
  lockerPlinth.position.set(lockerWallX - (lockerDepth - 0.04) * 0.5, 0.03, (lockerMinZ + lockerMaxZ) * 0.5);
  lockerGroup.add(lockerCarcass, lockerPlinth);

  const doorCount = 4;
  const doorSpan = (lockerW - 0.04) / doorCount;
  const doorGeo = bevelledBox(0.018, lockerH - 0.05, doorSpan - 0.014, 0.003, 3, 0.85, 0.85);
  const pullGeo = bevelledBox(0.016, 0.19, 0.014, 0.002, 2, 0.3, 0.3);
  for (let i = 0; i < doorCount; i++) {
    const dz = lockerMinZ + 0.02 + doorSpan * (i + 0.5);
    const doorPanel = new THREE.Mesh(doorGeo, mats.walnutWood);
    doorPanel.position.set(lockerWallX - lockerDepth - 0.011, lockerH * 0.5 + 0.061, dz);
    doorPanel.castShadow = true;
    const pull = new THREE.Mesh(pullGeo, mats.anodizedAlum);
    pull.position.set(lockerWallX - lockerDepth - 0.029, 1.12, dz + (i % 2 === 0 ? doorSpan * 0.36 : -doorSpan * 0.36));
    lockerGroup.add(doorPanel, pull);
  }

  const meterBox = new THREE.Mesh(bevelledBox(0.16, 0.68, 0.52, 0.005, 3, 0.6, 0.6), pierPuttyMat);
  meterBox.position.set(lockerWallX - 0.08, 1.38, -1.96);
  meterBox.castShadow = true;
  const meterDial = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.078, 0.078, 0.042, 28)), mats.plateGlass);
  meterDial.rotation.z = Math.PI / 2;
  meterDial.position.set(lockerWallX - 0.183, 1.48, -1.96);
  const meterRim = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.078, 0.009, 14, 28)), stainlessMat);
  meterRim.rotation.y = Math.PI / 2;
  meterRim.position.set(lockerWallX - 0.184, 1.48, -1.96);
  const conduit = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.876, 18)), stainlessMat);
  conduit.position.set(lockerWallX - 0.06, 2.162, -1.96);
  lockerGroup.add(meterBox, meterDial, meterRim, conduit);

  tagCutaway(lockerGroup, westCarportCut);
  attachAssetMetadata(lockerGroup, {
    name: 'Koenig Carport Cedar Storage Lockers & Utility Meter Enclosure',
    brand: 'Case Study House #22 Custom Millwork',
    sku: 'CSH22-CARPORT-LOCKERS',
    finish: 'Western Red Cedar, Charcoal Steel & Brushed Aluminum',
    category: 'joinery',
    dimensionsMm: [340, 3480, 2340],
  });
  carportGroup.add(lockerGroup);

  const wheelStopGeo = bevelledBox(0.15, 0.095, 1.68, 0.008, 4, 1.524, 1.524);
  for (const wz of [-4.58, -1.65]) {
    const wheelStop = new THREE.Mesh(wheelStopGeo, copingMat);
    wheelStop.position.set(-13.25, 0.0485, wz);
    wheelStop.castShadow = wheelStop.receiveShadow = true;
    tagCollisionRole(wheelStop, 'ignore');
    carportGroup.add(wheelStop);
  }
  root.add(carportGroup);

  buildStahlPatioFurnishingsAndRoadster(ctx, root, mats, stainlessMat);
  buildPerimeterPipeSafetyRailing(root, mats.steelCharcoal);
  buildStahlCliffOutcropsAndChaparral(root);
  buildLaBasinCityLightsVista(root);
}
