import * as THREE from 'three';
import type { CircuitId, RoomZoneId } from 'husjs';
import { applyMetricBoxUVs } from 'husjs/materials';
import {
  prepGeo,
  registerHingedDoor,
  tagHighLodDetail,
} from 'husjs/objects';
import {
  buildArmstrongWallBasinMixer,
  buildThomasCrapperDownhamBasin,
} from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';

/** Farrow & Ball *Pigeon No. 25* (`#969B90`) & *Green Smoke No. 47* (`#6F7B71`) & Neptune *Ink* (`#28313B`). */
export const FB_PIGEON_CABINETRY = 0x969b90;
export const FB_GREEN_SMOKE = 0x6f7b71;
export const NEPTUNE_INK_CABINETRY = 0x28313b;

export function registerCircuitEmissive(
  ctx: SceneBuilderContext,
  circuitId: CircuitId,
  mat: THREE.MeshStandardMaterial
): void {
  const maybeReg = (
    ctx as unknown as {
      registerEmissive?: (id: CircuitId, m: THREE.MeshStandardMaterial) => void;
    }
  ).registerEmissive;
  if (typeof maybeReg === 'function') {
    maybeReg.call(ctx, circuitId, mat);
    return;
  }
  ctx.lightGroups[circuitId]?.emissives.push(mat);
}

export function createWarm2700kLedMaterial(
  name: string,
  emissiveIntensity = 1.4
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xfff1d6,
    emissive: new THREE.Color(0xffb86b),
    emissiveIntensity,
    roughness: 0.3,
  });
}

export function deconflictRomanBlind(blind: THREE.Group, facingZ: 1 | -1): THREE.Group {
  for (const child of blind.children) {
    if (child.name.endsWith('.hemBar')) {
      child.position.y -= 0.0015;
      child.position.z += facingZ * 0.002;
    } else if (child.name.endsWith('.pleat')) {
      child.position.z += facingZ * 0.005;
    }
  }
  return blind;
}

export function deconflictCurtainBrackets(curtains: THREE.Group, inwardSignX: 1 | -1): THREE.Group {
  let idx = 0;
  for (const child of curtains.children) {
    if (child.name.endsWith('.bracket')) {
      const mod = idx % 3;
      if (mod === 0) {
        child.scale.y = 0.86;
      } else if (mod === 1) {
        child.position.x += inwardSignX * 0.0012;
      }
      idx++;
    }
  }
  return curtains;
}

export function addBox(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  center: readonly [number, number, number],
  material: THREE.Material
): THREE.Mesh {
  const mesh = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(size[0], size[1], size[2])), material);
  mesh.name = name;
  mesh.position.set(center[0], center[1], center[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function applyEstateEggshellPaintToJoinery(
  group: THREE.Object3D,
  eggShellMat: THREE.Material
): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mat = child.material;
    if (
      mat &&
      !Array.isArray(mat) &&
      typeof mat.name === 'string' &&
      (mat.name.endsWith('.paint') || mat.name.endsWith('.shinglePaint'))
    ) {
      child.material = eggShellMat;
    }
  });
}

/**
 * Paints the *Neptune* prep-island apron, legs & end panels in deep *Ink* (`0x28313b` `estate-eggshell`)
 * while preserving the honed Carrara marble slab and adding a flush character-oak butcher's block end section.
 */
export function customizeNeptuneInkPrepIsland(
  island: THREE.Group,
  inkPaintMat: THREE.Material,
  characterOakMat: THREE.Material
): void {
  island.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (
      child.name.includes('.oakLeg_') ||
      child.name.includes('.oakApron') ||
      child.name.includes('.oakEndPanel')
    ) {
      child.material = inkPaintMat;
    } else if (child.name.endsWith('.broadsheetLeftPage')) {
      child.position.x = -0.26;
    } else if (child.name.endsWith('.broadsheetRightPage')) {
      child.position.x = -0.05;
    }
  });

  // Solid end-grain character-oak butcher's block slab crowning the South/Left prep end (0 z-fight above 0.91 m Carrara top)
  const blockW = 0.56;
  const blockH = 0.028;
  const blockD = 1.06;
  const blockGeo = prepGeo(
    applyMetricBoxUVs(new THREE.BoxGeometry(blockW, blockH, blockD), {
      tileW: 0.75,
      tileH: 0.75,
      topTileV: 0.75,
    })
  );
  const butcherBlock = new THREE.Mesh(blockGeo, characterOakMat);
  butcherBlock.name = `${island.name}.butchersBlockOakEnd`;
  butcherBlock.position.set(-0.81, 0.91 + blockH * 0.5 + 0.0006, 0);
  butcherBlock.castShadow = true;
  butcherBlock.receiveShadow = true;
  island.add(butcherBlock);
}

/** Adds 2 matching Wardley carver/end chairs to a 6-chair Arundel dining set so all 8 places are set. */
function cloneTreeCleanUserData(src: THREE.Object3D, oldPrefix: string, newPrefix: string): THREE.Object3D {
  const dst =
    src instanceof THREE.Mesh
      ? new THREE.Mesh(src.geometry, src.material)
      : new THREE.Group();
  dst.name = src === dst ? src.name : src.name.replace(oldPrefix, newPrefix);
  dst.position.copy(src.position);
  dst.rotation.copy(src.rotation);
  dst.scale.copy(src.scale);
  dst.castShadow = src.castShadow;
  dst.receiveShadow = src.receiveShadow;
  if (src.userData?.lodTier) {
    dst.userData = { lodTier: src.userData.lodTier };
  }
  for (const child of src.children) {
    dst.add(cloneTreeCleanUserData(child, oldPrefix, newPrefix));
  }
  return dst;
}

export function addArundelEndDiningChairs(
  diningSet: THREE.Group,
  namePrefix: string,
  tableLengthM: number
): void {
  const protoName = `${namePrefix}.chairNorth_2`;
  const proto = diningSet.getObjectByName(protoName);
  if (!proto) return;
  const endOffsetX = tableLengthM * 0.5 + 0.18;
  for (const [tag, ex, rotY] of [
    ['chairHeadWest', -endOffsetX, Math.PI * 0.5],
    ['chairHeadEast', endOffsetX, -Math.PI * 0.5],
  ] as const) {
    const clone = cloneTreeCleanUserData(proto, protoName, `${namePrefix}.${tag}`);
    clone.position.set(ex, 0, 0);
    clone.rotation.y = rotY;
    diningSet.add(clone);
  }
}

export interface RotaryDimmerSpec {
  readonly dimmerId: string;
  readonly circuitId: CircuitId;
  readonly label: string;
}

/** Builds a 1- to 3-gang Corston antique-brass rotary dimmer plate with interactive knurled knobs. */
export function buildCorstonRotaryDimmerPlate(
  ctx: SceneBuilderContext,
  opts: {
    readonly name: string;
    readonly zoneId: RoomZoneId;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly facing: 'east' | 'west' | 'north' | 'south';
    readonly brassMat: THREE.Material;
    readonly knurledBrassMat: THREE.Material;
    readonly dimmers: readonly RotaryDimmerSpec[];
    readonly parent: THREE.Object3D;
  }
): THREE.Group {
  const group = new THREE.Group();
  group.name = opts.name;
  group.position.set(opts.x, opts.y, opts.z);
  const rotByFacing: Record<'north' | 'south' | 'east' | 'west', number> = {
    south: 0,
    north: Math.PI,
    east: Math.PI * 0.5,
    west: -Math.PI * 0.5,
  };
  group.rotation.y = rotByFacing[opts.facing];
  opts.parent.add(group);

  const count = opts.dimmers.length;
  const plateW = count <= 1 ? 0.086 : count === 2 ? 0.146 : 0.176;
  const plateH = 0.086;
  const plateT = 0.005;
  addBox(group, `${opts.name}.plate`, [plateW, plateH, plateT], [0, 0, plateT * 0.5 + 0.001], opts.brassMat);

  const pitch = count <= 1 ? 0 : 0.052;
  opts.dimmers.forEach((d, idx) => {
    const kx = (idx - (count - 1) * 0.5) * pitch;
    const collar = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.022, 0.024, 0.004, 18)),
      opts.brassMat
    );
    collar.name = `${opts.name}.collar_${idx + 1}`;
    collar.rotation.x = Math.PI * 0.5;
    collar.position.set(kx, 0, plateT + 0.0035);
    group.add(collar);

    const knob = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.017, 0.019, 0.018, 18)),
      opts.knurledBrassMat
    );
    knob.name = d.dimmerId;
    knob.rotation.x = Math.PI * 0.5;
    knob.position.set(kx, 0, plateT + 0.015);
    knob.userData = {
      type: 'dimmer',
      electricalDimmerId: d.dimmerId,
      zoneId: opts.zoneId,
      circuitId: d.circuitId,
      label: d.label,
    };
    ctx.interactiveMeshes.push(knob);
    group.add(knob);
  });

  return group;
}

/**
 * Georgian Carrara marble console washstand (`w = 0.54, d = 0.44`).
 * Local origin is centered in X and Z (`z ∈ [-0.266, +0.174]`) so placing at `[1.36, 0, -2.85]`
 * with `rotationY = -Math.PI / 2` seats the rear upstand & wall mixer flush against the East cloakroom wall!
 */
export function buildGeorgianCloakroomWashstand(
  namePrefix: string,
  brassMat: THREE.Material,
  carraraMat: THREE.Material,
  oakMat: THREE.Material
): THREE.Group {
  const root = new THREE.Group();
  root.name = namePrefix;

  const w = 0.54;
  const d = 0.44;
  const rearZ = -0.278;
  const frontZ = rearZ + d;
  const midZ = rearZ + d * 0.5;
  const topY = 0.76;
  const slabT = 0.026;
  const apronH = 0.074;
  const legTopY = topY - slabT;

  addBox(root, `${namePrefix}.carraraSlab`, [w, slabT, d], [0, topY - slabT * 0.5, midZ], carraraMat);
  addBox(
    root,
    `${namePrefix}.carraraUpstand`,
    [w, 0.068, 0.018],
    [0, topY + 0.0345, rearZ + 0.009],
    carraraMat
  );

  addBox(
    root,
    `${namePrefix}.oakApronFront`,
    [w - 0.09, apronH, 0.02],
    [0, legTopY - apronH * 0.5 - 0.002, frontZ - 0.038],
    oakMat
  );
  for (const [sTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addBox(
      root,
      `${namePrefix}.oakApronSide${sTag}`,
      [0.02, apronH, d - 0.08],
      [sx * (w * 0.5 - 0.035), legTopY - apronH * 0.5 - 0.002, rearZ + (d - 0.04) * 0.5],
      oakMat
    );
    const leg = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.013, 0.011, legTopY - 0.002, 14)),
      brassMat
    );
    leg.name = `${namePrefix}.brassConsoleLeg${sTag}`;
    leg.position.set(sx * (w * 0.5 - 0.035), (legTopY - 0.002) * 0.5, frontZ - 0.038);
    leg.castShadow = true;
    root.add(leg);
  }
  const towelRail = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.007, 0.007, w - 0.09, 12)),
    brassMat
  );
  towelRail.name = `${namePrefix}.frontTowelBar`;
  towelRail.rotation.z = Math.PI * 0.5;
  towelRail.position.set(0, 0.585, frontZ - 0.038);
  root.add(towelRail);

  const basin = buildThomasCrapperDownhamBasin({
    namePrefix: `${namePrefix}.downhamBasin`,
    finish: 'SB',
  });
  basin.position.set(0, topY + 0.001, rearZ + 0.045);
  root.add(basin);

  const wallMixer = buildArmstrongWallBasinMixer({
    namePrefix: `${namePrefix}.wallMixer`,
    finish: 'SB',
    tipCapOffsetM: 0.001,
  });
  wallMixer.position.set(0, topY + 0.255, rearZ + 0.002);
  root.add(wallMixer);

  return root;
}

/**
 * Custom Regency flame-mahogany tooled-leather-inset writing desk (`1.22 × 0.60 × 0.76 m`)
 * & sabre-leg upholstered library chair facing North (`-Z`) toward the garden sash window.
 */
export function buildRegencyMahoganyWritingDeskAndChair(opts: {
  readonly name: string;
  readonly brassMat: THREE.Material;
  readonly darkBrassMat: THREE.Material;
  readonly position: readonly [number, number, number];
}): THREE.Group {
  const { name, brassMat, darkBrassMat } = opts;
  const root = new THREE.Group();
  root.name = name;

  const mahoganyMat = new THREE.MeshPhysicalMaterial({
    name: `${name}.flameMahogany`,
    color: 0x4e2417,
    roughness: 0.34,
    clearcoat: 0.45,
    clearcoatRoughness: 0.28,
  });
  const leatherSkiverMat = new THREE.MeshStandardMaterial({
    name: `${name}.bottleGreenMoroccoLeather`,
    color: 0x24382c,
    roughness: 0.62,
  });
  const giltRuleMat = new THREE.MeshStandardMaterial({
    name: `${name}.giltTooling`,
    color: 0xc8a355,
    roughness: 0.32,
    metalness: 0.75,
  });
  const linenSeatMat = new THREE.MeshStandardMaterial({
    name: `${name}.oatmealHorsehairLinen`,
    color: 0xdad1c1,
    roughness: 0.86,
  });
  const paperMat = new THREE.MeshStandardMaterial({
    name: `${name}.laidWritingPaper`,
    color: 0xf3ecde,
    roughness: 0.9,
  });

  const w = 1.22;
  const d = 0.60;
  const h = 0.76;
  const topT = 0.028;
  const friezeH = 0.125;
  const legTopY = h - topT;

  // Mahogany perimeter mitred top frame + bottle-green Morocco leather skiver (zero coplanar faces)
  const border = 0.075;
  const innerW = w - border * 2;
  const innerD = d - border * 2;
  addBox(root, `${name}.topUnderDeck`, [w - 0.012, topT - 0.006, d - 0.012], [0, legTopY + (topT - 0.006) * 0.5, 0], mahoganyMat);
  addBox(root, `${name}.topBorderFront`, [w, 0.006, border], [0, h - 0.003, d * 0.5 - border * 0.5], mahoganyMat);
  addBox(root, `${name}.topBorderRear`, [w, 0.006, border], [0, h - 0.003, -(d * 0.5 - border * 0.5)], mahoganyMat);
  addBox(root, `${name}.topBorderLeft`, [border, 0.006, innerD], [-(w * 0.5 - border * 0.5), h - 0.003, 0], mahoganyMat);
  addBox(root, `${name}.topBorderRight`, [border, 0.006, innerD], [w * 0.5 - border * 0.5, h - 0.003, 0], mahoganyMat);
  addBox(root, `${name}.leatherSkiver`, [innerW - 0.008, 0.0055, innerD - 0.008], [0, h - 0.0028, 0], leatherSkiverMat);
  addBox(root, `${name}.giltRuleFront`, [innerW - 0.024, 0.001, 0.004], [0, h + 0.0006, innerD * 0.5 - 0.016], giltRuleMat);
  addBox(root, `${name}.giltRuleRear`, [innerW - 0.024, 0.001, 0.004], [0, h + 0.0006, -(innerD * 0.5 - 0.016)], giltRuleMat);

  // Frieze carcass & 3 cock-beaded drawers on user (+Z South) side
  const legInsetX = w * 0.5 - 0.052;
  const legInsetZ = d * 0.5 - 0.052;
  const friezeCy = legTopY - friezeH * 0.5 - 0.001;
  addBox(root, `${name}.friezeRear`, [w - 0.164, friezeH - 0.004, 0.022], [0, friezeCy, -legInsetZ], mahoganyMat);
  for (const [sTag, sx] of [['Left', -1], ['Right', 1]] as const) {
    addBox(root, `${name}.friezeSide${sTag}`, [0.022, friezeH - 0.004, d - 0.164], [sx * legInsetX, friezeCy, 0], mahoganyMat);
  }
  const drawerSpecs: readonly [string, number, number][] = [
    ['Left', -0.355, 0.31],
    ['Center', 0, 0.36],
    ['Right', 0.355, 0.31],
  ];
  for (const [dTag, dx, dw] of drawerSpecs) {
    addBox(root, `${name}.drawerFront${dTag}`, [dw, friezeH - 0.012, 0.022], [dx, friezeCy, legInsetZ], mahoganyMat);
    const pull = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.016, 0.003, 8, 16, Math.PI)), brassMat);
    pull.name = `${name}.drawerPull${dTag}`;
    pull.rotation.z = Math.PI;
    pull.position.set(dx, friezeCy - 0.004, legInsetZ + 0.015);
    tagHighLodDetail(pull);
    root.add(pull);
  }

  // 4 tapered reeded Regency legs + aged-brass cup castors
  for (const [lTag, sx, sz] of [
    ['FL', -1, 1],
    ['FR', 1, 1],
    ['BL', -1, -1],
    ['BR', 1, -1],
  ] as const) {
    const lx = sx * legInsetX;
    const lz = sz * legInsetZ;
    addBox(root, `${name}.legBlock_${lTag}`, [0.048, friezeH, 0.048], [lx, friezeCy, lz], mahoganyMat);
    const shaftH = legTopY - friezeH - 0.034;
    const shaft = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.022, 0.014, shaftH, 14)), mahoganyMat);
    shaft.name = `${name}.reededLeg_${lTag}`;
    shaft.position.set(lx, 0.033 + shaftH * 0.5, lz);
    shaft.castShadow = true;
    root.add(shaft);
    const castor = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.015, 0.012, 0.032, 12)), darkBrassMat);
    castor.name = `${name}.brassCastor_${lTag}`;
    castor.position.set(lx, 0.016, lz);
    root.add(castor);
  }

  // Desktop blotter, laid stationery & brass library inkstand
  addBox(root, `${name}.blotterPad`, [0.46, 0.006, 0.32], [0, h + 0.0035, 0.08], leatherSkiverMat);
  addBox(root, `${name}.writingSheet`, [0.21, 0.002, 0.28], [-0.03, h + 0.008, 0.08], paperMat);
  addBox(root, `${name}.inkstandTray`, [0.18, 0.012, 0.10], [0.34, h + 0.0065, -0.14], brassMat);
  const inkpot = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.022, 0.024, 0.042, 14)), darkBrassMat);
  inkpot.name = `${name}.brassInkwell`;
  inkpot.position.set(0.34, h + 0.034, -0.14);
  root.add(inkpot);

  // Sabre-leg Regency mahogany desk chair tucked on +Z side facing North (-Z)
  const chair = new THREE.Group();
  chair.name = `${name}.regencySabreChair`;
  chair.position.set(0, 0, 0.44);
  root.add(chair);

  const cw = 0.48;
  const cd = 0.45;
  const seatY = 0.455;
  addBox(chair, `${chair.name}.seatFrameFront`, [cw, 0.042, 0.032], [0, seatY - 0.021, -cd * 0.5 + 0.016], mahoganyMat);
  addBox(chair, `${chair.name}.seatFrameRear`, [cw - 0.04, 0.042, 0.032], [0, seatY - 0.021, cd * 0.5 - 0.016], mahoganyMat);
  for (const [sTag, sx] of [['L', -1], ['R', 1]] as const) {
    addBox(chair, `${chair.name}.seatFrameSide_${sTag}`, [0.032, 0.042, cd - 0.068], [sx * (cw * 0.5 - 0.016), seatY - 0.021, 0], mahoganyMat);
    const fLeg = addBox(chair, `${chair.name}.sabreFrontLeg_${sTag}`, [0.032, seatY - 0.044, 0.034], [sx * (cw * 0.5 - 0.024), (seatY - 0.044) * 0.5, -cd * 0.5 + 0.034], mahoganyMat);
    fLeg.rotation.x = 0.09;
    const rLeg = addBox(chair, `${chair.name}.sabreRearLeg_${sTag}`, [0.032, 0.85, 0.034], [sx * (cw * 0.5 - 0.034), 0.425, cd * 0.5 - 0.024], mahoganyMat);
    rLeg.rotation.x = -0.11;
  }
  addBox(chair, `${chair.name}.upholsteredSeatPad`, [cw - 0.056, 0.036, cd - 0.072], [0, seatY + 0.0185, -0.016], linenSeatMat);
  addBox(chair, `${chair.name}.curvedCrestRail`, [cw + 0.02, 0.088, 0.028], [0, 0.835, cd * 0.5 - 0.068], mahoganyMat);
  addBox(chair, `${chair.name}.scrollMidSplat`, [cw - 0.08, 0.044, 0.02], [0, 0.675, cd * 0.5 - 0.052], mahoganyMat);

  root.position.set(opts.position[0], opts.position[1], opts.position[2]);
  return root;
}

function buildBrassMushroomKnobLocal(
  namePrefix: string,
  brassMat: THREE.Material,
  darkBrassMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  g.name = namePrefix;
  const rose = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.013, 0.015, 0.004, 16)), darkBrassMat);
  rose.name = `${namePrefix}.rose`;
  rose.rotation.x = Math.PI * 0.5;
  rose.position.z = 0.002;
  g.add(rose);
  const stem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.0055, 0.007, 0.013, 14)), brassMat);
  stem.name = `${namePrefix}.stem`;
  stem.rotation.x = Math.PI * 0.5;
  stem.position.z = 0.0105;
  g.add(stem);
  const cap = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.014, 18, 12)), brassMat);
  cap.name = `${namePrefix}.cap`;
  cap.scale.set(1, 1, 0.62);
  cap.position.z = 0.022;
  g.add(cap);
  tagHighLodDetail(g);
  return g;
}

function buildFieldedShakerLeafLocal(
  namePrefix: string,
  widthM: number,
  heightM: number,
  thickM: number,
  stileW: number,
  paintMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  g.name = namePrefix;
  const innerW = widthM - stileW * 2;
  const innerH = heightM - stileW * 2;
  for (const [sTag, sign] of [['Left', -1], ['Right', 1]] as const) {
    addBox(g, `${namePrefix}.stile${sTag}`, [stileW, heightM, thickM], [sign * (widthM * 0.5 - stileW * 0.5), 0, 0], paintMat);
  }
  addBox(g, `${namePrefix}.railTop`, [innerW - 0.0006, stileW, thickM], [0, heightM * 0.5 - stileW * 0.5, 0], paintMat);
  addBox(g, `${namePrefix}.railBottom`, [innerW - 0.0006, stileW, thickM], [0, -(heightM * 0.5 - stileW * 0.5), 0], paintMat);
  const panelT = thickM * 0.45;
  addBox(g, `${namePrefix}.recessPanel`, [innerW - 0.001, innerH - 0.001, panelT], [0, 0, -thickM * 0.14], paintMat);
  const fieldMargin = 0.028;
  if (innerW > fieldMargin * 2.4 && innerH > fieldMargin * 2.4) {
    addBox(
      g,
      `${namePrefix}.fieldedCenter`,
      [innerW - fieldMargin * 2, innerH - fieldMargin * 2, 0.005],
      [0, 0, -thickM * 0.14 + panelT * 0.5 + 0.0028],
      paintMat
    );
  }
  return g;
}

export interface FullWidthGeorgianAlcoveBookcaseOptions {
  readonly name: string;
  readonly widthM: number;
  readonly heightM: number;
  readonly baseDepthM: number;
  readonly upperDepthM: number;
  readonly paintMat: THREE.Material;
  readonly oakMat: THREE.Material;
  readonly brassMat: THREE.Material;
  readonly darkBrassMat: THREE.Material;
  readonly accentCircuitId?: CircuitId;
  readonly position: readonly [number, number, number];
  readonly rotationY: number;
}

export function buildFullWidthGeorgianAlcoveBookcase(
  ctx: SceneBuilderContext,
  opts: FullWidthGeorgianAlcoveBookcaseOptions
): THREE.Group {
  const {
    name,
    widthM: w,
    heightM: totalH,
    baseDepthM: baseD,
    upperDepthM: upperD,
    paintMat,
    oakMat,
    brassMat,
    darkBrassMat,
  } = opts;

  const root = new THREE.Group();
  root.name = name;

  const nBays = 4;
  const plinthH = 0.112;
  const baseH = 0.82;
  const counterH = 0.032;
  const carcassH = baseH - counterH;
  const baseBodyH = carcassH - plinthH;
  const baseBodyMidY = plinthH + baseBodyH * 0.5;
  const wallT = 0.022;
  const frameT = 0.024;
  const outerScribeW = 0.056;
  const midStileW = 0.048;

  const ledMat = createWarm2700kLedMaterial(`${name}.ledWash2700k`, 1.45);
  if (opts.accentCircuitId) {
    registerCircuitEmissive(ctx, opts.accentCircuitId, ledMat);
  }

  const ceramicCreamMat = new THREE.MeshStandardMaterial({
    name: `${name}.ceramicCream`,
    color: 0xf0eadf,
    roughness: 0.32,
  });
  const ceramicCeladonMat = new THREE.MeshStandardMaterial({
    name: `${name}.ceramicCeladon`,
    color: 0xaab5a8,
    roughness: 0.34,
  });

  const plinthD = baseD - 0.028;
  addBox(root, `${name}.basePlinth`, [w - 0.008, plinthH, plinthD], [0, plinthH * 0.5, plinthD * 0.5], paintMat);
  addBox(root, `${name}.basePlinthMoulding`, [w - 0.006, 0.018, 0.008], [0, plinthH - 0.009, plinthD + 0.0045], paintMat);

  const carcassInnerD = baseD - frameT - 0.002;
  addBox(root, `${name}.baseBack`, [w - wallT * 2, baseBodyH - wallT * 2, 0.016], [0, baseBodyMidY, 0.008], paintMat);
  addBox(root, `${name}.baseFloor`, [w - wallT * 2, wallT, carcassInnerD - 0.018], [0, plinthH + wallT * 0.5, 0.018 + (carcassInnerD - 0.018) * 0.5], oakMat);
  addBox(root, `${name}.baseTopDeck`, [w - wallT * 2, wallT, carcassInnerD - 0.018], [0, carcassH - wallT * 0.5, 0.018 + (carcassInnerD - 0.018) * 0.5], paintMat);
  for (const [sTag, sign] of [['Left', -1], ['Right', 1]] as const) {
    addBox(root, `${name}.baseCheek${sTag}`, [wallT, baseBodyH, carcassInnerD], [sign * (w * 0.5 - wallT * 0.5), baseBodyMidY, carcassInnerD * 0.5], paintMat);
  }

  const bayOpenW = (w - outerScribeW * 2 - midStileW * (nBays - 1)) / nBays;
  const railH = 0.044;
  const doorOpenH = baseBodyH - railH * 2;
  const doorOpenCy = plinthH + railH + doorOpenH * 0.5;
  const fz = baseD - frameT * 0.5;

  for (const [sTag, sign] of [['Left', -1], ['Right', 1]] as const) {
    addBox(root, `${name}.baseScribeStile${sTag}`, [outerScribeW, baseBodyH, frameT], [sign * (w * 0.5 - outerScribeW * 0.5), baseBodyMidY, fz], paintMat);
  }
  for (let i = 1; i < nBays; i++) {
    const stileCx = -w * 0.5 + outerScribeW + i * bayOpenW + (i - 0.5) * midStileW;
    addBox(root, `${name}.baseMidStile_${i}`, [midStileW, baseBodyH, frameT], [stileCx, baseBodyMidY, fz], paintMat);
    addBox(root, `${name}.baseDivider_${i}`, [0.018, baseBodyH - wallT * 2 - 0.002, carcassInnerD - 0.02], [stileCx, baseBodyMidY, 0.018 + (carcassInnerD - 0.02) * 0.5], oakMat);
  }

  const doorPivots: THREE.Group[] = [];
  for (let b = 0; b < nBays; b++) {
    const bayCx = -w * 0.5 + outerScribeW + (b + 0.5) * bayOpenW + b * midStileW;
    addBox(root, `${name}.baseRailTop_${b + 1}`, [bayOpenW - 0.0006, railH, frameT], [bayCx, carcassH - railH * 0.5, fz], paintMat);
    addBox(root, `${name}.baseRailBot_${b + 1}`, [bayOpenW - 0.0006, railH, frameT], [bayCx, plinthH + railH * 0.5, fz], paintMat);
    addBox(root, `${name}.baseInnerShelf_${b + 1}`, [bayOpenW + 0.012, 0.018, carcassInnerD - 0.04], [bayCx, baseBodyMidY, 0.02 + (carcassInnerD - 0.04) * 0.5], oakMat);

    const isLeftLeaf = b % 2 === 0;
    const hingeSign = isLeftLeaf ? -1 : 1;
    const leafW = bayOpenW - 0.008;
    const leafH = doorOpenH - 0.008;
    const leafT = 0.022;
    const doorGroup = new THREE.Group();
    doorGroup.name = `${name}.cupboardDoor_${b + 1}`;
    doorGroup.position.set(bayCx, doorOpenCy, baseD - leafT * 0.5 - 0.002);
    root.add(doorGroup);
    doorGroup.add(buildFieldedShakerLeafLocal(`${doorGroup.name}.panel`, leafW, leafH, leafT, 0.054, paintMat));
    const knob = buildBrassMushroomKnobLocal(`${doorGroup.name}.knob`, brassMat, darkBrassMat);
    knob.position.set(-hingeSign * (leafW * 0.5 - 0.036), leafH * 0.5 - 0.078, leafT * 0.5 + 0.0005);
    doorGroup.add(knob);

    doorPivots.push(
      registerHingedDoor(ctx, {
        parent: root,
        door: doorGroup,
        hingeOffset: [hingeSign * (leafW * 0.5 - 0.012), 0, leafT * 0.5],
        axis: 'y',
        openAngle: isLeftLeaf ? -Math.PI * 0.39 : Math.PI * 0.39,
      })
    );
  }
  if (doorPivots.length === 4) {
    ctx.interactions.linkDoorPair(doorPivots[0]!, doorPivots[1]!);
    ctx.interactions.linkDoorPair(doorPivots[2]!, doorPivots[3]!);
  }

  const counterFrontNosing = 0.018;
  addBox(root, `${name}.counterLedge`, [w, counterH * 0.72, baseD + counterFrontNosing], [0, carcassH + counterH * 0.64, (baseD + counterFrontNosing) * 0.5], paintMat);
  addBox(root, `${name}.counterCoveUnder`, [w - 0.004, counterH * 0.28, baseD + counterFrontNosing * 0.55], [0, carcassH + counterH * 0.14, (baseD + counterFrontNosing * 0.55) * 0.5], paintMat);

  const crownH = 0.092;
  const upperBodyH = totalH - baseH - crownH;
  const upperMidY = baseH + upperBodyH * 0.5;
  const pilasterW = 0.068;
  const upperBayClearW = (w - pilasterW * (nBays + 1)) / nBays;

  const innerSpanW = w - 0.048;
  const nBoards = Math.max(22, Math.round(innerSpanW / 0.098));
  const boardPitch = innerSpanW / nBoards;
  for (let i = 0; i < nBoards; i++) {
    addBox(root, `${name}.upperTgBack_${i + 1}`, [boardPitch - 0.0025, upperBodyH - 0.024, 0.015], [-innerSpanW * 0.5 + (i + 0.5) * boardPitch, upperMidY - 0.01, 0.0095], paintMat);
  }

  const cheekD = upperD - 0.026;
  for (let pIdx = 0; pIdx <= nBays; pIdx++) {
    const px = -w * 0.5 + pilasterW * 0.5 + pIdx * (upperBayClearW + pilasterW);
    if (pIdx === 0 || pIdx === nBays) {
      const sign = pIdx === 0 ? -1 : 1;
      addBox(root, `${name}.upperOuterCheek_${pIdx === 0 ? 'Left' : 'Right'}`, [0.024, upperBodyH, cheekD], [sign * (w * 0.5 - 0.012), upperMidY, cheekD * 0.5], paintMat);
    } else {
      addBox(root, `${name}.upperBayDivider_${pIdx}`, [0.024, upperBodyH - 0.024, cheekD - 0.018], [px, upperMidY - 0.01, 0.018 + (cheekD - 0.018) * 0.5], paintMat);
    }
    addBox(root, `${name}.pilasterBase_${pIdx + 1}`, [pilasterW + 0.004, 0.092, 0.028], [px, baseH + 0.046, upperD - 0.012], paintMat);
    addBox(root, `${name}.pilasterCapital_${pIdx + 1}`, [pilasterW + 0.008, 0.084, 0.032], [px, baseH + upperBodyH - 0.042, upperD - 0.01], paintMat);
    const shaftH = upperBodyH - 0.178;
    addBox(root, `${name}.pilasterCore_${pIdx + 1}`, [pilasterW, shaftH, 0.022], [px, baseH + 0.093 + shaftH * 0.5, upperD - 0.014], paintMat);
  }

  addBox(root, `${name}.upperSoffit`, [w - 0.048, 0.022, cheekD - 0.02], [0, baseH + upperBodyH - 0.011, 0.018 + (cheekD - 0.02) * 0.5], paintMat);
  addBox(root, `${name}.crownFrieze`, [w, crownH * 0.5, upperD + 0.014], [0, totalH - crownH * 0.75, (upperD + 0.014) * 0.5], paintMat);
  addBox(root, `${name}.crownCymaCap`, [w, crownH * 0.5, upperD + 0.038], [0, totalH - crownH * 0.25, (upperD + 0.038) * 0.5], paintMat);

  const bookHexPalette = [0x6a2c22, 0x283b4c, 0x4b5847, 0xcabfa8, 0x7b5638, 0x3b3531, 0xded6c5, 0x876b4d];
  const bookMats = bookHexPalette.map(
    (hex, i) => new THREE.MeshStandardMaterial({ name: `${name}.bookCloth_${i + 1}`, color: hex, roughness: 0.66 })
  );
  const shelfD = cheekD - 0.024;
  const shelfCz = 0.019 + shelfD * 0.5;

  for (let b = 0; b < nBays; b++) {
    const bayCx = -w * 0.5 + pilasterW + b * (upperBayClearW + pilasterW) + upperBayClearW * 0.5;
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const sy = baseH + ((sIdx + 1) / 5) * (upperBodyH - 0.07);
      addBox(root, `${name}.shelf_b${b + 1}_s${sIdx + 1}`, [upperBayClearW - 0.001, 0.024, shelfD], [bayCx, sy, shelfCz], paintMat);
      const wash = addBox(
        root,
        `${name}.shelfLed_b${b + 1}_s${sIdx + 1}`,
        [upperBayClearW - 0.05, 0.005, 0.01],
        [bayCx, sy - 0.015, upperD - 0.046],
        ledMat
      );
      tagHighLodDetail(wash);

      const surfaceY = sy + 0.0125;
      let cursor = bayCx - upperBayClearW * 0.42;
      const count = 6 + ((b + sIdx) % 3);
      for (let k = 0; k < count; k++) {
        const bt = 0.026 + ((k * 5 + b + sIdx) % 4) * 0.006;
        if (cursor + bt > bayCx + upperBayClearW * 0.14) break;
        const bh = 0.19 + ((k * 3 + sIdx * 2 + b) % 5) * 0.018;
        const bk = addBox(
          root,
          `${name}.book_b${b + 1}_s${sIdx + 1}_${k + 1}`,
          [bt - 0.0012, bh, 0.17],
          [cursor + bt * 0.5, surfaceY + bh * 0.5, 0.034 + 0.085],
          bookMats[(k + b * 2 + sIdx * 3) % bookMats.length]!
        );
        tagHighLodDetail(bk);
        cursor += bt + 0.0015;
      }
      const vase = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.032, 0.042, 0.145, 14)),
        (b + sIdx) % 2 === 0 ? ceramicCreamMat : ceramicCeladonMat
      );
      vase.name = `${name}.ceramicVessel_b${b + 1}_s${sIdx + 1}`;
      vase.position.set(bayCx + upperBayClearW * 0.28, surfaceY + 0.073, shelfCz);
      vase.castShadow = true;
      tagHighLodDetail(vase);
      root.add(vase);
    }
  }

  root.position.set(opts.position[0], opts.position[1], opts.position[2]);
  root.rotation.y = opts.rotationY;
  return root;
}
