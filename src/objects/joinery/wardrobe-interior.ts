import * as THREE from 'three';

import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import {
  sharedBoxGeometry,
  sharedCylinderGeometry,
  sharedTorusGeometry,
} from '../shared/geometry-cache.ts';

export type WardrobeOpenFace = '+z' | '-z' | '+x' | '-x';

export type WardrobeBayPreset =
  | 'doubleHang'
  | 'longHangAndDrawers'
  | 'rakedShelvesAndDrawers'
  | 'counterTopCupboard'
  | 'threeDrawerChestAndLinen'
  | 'singleHangAndTwoShoeRacks'
  | 'openRakedShelvesOverThreeDrawers';

export interface HollowWardrobeBaySpec {
  readonly id: string;
  readonly uMin: number;
  readonly uMax: number;
  readonly preset: WardrobeBayPreset;
  /** Optional bay floor Y (defaults to `doorBaseY`; e.g. `2.978` for counter-top cupboard). */
  readonly floorY?: number;
  /** Optional interior oak shelf height aligned behind a fixed raked spandrel transom. */
  readonly spandrelShelfY?: number;
  /** Optional internal top solid-oak luggage shelf heights above `roomFloorY` (e.g. `[1.82]` or `[1.85, 2.30]`). */
  readonly luggageShelfHeights?: readonly number[];
  /** Registers the top internal oak drawer with `interactions.registerSlidingDrawer`. */
  readonly registerHeroDrawer?: boolean;
  /** Adds a short brushed-brass shirt rail in a wide raked eaves bay (e.g. Main Bedroom Bay 1). */
  readonly includeShirtRail?: boolean;
  /** Optional max Y for the bay divider to the right of this bay (enables pass-through top luggage cavity). */
  readonly dividerMaxY?: number;
  /** Optional left U override for pass-through top oak luggage shelf_1. */
  readonly luggagePassThroughLeftU?: number;
  /** Optional right U override for pass-through top oak luggage shelf_1. */
  readonly luggagePassThroughRightU?: number;
  /** Optional single-rail hanging datum above `roomFloorY` (defaults to `1.68` -> `+1,680 mm`; Stable uses `1.50`). */
  readonly desiredHangingRailRelY?: number;
  /** Optional flush 3-drawer chest counter deck height above `roomFloorY` (defaults to `0.86` -> `+860 mm`). */
  readonly chestTopRelY?: number;
  /** Optional open oak LED shelf heights above `roomFloorY` (defaults to `[1.27, 1.68]`). */
  readonly openShelfRelHeights?: readonly number[];
  /** Optional max Y above `roomFloorY` for open oak shelving alcove below a fixed Shaker apex/eaves panel. */
  readonly openAlcoveMaxRelY?: number;
}

export interface HollowWardrobeInteriorOptions {
  readonly parent: THREE.Object3D;
  readonly namePrefix: string;
  readonly openFace: WardrobeOpenFace;
  /** Outer wardrobe carcass min coordinate along the horizontal width axis `u`. */
  readonly uMin: number;
  /** Outer wardrobe carcass max coordinate along the horizontal width axis `u`. */
  readonly uMax: number;
  /** Front face coordinate of the carcass (behind the planted/in-frame door leaves). */
  readonly frontCoord: number;
  /** Carcass depth extending inward from `frontCoord` (`> 0`). */
  readonly depth: number;
  /** Room finished floor Y in `parent` local space (used for the first-person collision guard). */
  readonly roomFloorY: number;
  /** Bottom Y of the outer carcass (typically `roomFloorY`). */
  readonly carcassBaseY: number;
  /** Standard bay interior deck Y (typically `doorBaseY` right above the plinth). */
  readonly doorBaseY: number;
  /**
   * Returns the outer carcass top Y in `parent` local space at width coordinate `u`
   * and normalized depth `depthFrac` (`0` = `frontCoord`, `1` = rear back face).
   */
  readonly getCarcassTopY: (u: number, depthFrac: number) => number;
  /**
   * Optional door-top Y at `u` for the front painted cornice backing rail
   * (defaults to `getCarcassTopY(u, 0) - 0.048`).
   */
  readonly getDoorTopY?: (u: number) => number;
  readonly exteriorMat: THREE.Material;
  readonly brassMat?: THREE.Material;
  readonly interactions?: InteractionRegistry;
  readonly bays: readonly HollowWardrobeBaySpec[];
}

export interface ShakerWardrobeDoorOptions {
  readonly name: string;
  readonly x: number;
  readonly yBot: number;
  readonly z: number;
  readonly width: number;
  readonly heightLeft: number;
  readonly heightRight: number;
  readonly alongZ?: boolean;
  readonly normalSign?: 1 | -1;
  readonly handleSide: 'left' | 'right';
  readonly handleCenterY?: number;
  /** Local U offset override for pull/knob hardware (defaults to latch stile center). */
  readonly handleLocalU?: number;
  /** Hardware style: unified aged-brass collared bar pull (160mm standard doors, 128mm compact doors). */
  readonly pullStyle?: 'bar';
  /** Explicit collared bar pull length in meters (defaults to `0.160` -> `160 mm`; compact doors use `0.128`). */
  readonly barLength?: number;
  /** Keep exact handleCenterY without clamping away from top/bottom rails (for top-box knobs). */
  readonly exactHandleY?: boolean;
  /** Local Y above yBot for the Shaker mid-rail centerline (e.g. 0.714m -> Y = 3.370m). */
  readonly midRailCenterY?: number;
  /** Explicit override for 1-panel vs 2-panel Shaker leaf. */
  readonly singlePanel?: boolean;
  /** Keeps raked Shaker leaf as 1-piece with zero fixed spandrel even if hinged on short stile. */
  readonly forceOnePieceRaked?: boolean;
  readonly doorMat: THREE.Material;
  readonly brassMat: THREE.Material;
  readonly interactions?: InteractionRegistry;
  readonly openAngleRad?: number;
  readonly hingeKnuckles?: boolean;
  /** Adds a painted rear meeting astragal so closed double-door gaps have zero light leak. */
  readonly meetingAstragal?: boolean;
}

export interface WardrobePalette {
  readonly oakMat: THREE.MeshStandardMaterial;
  readonly oakDarkEdgeMat: THREE.MeshStandardMaterial;
  readonly ledStripMat: THREE.MeshStandardMaterial;
  readonly brassMat: THREE.MeshStandardMaterial;
  readonly blumOnyxMat: THREE.MeshStandardMaterial;
  readonly hangerWoodMat: THREE.MeshStandardMaterial;
  readonly rattanMat: THREE.MeshStandardMaterial;
  readonly canvasBoxMat: THREE.MeshStandardMaterial;
  readonly leatherDarkMat: THREE.MeshStandardMaterial;
  readonly leatherTanMat: THREE.MeshStandardMaterial;
  readonly garmentMats: readonly THREE.MeshStandardMaterial[];
  readonly knitFoldMats: readonly THREE.MeshStandardMaterial[];
  readonly collisionGuardMat: THREE.MeshBasicMaterial;
}

let cachedPalette: WardrobePalette | null = null;

export function getWardrobePalette(): WardrobePalette {
  if (cachedPalette) return cachedPalette;

  const oakMat = new THREE.MeshStandardMaterial({
    color: 0xc69c6d,
    roughness: 0.52,
    metalness: 0.02,
  });
  const oakDarkEdgeMat = new THREE.MeshStandardMaterial({
    color: 0xa97f52,
    roughness: 0.56,
    metalness: 0.02,
  });
  const ledStripMat = new THREE.MeshStandardMaterial({
    color: 0xfff0d4,
    emissive: 0xffb85c,
    emissiveIntensity: 1.35,
    roughness: 0.25,
    metalness: 0.0,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xb89456,
    roughness: 0.28,
    metalness: 0.84,
  });
  const blumOnyxMat = new THREE.MeshStandardMaterial({
    color: 0x252a30,
    roughness: 0.34,
    metalness: 0.78,
  });
  const hangerWoodMat = new THREE.MeshStandardMaterial({
    color: 0xb78756,
    roughness: 0.44,
    metalness: 0.02,
  });
  const rattanMat = new THREE.MeshStandardMaterial({
    color: 0xa68154,
    roughness: 0.84,
    metalness: 0.01,
  });
  const canvasBoxMat = new THREE.MeshStandardMaterial({
    color: 0xe6dfd2,
    roughness: 0.86,
    metalness: 0.01,
  });
  const leatherDarkMat = new THREE.MeshStandardMaterial({
    color: 0x4a3020,
    roughness: 0.44,
    metalness: 0.04,
  });
  const leatherTanMat = new THREE.MeshStandardMaterial({
    color: 0x7c4f32,
    roughness: 0.48,
    metalness: 0.04,
  });
  const garmentMats = [
    new THREE.MeshStandardMaterial({ color: 0x243246, roughness: 0.84 }), // Heritage Navy wool
    new THREE.MeshStandardMaterial({ color: 0xdcd2c2, roughness: 0.86 }), // Oatmeal cashmere
    new THREE.MeshStandardMaterial({ color: 0x6d7c69, roughness: 0.84 }), // Sage tweed
    new THREE.MeshStandardMaterial({ color: 0x8ea4ba, roughness: 0.78 }), // Chambray Oxford
    new THREE.MeshStandardMaterial({ color: 0x3e4147, roughness: 0.85 }), // Charcoal flannel
    new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 0.79 }), // Crisp Ivory linen
    new THREE.MeshStandardMaterial({ color: 0xb08975, roughness: 0.84 }), // Setting-Plaster merino
  ];
  const knitFoldMats = [
    garmentMats[1]!,
    garmentMats[2]!,
    garmentMats[5]!,
    garmentMats[6]!,
    garmentMats[3]!,
    garmentMats[0]!,
  ];
  const collisionGuardMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });

  cachedPalette = {
    oakMat,
    oakDarkEdgeMat,
    ledStripMat,
    brassMat,
    blumOnyxMat,
    hangerWoodMat,
    rattanMat,
    canvasBoxMat,
    leatherDarkMat,
    leatherTanMat,
    garmentMats,
    knitFoldMats,
    collisionGuardMat,
  };
  return cachedPalette;
}

/**
 * Builds an extruded vertical panel whose horizontal axis in shape space is `s in [s0, s1]`
 * and thickness is `thickness`, then maps `(s, y, t)` into `(u, y, v)` inside `target`.
 */
export function buildProfileExtrudedPanel(
  name: string,
  pts2D: readonly [number, number][],
  thickness: number,
  axisMode: 'uSpan' | 'vSpan',
  alongU: boolean,
  fixedCoord: number,
  mat: THREE.Material,
  castShadow = false
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(pts2D[0]![0], pts2D[0]![1]);
  for (let i = 1; i < pts2D.length; i++) {
    shape.lineTo(pts2D[i]![0], pts2D[i]![1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  // Map (shapeX = spanCoord, shapeY = Y, shapeZ = [0..thickness]) into parent (X, Y, Z).
  // When alongU === true (openFace '+z' or '-z'): u = X, v = Z.
  // When alongU === false (openFace '+x' or '-x'): u = Z, v = X.
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i);
    const sy = pos.getY(i);
    const sz = pos.getZ(i) - thickness * 0.5;
    let u: number;
    let v: number;
    if (axisMode === 'uSpan') {
      u = sx;
      v = fixedCoord + sz;
    } else {
      u = fixedCoord + sz;
      v = sx;
    }
    if (alongU) {
      pos.setXYZ(i, u, sy, v);
    } else {
      pos.setXYZ(i, v, sy, u);
    }
  }
  if ((axisMode === 'uSpan') !== alongU) {
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const x1 = pos.getX(i + 1), y1 = pos.getY(i + 1), z1 = pos.getZ(i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, x1, y1, z1);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Builds a thin sloped or flat quad slab spanning `u in [u0, u1]` and `v in [v0, v1]`
 * with thickness `dy` below `topY(u, v)` so `0.0mm` ever exceeds `topY(u, v)`.
 */
export function buildRoofSlabSegment(
  name: string,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  y00: number,
  y10: number,
  y11: number,
  y01: number,
  thickness: number,
  alongU: boolean,
  mat: THREE.Material
): THREE.Mesh {
  const toXYZ = (u: number, y: number, v: number): [number, number, number] =>
    alongU ? [u, y, v] : [v, y, u];

  const t00 = toXYZ(u0, y00, v0);
  const t10 = toXYZ(u1, y10, v0);
  const t11 = toXYZ(u1, y11, v1);
  const t01 = toXYZ(u0, y01, v1);
  const b00 = toXYZ(u0, y00 - thickness, v0);
  const b10 = toXYZ(u1, y10 - thickness, v0);
  const b11 = toXYZ(u1, y11 - thickness, v1);
  const b01 = toXYZ(u0, y01 - thickness, v1);

  const positions: number[] = [];
  const pushQuad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number]
  ): void => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  // Ensure outward winding regardless of coordinate handedness by checking triangle normal.
  const pushOrientedQuad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    desiredYSign: number
  ): void => {
    const abx = b[0] - a[0];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acz = c[2] - a[2];
    const ny = abz * acx - abx * acz;
    if (ny * desiredYSign >= 0) {
      pushQuad(a, b, c, d);
    } else {
      pushQuad(a, d, c, b);
    }
  };

  const slabMid: [number, number, number] = [
    (t00[0] + t10[0] + t11[0] + t01[0] + b00[0] + b10[0] + b11[0] + b01[0]) / 8,
    (t00[1] + t10[1] + t11[1] + t01[1] + b00[1] + b10[1] + b11[1] + b01[1]) / 8,
    (t00[2] + t10[2] + t11[2] + t01[2] + b00[2] + b10[2] + b11[2] + b01[2]) / 8,
  ];
  const pushOutwardSideQuad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number]
  ): void => {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const qmx = (a[0] + b[0] + c[0] + d[0]) * 0.25 - slabMid[0];
    const qmy = (a[1] + b[1] + c[1] + d[1]) * 0.25 - slabMid[1];
    const qmz = (a[2] + b[2] + c[2] + d[2]) * 0.25 - slabMid[2];
    if (nx * qmx + ny * qmy + nz * qmz >= 0) {
      pushQuad(a, b, c, d);
    } else {
      pushQuad(a, d, c, b);
    }
  };

  pushOrientedQuad(t00, t10, t11, t01, +1);
  pushOrientedQuad(b00, b10, b11, b01, -1);
  pushOutwardSideQuad(b00, b10, t10, t00);
  pushOutwardSideQuad(b10, b11, t11, t10);
  pushOutwardSideQuad(b11, b01, t01, t11);
  pushOutwardSideQuad(b01, b00, t00, t01);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Builds a Shaker door leaf or fixed raked Shaker spandrel panel (and registers interactive
 * outward-swinging hinged door pivots when `interactions` + `openAngleRad` are provided).
 */
export function addInteractiveShakerWardrobeDoor(
  parent: THREE.Object3D,
  options: ShakerWardrobeDoorOptions
): THREE.Group {
  const palette = getWardrobePalette();
  const doorMat = options.doorMat;
  const brassMat = options.brassMat ?? palette.brassMat;
  const w = options.width;
  const hL = options.heightLeft;
  const hR = options.heightRight;
  const alongZ = options.alongZ ?? false;
  const normalSign = options.normalSign ?? 1;
  const stileW = Math.min(0.068, Math.max(0.044, w * 0.16));
  const railH = stileW;
  const frameT = 0.026;
  const panelT = 0.016;

  // Hinge sits opposite the pull handle (`handleSide === 'right'` -> handle at `+u`, hinge at `-u`).
  const handleSign = options.handleSide === 'right' ? 1 : -1;
  const hingeSign = -handleSign;
  const hHinge = hingeSign < 0 ? hL : hR;
  const hLatch = hingeSign < 0 ? hR : hL;

  // Skeiling-safe joinery split: whenever a raked leaf is hinged on its short eaves stile,
  // place a coplanar fixed in-frame Shaker raked spandrel above `ySplitOffset` and swing the
  // rectangular Shaker door leaf below `ySplitOffset` so 0.0mm ever pierces a pitched skeiling.
  const needsFixedRakedSpandrel =
    !options.forceOnePieceRaked && Math.abs(hL - hR) > 0.008 && hHinge < hLatch - 0.008;
  const spandrelShortH = needsFixedRakedSpandrel
    ? Math.min(0.072, Math.max(0.054, hHinge * 0.075))
    : 0;
  const spandrelGap = needsFixedRakedSpandrel ? 0.008 : 0;
  const ySplitOffset = needsFixedRakedSpandrel ? hHinge - spandrelShortH : 0;

  if (needsFixedRakedSpandrel) {
    const spL = hL - ySplitOffset;
    const spR = hR - ySplitOffset;
    const spandrelGroup = buildRakedOrFlatShakerLeafGeometry({
      name: `${options.name}.rakedSpandrel`,
      width: w,
      hLeft: spL,
      hRight: spR,
      stileW,
      railH: Math.min(0.044, spandrelShortH * 0.62),
      frameT,
      panelT,
      alongZ,
      normalSign,
      doorMat,
      singlePanel: true,
    });
    spandrelGroup.position.set(options.x, options.yBot + ySplitOffset, options.z);
    parent.add(spandrelGroup);
  }

  const leafHL = needsFixedRakedSpandrel ? ySplitOffset - spandrelGap : hL;
  const leafHR = needsFixedRakedSpandrel ? ySplitOffset - spandrelGap : hR;
  const minLeafH = Math.min(leafHL, leafHR);

  const doorGroup = buildRakedOrFlatShakerLeafGeometry({
    name: options.name,
    width: w,
    hLeft: leafHL,
    hRight: leafHR,
    stileW,
    railH,
    frameT,
    panelT,
    alongZ,
    normalSign,
    doorMat,
    singlePanel: options.singlePanel ?? minLeafH < 1.12,
    midRailCenterY: options.midRailCenterY,
  });
  doorGroup.position.set(options.x, options.yBot, options.z);
  if (needsFixedRakedSpandrel) {
    doorGroup.userData.spandrelSplitY = options.yBot + ySplitOffset;
  }

  // Optional painted meeting astragal on the back latch edge of one double-door leaf
  // so closed double-door meeting gaps show 100% painted joinery with zero light leak.
  if (options.meetingAstragal) {
    const astragalH = Math.max(0.16, ( hingeSign < 0 ? leafHR : leafHL ) - 0.024);
    const astragalW = 0.024;
    const astragalT = 0.007;
    const astragalU = handleSign * (w * 0.5 + 0.004);
    const astragalN = -normalSign * (frameT * 0.5 + astragalT * 0.5 - 0.001);
    const astragalGeo = alongZ
      ? sharedBoxGeometry(astragalT, astragalH, astragalW)
      : sharedBoxGeometry(astragalW, astragalH, astragalT);
    const astragal = new THREE.Mesh(astragalGeo, doorMat);
    astragal.name = `${options.name}.meetingAstragal`;
    astragal.position.set(
      alongZ ? astragalN : astragalU,
      astragalH * 0.5 + 0.012,
      alongZ ? astragalU : astragalN
    );
    astragal.castShadow = false;
    astragal.receiveShadow = true;
    doorGroup.add(astragal);
  }

  // Unified aged-brass collared bar pull family (`160 mm` standard doors, `128 mm` compact doors)
  const handleU =
    options.handleLocalU !== undefined
      ? options.handleLocalU
      : handleSign * (w * 0.5 - stileW * 0.5);
  const latchLeafH = handleSign > 0 ? leafHR : leafHL;
  const barLen = options.barLength ?? 0.16;
  const rawHandleY =
    options.handleCenterY !== undefined ? options.handleCenterY : Math.min(0.925, minLeafH * 0.48);
  const centerY = options.exactHandleY
    ? rawHandleY
    : Math.max(
        barLen * 0.55 + 0.04,
        Math.min(latchLeafH - barLen * 0.55 - 0.04, rawHandleY)
      );
  const barProj = 0.028;

  const barMesh = new THREE.Mesh(sharedCylinderGeometry(0.0055, 0.0055, barLen, 12), brassMat);
  barMesh.name = `${options.name}.pullBar`;
  if (alongZ) {
    barMesh.position.set(normalSign * (frameT * 0.5 + barProj), centerY, handleU);
  } else {
    barMesh.position.set(handleU, centerY, normalSign * (frameT * 0.5 + barProj));
  }
  barMesh.castShadow = false;
  doorGroup.add(barMesh);

  for (const dy of [-barLen * 0.36, barLen * 0.36]) {
    const collar = new THREE.Mesh(sharedCylinderGeometry(0.0078, 0.0085, 0.0032, 12), brassMat);
    collar.name = `${options.name}.pullCollar`;
    const standoff = new THREE.Mesh(sharedCylinderGeometry(0.0042, 0.0042, barProj, 10), brassMat);
    standoff.name = `${options.name}.pullStandoff`;
    if (alongZ) {
      collar.rotation.z = Math.PI * 0.5;
      collar.position.set(normalSign * (frameT * 0.5 + 0.0016), centerY + dy, handleU);
      standoff.rotation.z = Math.PI * 0.5;
      standoff.position.set(normalSign * (frameT * 0.5 + barProj * 0.5), centerY + dy, handleU);
    } else {
      collar.rotation.x = Math.PI * 0.5;
      collar.position.set(handleU, centerY + dy, normalSign * (frameT * 0.5 + 0.0016));
      standoff.rotation.x = Math.PI * 0.5;
      standoff.position.set(handleU, centerY + dy, normalSign * (frameT * 0.5 + barProj * 0.5));
    }
    doorGroup.add(collar);
    doorGroup.add(standoff);
  }

  // 100% Concealed Internal `Blum CLIP top BLUMOTION Onyx` Ø35mm Cup Hinges (`0.0mm` exterior knuckles!)
  // Mounted strictly on the INSIDE/BACK face (`-normalSign`) of the door stile inside the carcass.
  const hingeU = hingeSign * (w * 0.5 - 0.003);
  const hingeN = normalSign * (frameT * 0.5 - 0.002);
  const hingeLeafH = hingeSign < 0 ? leafHL : leafHR;
  if (options.interactions && options.openAngleRad !== undefined && hingeLeafH >= 0.32) {
    const cupFracs = hingeLeafH < 1.05 ? [0.18, 0.82] : [0.12, 0.5, 0.88];
    const cupU = hingeSign * (w * 0.5 - stileW * 0.5);
    const cupBackN = -normalSign * (frameT * 0.5 + 0.0018);
    const armBackN = -normalSign * (frameT * 0.5 + 0.0045);
    const armU = hingeSign * (w * 0.5 - stileW * 0.24);
    const cupGeo = sharedCylinderGeometry(0.0175, 0.0175, 0.0036, 14);
    const armGeo = alongZ
      ? sharedBoxGeometry(0.005, 0.016, stileW * 0.52)
      : sharedBoxGeometry(stileW * 0.52, 0.016, 0.005);

    cupFracs.forEach((frac, cIdx) => {
      const cy = hingeLeafH * frac;
      const cup = new THREE.Mesh(cupGeo, palette.blumOnyxMat);
      cup.name = `${options.name}.blumOnyxCup_${cIdx + 1}`;
      if (alongZ) {
        cup.rotation.z = Math.PI * 0.5;
        cup.position.set(cupBackN, cy, cupU);
      } else {
        cup.rotation.x = Math.PI * 0.5;
        cup.position.set(cupU, cy, cupBackN);
      }
      cup.castShadow = false;
      doorGroup.add(cup);

      const arm = new THREE.Mesh(armGeo, palette.blumOnyxMat);
      arm.name = `${options.name}.blumOnyxArm_${cIdx + 1}`;
      arm.position.set(alongZ ? armBackN : armU, cy, alongZ ? armU : armBackN);
      arm.castShadow = false;
      doorGroup.add(arm);
    });
  }

  parent.add(doorGroup);

  if (options.interactions && options.openAngleRad !== undefined) {
    const hingeOffset = alongZ
      ? new THREE.Vector3(hingeN, 0, hingeU)
      : new THREE.Vector3(hingeU, 0, hingeN);
    const pivot = options.interactions.registerHingedDoor(
      parent,
      doorGroup,
      hingeOffset,
      'y',
      options.openAngleRad
    );
    doorGroup.userData.pivotGroup = pivot;
  }

  return doorGroup;
}

export interface FixedInFrameShakerPanelOptions {
  readonly name: string;
  /** Counter-clockwise or clockwise polygon vertices `[u, y]` in `parent` local space. */
  readonly outerPts: ReadonlyArray<readonly [number, number]>;
  /** Center coordinate along the normal axis (`x` when `alongZ = true`, `z` when `alongZ = false`). */
  readonly normalCenter: number;
  readonly alongZ?: boolean;
  readonly normalSign?: 1 | -1;
  readonly frameThickness?: number;
  readonly stileWidth?: number;
  readonly mat: THREE.Material;
}

/**
 * Builds a Fixed In-Frame Recessed Shaker Eaves / Header / Apex Panel (`0` handles, `0` hinges!):
 * - `26 mm` outer Shaker stiles & rails scribed cleanly to raked/collared crown cornices,
 * - Recessed Shaker field panel (`-5 mm` front step) inside the mitered frame opening.
 */
export function buildFixedInFrameShakerPanel(
  parent: THREE.Object3D,
  opts: FixedInFrameShakerPanelOptions
): THREE.Group {
  const {
    name,
    outerPts,
    normalCenter,
    alongZ = false,
    normalSign = 1,
    frameThickness = 0.026,
    stileWidth = 0.068,
    mat,
  } = opts;

  const group = new THREE.Group();
  group.name = name;

  // Ensure CCW winding in (u, y) so inward normals point strictly into the polygon interior
  let signedArea2 = 0;
  for (let i = 0; i < outerPts.length; i++) {
    const [x0, y0] = outerPts[i]!;
    const [x1, y1] = outerPts[(i + 1) % outerPts.length]!;
    signedArea2 += x0 * y1 - x1 * y0;
  }
  const ccwPts: Array<[number, number]> =
    signedArea2 >= 0
      ? outerPts.map(([u, y]) => [u, y])
      : [...outerPts].reverse().map(([u, y]) => [u, y]);

  let minU = Infinity, maxU = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [u, y] of ccwPts) {
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanU = maxU - minU;
  const spanY = maxY - minY;
  const matchedStileW = Math.min(stileWidth, Math.max(0.044, spanU * 0.16));
  const inset = Math.min(matchedStileW, spanU * 0.28, spanY * 0.28);

  const computeOffsetPolygon = (dist: number): Array<[number, number]> => {
    const offsetLines: Array<{ px: number; py: number; dx: number; dy: number }> = [];
    for (let i = 0; i < ccwPts.length; i++) {
      const [x0, y0] = ccwPts[i]!;
      const [x1, y1] = ccwPts[(i + 1) % ccwPts.length]!;
      const edx = x1 - x0;
      const edy = y1 - y0;
      const len = Math.hypot(edx, edy) || 1;
      const ux = edx / len;
      const uy = edy / len;
      const nx = -uy;
      const ny = ux;
      offsetLines.push({ px: x0 + nx * dist, py: y0 + ny * dist, dx: ux, dy: uy });
    }
    const rawPts: Array<[number, number]> = [];
    for (let i = 0; i < offsetLines.length; i++) {
      const lPrev = offsetLines[(i + offsetLines.length - 1) % offsetLines.length]!;
      const lCurr = offsetLines[i]!;
      const det = lPrev.dx * lCurr.dy - lPrev.dy * lCurr.dx;
      if (Math.abs(det) < 1e-4) {
        rawPts.push([lCurr.px, lCurr.py]);
      } else {
        const rx = lCurr.px - lPrev.px;
        const ry = lCurr.py - lPrev.py;
        const t = (rx * lCurr.dy - ry * lCurr.dx) / det;
        rawPts.push([lPrev.px + t * lPrev.dx, lPrev.py + t * lPrev.dy]);
      }
    }
    const cleaned: Array<[number, number]> = [];
    for (const [iu, iy] of rawPts) {
      if (
        iu > minU + dist * 0.35 &&
        iu < maxU - dist * 0.35 &&
        iy > minY + dist * 0.35 &&
        iy < maxY - dist * 0.35
      ) {
        cleaned.push([iu, iy]);
      }
    }
    return cleaned;
  };

  const validInner = computeOffsetPolygon(inset);

  const placeExtruded = (
    meshName: string,
    shape: THREE.Shape,
    depth: number,
    normalOffset: number,
    castShadow: boolean
  ): void => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    if (alongZ) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const uVal = pos.getX(i);
        const yVal = pos.getY(i);
        const extVal = pos.getZ(i) - depth * 0.5;
        pos.setXYZ(i, normalCenter + normalOffset + extVal, yVal, uVal);
      }
      // Mapping (u, y, ext) -> (ext, y, u) has determinant -1; flip triangle winding for true outward normals!
      for (let i = 0; i + 2 < pos.count; i += 3) {
        const x1 = pos.getX(i + 1), y1 = pos.getY(i + 1), z1 = pos.getZ(i + 1);
        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
        pos.setXYZ(i + 2, x1, y1, z1);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    } else {
      geo.translate(0, 0, normalCenter + normalOffset - depth * 0.5);
      geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = meshName;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  const outerShape = new THREE.Shape();
  ccwPts.forEach(([u, y], idx) => {
    if (idx === 0) outerShape.moveTo(u, y);
    else outerShape.lineTo(u, y);
  });
  outerShape.closePath();

  let innerArea2 = 0;
  for (let i = 0; i < validInner.length; i++) {
    const [x0, y0] = validInner[i]!;
    const [x1, y1] = validInner[(i + 1) % validInner.length]!;
    innerArea2 += x0 * y1 - x1 * y0;
  }

  if (validInner.length >= 3 && innerArea2 > 0.0015) {
    const holePath = new THREE.Path();
    const cwHole = [...validInner].reverse();
    cwHole.forEach(([u, y], idx) => {
      if (idx === 0) holePath.moveTo(u, y);
      else holePath.lineTo(u, y);
    });
    holePath.closePath();
    outerShape.holes.push(holePath);

    placeExtruded(`${name}.frame`, outerShape, frameThickness, 0, true);

    // Exact 5.0mm recessed Shaker field panel (matching addInteractiveShakerWardrobeDoor 1:1!)
    const rebatePts = computeOffsetPolygon(Math.max(0.008, inset - 0.008));
    const fieldPts = rebatePts.length >= 3 ? rebatePts : validInner;
    const fieldShape = new THREE.Shape();
    fieldPts.forEach(([cu, cy], idx) => {
      if (idx === 0) fieldShape.moveTo(cu, cy);
      else fieldShape.lineTo(cu, cy);
    });
    fieldShape.closePath();
    const panelT = Math.min(0.016, frameThickness - 0.006);
    const panelRecess = 0.005;
    const panelOffset = -normalSign * (frameThickness * 0.5 - panelRecess - panelT * 0.5);
    placeExtruded(`${name}.fieldPanel`, fieldShape, panelT, panelOffset, false);
  } else {
    placeExtruded(`${name}.frame`, outerShape, frameThickness, 0, true);
  }

  parent.add(group);
  return group;
}

function buildRakedOrFlatShakerLeafGeometry(params: {
  readonly name: string;
  readonly width: number;
  readonly hLeft: number;
  readonly hRight: number;
  readonly stileW: number;
  readonly railH: number;
  readonly frameT: number;
  readonly panelT: number;
  readonly alongZ: boolean;
  readonly normalSign: 1 | -1;
  readonly doorMat: THREE.Material;
  readonly singlePanel: boolean;
  readonly midRailCenterY?: number;
}): THREE.Group {
  const {
    name,
    width: w,
    hLeft: hL,
    hRight: hR,
    stileW,
    railH,
    frameT,
    panelT,
    alongZ,
    normalSign,
    doorMat,
    singlePanel,
  } = params;

  const group = new THREE.Group();
  group.name = name;

  const isRaked = Math.abs(hL - hR) > 0.004;
  const minH = Math.min(hL, hR);
  const midRailY = params.midRailCenterY ?? Math.min(0.85, minH * 0.42);
  const addBox = (
    partName: string,
    bx: number,
    by: number,
    bz: number,
    bw: number,
    bh: number,
    bd: number
  ): void => {
    const geo = alongZ ? sharedBoxGeometry(bd, bh, bw) : sharedBoxGeometry(bw, bh, bd);
    const mesh = new THREE.Mesh(geo, doorMat);
    mesh.name = partName;
    mesh.position.set(alongZ ? bz : bx, by, alongZ ? bx : bz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  if (!isRaked) {
    const h = hL;
    const innerW = Math.max(0.04, w - stileW * 2);
    addBox(`${name}.stileL`, -w * 0.5 + stileW * 0.5, h * 0.5, 0, stileW, h, frameT);
    addBox(`${name}.stileR`, w * 0.5 - stileW * 0.5, h * 0.5, 0, stileW, h, frameT);
    addBox(`${name}.railBot`, 0, railH * 0.5, 0, innerW, railH, frameT);
    addBox(`${name}.railTop`, 0, h - railH * 0.5, 0, innerW, railH, frameT);

    if (singlePanel) {
      const pH = Math.max(0.04, h - railH * 2 + 0.008);
      if (innerW > 0.04 && pH > 0.04) {
        addBox(
          `${name}.panel`,
          0,
          h * 0.5,
          -normalSign * (frameT * 0.5 - 0.005 - panelT * 0.5),
          innerW + 0.008,
          pH,
          panelT
        );
      }
    } else {
      addBox(`${name}.railMid`, 0, midRailY, 0, innerW, railH, frameT);
      const lowPanelH = Math.max(0.05, midRailY - railH * 0.5 - railH);
      addBox(
        `${name}.panelLow`,
        0,
        railH + lowPanelH * 0.5,
        -normalSign * (frameT * 0.5 - 0.005 - panelT * 0.5),
        innerW + 0.008,
        lowPanelH + 0.008,
        panelT
      );
      const highPanelBot = midRailY + railH * 0.5;
      const highPanelH = Math.max(0.05, h - railH - highPanelBot);
      addBox(
        `${name}.panelHigh`,
        0,
        highPanelBot + highPanelH * 0.5,
        -normalSign * (frameT * 0.5 - 0.005 - panelT * 0.5),
        innerW + 0.008,
        highPanelH + 0.008,
        panelT
      );
    }
    return group;
  }

  // Raked Shaker leaf / fixed spandrel: extruded outer perimeter with cutout holes + recessed panel
  const shapeL = alongZ ? (normalSign > 0 ? hR : hL) : hL;
  const shapeR = alongZ ? (normalSign > 0 ? hL : hR) : hR;
  const slope = (shapeR - shapeL) / w;
  const topYAt = (sx: number): number => shapeL + ((sx + w * 0.5) / w) * (shapeR - shapeL);
  const topRailDrop = railH * Math.hypot(1, slope);

  const frameShape = new THREE.Shape();
  frameShape.moveTo(-w * 0.5, 0);
  frameShape.lineTo(w * 0.5, 0);
  frameShape.lineTo(w * 0.5, shapeR);
  frameShape.lineTo(-w * 0.5, shapeL);
  frameShape.closePath();

  const xL = -w * 0.5 + stileW;
  const xR = w * 0.5 - stileW;

  if (singlePanel) {
    const yTopL = topYAt(xL) - topRailDrop;
    const yTopR = topYAt(xR) - topRailDrop;
    if (xR - xL > 0.035 && Math.max(yTopL, yTopR) > railH + 0.025) {
      const yClampL = Math.max(railH + 0.008, yTopL);
      const yClampR = Math.max(railH + 0.008, yTopR);
      const hole = new THREE.Path();
      hole.moveTo(xL, railH);
      hole.lineTo(xL, yClampL);
      hole.lineTo(xR, yClampR);
      hole.lineTo(xR, railH);
      hole.closePath();
      frameShape.holes.push(hole);
    }
  } else {
    const lowTop = midRailY - railH * 0.5;
    if (xR - xL > 0.035 && lowTop > railH + 0.03) {
      const lowHole = new THREE.Path();
      lowHole.moveTo(xL, railH);
      lowHole.lineTo(xL, lowTop);
      lowHole.lineTo(xR, lowTop);
      lowHole.lineTo(xR, railH);
      lowHole.closePath();
      frameShape.holes.push(lowHole);
    }
    const highBot = midRailY + railH * 0.5;
    const highTopL = Math.max(highBot + 0.02, topYAt(xL) - topRailDrop);
    const highTopR = Math.max(highBot + 0.02, topYAt(xR) - topRailDrop);
    if (xR - xL > 0.035 && Math.min(highTopL, highTopR) > highBot + 0.015) {
      const highHole = new THREE.Path();
      highHole.moveTo(xL, highBot);
      highHole.lineTo(xL, highTopL);
      highHole.lineTo(xR, highTopR);
      highHole.lineTo(xR, highBot);
      highHole.closePath();
      frameShape.holes.push(highHole);
    }
  }

  const frameGeo = new THREE.ExtrudeGeometry(frameShape, {
    depth: frameT,
    bevelEnabled: false,
  });
  frameGeo.translate(0, 0, -frameT * 0.5);
  if (alongZ) {
    frameGeo.rotateY(normalSign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
  }
  frameGeo.computeVertexNormals();
  frameGeo.computeBoundingBox();
  frameGeo.computeBoundingSphere();
  const frameMesh = new THREE.Mesh(frameGeo, doorMat);
  frameMesh.name = `${name}.frame`;
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  group.add(frameMesh);

  const pxL = -w * 0.5 + stileW * 0.65;
  const pxR = w * 0.5 - stileW * 0.65;
  const pyBot = Math.min(railH * 0.65, minH * 0.25);
  const pyTopL = Math.max(pyBot + 0.01, topYAt(pxL) - topRailDrop * 0.65);
  const pyTopR = Math.max(pyBot + 0.01, topYAt(pxR) - topRailDrop * 0.65);
  if (pxR - pxL > 0.02) {
    const panelShape = new THREE.Shape();
    panelShape.moveTo(pxL, pyBot);
    panelShape.lineTo(pxR, pyBot);
    panelShape.lineTo(pxR, pyTopR);
    panelShape.lineTo(pxL, pyTopL);
    panelShape.closePath();
    const panelGeo = new THREE.ExtrudeGeometry(panelShape, {
      depth: panelT,
      bevelEnabled: false,
    });
    panelGeo.translate(0, 0, -panelT * 0.5);
    if (alongZ) {
      panelGeo.rotateY(normalSign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      panelGeo.translate(-normalSign * (frameT * 0.5 - 0.005 - panelT * 0.5), 0, 0);
    } else {
      panelGeo.translate(0, 0, -normalSign * (frameT * 0.5 - 0.005 - panelT * 0.5));
    }
    panelGeo.computeVertexNormals();
    panelGeo.computeBoundingBox();
    panelGeo.computeBoundingSphere();
    const panelMesh = new THREE.Mesh(panelGeo, doorMat);
    panelMesh.name = `${name}.panel`;
    panelMesh.castShadow = false;
    panelMesh.receiveShadow = true;
    group.add(panelMesh);
  }

  return group;
}

/**
 * Builds a hollow 5-panel raked/flat wardrobe carcass (`18mm` panel thickness, `0.0mm` exterior
 * visual change when doors are closed, quarter-sawn European oak interior cavity & bay dividers,
 * first-person front-plane collision guard, recessed `2700K` warm LED pelmet diffuser strips, and fitted
 * interior hanging rails, garments, drawers, woven baskets, and shoe racks).
 */
export function buildHollowWardrobeInterior(
  options: HollowWardrobeInteriorOptions
): THREE.Group {
  const palette = getWardrobePalette();
  const {
    parent,
    namePrefix,
    openFace,
    uMin,
    uMax,
    frontCoord,
    depth,
    roomFloorY,
    carcassBaseY,
    doorBaseY,
    getCarcassTopY,
    exteriorMat,
    interactions,
    bays,
  } = options;
  const brassMat = options.brassMat ?? palette.brassMat;
  const oakMat = palette.oakMat;

  const alongU = openFace === '+z' || openFace === '-z';
  const openSign = openFace === '+z' || openFace === '+x' ? 1 : -1;
  const backCoord = frontCoord - openSign * depth;

  const getDoorTopY =
    options.getDoorTopY ?? ((u: number): number => getCarcassTopY(u, 0) - 0.048);

  const root = new THREE.Group();
  root.name = `${namePrefix}.hollowInterior`;
  parent.add(root);

  const panelT = 0.018;
  const extSkinT = 0.011;
  const oakLinerT = panelT - extSkinT; // 0.007m = 7mm

  const placeBox = (
    partName: string,
    uCenter: number,
    yCenter: number,
    vCenter: number,
    uSize: number,
    ySize: number,
    vSize: number,
    mat: THREE.Material,
    castShadow = false,
    target: THREE.Object3D = root
  ): THREE.Mesh => {
    const geo = alongU
      ? sharedBoxGeometry(uSize, ySize, vSize)
      : sharedBoxGeometry(vSize, ySize, uSize);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = partName;
    mesh.position.set(
      alongU ? uCenter : vCenter,
      yCenter,
      alongU ? vCenter : uCenter
    );
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    target.add(mesh);
    return mesh;
  };

  // First-person front-plane collision guard (prevents walking through open doors)
  {
    const guardH = 1.8; // Y = roomFloorY + 0.15m .. roomFloorY + 1.95m
    const guardY = roomFloorY + 0.15 + guardH * 0.5;
    const guardT = 0.024;
    const guardU = (uMin + uMax) * 0.5;
    const guardV = frontCoord - openSign * 0.014;
    const guardSpan = Math.max(0.4, uMax - uMin);
    const guardGeo = alongU
      ? sharedBoxGeometry(guardSpan, guardH, guardT)
      : sharedBoxGeometry(guardT, guardH, guardSpan);
    const guardMesh = new THREE.Mesh(guardGeo, palette.collisionGuardMat);
    guardMesh.name = `${namePrefix}.frontCollisionGuard`;
    guardMesh.position.set(
      alongU ? guardU : guardV,
      guardY,
      alongU ? guardV : guardU
    );
    guardMesh.castShadow = false;
    guardMesh.receiveShadow = false;
    guardMesh.userData.isArchitecturalShell = true;
    guardMesh.raycast = () => {};
    root.add(guardMesh);
  }

  // Hollow 5-Panel Carcass (18mm cheeks, rear back, roof & painted face-frame)
  const safeTopY = (u: number, depthFrac: number): number =>
    Math.max(carcassBaseY + 0.25, getCarcassTopY(u, depthFrac));

  // Left & Right side cheeks (outer painted skin + inner oak lining)
  const buildSideCheek = (sideLabel: 'left' | 'right', uOuter: number, inwardSign: 1 | -1): void => {
    const vSamples = 6;
    const extPts: [number, number][] = [
      [frontCoord, carcassBaseY],
      [backCoord, carcassBaseY],
    ];
    for (let s = vSamples; s >= 0; s--) {
      const df = s / vSamples;
      const v = frontCoord - openSign * depth * df;
      extPts.push([v, safeTopY(uOuter, df)]);
    }
    const extCheek = buildProfileExtrudedPanel(
      `${namePrefix}.carcass.${sideLabel}OuterCheek`,
      extPts,
      extSkinT,
      'vSpan',
      alongU,
      uOuter + inwardSign * extSkinT * 0.5,
      exteriorMat,
      true
    );
    extCheek.userData.isArchitecturalShell = true;
    root.add(extCheek);

    const endBay = sideLabel === 'left' ? bays[0] : bays[bays.length - 1];
    const endBayGap =
      endBay === undefined
        ? Infinity
        : sideLabel === 'left'
          ? endBay.uMin - uOuter
          : uOuter - endBay.uMax;
    const coveredByOpenAlcovePanel =
      endBay?.preset === 'openRakedShelvesOverThreeDrawers' && endBayGap <= panelT + 0.002;

    if (!coveredByOpenAlcovePanel) {
      const uInner = uOuter + inwardSign * (extSkinT + oakLinerT * 0.5);
      const oakFrontInset = panelT + 0.008;
      const oakPts: [number, number][] = [
        [frontCoord - openSign * oakFrontInset, doorBaseY],
        [backCoord + openSign * panelT, doorBaseY],
      ];
      for (let s = vSamples; s >= 0; s--) {
        const df = s / vSamples;
        const v =
          frontCoord -
          openSign * oakFrontInset -
          openSign * Math.max(0.05, depth - oakFrontInset - panelT) * df;
        const realDf = Math.abs(v - frontCoord) / depth;
        oakPts.push([v, safeTopY(uOuter + inwardSign * panelT, realDf) - 0.012]);
      }
      root.add(
        buildProfileExtrudedPanel(
          `${namePrefix}.carcass.${sideLabel}OakCheek`,
          oakPts,
          oakLinerT,
          'vSpan',
          alongU,
          uInner,
          oakMat,
          false
        )
      );
    }
  };

  buildSideCheek('left', uMin, 1);
  buildSideCheek('right', uMax, -1);

  // Rear Back Panel (`11mm` exterior skin + `7mm` warm oak cavity back lining)
  const uSamples = Math.max(12, Math.ceil((uMax - uMin) / 0.22));
  {
    const u0 = uMin + extSkinT;
    const u1 = uMax - extSkinT;
    const backExtPts: [number, number][] = [
      [u0, carcassBaseY],
      [u1, carcassBaseY],
    ];
    for (let i = uSamples; i >= 0; i--) {
      const u = u0 + ((u1 - u0) * i) / uSamples;
      backExtPts.push([u, safeTopY(u, 1)]);
    }
    const rearExt = buildProfileExtrudedPanel(
      `${namePrefix}.carcass`,
      backExtPts,
      extSkinT,
      'uSpan',
      alongU,
      backCoord + openSign * extSkinT * 0.5,
      exteriorMat,
      true
    );
    rearExt.userData.isArchitecturalShell = true;
    root.add(rearExt);

    const uOak0 = uMin + panelT;
    const uOak1 = uMax - panelT;
    const backOakPts: [number, number][] = [
      [uOak0, doorBaseY],
      [uOak1, doorBaseY],
    ];
    for (let i = uSamples; i >= 0; i--) {
      const u = uOak0 + ((uOak1 - uOak0) * i) / uSamples;
      backOakPts.push([u, safeTopY(u, 1) - 0.012]);
    }
    root.add(
      buildProfileExtrudedPanel(
        `${namePrefix}.carcass.rearOakLining`,
        backOakPts,
        oakLinerT,
        'uSpan',
        alongU,
        backCoord + openSign * (extSkinT + oakLinerT * 0.5),
        oakMat,
        false
      )
    );
  }

  // Raked / Hipped / Flat Roof Skin (outer painted cap strictly between cheeks/rear/face-frame + inner oak lining)
  {
    const extRoofT = 0.008;
    const oakRoofT = 0.01;
    const uRoofMin = uMin + extSkinT;
    const uRoofMax = uMax - extSkinT;
    const vFront = bays.length > 0 ? frontCoord - openSign * panelT : frontCoord;
    const vBack = backCoord + openSign * extSkinT;
    const dfFront = Math.abs(vFront - frontCoord) / depth;
    const dfBack = Math.abs(vBack - frontCoord) / depth;
    for (let i = 0; i < uSamples; i++) {
      const ua = uRoofMin + ((uRoofMax - uRoofMin) * i) / uSamples;
      const ub = uRoofMin + ((uRoofMax - uRoofMin) * (i + 1)) / uSamples;
      const yf0 = safeTopY(ua, dfFront);
      const yf1 = safeTopY(ub, dfFront);
      const yb1 = safeTopY(ub, dfBack);
      const yb0 = safeTopY(ua, dfBack);
      root.add(
        buildRoofSlabSegment(
          `${namePrefix}.carcass.roofOuter_${i}`,
          ua,
          ub,
          vFront,
          vBack,
          yf0,
          yf1,
          yb1,
          yb0,
          extRoofT,
          alongU,
          exteriorMat
        )
      );

      const uOa = Math.max(uMin + panelT, ua);
      const uOb = Math.min(uMax - panelT, ub);
      if (uOb - uOa > 0.008) {
        const vOakF = frontCoord - openSign * (panelT + 0.008);
        const vOakB = backCoord + openSign * panelT;
        const dfOakF = Math.abs(vOakF - frontCoord) / depth;
        const dfOakB = Math.abs(vOakB - frontCoord) / depth;
        root.add(
          buildRoofSlabSegment(
            `${namePrefix}.carcass.roofOak_${i}`,
            uOa,
            uOb,
            vOakF,
            vOakB,
            safeTopY(uOa, dfOakF) - extRoofT,
            safeTopY(uOb, dfOakF) - extRoofT,
            safeTopY(uOb, dfOakB) - extRoofT,
            safeTopY(uOa, dfOakB) - extRoofT,
            oakRoofT,
            alongU,
            oakMat
          )
        );
      }
    }
  }

  // Painted Front In-Frame Perimeter Stiles, Cornice Frieze & Plinth Sub-Rails (`0.0mm` flush at `frontCoord`)
  const frontStileV = frontCoord - openSign * panelT * 0.5;
  if (bays.length > 0) {
    const firstBay = bays[0]!;
    const lastBay = bays[bays.length - 1]!;

    const hasLeftStile = firstBay.uMin - (uMin + extSkinT) > 0.002;
    const hasRightStile = (uMax - extSkinT) - lastBay.uMax > 0.002;

    // Left outer face-frame stile (strictly inside leftOuterCheek)
    if (hasLeftStile) {
      const sU0 = uMin + extSkinT;
      const sU1 = firstBay.uMin;
      const stilePts: [number, number][] = [
        [sU0, carcassBaseY],
        [sU1, carcassBaseY],
        [sU1, safeTopY(sU1, 0)],
        [sU0, safeTopY(sU0, 0)],
      ];
      root.add(
        buildProfileExtrudedPanel(
          `${namePrefix}.faceFrame.leftStile`,
          stilePts,
          panelT,
          'uSpan',
          alongU,
          frontStileV,
          exteriorMat,
          false
        )
      );
    }

    // Right outer face-frame stile (strictly inside rightOuterCheek)
    if (hasRightStile) {
      const sU0 = lastBay.uMax;
      const sU1 = uMax - extSkinT;
      const stilePts: [number, number][] = [
        [sU0, carcassBaseY],
        [sU1, carcassBaseY],
        [sU1, safeTopY(sU1, 0)],
        [sU0, safeTopY(sU0, 0)],
      ];
      root.add(
        buildProfileExtrudedPanel(
          `${namePrefix}.faceFrame.rightStile`,
          stilePts,
          panelT,
          'uSpan',
          alongU,
          frontStileV,
          exteriorMat,
          false
        )
      );
    }

    // Top cornice backing frieze + bottom plinth/seat backing rail per bay (exact disjoint U spans)
    bays.forEach((bay, bIdx) => {
      const prevBay = bIdx > 0 ? bays[bIdx - 1]! : undefined;
      const nextBay = bIdx < bays.length - 1 ? bays[bIdx + 1]! : undefined;
      const frameU0 =
        prevBay === undefined
          ? hasLeftStile
            ? firstBay.uMin
            : uMin + extSkinT
          : bay.uMin - prevBay.uMax >= 0.014
            ? bay.uMin
            : (prevBay.uMax + bay.uMin) * 0.5;
      const frameU1 =
        nextBay === undefined
          ? hasRightStile
            ? lastBay.uMax
            : uMax - extSkinT
          : nextBay.uMin - bay.uMax >= 0.014
            ? bay.uMax
            : (bay.uMax + nextBay.uMin) * 0.5;
      if (frameU1 - frameU0 <= 0.004) return;

      const bayFloor = bay.floorY ?? doorBaseY;
      if (bayFloor - carcassBaseY > 0.006) {
        const subH = bayFloor - carcassBaseY;
        placeBox(
          `${namePrefix}.${bay.id}.frontSubRail`,
          (frameU0 + frameU1) * 0.5,
          carcassBaseY + subH * 0.5,
          frontStileV,
          frameU1 - frameU0,
          subH,
          panelT,
          exteriorMat,
          false
        );
      }

      const bMid = (frameU0 + frameU1) * 0.5;
      const friezePts: [number, number][] = [
        [frameU0, getDoorTopY(frameU0) - 0.006],
        [bMid, getDoorTopY(bMid) - 0.006],
        [frameU1, getDoorTopY(frameU1) - 0.006],
        [frameU1, safeTopY(frameU1, 0)],
        [bMid, safeTopY(bMid, 0)],
        [frameU0, safeTopY(frameU0, 0)],
      ];
      root.add(
        buildProfileExtrudedPanel(
          `${namePrefix}.${bay.id}.topFrieze`,
          friezePts,
          panelT,
          'uSpan',
          alongU,
          frontStileV,
          exteriorMat,
          false
        )
      );
    });

    // Inter-bay painted front mullions + full-depth 18mm warm European oak vertical bay dividers
    for (let i = 0; i < bays.length - 1; i++) {
      const leftBay = bays[i]!;
      const rightBay = bays[i + 1]!;
      const divCenterU = (leftBay.uMax + rightBay.uMin) * 0.5;
      const mullionW = rightBay.uMin - leftBay.uMax;
      const divBotY = Math.min(leftBay.floorY ?? doorBaseY, rightBay.floorY ?? doorBaseY);

      // Front painted face-frame mullion (only when bays are separated by a visible >= 14mm frame stile)
      if (mullionW >= 0.014) {
        const mulPts: [number, number][] = [
          [divCenterU - mullionW * 0.5, carcassBaseY],
          [divCenterU + mullionW * 0.5, carcassBaseY],
          [divCenterU + mullionW * 0.5, safeTopY(divCenterU + mullionW * 0.5, 0)],
          [divCenterU - mullionW * 0.5, safeTopY(divCenterU - mullionW * 0.5, 0)],
        ];
        root.add(
          buildProfileExtrudedPanel(
            `${namePrefix}.faceFrame.mullion_${i + 1}`,
            mulPts,
            panelT,
            'uSpan',
            alongU,
            frontStileV,
            exteriorMat,
            false
          )
        );
      }

      // Full-depth 18mm warm oak vertical bay divider set 8mm behind front mullion (0 z-fighting!)
      const divFrontInset = panelT + 0.008;
      const divVFront = frontCoord - openSign * divFrontInset;
      const divVBack = backCoord + openSign * panelT;
      const divPts: [number, number][] = [
        [divVFront, divBotY],
        [divVBack, divBotY],
      ];
      const divSamples = 5;
      for (let s = divSamples; s >= 0; s--) {
        const df = s / divSamples;
        const v = divVFront - openSign * Math.max(0.05, depth - divFrontInset - panelT) * df;
        const realDf = Math.abs(v - frontCoord) / depth;
        const rawTop = safeTopY(divCenterU, realDf) - 0.018;
        const cappedTop =
          leftBay.dividerMaxY !== undefined ? Math.min(rawTop, leftBay.dividerMaxY) : rawTop;
        divPts.push([v, Math.max(divBotY + 0.08, cappedTop)]);
      }
      root.add(
        buildProfileExtrudedPanel(
          `${namePrefix}.bayDivider_${i + 1}`,
          divPts,
          panelT,
          'vSpan',
          alongU,
          divCenterU,
          oakMat,
          false
        )
      );
    }
  }

  // Fitted Bay Interiors, Warm 2700K LED Pelmets & Interactive Oak Drawers
  const frontClearInset = panelT + 0.008;
  const innerDepth = Math.max(0.28, depth - frontClearInset - panelT);
  const vInnerFront = frontCoord - openSign * frontClearInset;
  const vInnerCenter = frontCoord - openSign * (frontClearInset + innerDepth * 0.5);

  const minInteriorCeilY = (u0: number, u1: number): number => {
    let minY = Number.POSITIVE_INFINITY;
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const u = u0 + (u1 - u0) * frac;
      for (const df of [0.05, 0.5, 0.95]) {
        minY = Math.min(minY, safeTopY(u, df) - 0.022);
      }
    }
    return minY;
  };

  const addOakShelf = (
    shelfName: string,
    u0: number,
    u1: number,
    yTop: number,
    shelfDepthFrac = 0.92,
    withLedUnder = false,
    target: THREE.Object3D = root
  ): void => {
    const sw = Math.max(0.08, u1 - u0);
    const sd = innerDepth * shelfDepthFrac;
    const sv = vInnerFront - openSign * ((innerDepth - sd) + sd * 0.5);
    placeBox(shelfName, (u0 + u1) * 0.5, yTop - 0.009, sv, sw, 0.018, sd, oakMat, false, target);
    if (withLedUnder && sw > 0.14) {
      const ledV = vInnerFront - openSign * 0.048;
      const ledMesh = placeBox(
        `${shelfName}.ledDiffuser`,
        (u0 + u1) * 0.5,
        yTop - 0.02,
        ledV,
        sw - 0.03,
        0.005,
        0.012,
        palette.ledStripMat,
        false,
        target
      );
      ledMesh.castShadow = false;
      ledMesh.receiveShadow = false;
    }
  };

  const addHangingRailWithGarments = (
    railName: string,
    u0: number,
    u1: number,
    railY: number,
    garmentLen: number,
    seedOffset: number
  ): void => {
    const rw = Math.max(0.12, u1 - u0);
    const uMid = (u0 + u1) * 0.5;
    const railV = vInnerCenter;

    // Brushed-brass oval wardrobe rail trimmed between inner faces of end wall sockets
    const sockLen = 0.012;
    const railInnerLen = Math.max(0.08, rw - sockLen * 2);
    const railGeo = sharedCylinderGeometry(0.009, 0.009, railInnerLen, 12);
    const railMesh = new THREE.Mesh(railGeo, brassMat);
    railMesh.name = railName;
    if (alongU) {
      railMesh.rotation.z = Math.PI * 0.5;
      railMesh.position.set(uMid, railY, railV);
    } else {
      railMesh.rotation.x = Math.PI * 0.5;
      railMesh.position.set(railV, railY, uMid);
    }
    root.add(railMesh);

    const sockGeo = sharedCylinderGeometry(0.016, 0.016, 0.012, 12);
    for (const endSign of [-1, 1]) {
      const sock = new THREE.Mesh(sockGeo, brassMat);
      const su = uMid + endSign * (rw * 0.5 - 0.006);
      if (alongU) {
        sock.rotation.z = Math.PI * 0.5;
        sock.position.set(su, railY, railV);
      } else {
        sock.rotation.x = Math.PI * 0.5;
        sock.position.set(railV, railY, su);
      }
      root.add(sock);
    }

    // Sculpted wooden coat hangers with brass hooks + tailored hanging garments
    const count = Math.max(2, Math.min(9, Math.floor((rw - 0.08) / 0.085)));
    const spanUsed = (count - 1) * 0.078;
    const hookGeo = sharedTorusGeometry(0.015, 0.0022, 6, 12, Math.PI * 1.35);
    const gDepth = Math.min(0.42, innerDepth * 0.78);

    for (let g = 0; g < count; g++) {
      const gu = uMid - spanUsed * 0.5 + g * 0.078;
      const gMat = palette.garmentMats[(g + seedOffset) % palette.garmentMats.length]!;
      const lenVar = garmentLen * (0.86 + ((g * 37 + seedOffset * 13) % 15) * 0.01);
      const thickU = 0.036 + ((g + seedOffset) % 3) * 0.007;

      // Brass hanger hook over rail
      const hook = new THREE.Mesh(hookGeo, brassMat);
      if (alongU) {
        hook.rotation.y = Math.PI * 0.5;
        hook.position.set(gu, railY + 0.014, railV);
      } else {
        hook.position.set(railV, railY + 0.014, gu);
      }
      root.add(hook);

      // Sculpted timber coat-hanger shoulder bar
      placeBox(
        `${railName}.hanger_${g + 1}`,
        gu,
        railY - 0.024,
        railV,
        0.016,
        0.022,
        Math.min(0.38, gDepth * 0.92),
        palette.hangerWoodMat
      );

      // Tailored garment shoulder yoke + draped body + subtle lapel/collar fold
      placeBox(
        `${railName}.garmentShoulder_${g + 1}`,
        gu,
        railY - 0.055,
        railV,
        thickU + 0.006,
        0.065,
        gDepth,
        gMat
      );
      placeBox(
        `${railName}.garmentBody_${g + 1}`,
        gu,
        railY - 0.065 - lenVar * 0.5,
        railV,
        thickU,
        Math.max(0.18, lenVar - 0.04),
        gDepth * 0.92,
        gMat
      );
    }
  };

  const addFoldedLinenStack = (
    stackName: string,
    uCenter: number,
    yBase: number,
    vCenter: number,
    stackW: number,
    layers: number,
    seed: number,
    target: THREE.Object3D = root
  ): void => {
    const layerH = 0.034;
    const stackD = Math.min(0.32, innerDepth * 0.64);
    for (let l = 0; l < layers; l++) {
      const mat = palette.knitFoldMats[(seed + l) % palette.knitFoldMats.length]!;
      const inset = l * 0.006;
      placeBox(
        `${stackName}.layer_${l + 1}`,
        uCenter,
        yBase + layerH * (l + 0.5),
        vCenter,
        Math.max(0.1, stackW - inset),
        layerH - 0.003,
        stackD - inset * 0.5,
        mat,
        false,
        target
      );
    }
  };

  const addWovenStorageBasket = (
    basketName: string,
    uCenter: number,
    yBase: number,
    bw: number,
    bh: number,
    isCanvasBox = false
  ): void => {
    const bd = Math.min(0.36, innerDepth * 0.72);
    const bv = vInnerCenter + openSign * 0.015;
    placeBox(
      basketName,
      uCenter,
      yBase + bh * 0.5,
      bv,
      bw,
      bh,
      bd,
      isCanvasBox ? palette.canvasBoxMat : palette.rattanMat
    );
    // Leather pull tab / lid rim
    placeBox(
      `${basketName}.lidRim`,
      uCenter,
      yBase + bh - 0.012,
      bv,
      bw + 0.008,
      0.022,
      bd + 0.008,
      isCanvasBox ? oakMat : palette.oakDarkEdgeMat
    );
    placeBox(
      `${basketName}.leatherStrap`,
      uCenter,
      yBase + bh * 0.52,
      bv + openSign * (bd * 0.5 + 0.004),
      Math.min(0.075, bw * 0.28),
      0.024,
      0.008,
      palette.leatherDarkMat
    );
  };

  const addSlattedShoeRackAndFootwear = (
    rackName: string,
    u0: number,
    u1: number,
    yBase: number,
    seed: number
  ): void => {
    const rw = Math.max(0.2, u1 - u0 - 0.03);
    const uMid = (u0 + u1) * 0.5;
    const rackD = Math.min(0.34, innerDepth * 0.68);
    // Twin oak slatted rails + pairs of sculpted leather boots/loafers
    for (let s = 0; s < 3; s++) {
      const frac = (s - 1) * 0.34;
      const sv = vInnerCenter + openSign * frac * rackD;
      const sy = yBase + 0.065 - s * 0.014;
      placeBox(`${rackName}.slat_${s + 1}`, uMid, sy, sv, rw, 0.012, 0.028, oakMat);
    }

    const pairCount = Math.max(1, Math.min(4, Math.floor(rw / 0.24)));
    for (let p = 0; p < pairCount; p++) {
      const pu = uMid - ((pairCount - 1) * 0.22) * 0.5 + p * 0.22;
      const shoeMat = (p + seed) % 2 === 0 ? palette.leatherDarkMat : palette.leatherTanMat;
      const isBoot = (p + seed) % 3 === 0;
      for (const footOff of [-0.046, 0.046]) {
        // Sole + sculpted vamp
        placeBox(
          `${rackName}.shoeSole_${p}_${footOff > 0 ? 'R' : 'L'}`,
          pu + footOff,
          yBase + 0.082,
          vInnerCenter + openSign * 0.02,
          0.074,
          0.036,
          0.22,
          shoeMat
        );
        if (isBoot) {
          placeBox(
            `${rackName}.bootShaft_${p}_${footOff > 0 ? 'R' : 'L'}`,
            pu + footOff,
            yBase + 0.145,
            vInnerCenter - openSign * 0.03,
            0.066,
            0.1,
            0.095,
            shoeMat
          );
        }
      }
    }
  };

  const addHorizontalBrassBarPull = (
    pullName: string,
    uCenter: number,
    yCenter: number,
    frontFaceV: number,
    barWidth = 0.16,
    target: THREE.Object3D = root
  ): void => {
    const barProj = 0.026;
    const barGeo = sharedCylinderGeometry(0.0055, 0.0055, barWidth, 12);
    const barMesh = new THREE.Mesh(barGeo, brassMat);
    barMesh.name = pullName;
    if (alongU) {
      barMesh.rotation.z = Math.PI * 0.5;
      barMesh.position.set(uCenter, yCenter, frontFaceV + openSign * barProj);
    } else {
      barMesh.rotation.x = Math.PI * 0.5;
      barMesh.position.set(frontFaceV + openSign * barProj, yCenter, uCenter);
    }
    target.add(barMesh);

    const collarThick = 0.0032;
    const standoffLen = Math.max(0.008, barProj - collarThick);
    const standoffMidV = frontFaceV + openSign * (collarThick + standoffLen * 0.5);
    const collarGeo = sharedCylinderGeometry(0.0078, 0.0085, collarThick, 12);
    const standoffGeo = sharedCylinderGeometry(0.0042, 0.0042, standoffLen, 10);
    for (const du of [-barWidth * 0.36, barWidth * 0.36]) {
      const col = new THREE.Mesh(collarGeo, brassMat);
      col.name = `${pullName}.collar`;
      const st = new THREE.Mesh(standoffGeo, brassMat);
      st.name = `${pullName}.standoff`;
      if (alongU) {
        col.rotation.x = Math.PI * 0.5;
        col.position.set(uCenter + du, yCenter, frontFaceV + openSign * (collarThick * 0.5));
        st.rotation.x = Math.PI * 0.5;
        st.position.set(uCenter + du, yCenter, standoffMidV);
      } else {
        col.rotation.z = Math.PI * 0.5;
        col.position.set(frontFaceV + openSign * (collarThick * 0.5), yCenter, uCenter + du);
        st.rotation.z = Math.PI * 0.5;
        st.position.set(standoffMidV, yCenter, uCenter + du);
      }
      target.add(col);
      target.add(st);
    }
  };

  const addTwoRowOakShoeRacks = (
    rackPrefix: string,
    u0: number,
    u1: number,
    seed: number
  ): void => {
    // 2 rows of solid-oak shoe racks at exact +75mm & +235mm above roomFloorY
    const rw = Math.max(0.2, u1 - u0 - 0.016);
    const uMid = (u0 + u1) * 0.5;
    const rackD = Math.min(0.36, innerDepth * 0.72);
    const row1Y = Math.max(roomFloorY + 0.162, doorBaseY + 0.024);
    const rowHeights = [row1Y, row1Y + 0.15] as const;

    rowHeights.forEach((rowY, rIdx) => {
      for (let s = 0; s < 3; s++) {
        const frac = (s - 1) * 0.34;
        const sv = vInnerCenter + openSign * frac * rackD;
        const sy = rowY - s * 0.008;
        placeBox(
          `${rackPrefix}.row_${rIdx + 1}.slat_${s + 1}`,
          uMid,
          sy,
          sv,
          rw,
          0.014,
          0.032,
          oakMat
        );
      }
      // Side solid-oak shoe-rack stretcher rails
      for (const sideSign of [-1, 1] as const) {
        placeBox(
          `${rackPrefix}.row_${rIdx + 1}.rail_${sideSign < 0 ? 'L' : 'R'}`,
          uMid + sideSign * (rw * 0.5 - 0.009),
          rowY - 0.008,
          vInnerCenter,
          0.016,
          0.02,
          rackD,
          palette.oakDarkEdgeMat
        );
      }

      const pairCount = Math.max(1, Math.min(5, Math.floor(rw / 0.24)));
      for (let p = 0; p < pairCount; p++) {
        const pu = uMid - ((pairCount - 1) * 0.22) * 0.5 + p * 0.22;
        const shoeMat =
          (p + seed + rIdx) % 2 === 0 ? palette.leatherDarkMat : palette.leatherTanMat;
        for (const footOff of [-0.044, 0.044]) {
          placeBox(
            `${rackPrefix}.row_${rIdx + 1}.shoe_${p + 1}_${footOff > 0 ? 'R' : 'L'}`,
            pu + footOff,
            rowY + 0.026,
            vInnerCenter + openSign * 0.015,
            0.072,
            0.038,
            0.22,
            shoeMat
          );
        }
      }
    });
  };

  const addInternalOakDrawerStack = (
    stackName: string,
    u0: number,
    u1: number,
    yBase: number,
    drawerCount: number,
    drawerH: number,
    registerTopHeroDrawer: boolean,
    seed: number,
    flushAtFront = false
  ): number => {
    const dw = Math.max(0.22, u1 - u0 - (flushAtFront ? 0.006 : 0.012));
    const uMid = (u0 + u1) * 0.5;
    const frontV = flushAtFront
      ? frontCoord + openSign * 0.013
      : vInnerFront - openSign * 0.036; // Flush 26mm plane when external; recessed behind doors when internal!
    const pullFaceV = flushAtFront ? frontCoord + openSign * 0.026 : frontV + openSign * 0.014;
    const barW = 0.16; // Unified 160mm aged-brass collared bar pull on all drawers!
    const fasciaMat = flushAtFront ? exteriorMat : oakMat;
    const recessMat = flushAtFront ? exteriorMat : palette.oakDarkEdgeMat;
    const boxDepth = Math.min(0.42, innerDepth - (flushAtFront ? 0.03 : 0.07));

    for (let d = 0; d < drawerCount; d++) {
      const dyCenter = yBase + d * drawerH + drawerH * 0.5;
      const isTopHero = registerTopHeroDrawer && d === drawerCount - 1 && Boolean(interactions);

      if (isTopHero && interactions) {
        const heroGroup = new THREE.Group();
        heroGroup.name = `${stackName}.heroDrawer`;
        root.add(heroGroup);

        placeBox(
          `${stackName}.heroFront`,
          uMid,
          dyCenter,
          frontV,
          dw,
          drawerH - 0.006,
          flushAtFront ? 0.016 : 0.022,
          fasciaMat,
          true,
          heroGroup
        );
        if (flushAtFront) {
          const stW = 0.048;
          const rlH = 0.036;
          const fH = drawerH - 0.006;
          for (const sSign of [-1, 1] as const) {
            placeBox(
              `${stackName}.heroShakerStile_${sSign < 0 ? 'L' : 'R'}`,
              uMid + sSign * (dw * 0.5 - stW * 0.5),
              dyCenter,
              frontCoord + openSign * 0.0235,
              stW,
              fH,
              0.005,
              fasciaMat,
              false,
              heroGroup
            );
          }
          for (const rSign of [-1, 1] as const) {
            placeBox(
              `${stackName}.heroShakerRail_${rSign < 0 ? 'B' : 'T'}`,
              uMid,
              dyCenter + rSign * (fH * 0.5 - rlH * 0.5),
              frontCoord + openSign * 0.0235,
              Math.max(0.06, dw - stW * 2),
              rlH,
              0.005,
              fasciaMat,
              false,
              heroGroup
            );
          }
        } else {
          placeBox(
            `${stackName}.heroRecess`,
            uMid,
            dyCenter,
            frontV + openSign * 0.008,
            Math.max(0.08, dw - 0.084),
            Math.max(0.05, drawerH - 0.072),
            0.008,
            recessMat,
            false,
            heroGroup
          );
        }
        addHorizontalBrassBarPull(
          `${stackName}.heroBarPull`,
          uMid,
          dyCenter + 0.004,
          pullFaceV,
          barW,
          heroGroup
        );

        // Dovetailed solid-oak drawer box (disjoint sides, rear, floor) & folded cashmere contents inside!
        const boxSideT = 0.014;
        const boxOuterW = Math.max(0.10, dw - 0.014);
        const boxInnerW = Math.max(0.06, boxOuterW - boxSideT * 2);
        const boxFrontV = frontV - openSign * 0.008;
        const boxCenterV = boxFrontV - openSign * (boxDepth * 0.5);
        const boxInnerD = Math.max(0.06, boxDepth - boxSideT);
        const sideH = drawerH - 0.024;
        placeBox(
          `${stackName}.heroBoxFloor`,
          uMid,
          dyCenter - sideH * 0.5 + 0.006,
          boxFrontV - openSign * (boxInnerD * 0.5),
          boxInnerW,
          0.012,
          boxInnerD,
          oakMat,
          false,
          heroGroup
        );
        for (const sSign of [-1, 1]) {
          placeBox(
            `${stackName}.heroBoxSide_${sSign > 0 ? 'R' : 'L'}`,
            uMid + sSign * (boxOuterW * 0.5 - boxSideT * 0.5),
            dyCenter,
            boxCenterV,
            boxSideT,
            sideH,
            boxDepth,
            oakMat,
            false,
            heroGroup
          );
        }
        placeBox(
          `${stackName}.heroBoxBack`,
          uMid,
          dyCenter,
          boxFrontV - openSign * (boxDepth - boxSideT * 0.5),
          boxInnerW,
          sideH,
          boxSideT,
          oakMat,
          false,
          heroGroup
        );

        const stackCols = dw > 0.56 ? 2 : 1;
        for (let c = 0; c < stackCols; c++) {
          const cu =
            stackCols === 1 ? uMid : uMid + (c === 0 ? -dw * 0.24 : dw * 0.24);
          addFoldedLinenStack(
            `${stackName}.heroContents_${c + 1}`,
            cu,
            dyCenter - sideH * 0.5 + 0.014,
            boxCenterV + openSign * 0.03,
            stackCols === 1 ? dw - 0.07 : Math.max(0.10, (dw - 0.11) / 2),
            2,
            seed + c,
            heroGroup
          );
        }

        const slideTravel = Math.min(0.36, boxDepth * 0.78);
        const slideDelta = alongU
          ? new THREE.Vector3(0, 0, openSign * slideTravel)
          : new THREE.Vector3(openSign * slideTravel, 0, 0);
        interactions.registerSlidingDrawer(heroGroup, slideDelta);
      } else {
        placeBox(
          `${stackName}.drawerFront_${d + 1}`,
          uMid,
          dyCenter,
          frontV,
          dw,
          drawerH - 0.006,
          flushAtFront ? 0.016 : 0.022,
          fasciaMat,
          flushAtFront
        );
        if (flushAtFront) {
          const stW = 0.048;
          const rlH = 0.036;
          const fH = drawerH - 0.006;
          for (const sSign of [-1, 1] as const) {
            placeBox(
              `${stackName}.drawerShakerStile_${d + 1}_${sSign < 0 ? 'L' : 'R'}`,
              uMid + sSign * (dw * 0.5 - stW * 0.5),
              dyCenter,
              frontCoord + openSign * 0.0235,
              stW,
              fH,
              0.005,
              fasciaMat
            );
          }
          for (const rSign of [-1, 1] as const) {
            placeBox(
              `${stackName}.drawerShakerRail_${d + 1}_${rSign < 0 ? 'B' : 'T'}`,
              uMid,
              dyCenter + rSign * (fH * 0.5 - rlH * 0.5),
              frontCoord + openSign * 0.0235,
              Math.max(0.06, dw - stW * 2),
              rlH,
              0.005,
              fasciaMat
            );
          }
        } else {
          placeBox(
            `${stackName}.drawerPanel_${d + 1}`,
            uMid,
            dyCenter,
            frontV + openSign * 0.008,
            Math.max(0.08, dw - 0.084),
            Math.max(0.05, drawerH - 0.072),
            0.008,
            recessMat
          );
        }
        addHorizontalBrassBarPull(
          `${stackName}.barPull_${d + 1}`,
          uMid,
          dyCenter + 0.004,
          pullFaceV,
          barW
        );
      }
    }

    const topDeckY = yBase + drawerCount * drawerH + 0.012;
    addOakShelf(
      `${stackName}.counterDeck`,
      u0,
      u1,
      topDeckY,
      flushAtFront ? 0.99 : 0.92
    );
    return topDeckY;
  };

  bays.forEach((bay, bayIdx) => {
    const bayFloor = bay.floorY ?? doorBaseY;
    const prevBay = bayIdx > 0 ? bays[bayIdx - 1]! : undefined;
    const nextBay = bayIdx < bays.length - 1 ? bays[bayIdx + 1]! : undefined;
    const minFromPrevDiv =
      prevBay !== undefined ? (prevBay.uMax + bay.uMin) * 0.5 + panelT * 0.5 : -Infinity;
    const maxFromNextDiv =
      nextBay !== undefined ? (bay.uMax + nextBay.uMin) * 0.5 - panelT * 0.5 : Infinity;
    const bu0 = Math.max(uMin + panelT, bay.uMin, minFromPrevDiv);
    const bu1 = Math.min(uMax - panelT, bay.uMax, maxFromNextDiv);
    const bw = bu1 - bu0;
    if (bw <= 0.12) return;

    const buMid = (bu0 + bu1) * 0.5;
    const minCeilY = minInteriorCeilY(bu0, bu1);
    const maxCeilY = Math.max(
      safeTopY(bu0, 0.5),
      safeTopY(buMid, 0.5),
      safeTopY(bu1, 0.5)
    ) - 0.025;
    const clearH = Math.max(0.35, minCeilY - bayFloor);

    // Solid 18mm oak bay floor deck strictly between bay dividers / oak cheeks
    placeBox(
      `${namePrefix}.${bay.id}.oakDeck`,
      buMid,
      bayFloor + 0.009,
      vInnerCenter,
      bw,
      0.018,
      innerDepth,
      oakMat
    );

    // Top recessed warm 2700K LED pelmet strip in every bay (`castShadow = false`, 0 PointLights!)
    const topLedY = Math.min(minCeilY - 0.015, getDoorTopY(buMid) - 0.014);
    if (topLedY > bayFloor + 0.25) {
      const pelmetLed = placeBox(
        `${namePrefix}.${bay.id}.pelmetLed`,
        buMid,
        topLedY,
        vInnerFront - openSign * 0.042,
        Math.max(0.12, bw - 0.04),
        0.006,
        0.014,
        palette.ledStripMat
      );
      pelmetLed.castShadow = false;
      pelmetLed.receiveShadow = false;
    }

    // Optional oak shelf aligned behind a fixed raked spandrel transom
    if (
      bay.spandrelShelfY !== undefined &&
      bay.spandrelShelfY > bayFloor + 0.45 &&
      bay.spandrelShelfY < maxCeilY - 0.1
    ) {
      const sU0 = safeTopY(bu0, 0.5) - 0.03 >= bay.spandrelShelfY ? bu0 : buMid - bw * 0.15;
      const sU1 = safeTopY(bu1, 0.5) - 0.03 >= bay.spandrelShelfY ? bu1 : buMid + bw * 0.15;
      if (sU1 - sU0 > 0.18) {
        addOakShelf(
          `${namePrefix}.${bay.id}.spandrelShelf`,
          sU0,
          sU1,
          bay.spandrelShelfY,
          0.88,
          true
        );
      }
    }

    if (bay.preset === 'doubleHang') {
      const topShelfY = Math.min(bayFloor + clearH - 0.34, bayFloor + 1.92);
      if (topShelfY > bayFloor + 1.38) {
        addOakShelf(`${namePrefix}.${bay.id}.topLuggageShelf`, bu0, bu1, topShelfY, 0.9, true);
        const boxSpace = minCeilY - topShelfY;
        if (boxSpace >= 0.18) {
          const bh = Math.min(0.22, boxSpace - 0.04);
          if (bw >= 0.75) {
            addWovenStorageBasket(
              `${namePrefix}.${bay.id}.luggageBoxL`,
              buMid - bw * 0.24,
              topShelfY,
              bw * 0.4,
              bh,
              true
            );
            addWovenStorageBasket(
              `${namePrefix}.${bay.id}.rattanBasketR`,
              buMid + bw * 0.24,
              topShelfY,
              bw * 0.4,
              bh,
              false
            );
          } else {
            addWovenStorageBasket(
              `${namePrefix}.${bay.id}.luggageBox`,
              buMid,
              topShelfY,
              bw * 0.72,
              bh,
              true
            );
          }
        }
      }

      const effectiveTop = topShelfY > bayFloor + 1.38 ? topShelfY - 0.02 : bayFloor + clearH;
      const midShelfY = bayFloor + (effectiveTop - bayFloor) * 0.53;
      addOakShelf(`${namePrefix}.${bay.id}.midDividerShelf`, bu0, bu1, midShelfY, 0.88, true);

      const upperRailY = effectiveTop - 0.065;
      const upperGarmentLen = Math.min(0.76, Math.max(0.42, upperRailY - midShelfY - 0.1));
      addHangingRailWithGarments(
        `${namePrefix}.${bay.id}.upperRail`,
        bu0,
        bu1,
        upperRailY,
        upperGarmentLen,
        bayIdx * 3
      );

      const lowerRailY = midShelfY - 0.075;
      const shoeClear = 0.23;
      const lowerGarmentLen = Math.min(0.68, Math.max(0.36, lowerRailY - (bayFloor + shoeClear) - 0.06));
      addHangingRailWithGarments(
        `${namePrefix}.${bay.id}.lowerRail`,
        bu0,
        bu1,
        lowerRailY,
        lowerGarmentLen,
        bayIdx * 3 + 2
      );

      addSlattedShoeRackAndFootwear(
        `${namePrefix}.${bay.id}.shoeRack`,
        bu0,
        bu1,
        bayFloor + 0.018,
        bayIdx
      );
    } else if (bay.preset === 'longHangAndDrawers') {
      const topShelfY = Math.min(bayFloor + clearH - 0.3, bayFloor + 1.9);
      const hasTopShelf = topShelfY > bayFloor + 1.25;
      if (hasTopShelf) {
        addOakShelf(`${namePrefix}.${bay.id}.topHatShelf`, bu0, bu1, topShelfY, 0.9, true);
        const boxSpace = minCeilY - topShelfY;
        if (boxSpace >= 0.16) {
          const bh = Math.min(0.2, boxSpace - 0.04);
          addWovenStorageBasket(
            `${namePrefix}.${bay.id}.hatBoxL`,
            buMid - bw * 0.23,
            topShelfY,
            Math.min(0.36, bw * 0.38),
            bh,
            true
          );
          addWovenStorageBasket(
            `${namePrefix}.${bay.id}.rattanBoxR`,
            buMid + bw * 0.23,
            topShelfY,
            Math.min(0.36, bw * 0.38),
            bh,
            false
          );
        }
      }

      const subBotY = bayFloor + 0.018;
      const subTopY = hasTopShelf ? topShelfY - 0.018 : bayFloor + clearH - 0.02;
      const uSplit = bu0 + bw * 0.54;
      // Vertical 18mm internal oak divider resting cleanly on top of oakDeck
      placeBox(
        `${namePrefix}.${bay.id}.subDivider`,
        uSplit,
        (subBotY + subTopY) * 0.5,
        vInnerCenter,
        0.018,
        Math.max(0.4, subTopY - subBotY),
        innerDepth * 0.9,
        oakMat
      );

      // Left half: full-length coat & dress rail + leather boots below
      const longRailY = subTopY - 0.065;
      const coatLen = Math.min(1.24, Math.max(0.62, longRailY - bayFloor - 0.28));
      addHangingRailWithGarments(
        `${namePrefix}.${bay.id}.longCoatRail`,
        bu0,
        uSplit - 0.01,
        longRailY,
        coatLen,
        bayIdx * 5 + 1
      );
      addSlattedShoeRackAndFootwear(
        `${namePrefix}.${bay.id}.bootRack`,
        bu0,
        uSplit - 0.01,
        bayFloor + 0.018,
        bayIdx + 1
      );

      // Right half: stack of 3 dovetailed internal oak Shaker drawers + folded cashmere above
      const drawerStackTop = addInternalOakDrawerStack(
        `${namePrefix}.${bay.id}.drawers`,
        uSplit + 0.01,
        bu1,
        bayFloor + 0.018,
        3,
        Math.min(0.22, Math.max(0.16, (subTopY - bayFloor) * 0.14)),
        Boolean(bay.registerHeroDrawer),
        bayIdx
      );

      if (subTopY - drawerStackTop > 0.36) {
        const midCubbyY = (drawerStackTop + subTopY) * 0.5;
        addOakShelf(
          `${namePrefix}.${bay.id}.upperCubbyShelf`,
          uSplit + 0.01,
          bu1,
          midCubbyY,
          0.88,
          true
        );
        addFoldedLinenStack(
          `${namePrefix}.${bay.id}.cashmereLow`,
          (uSplit + 0.01 + bu1) * 0.5,
          drawerStackTop,
          vInnerCenter,
          (bu1 - uSplit) * 0.76,
          3,
          bayIdx + 2
        );
        addFoldedLinenStack(
          `${namePrefix}.${bay.id}.cashmereHigh`,
          (uSplit + 0.01 + bu1) * 0.5,
          midCubbyY,
          vInnerCenter,
          (bu1 - uSplit) * 0.76,
          3,
          bayIdx + 4
        );
      } else if (subTopY - drawerStackTop > 0.15) {
        addFoldedLinenStack(
          `${namePrefix}.${bay.id}.cashmereStack`,
          (uSplit + 0.01 + bu1) * 0.5,
          drawerStackTop,
          vInnerCenter,
          (bu1 - uSplit) * 0.76,
          3,
          bayIdx + 2
        );
      }
    } else if (bay.preset === 'rakedShelvesAndDrawers') {
      const drawerCount = clearH >= 0.95 ? 3 : 2;
      const drawerH = Math.min(0.2, Math.max(0.15, clearH * 0.15));
      const drawerTopY = addInternalOakDrawerStack(
        `${namePrefix}.${bay.id}.drawers`,
        bu0,
        bu1,
        bayFloor + 0.018,
        drawerCount,
        drawerH,
        Boolean(bay.registerHeroDrawer),
        bayIdx + 3
      );

      // Determine which side of the bay is taller under the raked ceiling
      const ceilL = Math.min(safeTopY(bu0, 0.1), safeTopY(bu0, 0.9)) - 0.03;
      const ceilR = Math.min(safeTopY(bu1, 0.1), safeTopY(bu1, 0.9)) - 0.03;
      const tallOnRight = ceilR >= ceilL;

      if (bay.includeShirtRail && bw >= 0.85 && Math.max(ceilL, ceilR) - drawerTopY >= 0.82) {
        // Split upper zone: short shirt rail on the taller half + tiered raked oak shelves on the eaves half
        const uSplit = bu0 + bw * 0.5;
        const railU0 = tallOnRight ? uSplit + 0.01 : bu0;
        const railU1 = tallOnRight ? bu1 : uSplit - 0.01;
        const shelfU0 = tallOnRight ? bu0 : uSplit + 0.01;
        const shelfU1 = tallOnRight ? uSplit - 0.01 : bu1;
        const splitCeil = Math.min(safeTopY(uSplit, 0.1), safeTopY(uSplit, 0.9)) - 0.035;

        placeBox(
          `${namePrefix}.${bay.id}.upperDivider`,
          uSplit,
          (drawerTopY + splitCeil) * 0.5,
          vInnerCenter,
          0.018,
          Math.max(0.25, splitCeil - drawerTopY),
          innerDepth * 0.88,
          oakMat
        );

        const railCeil = Math.min(
          safeTopY(railU0, 0.2),
          safeTopY(railU1, 0.2),
          safeTopY(railU0, 0.85),
          safeTopY(railU1, 0.85)
        ) - 0.04;
        const shirtRailY = railCeil - 0.06;
        if (shirtRailY - drawerTopY > 0.45) {
          addHangingRailWithGarments(
            `${namePrefix}.${bay.id}.shirtRail`,
            railU0,
            railU1,
            shirtRailY,
            Math.min(0.72, shirtRailY - drawerTopY - 0.08),
            bayIdx + 4
          );
        }

        const eavesMinCeil = Math.min(
          safeTopY(shelfU0, 0.1),
          safeTopY(shelfU1, 0.1),
          safeTopY(shelfU0, 0.9),
          safeTopY(shelfU1, 0.9)
        ) - 0.03;
        addFoldedLinenStack(
          `${namePrefix}.${bay.id}.eavesLinensLow`,
          (shelfU0 + shelfU1) * 0.5,
          drawerTopY,
          vInnerCenter,
          (shelfU1 - shelfU0) * 0.74,
          3,
          bayIdx + 1
        );
        if (eavesMinCeil - drawerTopY > 0.34) {
          const s1Y = drawerTopY + Math.min(0.34, (eavesMinCeil - drawerTopY) * 0.55);
          addOakShelf(`${namePrefix}.${bay.id}.rakedShelf_1`, shelfU0, shelfU1, s1Y, 0.88, true);
          if (eavesMinCeil - s1Y >= 0.16) {
            addWovenStorageBasket(
              `${namePrefix}.${bay.id}.eavesBasket`,
              (shelfU0 + shelfU1) * 0.5,
              s1Y,
              (shelfU1 - shelfU0) * 0.72,
              Math.min(0.18, eavesMinCeil - s1Y - 0.03),
              false
            );
          }
        }
      } else {
        // Tiered solid-oak cubby shelves scribed cleanly to the raked ceiling slope
        const upperSpan = Math.max(ceilL, ceilR) - drawerTopY;
        const tiers = upperSpan >= 0.95 ? 3 : upperSpan >= 0.55 ? 2 : 1;
        // Deck items on top of the drawer unit
        if (bw >= 0.72) {
          addFoldedLinenStack(
            `${namePrefix}.${bay.id}.deckKnitL`,
            buMid - bw * 0.23,
            drawerTopY,
            vInnerCenter,
            bw * 0.36,
            3,
            bayIdx
          );
          addWovenStorageBasket(
            `${namePrefix}.${bay.id}.deckBasketR`,
            buMid + bw * 0.23,
            drawerTopY,
            bw * 0.36,
            0.16,
            false
          );
        } else {
          addFoldedLinenStack(
            `${namePrefix}.${bay.id}.deckKnit`,
            buMid,
            drawerTopY,
            vInnerCenter,
            bw * 0.68,
            3,
            bayIdx
          );
        }

        for (let t = 1; t <= tiers; t++) {
          const sy = drawerTopY + t * Math.min(0.34, upperSpan / (tiers + 0.55));
          // Scribe shelf horizontal span `[su0, su1]` so both ends stay >= 32mm below ceiling
          let su0 = bu0;
          let su1 = bu1;
          for (let step = 0; step <= 12; step++) {
            const testU = bu0 + (bw * step) / 12;
            const cHere = Math.min(safeTopY(testU, 0.1), safeTopY(testU, 0.9)) - 0.032;
            if (cHere < sy + 0.024) {
              if (tallOnRight) {
                su0 = Math.max(su0, testU + bw / 12);
              } else {
                su1 = Math.min(su1, testU - bw / 12);
              }
            }
          }
          if (su1 - su0 >= 0.22) {
            addOakShelf(
              `${namePrefix}.${bay.id}.rakedShelf_${t}`,
              su0,
              su1,
              sy,
              0.88,
              true
            );
            const nextCeil = Math.min(
              safeTopY((su0 + su1) * 0.5, 0.15),
              safeTopY((su0 + su1) * 0.5, 0.85)
            ) - 0.035;
            if (nextCeil - sy >= 0.16) {
              if (t % 2 === 1) {
                addWovenStorageBasket(
                  `${namePrefix}.${bay.id}.shelfBasket_${t}`,
                  (su0 + su1) * 0.5,
                  sy,
                  Math.min(0.34, (su1 - su0) * 0.68),
                  Math.min(0.17, nextCeil - sy - 0.03),
                  t > 1
                );
              } else {
                addFoldedLinenStack(
                  `${namePrefix}.${bay.id}.shelfKnit_${t}`,
                  (su0 + su1) * 0.5,
                  sy,
                  vInnerCenter,
                  Math.min(0.32, (su1 - su0) * 0.68),
                  3,
                  bayIdx + t
                );
              }
            }
          }
        }
      }
    } else if (bay.preset === 'counterTopCupboard') {
      // Counter-top cupboard (Main Bedroom door_8 above the window seat, Y = 2.978m..4.48m):
      // Solid oak bottom deck + 2 fitted oak shelves scribed below South skeiling, stocked with
      // folded spare guest linens, piped pillows, and a woven rattan basket.
      addWovenStorageBasket(
        `${namePrefix}.${bay.id}.deckBasket`,
        buMid,
        bayFloor + 0.018,
        Math.min(0.36, bw * 0.72),
        0.18,
        false
      );

      const ceilL = Math.min(safeTopY(bu0, 0.1), safeTopY(bu0, 0.9)) - 0.032;
      const ceilR = Math.min(safeTopY(bu1, 0.1), safeTopY(bu1, 0.9)) - 0.032;
      const tallOnRight = ceilR >= ceilL;
      const shelfHeights = [bayFloor + 0.36, bayFloor + 0.72];

      shelfHeights.forEach((sy, idx) => {
        let su0 = bu0;
        let su1 = bu1;
        for (let step = 0; step <= 12; step++) {
          const testU = bu0 + (bw * step) / 12;
          const cHere = Math.min(safeTopY(testU, 0.1), safeTopY(testU, 0.9)) - 0.032;
          if (cHere < sy + 0.024) {
            if (tallOnRight) {
              su0 = Math.max(su0, testU + bw / 12);
            } else {
              su1 = Math.min(su1, testU - bw / 12);
            }
          }
        }
        if (su1 - su0 >= 0.2) {
          addOakShelf(
            `${namePrefix}.${bay.id}.linenShelf_${idx + 1}`,
            su0,
            su1,
            sy,
            0.88,
            true
          );
          const midC = Math.min(
            safeTopY((su0 + su1) * 0.5, 0.15),
            safeTopY((su0 + su1) * 0.5, 0.85)
          ) - 0.035;
          if (midC - sy >= 0.15) {
            addFoldedLinenStack(
              `${namePrefix}.${bay.id}.guestLinens_${idx + 1}`,
              (su0 + su1) * 0.5,
              sy,
              vInnerCenter,
              Math.min(0.34, (su1 - su0) * 0.72),
              idx === 0 ? 3 : 2,
              5 + idx
            );
          }
        }
      });
    } else if (bay.preset === 'threeDrawerChestAndLinen') {
      // Exact 3 × 255mm (+65..+860mm above roomFloorY) solid-oak drawers with horizontal brass bar pulls,
      // interactive top drawer, +860mm solid-oak counter deck, and woven linen/knitwear basket(s) above!
      const stackStartY = bayFloor + 0.018;
      const targetDeckY = roomFloorY + 0.86;
      const drawerPitch = Math.max(0.22, (targetDeckY - 0.012 - stackStartY) / 3); // ~0.255m
      const drawerTopY = addInternalOakDrawerStack(
        `${namePrefix}.${bay.id}.drawers`,
        bu0,
        bu1,
        stackStartY,
        3,
        drawerPitch,
        Boolean(bay.registerHeroDrawer ?? true),
        bayIdx + 2,
        false
      );

      const ceilL = Math.min(safeTopY(bu0, 0.1), safeTopY(bu0, 0.9)) - 0.032;
      const ceilR = Math.min(safeTopY(bu1, 0.1), safeTopY(bu1, 0.9)) - 0.032;
      const tallOnRight = ceilR >= ceilL;
      const deckClear = Math.min(
        safeTopY(buMid, 0.15),
        safeTopY(buMid, 0.85)
      ) - 0.035 - drawerTopY;

      if (deckClear >= 0.16) {
        const basketH = Math.min(0.18, deckClear - 0.02);
        if (bw >= 0.76) {
          addWovenStorageBasket(
            `${namePrefix}.${bay.id}.linenBasketL`,
            buMid - bw * 0.23,
            drawerTopY,
            bw * 0.38,
            basketH,
            false
          );
          addWovenStorageBasket(
            `${namePrefix}.${bay.id}.linenBasketR`,
            buMid + bw * 0.23,
            drawerTopY,
            bw * 0.38,
            basketH,
            true
          );
        } else {
          addWovenStorageBasket(
            `${namePrefix}.${bay.id}.linenBasket`,
            buMid,
            drawerTopY,
            Math.min(0.38, bw * 0.72),
            basketH,
            false
          );
        }
      }

      const upperSpan = Math.max(ceilL, ceilR) - drawerTopY;
      const tiers = upperSpan >= 0.92 ? 2 : upperSpan >= 0.52 ? 1 : 0;
      for (let t = 1; t <= tiers; t++) {
        const sy = drawerTopY + t * Math.min(0.38, upperSpan / (tiers + 0.65));
        let su0 = bu0;
        let su1 = bu1;
        for (let step = 0; step <= 12; step++) {
          const testU = bu0 + (bw * step) / 12;
          const cHere = Math.min(safeTopY(testU, 0.1), safeTopY(testU, 0.9)) - 0.032;
          if (cHere < sy + 0.024) {
            if (tallOnRight) {
              su0 = Math.max(su0, testU + bw / 12);
            } else {
              su1 = Math.min(su1, testU - bw / 12);
            }
          }
        }
        if (su1 - su0 >= 0.22) {
          addOakShelf(
            `${namePrefix}.${bay.id}.linenShelf_${t}`,
            su0,
            su1,
            sy,
            0.88,
            true
          );
          const nextCeil = Math.min(
            safeTopY((su0 + su1) * 0.5, 0.15),
            safeTopY((su0 + su1) * 0.5, 0.85)
          ) - 0.035;
          if (nextCeil - sy >= 0.15) {
            addFoldedLinenStack(
              `${namePrefix}.${bay.id}.foldedKnit_${t}`,
              (su0 + su1) * 0.5,
              sy,
              vInnerCenter,
              Math.min(0.34, (su1 - su0) * 0.7),
              3,
              bayIdx + t
            );
          }
        }
      }
    } else if (bay.preset === 'singleHangAndTwoShoeRacks') {
      // Optional internal pass-through solid-oak luggage shelves (e.g. +1,820mm in Bed 2/3, +1,850/+2,350mm in Bed 4, +1,580mm in Stable)
      const luggageHeights = bay.luggageShelfHeights ?? [];
      luggageHeights.forEach((relH, sIdx) => {
        const sy = roomFloorY + relH;
        const shelfU0 = sIdx === 0 && bay.luggagePassThroughLeftU !== undefined ? bay.luggagePassThroughLeftU : bu0;
        const shelfU1 = sIdx === 0 && bay.luggagePassThroughRightU !== undefined ? bay.luggagePassThroughRightU : bu1;
        const shelfCeilMax = Math.max(minCeilY, safeTopY((shelfU0 + shelfU1) * 0.5, 0.5) - 0.022);
        if (sy > bayFloor + 1.15 && sy < shelfCeilMax - 0.10) {
          addOakShelf(
            `${namePrefix}.${bay.id}.luggageShelf_${sIdx + 1}`,
            shelfU0,
            shelfU1,
            sy,
            0.9,
            true
          );
          const nextY =
            sIdx + 1 < luggageHeights.length
              ? Math.min(minCeilY, roomFloorY + luggageHeights[sIdx + 1]!)
              : minCeilY;
          const clearAbove = nextY - sy;
          if (clearAbove >= 0.16) {
            const boxH = Math.min(0.22, clearAbove - 0.035);
            if (bw >= 0.9) {
              addWovenStorageBasket(
                `${namePrefix}.${bay.id}.luggageBox_${sIdx + 1}_L`,
                buMid - bw * 0.25,
                sy,
                Math.min(0.44, bw * 0.4),
                boxH,
                sIdx % 2 === 0
              );
              addWovenStorageBasket(
                `${namePrefix}.${bay.id}.luggageBox_${sIdx + 1}_R`,
                buMid + bw * 0.25,
                sy,
                Math.min(0.44, bw * 0.4),
                boxH,
                sIdx % 2 === 1
              );
            } else {
              addWovenStorageBasket(
                `${namePrefix}.${bay.id}.luggageBox_${sIdx + 1}`,
                buMid,
                sy,
                Math.min(0.42, bw * 0.72),
                boxH,
                sIdx % 2 === 0
              );
            }
          }
        }
      });

      // +1,680mm single-rail full-drop brushed-brass hanging rail (scribes safely below sloped roofs if needed)
      const desiredRailY = roomFloorY + (bay.desiredHangingRailRelY ?? 1.68);
      const railCeilLimit = minCeilY - 0.065;
      const railY = Math.min(desiredRailY, railCeilLimit);
      const garmentLen = Math.min(1.16, Math.max(0.68, railY - (roomFloorY + 0.34) - 0.08));
      addHangingRailWithGarments(
        `${namePrefix}.${bay.id}.singleHangingRail`,
        bu0,
        bu1,
        railY,
        garmentLen,
        bayIdx * 3 + 1
      );

      // 2 rows of solid-oak shoe racks (+75mm & +235mm above roomFloorY)
      addTwoRowOakShoeRacks(`${namePrefix}.${bay.id}.shoeRacks`, bu0, bu1, bayIdx);
    } else if (bay.preset === 'openRakedShelvesOverThreeDrawers') {
      // Full-depth, full-height 18mm quarter-sawn oak interior side carcass panel lining the wall side of every end bay
      // right behind the >=45mm painted Shaker wall-scribe filler stile (0 bare plaster wall, 0 step behind filler stile!)
      if (bayIdx === 0 || bayIdx === bays.length - 1) {
        const isLeftEnd = bayIdx === 0;
        const endGap = isLeftEnd ? bay.uMin - uMin : uMax - bay.uMax;
        const minWallOffset = endGap <= panelT + 0.002 ? extSkinT + 0.0005 : panelT;
        const uInnerFace = isLeftEnd ? bay.uMin : bay.uMax;
        const uOuterFace = isLeftEnd
          ? Math.max(uMin + minWallOffset, bay.uMin - panelT)
          : Math.min(uMax - minWallOffset, bay.uMax + panelT);
        const wallCheekT = Math.max(0.004, Math.abs(uOuterFace - uInnerFace));
        const cheekUCenter = (uInnerFace + uOuterFace) * 0.5;
        const oakFrontInset = panelT + 0.008;
        const vSamples = 6;
        const wallCheekPts: [number, number][] = [
          [frontCoord - openSign * oakFrontInset, carcassBaseY + 0.004],
          [backCoord + openSign * panelT, carcassBaseY + 0.004],
        ];
        for (let st = vSamples; st >= 0; st--) {
          const df = st / vSamples;
          const v =
            frontCoord -
            openSign * oakFrontInset -
            openSign * Math.max(0.05, depth - oakFrontInset - panelT) * df;
          const realDf = Math.abs(v - frontCoord) / depth;
          const topHere = Math.min(safeTopY(uInnerFace, realDf), safeTopY(uOuterFace, realDf)) - 0.018;
          wallCheekPts.push([v, topHere]);
        }
        root.add(
          buildProfileExtrudedPanel(
            `${namePrefix}.${bay.id}.wallSideOakCarcassPanel`,
            wallCheekPts,
            wallCheekT,
            'vSpan',
            alongU,
            cheekUCenter,
            oakMat,
            false
          )
        );
      }

      // Flush painted In-Frame Shaker 3-drawer chest (`160mm` H brass pulls) + open scribed quarter-sawn oak `2700K` LED shelving!
      const stackStartY = bayFloor + 0.004;
      const targetDeckY = roomFloorY + (bay.chestTopRelY ?? 0.86);
      const drawerPitch = Math.max(0.18, (targetDeckY - 0.012 - stackStartY) / 3);
      addInternalOakDrawerStack(
        `${namePrefix}.${bay.id}.flushChestDrawers`,
        bu0,
        bu1,
        stackStartY,
        3,
        drawerPitch,
        Boolean(bay.registerHeroDrawer ?? true),
        bayIdx + 4,
        true
      );

      const alcoveCapY =
        bay.openAlcoveMaxRelY !== undefined ? roomFloorY + bay.openAlcoveMaxRelY : Infinity;
      const effectiveCeilAt = (uVal: number): number =>
        Math.min(
          alcoveCapY,
          getDoorTopY(uVal) - 0.022,
          safeTopY(uVal, 0.04) - 0.026,
          safeTopY(uVal, 0.96) - 0.026
        );

      if (bay.openAlcoveMaxRelY !== undefined) {
        addOakShelf(
          `${namePrefix}.${bay.id}.openAlcoveTopSoffit`,
          bu0,
          bu1,
          roomFloorY + bay.openAlcoveMaxRelY,
          0.98,
          true
        );
      }

      const ceilL = effectiveCeilAt(bu0);
      const ceilR = effectiveCeilAt(bu1);
      const tallOnRight = ceilR >= ceilL;

      const openShelfRelHeights = bay.openShelfRelHeights ?? [1.27, 1.68];
      const shelfBases = [targetDeckY, ...openShelfRelHeights.map((h) => roomFloorY + h)];

      openShelfRelHeights.forEach((relH, idx) => {
        const sy = roomFloorY + relH;
        let su0 = bu0;
        let su1 = bu1;
        for (let step = 0; step <= 48; step++) {
          const testU = bu0 + (bw * step) / 48;
          const cHere = effectiveCeilAt(testU);
          if (cHere < sy + 0.024) {
            if (tallOnRight) {
              su0 = Math.max(su0, testU + bw / 48);
            } else {
              su1 = Math.min(su1, testU - bw / 48);
            }
          }
        }
        if (su1 - su0 >= 0.16) {
          addOakShelf(
            `${namePrefix}.${bay.id}.openOakShelf_${idx + 1}`,
            su0,
            su1,
            sy,
            0.96,
            true
          );
        }
      });

      // Curated cloth-bound books & stoneware ceramic vessels on +860mm deck & +1,270 / +1,680mm open oak shelves
      const ceramicMat = new THREE.MeshStandardMaterial({
        color: 0xd9d0c1,
        roughness: 0.72,
        metalness: 0.02,
      });
      shelfBases.forEach((baseY, sIdx) => {
        let su0 = bu0 + 0.03;
        let su1 = bu1 - 0.03;
        for (let step = 0; step <= 12; step++) {
          const testU = bu0 + (bw * step) / 12;
          const cHere = effectiveCeilAt(testU) - 0.012;
          if (cHere < baseY + 0.22) {
            if (tallOnRight) {
              su0 = Math.max(su0, testU + bw / 12);
            } else {
              su1 = Math.min(su1, testU - bw / 12);
            }
          }
        }
        if (su1 - su0 < 0.2) return;
        const bookCount = Math.min(5, Math.max(3, Math.floor((su1 - su0) / 0.085)));
        const bookStartU = tallOnRight ? su1 - 0.05 : su0 + 0.05;
        const dir = tallOnRight ? -1 : 1;
        for (let b = 0; b < bookCount; b++) {
          const bh = 0.18 + ((b + sIdx) % 3) * 0.022;
          const bu = bookStartU + dir * b * 0.036;
          placeBox(
            `${namePrefix}.${bay.id}.openBook_${sIdx + 1}_${b + 1}`,
            bu,
            baseY + bh * 0.5,
            vInnerFront - openSign * 0.14,
            0.031,
            bh,
            0.17,
            palette.garmentMats[(b + sIdx * 2) % palette.garmentMats.length]!
          );
        }
        if (sIdx < 2 && su1 - su0 >= 0.34) {
          const vu = bookStartU + dir * (bookCount * 0.036 + 0.09);
          const vessel = new THREE.Mesh(
            sharedCylinderGeometry(0.038, 0.048, 0.14, 14),
            ceramicMat
          );
          vessel.name = `${namePrefix}.${bay.id}.ceramicVessel_${sIdx + 1}`;
          vessel.position.set(
            alongU ? vu : vInnerFront - openSign * 0.15,
            baseY + 0.07,
            alongU ? vInnerFront - openSign * 0.15 : vu
          );
          vessel.castShadow = true;
          root.add(vessel);
        }
      });
    }
  });

  return root;
}
