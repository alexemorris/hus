import * as THREE from 'three';
import { SeatInteractable, collectSeatClickableMeshes } from 'husjs/catalog/furniture';
import { applyMetricBoxUVs } from 'husjs/materials';
import { attachAssetMetadata, prepGeo } from 'husjs/objects';
import type { SceneBuilderContext } from 'husjs/viewer';
import { getMcmMaterials } from './mcm-materials.ts';
import { getArchitecturalFinishPbr512, getVinylYachtCordPbr512, hashCell2D } from './pbr-textures.ts';
import {
  bevelledBox,
  buildAgaveAttenuataRosetteGeo,
  buildArchitecturalPotteryPlanterGeo,
  buildTuftedCushionGeo,
} from './sculpted-geometry.ts';
import type { StahlMaterials } from './structure.ts';

function paintAgaveColors(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  let repaired = false;
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getZ(i))) {
      const p1 = Math.max(0, i - 7);
      const p2 = Math.max(0, i - 14);
      pos.setXYZ(i, 2 * pos.getX(p1) - pos.getX(p2), Number.isFinite(pos.getY(i)) ? pos.getY(i) : pos.getY(p1), 2 * pos.getZ(p1) - pos.getZ(p2));
      repaired = true;
    }
  }
  if (repaired) {
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  const cols = new Float32Array(pos.count * 3);
  const inner = new THREE.Color(0x88a674);
  const outer = new THREE.Color(0x5b7650);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    c.copy(inner).lerp(outer, Math.max(0, Math.min(1, r / 0.45)));
    const shade = Math.max(0.76, Math.min(1.12, 0.88 + pos.getY(i) * 0.45));
    cols[i * 3] = Math.min(1, c.r * shade);
    cols[i * 3 + 1] = Math.min(1, c.g * shade);
    cols[i * 3 + 2] = Math.min(1, c.b * shade);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return prepGeo(geo);
}

function buildTropicalPlanterFoliageGeometry(variant: 'strelitzia' | 'philodendron', seed = 733): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const stemCol = new THREE.Color(0x3f5e32);
  const leafDark = new THREE.Color(variant === 'strelitzia' ? 0x2f5a31 : 0x295228);
  const leafBright = new THREE.Color(variant === 'strelitzia' ? 0x528246 : 0x4b7d3b);
  const tmpCol = new THREE.Color();
  const leafCount = variant === 'strelitzia' ? 10 : 12;
  const segs = 9;

  for (let i = 0; i < leafCount; i++) {
    const az = (i / leafCount) * Math.PI * 2 + (hashCell2D(i, 1, seed) - 0.5) * 0.42;
    const dirX = Math.cos(az);
    const dirZ = Math.sin(az);
    const sideX = -dirZ;
    const sideZ = dirX;
    const stemH = (variant === 'strelitzia' ? 0.42 : 0.26) + hashCell2D(i, 2, seed) * 0.24;
    const bladeLen = (variant === 'strelitzia' ? 0.52 : 0.36) + hashCell2D(i, 3, seed) * 0.16;
    const maxW = variant === 'strelitzia' ? 0.125 : 0.145;
    const pitch = (variant === 'strelitzia' ? 0.72 : 0.46) + hashCell2D(i, 4, seed) * 0.35;
    const baseVert = positions.length / 3;

    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const inBlade = Math.max(0, (t - 0.28) / 0.72);
      const r = 0.02 + t * (stemH * 0.35 + bladeLen * Math.cos(pitch * 0.75));
      const y = t * stemH * 0.85 + Math.sin(inBlade * Math.PI * 0.72) * bladeLen * Math.sin(pitch) - inBlade * inBlade * 0.11;
      const lobeMod = variant === 'philodendron' && inBlade > 0.15 ? 0.72 + 0.28 * Math.abs(Math.sin(inBlade * Math.PI * 3.5)) : 1.0;
      const hw = t < 0.26 ? 0.014 : maxW * Math.sin(Math.pow(inBlade, 0.68) * Math.PI) * lobeMod;
      const keel = t < 0.26 ? 0.012 : 0.02 * (1 - inBlade * 0.6);
      tmpCol.copy(t < 0.28 ? stemCol : leafDark).lerp(leafBright, inBlade * 0.75);
      const cx = dirX * r;
      const cz = dirZ * r;
      positions.push(
        cx - sideX * hw, y + keel * 0.65, cz - sideZ * hw,
        cx - sideX * hw * 0.48, y + keel * 0.28, cz - sideZ * hw * 0.48,
        cx, y, cz,
        cx + sideX * hw * 0.48, y + keel * 0.28, cz + sideZ * hw * 0.48,
        cx + sideX * hw, y + keel * 0.65, cz + sideZ * hw
      );
      for (const shade of [1.0, 0.94, 0.84, 0.94, 1.0]) {
        colors.push(tmpCol.r * shade, tmpCol.g * shade, tmpCol.b * shade);
      }
      if (s < segs) {
        const r0 = baseVert + s * 5;
        const r1 = r0 + 5;
        for (let k = 0; k < 4; k++) {
          indices.push(r0 + k, r1 + k, r0 + k + 1, r0 + k + 1, r1 + k, r1 + k + 1);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Hendrick Van Keppel-Green (VKG) 1960 Case Study House #22 corded tubular-steel sun chaise lounger
 * with `bevelledBox` square-tube frame (`radius: 0.003, segments: 3`), `getVinylYachtCordPbr512()`
 * wrapped vinyl yacht-cord deck, `36`-seg cylindrical headrest bolster, and `SeatInteractable`.
 */
export function addVanKeppelChaise(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  options: {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly rotY: number;
    readonly frameMat: THREE.Material;
    readonly cordMat: THREE.Material;
    readonly accentMat: THREE.Material;
    readonly floorY?: number;
  }
): void {
  const { name, x, z, rotY, frameMat, cordMat, accentMat, floorY = -0.0085 } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, floorY, z);
  g.rotation.y = rotY;

  const w = 0.68;
  const seatY = 0.315;
  const tube = 0.024;
  const railGeo = bevelledBox(tube, tube, 1.92, 0.003, 3, 0.5, 0.5);
  const legH = seatY - tube * 0.5 - 0.002;
  const legGeo = bevelledBox(tube, legH, tube, 0.003, 3, 0.5, 0.5);

  for (const sx of [-w * 0.5 + tube * 0.5, w * 0.5 - tube * 0.5]) {
    const rail = new THREE.Mesh(railGeo, frameMat);
    rail.position.set(sx, seatY, 0.02);
    rail.castShadow = true;
    g.add(rail);
    for (const sz of [-0.82, 0.84]) {
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(sx, legH * 0.5 + 0.0005, sz);
      leg.castShadow = true;
      g.add(leg);
    }
  }

  const crossGeo = bevelledBox(w - 2 * tube - 0.004, tube * 0.88, tube, 0.003, 3, 0.5, 0.5);
  for (const cz of [-0.92, -0.32, 0.96]) {
    const cross = new THREE.Mesh(crossGeo, frameMat);
    cross.position.set(0, seatY, cz);
    g.add(cross);
  }

  const seatDeck = new THREE.Mesh(bevelledBox(w - 2 * tube - 0.006, 0.026, 1.2, 0.005, 3, 0.42, 0.42), cordMat);
  seatDeck.name = `${name}.seatDeck`;
  seatDeck.position.set(0, seatY + 0.004, 0.325);
  seatDeck.castShadow = seatDeck.receiveShadow = true;
  g.add(seatDeck);

  const ribGeo = bevelledBox(w - 2 * tube - 0.002, 0.006, 0.032, 0.002, 2, 0.35, 0.35);
  for (let i = 0; i < 15; i++) {
    const rib = new THREE.Mesh(ribGeo, i === 1 || i === 2 ? accentMat : cordMat);
    rib.name = `${name}.ropeCord_${i}`;
    rib.position.set(0, seatY + 0.022, -0.24 + i * 0.082);
    g.add(rib);
  }

  const backPivot = new THREE.Group();
  backPivot.position.set(0, seatY + 0.014, -0.325);
  backPivot.rotation.x = -0.58;
  const backLen = 0.65;
  const bStileGeo = bevelledBox(tube * 0.9, tube * 0.9, backLen, 0.003, 3, 0.5, 0.5);
  for (const sx of [-w * 0.5 + tube * 0.5, w * 0.5 - tube * 0.5]) {
    const stile = new THREE.Mesh(bStileGeo, frameMat);
    stile.position.set(sx, 0, -backLen * 0.5);
    backPivot.add(stile);
  }
  const bTop = new THREE.Mesh(bevelledBox(w - 2 * tube - 0.004, tube * 0.9, tube * 0.9, 0.003, 3, 0.5, 0.5), frameMat);
  bTop.position.set(0, 0, -backLen + tube * 0.45);
  const backCord = new THREE.Mesh(bevelledBox(w - 2 * tube - 0.008, 0.024, backLen - 0.06, 0.005, 3, 0.42, 0.42), cordMat);
  backCord.name = `${name}.backrest`;
  backCord.position.set(0, 0.002, -backLen * 0.5 - 0.008);
  backCord.castShadow = true;

  const bolster = new THREE.Mesh(
    prepGeo(applyMetricBoxUVs(new THREE.CylinderGeometry(0.055, 0.055, w - 0.14, 36), { tileW: 0.4, tileH: 0.4 })),
    accentMat
  );
  bolster.rotation.z = Math.PI / 2;
  bolster.position.set(0, 0.072, -backLen + 0.13);
  bolster.castShadow = true;
  backPivot.add(bTop, backCord, bolster);
  g.add(backPivot);

  attachAssetMetadata(g, {
    name: 'Van Keppel-Green Corded Steel Sun Chaise Lounge (1960)',
    brand: 'Van Keppel-Green',
    collection: 'Case Study House #22 Merit Specified',
    sku: 'VKG-CSH22-CHAISE',
    finish: 'Charcoal-Bronze Lacquered Square Steel & White Vinyl Yacht Cord',
    category: 'furniture',
    dimensionsMm: [680, 1940, 740],
    notes: 'Merit-specified by Pierre Koenig for Case Study House #22 (Arts & Architecture, June 1960, p. 30).',
  });
  parent.add(g);

  if (ctx.interactions) {
    ctx.interactions.registerAnimatedInteractable(
      new SeatInteractable({
        id: `${name}.seat`,
        label: 'Recline on Van Keppel-Green Sun Lounger',
        aliases: [name],
        anchor: g,
        clickableTargets: collectSeatClickableMeshes(g),
        localSeatPos: [0, 0.35, 0.12],
        localFootOffset: [0, 0, 1.15],
        localForward: [0, 0, 1],
        material: 'linen',
      })
    );
  }
}

function addVanKeppelLoungeChair(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  options: {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly rotY: number;
    readonly frameMat: THREE.Material;
    readonly cordMat: THREE.Material;
    readonly cushionMat: THREE.Material;
    readonly floorY?: number;
  }
): void {
  const { name, x, z, rotY, frameMat, cordMat, cushionMat, floorY = -0.0085 } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, floorY, z);
  g.rotation.y = rotY;

  const w = 0.62;
  const d = 0.62;
  const seatY = 0.37;
  const tube = 0.022;
  const armH = 0.54;
  const frontLegGeo = bevelledBox(tube, armH, tube, 0.003, 3, 0.5, 0.5);
  const rearLegGeo = bevelledBox(tube, armH + 0.22, tube, 0.003, 3, 0.5, 0.5);
  const armGeo = bevelledBox(tube, tube * 0.85, d - 2 * tube - 0.004, 0.003, 3, 0.5, 0.5);
  const sideRailGeo = bevelledBox(tube, tube, d - 2 * tube - 0.004, 0.003, 3, 0.5, 0.5);

  for (const sx of [-w * 0.5 + tube * 0.5, w * 0.5 - tube * 0.5]) {
    const frontLeg = new THREE.Mesh(frontLegGeo, frameMat);
    frontLeg.position.set(sx, armH * 0.5 + 0.0005, d * 0.5 - tube * 0.5);
    const rearLeg = new THREE.Mesh(rearLegGeo, frameMat);
    rearLeg.position.set(sx, (armH + 0.22) * 0.5 + 0.0005, -d * 0.5 + tube * 0.5);
    const arm = new THREE.Mesh(armGeo, frameMat);
    arm.position.set(sx, armH - tube * 0.45, 0);
    const sideRail = new THREE.Mesh(sideRailGeo, frameMat);
    sideRail.position.set(sx, seatY, 0);
    frontLeg.castShadow = rearLeg.castShadow = true;
    g.add(frontLeg, rearLeg, arm, sideRail);
  }

  const seat = new THREE.Mesh(bevelledBox(w - 2 * tube - 0.006, 0.026, d - 0.07, 0.005, 3, 0.42, 0.42), cordMat);
  seat.name = `${name}.seat`;
  seat.position.set(0, seatY + 0.002, 0.015);
  seat.castShadow = seat.receiveShadow = true;

  const seatPad = new THREE.Mesh(
    buildTuftedCushionGeo({
      width: w - 2 * tube - 0.032, height: 0.034, depth: d - 0.14, crown: 0.008,
      tuftsX: 2, tuftsZ: 2, tuftDepth: 0.006, segX: 24, segY: 8, segZ: 20,
    }),
    cushionMat
  );
  seatPad.position.set(0, seatY + 0.038, 0.035);
  seatPad.castShadow = seatPad.receiveShadow = true;

  const back = new THREE.Mesh(bevelledBox(w - 2 * tube - 0.006, 0.28, 0.026, 0.005, 3, 0.42, 0.42), cordMat);
  back.name = `${name}.back`;
  back.position.set(0, seatY + 0.245, -d * 0.5 + 0.036);
  back.rotation.x = -0.18;
  back.castShadow = true;
  g.add(seat, seatPad, back);

  attachAssetMetadata(g, {
    name: 'Van Keppel-Green Corded Steel Patio Lounge Chair',
    brand: 'Van Keppel-Green',
    collection: 'Case Study House #22',
    sku: 'VKG-CSH22-CHAIR',
    finish: 'Charcoal-Bronze Steel & White Vinyl Cord',
    category: 'furniture',
    dimensionsMm: [620, 620, 760],
  });
  parent.add(g);

  if (ctx.interactions) {
    ctx.interactions.registerAnimatedInteractable(
      new SeatInteractable({
        id: `${name}.seat`,
        label: 'Sit in Van Keppel-Green Patio Chair',
        aliases: [name],
        anchor: g,
        clickableTargets: collectSeatClickableMeshes(g),
        localSeatPos: [0, 0.41, 0.02],
        localFootOffset: [0, 0, 0.72],
        localForward: [0, 0, 1],
        material: 'linen',
      })
    );
  }
}

function addVkgSideTableWithStyling(
  parent: THREE.Object3D,
  x: number,
  z: number,
  frameMat: THREE.Material,
  topMat: THREE.Material,
  accentMat: THREE.Material,
  glassMat: THREE.Material,
  floorY = -0.0085
): void {
  const g = new THREE.Group();
  g.name = 'stahl.patio.vkgSideTable';
  g.position.set(x, floorY, z);

  const w = 0.54;
  const d = 0.54;
  const h = 0.42;
  const tube = 0.02;
  const legH = h - 0.022;
  const legGeo = bevelledBox(tube, legH, tube, 0.003, 3, 0.5, 0.5);
  for (const sx of [-w * 0.5 + tube * 0.5, w * 0.5 - tube * 0.5]) {
    for (const sz of [-d * 0.5 + tube * 0.5, d * 0.5 - tube * 0.5]) {
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(sx, legH * 0.5 + 0.0005, sz);
      leg.castShadow = true;
      g.add(leg);
    }
  }

  const slatCount = 7;
  const slatW = (w - 0.04) / slatCount - 0.006;
  const slatGeo = bevelledBox(slatW, 0.018, d, 0.003, 3, 0.5, 0.5);
  for (let i = 0; i < slatCount; i++) {
    const slat = new THREE.Mesh(slatGeo, topMat);
    slat.position.set(-w * 0.5 + 0.02 + slatW * 0.5 + i * (slatW + 0.006), h - 0.009, 0);
    slat.castShadow = slat.receiveShadow = true;
    g.add(slat);
  }

  const towel = new THREE.Mesh(
    buildTuftedCushionGeo({ width: 0.21, height: 0.03, depth: 0.27, crown: 0.005, segX: 18, segY: 6, segZ: 18 }),
    accentMat
  );
  towel.position.set(-0.11, h + 0.02, 0.07);
  towel.rotation.y = 0.12;
  towel.castShadow = true;
  g.add(towel);

  const drinkMat = new THREE.MeshStandardMaterial({ color: 0xf2a93b, roughness: 0.18, transparent: true, opacity: 0.85 });
  const tumblerGeo = prepGeo(new THREE.CylinderGeometry(0.032, 0.028, 0.11, 28));
  const liquidGeo = prepGeo(new THREE.CylinderGeometry(0.026, 0.023, 0.076, 24));
  for (const [gx, gz] of [[0.12, -0.1], [0.16, 0.06]] as const) {
    const tumbler = new THREE.Mesh(tumblerGeo, glassMat);
    tumbler.position.set(gx, h + 0.057, gz);
    const liquid = new THREE.Mesh(liquidGeo, drinkMat);
    liquid.position.set(gx, h + 0.048, gz);
    g.add(tumbler, liquid);
  }

  const frameTortoise = new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.28 });
  const sgGroup = new THREE.Group();
  sgGroup.position.set(0.05, h + 0.012, -0.16);
  sgGroup.rotation.y = -0.45;
  const rimGeo = prepGeo(new THREE.TorusGeometry(0.022, 0.004, 12, 24));
  for (const lx of [-0.032, 0.032]) {
    const rim = new THREE.Mesh(rimGeo, frameTortoise);
    rim.rotation.x = Math.PI / 2;
    rim.position.x = lx;
    sgGroup.add(rim);
  }
  sgGroup.add(new THREE.Mesh(bevelledBox(0.018, 0.004, 0.005, 0.001, 2), frameTortoise));
  g.add(sgGroup);

  attachAssetMetadata(g, {
    name: 'Van Keppel-Green Slatted Patio Side Table',
    brand: 'Van Keppel-Green',
    collection: 'Case Study House #22',
    sku: 'VKG-CSH22-SIDE',
    finish: 'Charcoal Steel & White Opal Slats',
    category: 'furniture',
    dimensionsMm: [540, 540, 420],
  });
  parent.add(g);
}

function addArchitecturalPotteryPlanter(
  parent: THREE.Object3D,
  options: {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly floorY?: number;
    readonly shape: 'cylinder' | 'cone';
    readonly species: 'strelitzia' | 'philodendron' | 'agave';
    readonly ceramicMat: THREE.Material;
    readonly standMat: THREE.Material;
    readonly soilMat: THREE.Material;
    readonly foliageMat: THREE.Material;
    readonly agaveMat: THREE.Material;
    readonly seed: number;
  }
): void {
  const { name, x, z, floorY = -0.0085, shape, species, ceramicMat, standMat, soilMat, foliageMat, agaveMat, seed } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, floorY, z);

  const standH = 0.14;
  const potRTop = shape === 'cone' ? 0.25 : 0.22;
  const potRBot = shape === 'cone' ? 0.14 : 0.21;
  const potH = shape === 'cone' ? 0.36 : 0.38;
  const legOffset = potRTop + 0.032;
  const legW = 0.026;
  const innerSpan = (legOffset - legW * 0.5) * 2 - 0.004;
  const crossY = standH * 0.55;

  const bar1 = new THREE.Mesh(bevelledBox(innerSpan, 0.024, 0.024, 0.003, 3, 0.5, 0.5), standMat);
  bar1.position.set(0, crossY, 0);
  const halfArm = (innerSpan - 0.028) * 0.5;
  const armCenter = 0.014 + halfArm * 0.5;
  const armGeo = bevelledBox(0.024, 0.024, halfArm, 0.003, 3, 0.5, 0.5);
  const bar2A = new THREE.Mesh(armGeo, standMat);
  bar2A.position.set(0, crossY, -armCenter);
  const bar2B = new THREE.Mesh(armGeo, standMat);
  bar2B.position.set(0, crossY, armCenter);
  g.add(bar1, bar2A, bar2B);

  const legTotalH = standH + 0.18;
  const legGeo = bevelledBox(legW, legTotalH, legW, 0.003, 3, 0.5, 0.5);
  for (const [lx, lz] of [[-legOffset, 0], [legOffset, 0], [0, -legOffset], [0, legOffset]] as const) {
    const leg = new THREE.Mesh(legGeo, standMat);
    leg.position.set(lx, legTotalH * 0.5 + 0.0005, lz);
    leg.castShadow = true;
    g.add(leg);
  }

  const potBaseY = crossY + 0.015;
  const vessel = new THREE.Mesh(buildArchitecturalPotteryPlanterGeo(potRTop, potRBot, potH, 0.016, 56), ceramicMat);
  vessel.position.y = potBaseY;
  vessel.castShadow = vessel.receiveShadow = true;
  g.add(vessel);

  const soilY = potBaseY + potH * 0.85;
  const soil = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(potRTop - 0.024, potRTop - 0.026, 0.018, 36)), soilMat);
  soil.position.y = soilY;
  g.add(soil);

  const isAgave = species === 'agave';
  const plantGeo = isAgave ? paintAgaveColors(buildAgaveAttenuataRosetteGeo(24, 0.72)) : buildTropicalPlanterFoliageGeometry(species, seed);
  const plant = new THREE.Mesh(plantGeo, isAgave ? agaveMat : foliageMat);
  plant.name = `${name}.foliage`;
  plant.position.y = soilY + 0.011;
  plant.rotation.y = (seed % 7) * 0.9;
  plant.castShadow = true;
  g.add(plant);

  const speciesLabel = species === 'strelitzia' ? 'Strelitzia nicolai' : species === 'philodendron' ? 'Split-Leaf Philodendron' : 'Agave attenuata';
  attachAssetMetadata(g, {
    name: `Architectural Pottery Matte-White ${shape === 'cone' ? 'Conical' : 'Cylinder'} Planter (${speciesLabel})`,
    brand: 'Architectural Pottery',
    collection: 'LaDa / Case Study Merit Specified (1960)',
    sku: shape === 'cone' ? 'AP-CSH22-CONE' : 'AP-CSH22-CYL',
    finish: 'Matte Off-White Bisque Ceramic & Walnut Cross-Stand',
    category: 'decor',
    dimensionsMm: [Math.round(potRTop * 2000), Math.round(potRTop * 2000), Math.round((potH + potBaseY) * 1000)],
  });
  parent.add(g);
}

function catmullRom1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t2 * t);
}

function build1960CaliforniaRoadster(
  parent: THREE.Object3D,
  x: number,
  z: number,
  rotY: number,
  chromeMat: THREE.Material,
  glassMat: THREE.Material
): void {
  const car = new THREE.Group();
  car.name = 'stahl.carport.roadster1960';
  car.position.set(x, 0, z);
  car.rotation.y = rotY;

  const mcm = getMcmMaterials();
  const steelMaps = getArchitecturalFinishPbr512('paintedSteel');
  const paintMat = new THREE.MeshPhysicalMaterial({
    name: 'stahl.roadster.horizonWhitePaint',
    color: 0xece8de,
    normalMap: steelMaps.normalMap,
    normalScale: new THREE.Vector2(0.05, 0.05),
    roughness: 0.18,
    metalness: 0.12,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
  });
  const coveAccentMat = new THREE.MeshPhysicalMaterial({
    name: 'stahl.roadster.silverBlueCove',
    color: 0x8da4b5,
    roughness: 0.24,
    metalness: 0.4,
    clearcoat: 0.82,
  });
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.78, metalness: 0.35 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.84 });
  const whitewallMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.5 });
  const headlampMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, emissive: new THREE.Color(0xdbe8ff), emissiveIntensity: 0.15, roughness: 0.12 });
  const rubyTailMat = new THREE.MeshStandardMaterial({ color: 0xb81d18, emissive: new THREE.Color(0x7a0d0a), emissiveIntensity: 0.22, roughness: 0.18 });

  const ctrlStations: readonly [number, number, number, number, number, number, number][] = [
    [-2.08, 0.58, 0.31, 0.63, 0.67, 0, 0],
    [-1.84, 0.76, 0.24, 0.72, 0.77, 0, 0],
    [-1.34, 0.83, 0.21, 0.76, 0.8, 0, 0],
    [-0.78, 0.82, 0.2, 0.75, 0.77, 0.25, 0.01],
    [-0.15, 0.81, 0.2, 0.74, 0.75, 0.29, 0.032],
    [0.38, 0.82, 0.2, 0.77, 0.81, 0.04, 0.046],
    [0.96, 0.84, 0.21, 0.79, 0.84, 0, 0.038],
    [1.54, 0.81, 0.22, 0.75, 0.8, 0, 0.012],
    [1.96, 0.71, 0.26, 0.66, 0.71, 0, 0],
    [2.12, 0.54, 0.32, 0.55, 0.59, 0, 0],
  ];

  // 40 Catmull-Rom longitudinal stations x 32 cross-section ring vertices
  const numStations = 40;
  const ringPts = 32;
  const bodyPos: number[] = [];
  const bodyIdx: number[] = [];
  const nCtrl = ctrlStations.length;

  for (let s = 0; s < numStations; s++) {
    const u = (s / (numStations - 1)) * (nCtrl - 1);
    const i1 = Math.min(nCtrl - 2, Math.floor(u));
    const f = u - i1;
    const c0 = ctrlStations[Math.max(0, i1 - 1)]!;
    const c1 = ctrlStations[i1]!;
    const c2 = ctrlStations[i1 + 1]!;
    const c3 = ctrlStations[Math.min(nCtrl - 1, i1 + 2)]!;

    const sx = catmullRom1D(c0[0], c1[0], c2[0], c3[0], f);
    const halfW = catmullRom1D(c0[1], c1[1], c2[1], c3[1], f);
    const botY = catmullRom1D(c0[2], c1[2], c2[2], c3[2], f);
    const beltY = catmullRom1D(c0[3], c1[3], c2[3], c3[3], f);
    const crownY = catmullRom1D(c0[4], c1[4], c2[4], c3[4], f);
    const cockpitDip = Math.max(0, catmullRom1D(c0[5], c1[5], c2[5], c3[5], f));
    const coveIndent = Math.max(0, catmullRom1D(c0[6], c1[6], c2[6], c3[6], f));

    for (let k = 0; k < ringPts; k++) {
      const ang = (k / ringPts) * Math.PI * 2;
      const sinA = Math.sin(ang);
      const cosA = -Math.cos(ang);
      let pz = sinA * halfW;
      let py: number;
      if (cosA < -0.36) {
        const tBot = (cosA + 1) / 0.64;
        py = botY + (1 - tBot) * 0.012;
        pz *= 0.8 + 0.14 * tBot;
      } else if (cosA < 0.36) {
        const tSide = (cosA + 0.36) / 0.72;
        py = botY + tSide * (beltY - botY);
        const coveMask = Math.exp(-Math.pow((tSide - 0.54) / 0.24, 2));
        pz = Math.sign(sinA) * (halfW * (0.94 + Math.sin(tSide * Math.PI) * 0.085) - coveIndent * coveMask);
      } else {
        const tTop = (cosA - 0.36) / 0.64;
        py = beltY + Math.pow(tTop, 0.78) * (crownY - beltY) - cockpitDip * Math.pow(Math.max(0, 1 - Math.abs(sinA)), 1.35);
      }
      bodyPos.push(sx, py, pz);
    }
  }

  const rearCenterIdx = bodyPos.length / 3;
  bodyPos.push(-2.105, 0.49, 0);
  const frontCenterIdx = bodyPos.length / 3;
  bodyPos.push(2.145, 0.45, 0);

  for (let s = 0; s < numStations - 1; s++) {
    const r0 = s * ringPts;
    const r1 = (s + 1) * ringPts;
    for (let k = 0; k < ringPts; k++) {
      const kn = (k + 1) % ringPts;
      bodyIdx.push(r0 + k, r1 + k, r0 + kn, r0 + kn, r1 + k, r1 + kn);
    }
  }
  const fBase = (numStations - 1) * ringPts;
  for (let k = 0; k < ringPts; k++) {
    const kn = (k + 1) % ringPts;
    bodyIdx.push(rearCenterIdx, k, kn, frontCenterIdx, fBase + kn, fBase + k);
  }

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(bodyPos, 3));
  bodyGeo.setIndex(bodyIdx);
  bodyGeo.computeVertexNormals();

  const bodyShell = new THREE.Mesh(prepGeo(applyMetricBoxUVs(bodyGeo, { tileW: 1.0, tileH: 1.0 })), paintMat);
  bodyShell.name = 'stahl.carport.roadster1960.body';
  bodyShell.castShadow = bodyShell.receiveShadow = true;
  car.add(bodyShell);

  for (const side of [-1, 1] as const) {
    const covePanel = new THREE.Mesh(bevelledBox(1.32, 0.19, 0.016, 0.005, 3), coveAccentMat);
    covePanel.position.set(0.68, 0.5, side * 0.858);
    const spearCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.08, 0.5, side * 0.876),
      new THREE.Vector3(0.55, 0.505, side * 0.884),
      new THREE.Vector3(1.38, 0.49, side * 0.868),
    ]);
    car.add(covePanel, new THREE.Mesh(prepGeo(new THREE.TubeGeometry(spearCurve, 36, 0.0085, 14, false)), mcm.polishedChrome));
  }

  const underPan = new THREE.Mesh(bevelledBox(3.42, 0.055, 1.2, 0.008, 2), chassisMat);
  underPan.position.set(0.0, 0.168, 0);
  const cockpitFloor = new THREE.Mesh(bevelledBox(1.08, 0.036, 1.14, 0.006, 2), chassisMat);
  cockpitFloor.position.set(-0.34, 0.435, 0);
  car.add(underPan, cockpitFloor);

  const seatCushionGeo = buildTuftedCushionGeo({ width: 0.44, height: 0.095, depth: 0.42, crown: 0.018, tuftsX: 2, tuftsZ: 2, segX: 26, segY: 10, segZ: 24 });
  const seatBackGeo = buildTuftedCushionGeo({ width: 0.1, height: 0.41, depth: 0.41, crown: 0.016, tuftsX: 1, tuftsZ: 2, segX: 16, segY: 22, segZ: 22 });
  const fairingGeo = prepGeo(new THREE.ConeGeometry(0.125, 0.46, 28));
  for (const sz of [-0.34, 0.34] as const) {
    const cushion = new THREE.Mesh(seatCushionGeo, mcm.saddleLeather);
    cushion.position.set(-0.41, 0.515, sz);
    const seatBack = new THREE.Mesh(seatBackGeo, mcm.saddleLeather);
    seatBack.position.set(-0.665, 0.705, sz);
    seatBack.rotation.z = 0.2;
    const fairing = new THREE.Mesh(fairingGeo, paintMat);
    fairing.rotation.z = Math.PI / 2;
    fairing.position.set(-1.02, 0.805, sz);
    cushion.castShadow = seatBack.castShadow = true;
    car.add(cushion, seatBack, fairing);
  }

  const steerCol = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.32, 20)), mcm.polishedChrome);
  steerCol.position.set(0.06, 0.69, -0.34);
  steerCol.rotation.z = 0.95;

  const wheelPts: THREE.Vector3[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    wheelPts.push(new THREE.Vector3(0, Math.cos(a) * 0.155, Math.sin(a) * 0.155));
  }
  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(-0.085, 0.785, -0.34);
  wheelGroup.rotation.z = -0.62;
  wheelGroup.add(new THREE.Mesh(prepGeo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wheelPts, true), 40, 0.013, 14, true)), mcm.walnut));
  const spokeGeo = prepGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.132, 12));
  for (const sa of [Math.PI * 0.5, Math.PI * 1.2, Math.PI * 1.8]) {
    const sp = new THREE.Mesh(spokeGeo, mcm.polishedChrome);
    sp.rotation.x = sa;
    sp.position.set(0, Math.sin(sa) * 0.074, -Math.cos(sa) * 0.074);
    wheelGroup.add(sp);
  }

  const shifter = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.18, 16)), mcm.polishedChrome);
  shifter.position.set(-0.18, 0.58, 0);
  const shiftKnob = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.018, 18, 14)), mcm.porcelainWhite);
  shiftKnob.position.set(-0.18, 0.68, 0);
  car.add(steerCol, wheelGroup, shifter, shiftKnob);

  // Curved wraparound glass windshield & 40-seg TubeGeometry chrome header bow
  const wsGlass = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.68, 0.72, 0.33, 36, 2, true, -Math.PI * 0.42, Math.PI * 0.84)),
    glassMat
  );
  wsGlass.position.set(-0.22, 0.91, 0);
  wsGlass.rotation.set(0, Math.PI / 2, -0.36);

  const bowPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI * 0.42 + (i / 24) * Math.PI * 0.84;
    bowPts.push(new THREE.Vector3(Math.sin(a) * 0.685, 0.172, Math.cos(a) * 0.685));
  }
  const wsBow = new THREE.Mesh(prepGeo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bowPts), 40, 0.012, 14, false)), mcm.polishedChrome);
  wsBow.position.set(-0.22, 0.91, 0);
  wsBow.rotation.set(0, Math.PI / 2, -0.36);
  car.add(wsGlass, wsBow);

  const grillePts: THREE.Vector3[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    grillePts.push(new THREE.Vector3(2.162, 0.44 + Math.sin(a) * 0.145, Math.cos(a) * 0.44));
  }
  car.add(new THREE.Mesh(prepGeo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(grillePts, true), 40, 0.02, 14, true)), mcm.polishedChrome));
  const toothGeo = bevelledBox(0.016, 0.17, 0.01, 0.002, 2);
  for (let t = -5; t <= 5; t++) {
    const tooth = new THREE.Mesh(toothGeo, mcm.polishedChrome);
    tooth.position.set(2.155, 0.44, t * 0.068);
    car.add(tooth);
  }

  for (const side of [-1, 1] as const) {
    const bezel = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.105, 0.112, 0.07, 28)), mcm.polishedChrome);
    bezel.rotation.z = Math.PI / 2;
    bezel.position.set(2.055, 0.63, side * 0.56);
    const lens = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.09, 24, 16)), headlampMat);
    lens.scale.set(0.42, 1, 1);
    lens.position.set(2.1, 0.63, side * 0.56);

    const fBumperCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(2.21, 0.32, side * 0.24),
      new THREE.Vector3(2.2, 0.32, side * 0.54),
      new THREE.Vector3(2.11, 0.32, side * 0.75),
      new THREE.Vector3(1.94, 0.32, side * 0.81),
    ]);
    const fBumper = new THREE.Mesh(prepGeo(new THREE.TubeGeometry(fBumperCurve, 36, 0.032, 16, false)), mcm.polishedChrome);

    const rBumperCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.16, 0.34, side * 0.24),
      new THREE.Vector3(-2.15, 0.34, side * 0.54),
      new THREE.Vector3(-2.06, 0.34, side * 0.74),
      new THREE.Vector3(-1.89, 0.34, side * 0.8),
    ]);
    const rBumper = new THREE.Mesh(prepGeo(new THREE.TubeGeometry(rBumperCurve, 36, 0.034, 16, false)), mcm.polishedChrome);

    const tailBezel = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.056, 0.062, 0.06, 24)), mcm.polishedChrome);
    tailBezel.rotation.z = Math.PI / 2;
    tailBezel.position.set(-2.07, 0.6, side * 0.58);
    const tailLens = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.047, 0.08, 24)), rubyTailMat);
    tailLens.rotation.z = Math.PI / 2;
    tailLens.position.set(-2.125, 0.6, side * 0.58);

    const exhaust = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.14, 20)), chromeMat);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(-2.12, 0.24, side * 0.36);
    car.add(bezel, lens, fBumper, rBumper, tailBezel, tailLens, exhaust);
  }

  // 36-seg rounded-profile LatheGeometry whitewall tires + 36-seg spun-chrome knock-off hubcaps
  const wheelR = 0.33;
  const hw = 0.098;
  const tireGeo = prepGeo(new THREE.LatheGeometry([
    new THREE.Vector2(0.188, -hw * 0.84), new THREE.Vector2(0.248, -hw * 0.99),
    new THREE.Vector2(0.298, -hw * 0.94), new THREE.Vector2(0.324, -hw * 0.72),
    new THREE.Vector2(wheelR, -hw * 0.38), new THREE.Vector2(wheelR, hw * 0.38),
    new THREE.Vector2(0.324, hw * 0.72), new THREE.Vector2(0.298, hw * 0.94),
    new THREE.Vector2(0.248, hw * 0.99), new THREE.Vector2(0.188, hw * 0.84),
  ], 36));
  const whitewallGeo = prepGeo(new THREE.LatheGeometry([
    new THREE.Vector2(0.194, hw * 0.86 + 0.0032),
    new THREE.Vector2(0.236, hw * 0.99 + 0.0036),
    new THREE.Vector2(0.272, hw * 0.97 + 0.0032),
  ], 36));
  const hubcapGeo = prepGeo(new THREE.LatheGeometry([
    new THREE.Vector2(0.001, hw + 0.046), new THREE.Vector2(0.036, hw + 0.024),
    new THREE.Vector2(0.068, hw + 0.017), new THREE.Vector2(0.125, hw + 0.007),
    new THREE.Vector2(0.162, hw + 0.014), new THREE.Vector2(0.188, hw * 0.86 + 0.006),
  ], 36));

  for (const [wx, wz] of [[1.3, -0.78], [1.3, 0.78], [-1.28, -0.78], [-1.28, 0.78]] as const) {
    const rotX = wz > 0 ? Math.PI / 2 : -Math.PI / 2;
    const wGrp = new THREE.Group();
    wGrp.position.set(wx, wheelR + 0.002, wz);
    const tire = new THREE.Mesh(tireGeo, tireMat);
    const whitewall = new THREE.Mesh(whitewallGeo, whitewallMat);
    const hubcap = new THREE.Mesh(hubcapGeo, mcm.polishedChrome);
    tire.rotation.x = whitewall.rotation.x = hubcap.rotation.x = rotX;
    tire.castShadow = true;
    wGrp.add(tire, whitewall, hubcap);
    car.add(wGrp);
  }

  attachAssetMetadata(car, {
    name: '1960 California Two-Seat Roadster (Ermine White / Silver-Blue Cove)',
    brand: 'Chevrolet / Case Study Period Classic',
    collection: '1960 Hollywood Hills Arrival',
    sku: 'CSH22-1960-ROADSTER',
    finish: 'Ermine White & Silver-Blue Lacquer with Saddle Leather & Whitewalls',
    category: 'vehicle',
    dimensionsMm: [4260, 1740, 1180],
    notes: 'Parked in North Bay 1 of Pierre Koenig’s sheltered 2-car carport off 1635 Woods Drive.',
  });
  parent.add(car);
}

/**
 * Populates Van Keppel-Green outdoor furnishings, Architectural Pottery planters,
 * and the 1960 California Roadster in North Carport Bay 1.
 */
export function buildStahlPatioFurnishingsAndRoadster(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials,
  stainlessMat: THREE.Material
): void {
  const mcm = getMcmMaterials();
  const cordMaps = getVinylYachtCordPbr512();
  const steelMaps = getArchitecturalFinishPbr512('paintedSteel');
  const plasterMaps = getArchitecturalFinishPbr512('plaster');

  const vkgCordMat = new THREE.MeshStandardMaterial({
    name: 'stahl.vkg.whiteVinylCord',
    color: 0xf4f0e4,
    map: cordMaps.map,
    normalMap: cordMaps.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: cordMaps.roughnessMap,
    roughness: 0.44,
  });
  const vkgPersimmonMat = new THREE.MeshStandardMaterial({
    name: 'stahl.vkg.persimmonCord',
    color: 0xd4673a,
    normalMap: cordMaps.normalMap,
    normalScale: new THREE.Vector2(0.48, 0.48),
    roughnessMap: cordMaps.roughnessMap,
    roughness: 0.56,
  });
  const vkgOpalSlatMat = new THREE.MeshStandardMaterial({
    name: 'stahl.vkg.whiteOpalLacquer',
    color: 0xeeeade,
    normalMap: steelMaps.normalMap,
    normalScale: new THREE.Vector2(0.14, 0.14),
    roughnessMap: steelMaps.roughnessMap,
    roughness: 0.36,
    metalness: 0.12,
  });

  for (const [idx, lz] of [[1, 2.75], [2, 5.95]] as const) {
    addVanKeppelChaise(ctx, root, {
      name: `stahl.patio.vkgLounger_${idx}`,
      x: -12.32,
      z: lz,
      rotY: Math.PI / 2,
      frameMat: mats.steelCharcoal,
      cordMat: vkgCordMat,
      accentMat: vkgPersimmonMat,
    });
  }
  addVkgSideTableWithStyling(root, -12.38, 4.35, mats.steelCharcoal, vkgOpalSlatMat, mcm.throwStriped, mats.plateGlass);

  const patioTableGroup = new THREE.Group();
  patioTableGroup.name = 'stahl.patio.vkgRoundTable';
  patioTableGroup.position.set(-5.15, -0.0085, 8.48);
  const roundTop = new THREE.Mesh(
    prepGeo(applyMetricBoxUVs(new THREE.CylinderGeometry(0.46, 0.46, 0.022, 48), { tileW: 0.9, tileH: 0.9 })),
    vkgOpalSlatMat
  );
  roundTop.position.y = 0.52;
  roundTop.castShadow = roundTop.receiveShadow = true;
  const roundStem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.493, 28)), mats.steelCharcoal);
  roundStem.position.y = 0.261;
  const roundBase = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.24, 0.25, 0.012, 40)), mats.steelCharcoal);
  roundBase.position.y = 0.0065;
  patioTableGroup.add(roundTop, roundStem, roundBase);
  attachAssetMetadata(patioTableGroup, {
    name: 'Van Keppel-Green Circular Patio Cocktail Table',
    brand: 'Van Keppel-Green',
    collection: 'Case Study House #22',
    sku: 'VKG-CSH22-ROUND920',
    finish: 'White Opal Top & Charcoal Steel Pedestal',
    category: 'furniture',
    dimensionsMm: [920, 920, 530],
  });
  root.add(patioTableGroup);

  for (const [idx, cx, rot] of [[1, -6.12, Math.PI * 0.64], [2, -4.18, -Math.PI * 0.56]] as const) {
    addVanKeppelLoungeChair(ctx, root, {
      name: `stahl.patio.vkgChair_${idx}`,
      x: cx,
      z: 8.42,
      rotY: rot,
      frameMat: mats.steelCharcoal,
      cordMat: vkgCordMat,
      cushionMat: vkgPersimmonMat,
    });
  }

  const ceramicWhiteMat = new THREE.MeshStandardMaterial({
    name: 'stahl.planter.architecturalPotteryWhite',
    color: 0xf3efe5,
    normalMap: plasterMaps.normalMap,
    normalScale: new THREE.Vector2(0.22, 0.22),
    roughnessMap: plasterMaps.roughnessMap,
    roughness: 0.68,
    metalness: 0.0,
  });
  const pottingSoilMat = new THREE.MeshStandardMaterial({ color: 0x3b2d22, roughness: 0.95 });
  const tropicalLeafMat = new THREE.MeshStandardMaterial({
    name: 'stahl.planter.tropicalFoliage',
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.54,
  });
  const agavePlanterMat = new THREE.MeshStandardMaterial({
    name: 'stahl.planter.agaveAttenuata',
    vertexColors: true,
    roughness: 0.56,
    metalness: 0.0,
  });

  for (const spec of [
    { name: 'stahl.planter.breezewayWest', x: -12.98, z: 0.72, shape: 'cylinder', species: 'strelitzia', standMat: mcm.walnut, seed: 101 },
    { name: 'stahl.planter.breezewayInnerCorner', x: -6.12, z: 0.74, shape: 'cylinder', species: 'philodendron', standMat: mcm.walnut, seed: 203 },
    { name: 'stahl.planter.southWestCorner', x: -12.95, z: 8.75, shape: 'cone', species: 'agave', standMat: mats.steelCharcoal, seed: 307 },
    { name: 'stahl.planter.southLivingThreshold', x: -1.18, z: 8.72, shape: 'cone', species: 'agave', standMat: mcm.walnut, seed: 409 },
  ] as const) {
    addArchitecturalPotteryPlanter(root, {
      ...spec,
      ceramicMat: ceramicWhiteMat,
      soilMat: pottingSoilMat,
      foliageMat: tropicalLeafMat,
      agaveMat: agavePlanterMat,
    });
  }

  build1960CaliforniaRoadster(root, -15.38, -4.58, 0, stainlessMat, mats.plateGlass);
}
