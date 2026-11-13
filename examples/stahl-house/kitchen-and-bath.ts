import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import { attachAssetInteraction, attachAssetMetadata, prepGeo, tagCollisionRole, tagCutaway } from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import { buildFloorToCeilingSlidingWardrobe } from './mcm-bedrooms.ts';
import { registerSeat } from './mcm-furniture.ts';
import type { McmMaterials } from './mcm-materials.ts';
import {
  addCushionTuftButtons,
  bevelledBox,
  buildCurvedFaucetGeo,
  buildSculptedBasinGeo,
  buildTuftedCushionGeo,
} from './sculpted-geometry.ts';

const TILE_4X4 = 0.816; // 8x8 tile 1024x1024 PBR map -> exact 102 mm (4"x4") glazed ceramic tiles

function addPart(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadow = false
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (shadow) m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

function buildTubeGeo(
  pts: readonly (readonly [number, number, number])[],
  tubularSegments = 32,
  radius = 0.0085,
  radialSegments = 16
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/** Smooth curved `TubeGeometry` (`32 x 16`) appliance/towel grab handle oriented along X or Y, projecting +Z. */
function buildCurvedGrabHandleGeo(span: number, standOff = 0.036, vertical = false, radius = 0.0085): THREE.BufferGeometry {
  const h = span * 0.5;
  const b = Math.min(0.042, span * 0.14);
  const pts: (readonly [number, number, number])[] = vertical
    ? [[0, -h, 0], [0, -h + b * 0.35, standOff * 0.78], [0, -h + b, standOff], [0, h - b, standOff], [0, h - b * 0.35, standOff * 0.78], [0, h, 0]]
    : [[-h, 0, 0], [-h + b * 0.35, 0, standOff * 0.78], [-h + b, 0, standOff], [h - b, 0, standOff], [h - b * 0.35, 0, standOff * 0.78], [h, 0, 0]];
  return buildTubeGeo(pts, 32, radius, 16);
}

/** `44`-seg `LatheGeometry` stoneware canister or kettle body. Origin at base `y = 0`. */
function buildStonewareVesselGeo(rBase: number, rBelly: number, rNeck: number, height: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(rBase * 0.9, 0)];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const r = rBase * (1 - t) + rNeck * t + (rBelly - (rBase + rNeck) * 0.5) * Math.sin(t * Math.PI * 0.92);
    pts.push(new THREE.Vector2(Math.max(0.008, r), t * height));
  }
  pts.push(new THREE.Vector2(rNeck * 0.86, height), new THREE.Vector2(0, height * 0.94));
  const geo = new THREE.LatheGeometry(pts, 44);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Frames a counter slab around twin rectangular sink cutouts using 5 non-overlapping
 * `bevelledBox` surround pieces (`>= 1.0 mm` seam clearances, zero z-fighting, open basin wells).
 */
function addTwinCutoutCounter(
  parent: THREE.Object3D,
  mat: THREE.Material,
  opts: {
    readonly axis: 'x' | 'z';
    readonly xMin: number;
    readonly xMax: number;
    readonly zMin: number;
    readonly zMax: number;
    readonly yMid: number;
    readonly thickness: number;
    readonly holeA: readonly [number, number];
    readonly holeB: readonly [number, number];
    readonly hx: number;
    readonly hz: number;
  }
): void {
  const { axis, xMin, xMax, zMin, zMax, yMid, thickness, holeA, holeB, hx, hz } = opts;
  const g = 0.001;
  const put = (xa: number, xb: number, za: number, zb: number) => {
    if (xb - xa > 0.004 && zb - za > 0.004) {
      addPart(parent, bevelledBox(xb - xa, thickness, zb - za, 0.005, 4, 0.95, 0.95), mat, (xa + xb) * 0.5, yMid, (za + zb) * 0.5, true);
    }
  };
  if (axis === 'x') {
    const c1 = Math.min(holeA[0], holeB[0]);
    const c2 = Math.max(holeA[0], holeB[0]);
    const cz = holeA[1];
    put(xMin, c1 - hx - g, zMin, zMax);
    put(c2 + hx + g, xMax, zMin, zMax);
    put(c1 + hx + g, c2 - hx - g, cz - hz + g, cz + hz - g);
    put(c1 - hx, c2 + hx, zMin, cz - hz - g);
    put(c1 - hx, c2 + hx, cz + hz + g, zMax);
  } else {
    const c1 = Math.min(holeA[1], holeB[1]);
    const c2 = Math.max(holeA[1], holeB[1]);
    const cx = holeA[0];
    put(xMin, xMax, zMin, c1 - hz - g);
    put(xMin, xMax, c2 + hz + g, zMax);
    put(cx - hx + g, cx + hx - g, c1 + hz + g, c2 - hz - g);
    put(xMin, cx - hx - g, c1 - hz, c2 + hz);
    put(cx + hx + g, xMax, c1 - hz, c2 + hz);
  }
}

function addStubbyFloatingLegs(
  parent: THREE.Object3D,
  xs: readonly number[],
  zs: readonly number[],
  legH: number,
  mcm: McmMaterials
): void {
  const shaftH = legH - 0.018;
  const legGeo = prepGeo(new THREE.CylinderGeometry(0.015, 0.0125, shaftH, 24));
  const collarGeo = prepGeo(new THREE.CylinderGeometry(0.023, 0.019, 0.004, 24));
  const footGeo = prepGeo(new THREE.CylinderGeometry(0.021, 0.023, 0.008, 24));
  for (const x of xs) {
    for (const z of zs) {
      addPart(parent, footGeo, mcm.dieCastAlum, x, 0.0045, z);
      addPart(parent, legGeo, mcm.blackenedSteel, x, 0.0095 + shaftH * 0.5, z);
      addPart(parent, collarGeo, mcm.dieCastAlum, x, legH - 0.003, z);
    }
  }
}

function addKnurledKnob(parent: THREE.Object3D, mcm: McmMaterials, x: number, y: number, z: number, faceAxis: 'y' | 'z'): void {
  const bezel = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.019, 0.021, 0.004, 28)), mcm.polishedChrome);
  const dial = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.0145, 0.0165, 0.015, 28)), mcm.formicaCharcoal);
  const cap = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.011, 0.011, 0.002, 28)), mcm.brushedStainless);
  if (faceAxis === 'z') {
    bezel.rotation.x = dial.rotation.x = cap.rotation.x = Math.PI * 0.5;
    bezel.position.set(x, y, z + 0.0025);
    dial.position.set(x, y, z + 0.0125);
    cap.position.set(x, y, z + 0.0215);
  } else {
    bezel.position.set(x, y + 0.0025, z);
    dial.position.set(x, y + 0.0125, z);
    cap.position.set(x, y + 0.0215, z);
  }
  parent.add(bezel, dial, cap);
}

/** Arcware walnut door/drawer row with radiused stiles & recessed brushed-aluminum finger-pull channels (`>= 1 mm` clear). */
function addArcwareWalnutBayFronts(
  parent: THREE.Object3D,
  mcm: McmMaterials,
  width: number,
  yBot: number,
  yTop: number,
  zFace: number,
  bays: number,
  signZ: 1 | -1 = 1
): void {
  const h = yTop - yBot;
  const railH = 0.02;
  addPart(parent, bevelledBox(width, railH, 0.022, 0.003, 4), mcm.dieCastAlum, 0, yBot + railH * 0.5, zFace);
  addPart(parent, bevelledBox(width, railH, 0.022, 0.003, 4), mcm.dieCastAlum, 0, yTop - railH * 0.5, zFace);

  const stileW = 0.02;
  const innerSpan = width - stileW;
  const pitch = innerSpan / bays;
  const innerH = h - railH * 2 - 0.003;
  const stileGeo = bevelledBox(stileW, innerH, 0.02, 0.005, 4, 0.6, 0.6);
  for (let i = 0; i <= bays; i++) {
    addPart(parent, stileGeo, mcm.walnut, -innerSpan * 0.5 + pitch * i, (yBot + yTop) * 0.5, zFace);
  }

  const bayW = pitch - stileW - 0.003;
  const pullH = 0.03;
  const doorH = innerH - pullH - 0.003;
  const doorGeo = bevelledBox(bayW, doorH, 0.018, 0.004, 4, 0.85, 0.85);
  const pullGeo = bevelledBox(bayW, pullH, 0.013, 0.0025, 3);
  for (let i = 0; i < bays; i++) {
    const cx = -innerSpan * 0.5 + pitch * (i + 0.5);
    addPart(parent, doorGeo, mcm.walnut, cx, yBot + railH + 0.0015 + doorH * 0.5, zFace + signZ * 0.001, true);
    addPart(parent, pullGeo, mcm.dieCastAlum, cx, yTop - railH - 0.0015 - pullH * 0.5, zFace - signZ * 0.005);
  }
}

export function buildStahlKitchenBay(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials
): THREE.Group {
  const kitchen = new THREE.Group();
  kitchen.name = 'stahl.kitchen.joinery';
  kitchen.position.y = 0.0008;

  const legH = 0.16;
  const colH = 2.02;
  const colD = 0.64;

  // Integrated brushed-stainless refrigerator/freezer column
  const fridgeCol = new THREE.Group();
  fridgeCol.name = 'stahl.kitchen.fridgeAppliance';
  fridgeCol.position.set(1.22, 0, -5.54);
  addStubbyFloatingLegs(fridgeCol, [-0.38, 0.38], [-0.26, 0.26], legH, mcm);
  addPart(fridgeCol, bevelledBox(0.88, colH, colD - 0.044, 0.005, 4, 0.9, 0.9), mcm.walnut, 0, legH + colH * 0.5, -0.022, true);
  addPart(fridgeCol, bevelledBox(0.886, 0.018, colD, 0.003, 4), mcm.dieCastAlum, 0, legH + colH + 0.01, 0);
  addPart(fridgeCol, bevelledBox(0.884, 0.016, 0.022, 0.003, 4), mcm.dieCastAlum, 0, legH + 0.009, 0.289);

  const upperDoorH = 1.24;
  const fridgePivot = new THREE.Group();
  fridgePivot.name = 'stahl.kitchen.fridgeUpperDoor.pivot';
  fridgePivot.position.set(-0.425, legH + 0.75 + upperDoorH * 0.5, 0.294);
  addPart(fridgePivot, bevelledBox(0.85, upperDoorH, 0.028, 0.005, 4, 0.9, 0.9), mcm.brushedStainless, 0.425, 0, 0, true);
  addPart(fridgePivot, buildCurvedGrabHandleGeo(0.46, 0.036, true), mcm.polishedChrome, 0.79, -0.1, 0.014);
  attachAssetInteraction(fridgePivot, {
    kind: 'hinge', id: 'stahl-fridge-door', label: 'Open Integrated Stainless Refrigerator',
    pivotOffset: [0, 0, 0], axis: 'y', openAngle: -1.18, audio: { openPreset: 'doorLatch', volume: 0.48 },
  });

  const freezerDrawer = new THREE.Group();
  freezerDrawer.name = 'stahl.kitchen.freezerDrawer';
  freezerDrawer.position.set(0, legH + 0.382, 0.294);
  addPart(freezerDrawer, bevelledBox(0.85, 0.71, 0.028, 0.005, 4, 0.9, 0.9), mcm.brushedStainless, 0, 0, 0, true);
  addPart(freezerDrawer, buildCurvedGrabHandleGeo(0.5, 0.036, false), mcm.polishedChrome, 0, 0.25, 0.014);
  attachAssetInteraction(freezerDrawer, {
    kind: 'slide', id: 'stahl-freezer-drawer', label: 'Pull Out Stainless Freezer Drawer',
    slideDelta: [0, 0, 0.42], audio: { openPreset: 'drawerSlide', volume: 0.48 },
  });
  fridgeCol.add(fridgePivot, freezerDrawer);
  attachAssetMetadata(fridgeCol, {
    name: 'Revco / General Electric Custom Built-In Brushed-Stainless Refrigerator-Freezer',
    brand: 'Revco Bilt-In', collection: 'Case Study House #22 Appliance Suite (1960)', sku: 'RV-1960-SS-880',
    finish: 'Brushed 304 Stainless Steel, Polished Chrome & Arcware Anodized Trim', category: 'appliance', dimensionsMm: [880, 640, 2180],
  });
  kitchen.add(fridgeCol);

  // Thermador brushed-stainless double wall oven column
  const ovenCol = new THREE.Group();
  ovenCol.name = 'stahl.kitchen.thermadorOvenAppliance';
  ovenCol.position.set(2.08, 0, -5.54);
  addStubbyFloatingLegs(ovenCol, [-0.34, 0.34], [-0.26, 0.26], legH, mcm);
  addPart(ovenCol, bevelledBox(0.8, colH, colD - 0.044, 0.005, 4, 0.9, 0.9), mcm.walnut, 0, legH + colH * 0.5, -0.022, true);
  addPart(ovenCol, bevelledBox(0.806, 0.018, colD, 0.003, 4), mcm.dieCastAlum, 0, legH + colH + 0.01, 0);
  for (const sx of [-0.39, 0.39]) {
    addPart(ovenCol, bevelledBox(0.018, colH - 0.004, 0.02, 0.004, 4, 0.6, 0.6), mcm.walnut, sx, legH + colH * 0.5, 0.288);
  }
  addPart(ovenCol, bevelledBox(0.756, 0.24, 0.018, 0.004, 4, 0.8, 0.8), mcm.walnut, 0, legH + 0.125, 0.29);
  addPart(ovenCol, bevelledBox(0.756, 0.026, 0.013, 0.0025, 3), mcm.dieCastAlum, 0, legH + 0.262, 0.284);
  addPart(ovenCol, bevelledBox(0.756, 0.026, 0.013, 0.0025, 3), mcm.dieCastAlum, 0, legH + colH - 0.33, 0.284);
  addPart(ovenCol, bevelledBox(0.756, 0.31, 0.018, 0.004, 4, 0.8, 0.8), mcm.walnut, 0, legH + colH - 0.158, 0.29);

  const ctrlY = legH + 1.56;
  addPart(ovenCol, bevelledBox(0.758, 0.115, 0.024, 0.004, 4), mcm.brushedStainless, 0, ctrlY, 0.291);
  for (const kx of [-0.27, -0.16, 0.16, 0.27]) addKnurledKnob(ovenCol, mcm, kx, ctrlY, 0.303, 'z');
  const clockRing = addPart(ovenCol, prepGeo(new THREE.CylinderGeometry(0.032, 0.034, 0.008, 32)), mcm.polishedChrome, 0, ctrlY, 0.307);
  const clockFace = addPart(ovenCol, prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.004, 32)), mcm.formicaCharcoal, 0, ctrlY, 0.311);
  clockRing.rotation.x = clockFace.rotation.x = Math.PI * 0.5;
  addPart(ovenCol, bevelledBox(0.758, 0.026, 0.024, 0.003, 4), mcm.brushedStainless, 0, legH + 0.885, 0.291);

  const ovenGrabGeo = buildCurvedGrabHandleGeo(0.62, 0.038, false);
  for (const [tag, oy, label] of [
    ['upper', legH + 0.905, 'Open Thermador Upper Bake Oven'],
    ['lower', legH + 0.285, 'Open Thermador Lower Broil Oven'],
  ] as const) {
    const doorH = 0.58;
    const pivot = new THREE.Group();
    pivot.name = `stahl.kitchen.thermador.${tag}Door.pivot`;
    pivot.position.set(0, oy, 0.293);
    addPart(pivot, bevelledBox(0.758, 0.15, 0.026, 0.004, 4), mcm.brushedStainless, 0, 0.075, 0);
    addPart(pivot, bevelledBox(0.758, 0.16, 0.026, 0.004, 4), mcm.brushedStainless, 0, doorH - 0.08, 0);
    addPart(pivot, bevelledBox(0.125, 0.266, 0.026, 0.004, 4), mcm.brushedStainless, -0.3165, 0.285, 0);
    addPart(pivot, bevelledBox(0.125, 0.266, 0.026, 0.004, 4), mcm.brushedStainless, 0.3165, 0.285, 0);
    addPart(pivot, bevelledBox(0.504, 0.266, 0.014, 0.002, 3), mcm.formicaCharcoal, 0, 0.285, -0.002);
    addPart(pivot, ovenGrabGeo, mcm.polishedChrome, 0, doorH - 0.056, 0.013);
    attachAssetInteraction(pivot, {
      kind: 'hinge', id: `stahl-thermador-oven-${tag}`, label,
      pivotOffset: [0, 0, 0], axis: 'x', openAngle: 1.18, audio: { openPreset: 'ovenDoorLatch', volume: 0.55 },
    });
    ovenCol.add(pivot);
  }
  attachAssetMetadata(ovenCol, {
    name: 'Thermador Masterpiece Bilt-In Brushed-Stainless Double Electric Wall Oven',
    brand: 'Thermador Electrical Mfg. Co. (Los Angeles)', collection: 'Masterpiece Bilt-In Series (1960)', sku: 'TH-WO-242-SS',
    finish: 'Brushed 304 Stainless Steel, Tempered Viewing Glass & Chrome Bar Handles', category: 'appliance', dimensionsMm: [800, 640, 2180],
  });
  kitchen.add(ovenCol);

  // North sink cabinet + twin Lyoncraft stainless sinks + color-blocked Formica sliding upper cabinets
  const northRun = new THREE.Group();
  northRun.name = 'stahl.kitchen.northSinkCabinet';
  const nrW = 2.86;
  const nrD = 0.64;
  const baseBodyH = 0.72;
  northRun.position.set(3.93, 0, -5.54);
  addStubbyFloatingLegs(northRun, [-1.34, 0, 1.34], [-0.26, 0.26], legH, mcm);

  const cDepth = nrD - 0.044;
  addPart(northRun, bevelledBox(0.98, baseBodyH, cDepth, 0.005, 4, 0.9, 0.9), mcm.walnut, -0.94, legH + baseBodyH * 0.5, -0.022, true);
  addPart(northRun, bevelledBox(0.98, baseBodyH, cDepth, 0.005, 4, 0.9, 0.9), mcm.walnut, 0.94, legH + baseBodyH * 0.5, -0.022, true);
  addPart(northRun, bevelledBox(0.896, 0.48, cDepth, 0.004, 4, 0.9, 0.9), mcm.walnut, 0, legH + 0.24, -0.022, true);
  addPart(northRun, bevelledBox(0.896, 0.236, 0.022, 0.003, 3, 0.9, 0.9), mcm.walnut, 0, legH + 0.6, -0.308);
  addArcwareWalnutBayFronts(northRun, mcm, nrW, legH, legH + baseBodyH, 0.29, 4);

  const counterY = legH + baseBodyH + 0.001;
  const counterT = 0.034;
  const sinkSurfY = counterY + counterT;
  addTwinCutoutCounter(northRun, mcm.formicaWhite, {
    axis: 'x', xMin: -nrW * 0.5 - 0.01, xMax: nrW * 0.5 + 0.01, zMin: -nrD * 0.5 - 0.01, zMax: nrD * 0.5 + 0.02,
    yMid: counterY + counterT * 0.5, thickness: counterT, holeA: [-0.225, 0.01], holeB: [0.225, 0.01], hx: 0.153, hz: 0.153,
  });

  const lyonBowlGeo = buildSculptedBasinGeo({ width: 0.44, depth: 0.44, bowlDepth: 0.175, rimWidth: 0.068, radialSegments: 48 });
  const drainFlangeGeo = prepGeo(new THREE.CylinderGeometry(0.044, 0.038, 0.005, 36));
  const drainWellGeo = prepGeo(new THREE.CylinderGeometry(0.028, 0.026, 0.005, 36));
  for (const bx of [-0.225, 0.225]) {
    addPart(northRun, lyonBowlGeo, mcm.brushedStainless, bx, sinkSurfY + 0.0025, 0.01);
    addPart(northRun, drainFlangeGeo, mcm.polishedChrome, bx, sinkSurfY - 0.169, 0.01);
    addPart(northRun, drainWellGeo, mcm.blackenedSteel, bx, sinkSurfY - 0.167, 0.01);
  }

  // Polished-chrome curved gooseneck faucet (`48 x 18`) + `24`-seg lever handles
  const tapGroup = new THREE.Group();
  tapGroup.name = 'stahl.kitchen.lyoncraftTap';
  tapGroup.position.set(0, sinkSurfY + 0.001, -0.235);
  addPart(tapGroup, bevelledBox(0.22, 0.014, 0.056, 0.004, 4), mcm.polishedChrome, 0, 0.007, 0);
  addPart(tapGroup, prepGeo(new THREE.CylinderGeometry(0.017, 0.021, 0.028, 24)), mcm.polishedChrome, 0, 0.026, 0);
  const gooseSpout = addPart(
    tapGroup,
    buildCurvedFaucetGeo({ reach: 0.2, rise: 0.25, style: 'gooseneck', tubularSegments: 48, radialSegments: 18 }),
    mcm.polishedChrome, 0, 0.036, 0
  );
  const spoutYaw = 0.52;
  gooseSpout.rotation.y = spoutYaw;
  const tipX = Math.sin(spoutYaw) * 0.2;
  const tipZ = Math.cos(spoutYaw) * 0.2;
  addPart(tapGroup, prepGeo(new THREE.CylinderGeometry(0.012, 0.011, 0.014, 24)), mcm.polishedChrome, tipX, 0.172, tipZ);

  for (const hx of [-0.078, 0.078]) {
    addPart(tapGroup, prepGeo(new THREE.CylinderGeometry(0.014, 0.017, 0.032, 24)), mcm.polishedChrome, hx, 0.028, 0);
    const wand = addPart(tapGroup, prepGeo(new THREE.CylinderGeometry(0.0045, 0.006, 0.056, 24)), mcm.polishedChrome, hx + Math.sign(hx) * 0.026, 0.043, 0);
    wand.rotation.z = -Math.sign(hx) * 1.38;
  }
  const streamMat = new THREE.MeshPhysicalMaterial({ color: 0xd8f3ff, transparent: true, opacity: 0.62, roughness: 0.05 });
  const waterStream = addPart(tapGroup, prepGeo(new THREE.CylinderGeometry(0.0055, 0.0075, 0.31, 20)), streamMat, tipX, 0.012, tipZ);
  waterStream.visible = false;
  attachAssetInteraction(tapGroup, {
    kind: 'toggle', id: 'stahl-kitchen-sink-tap', label: 'Turn On Lyoncraft Kitchen Sink Faucet',
    activeLabel: 'Turn Off Kitchen Sink Faucet', onToggle: (active) => { waterStream.visible = active; },
    audio: { openPreset: 'switchClick', activeLoopPreset: 'waterTapFlow', volume: 0.45 },
  });
  northRun.add(tapGroup);

  const knifeBlock = addPart(northRun, bevelledBox(0.12, 0.19, 0.17, 0.006, 4, 0.5, 0.5), mcm.walnut, -1.05, sinkSurfY + 0.096, -0.08, true);
  knifeBlock.rotation.x = 0.22;
  for (const [cx, ch, cmat] of [[0.86, 0.165, mcm.stonewareWhite], [1.04, 0.14, mcm.ceramicTeal], [1.21, 0.115, mcm.ceramicTerracotta]] as const) {
    addPart(northRun, buildStonewareVesselGeo(0.052, 0.062, 0.054, ch), cmat, cx, sinkSurfY + 0.001, -0.1, true);
    addPart(northRun, prepGeo(new THREE.CylinderGeometry(0.055, 0.053, 0.014, 44)), mcm.walnut, cx, sinkSurfY + ch + 0.005, -0.1);
    addPart(northRun, prepGeo(new THREE.CylinderGeometry(0.014, 0.011, 0.012, 28)), mcm.walnut, cx, sinkSurfY + ch + 0.018, -0.1);
  }

  // Color-blocked Formica sliding upper cabinets (`Y in [1.44, 2.18]`)
  const upH = 0.74;
  const upD = 0.36;
  const upMidY = 1.44 + upH * 0.5;
  const upZ = -nrD * 0.5 + upD * 0.5;
  addPart(northRun, bevelledBox(nrW, 0.02, upD, 0.004, 4, 0.9, 0.9), mcm.walnut, 0, 1.44 + upH - 0.01, upZ);
  addPart(northRun, bevelledBox(nrW, 0.02, upD, 0.004, 4, 0.9, 0.9), mcm.walnut, 0, 1.44 + 0.01, upZ);
  addPart(northRun, bevelledBox(nrW - 0.044, upH - 0.044, 0.016, 0.003, 3, 0.9, 0.9), mcm.walnut, 0, upMidY, upZ - upD * 0.5 + 0.01);
  addPart(northRun, bevelledBox(nrW - 0.046, 0.016, upD - 0.064, 0.003, 3, 0.9, 0.9), mcm.walnut, 0, upMidY, upZ - 0.014);
  for (const sx of [-1, 1]) {
    addPart(northRun, bevelledBox(0.02, upH - 0.044, upD, 0.005, 4, 0.9, 0.9), mcm.walnut, sx * (nrW * 0.5 - 0.01), upMidY, upZ);
  }

  const upPanelW = (nrW - 0.044) / 4 + 0.016;
  const upLeafGeo = bevelledBox(upPanelW, upH - 0.048, 0.016, 0.004, 4, 0.85, 0.85);
  const cupRingGeo = prepGeo(new THREE.TorusGeometry(0.015, 0.0028, 12, 24));
  const cupBackGeo = prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.003, 24));
  const formicaPanels = [
    [mcm.formicaAqua, 'Turquoise Aqua', -0.013, 1],
    [mcm.formicaMustard, 'Mustard Ochre', 0.009, -1],
    [mcm.formicaPersimmon, 'Persimmon Coral', -0.013, 1],
    [mcm.formicaWhite, 'Crisp White', 0.009, -1],
  ] as const;
  formicaPanels.forEach(([mat, colorName, trackOffsetZ, slideSign], idx) => {
    const px = -nrW * 0.5 + 0.022 + ((nrW - 0.044) / 4) * (idx + 0.5);
    const pGrp = new THREE.Group();
    pGrp.name = `stahl.kitchen.upperSlide_${idx + 1}`;
    pGrp.position.set(px, upMidY, upZ + upD * 0.5 - 0.02 + trackOffsetZ);
    addPart(pGrp, upLeafGeo, mat, 0, 0, 0);
    const cupX = slideSign * (-upPanelW * 0.5 + 0.055);
    addPart(pGrp, cupRingGeo, mcm.dieCastAlum, cupX, -0.18, 0.0098);
    const cb = addPart(pGrp, cupBackGeo, mcm.blackenedSteel, cupX, -0.18, 0.0092);
    cb.rotation.x = Math.PI * 0.5;
    attachAssetInteraction(pGrp, {
      kind: 'slide', id: `stahl-kitchen-upper-${idx + 1}`, label: `Slide ${colorName} Formica Upper Cabinet Door`,
      slideDelta: [slideSign * (upPanelW - 0.06), 0, 0], audio: { openPreset: 'drawerSlide', volume: 0.42 },
    });
    northRun.add(pGrp);
  });

  const underCabMat = new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: new THREE.Color(0xffe6b8), emissiveIntensity: 1.35, roughness: 0.3 });
  addPart(northRun, bevelledBox(nrW - 0.16, 0.012, 0.036, 0.003, 3), underCabMat, 0, 1.432, upZ + 0.08);
  addPart(northRun, bevelledBox(0.68, 0.108, 0.14, 0.004, 4), mcm.dieCastAlum, -0.78, 1.383, upZ - 0.06);
  const lumGroup = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlKitchenLuminous;
  if (lumGroup) lumGroup.emissives.push(underCabMat);

  attachAssetMetadata(northRun, {
    name: 'Arcware Aluminum-Framed Walnut & Color-Blocked Formica Kitchen Wall Unit',
    brand: 'Arcware / Formica / Lyoncraft', collection: 'Case Study House #22 Prefabricated Kitchen System (1960)', sku: 'CSH22-ARC-2860',
    finish: 'Book-Matched American Black Walnut, Aqua/Mustard/Persimmon/White Formica & Satin Aluminum', category: 'joinery', dimensionsMm: [2860, 640, 2180],
  });
  kitchen.add(northRun);

  // Floating peninsula worktop, Thermador drop-in cooktop, range hood, Moka Express & stoneware kettle
  const island = new THREE.Group();
  island.name = 'stahl.kitchen.peninsulaCabinet';
  const isW = 3.24;
  const isCarcassD = 0.7;
  const isTopD = 1.04;
  island.position.set(3.3, 0, -2.2);
  addStubbyFloatingLegs(island, [-1.5, 0, 1.5], [-0.28, 0.28], legH, mcm);

  addPart(island, bevelledBox(isW, baseBodyH, isCarcassD - 0.044, 0.005, 4, 0.9, 0.9), mcm.walnut, 0, legH + baseBodyH * 0.5, 0.022, true);
  addPart(island, bevelledBox(isW + 0.006, 0.02, 0.022, 0.003, 4), mcm.dieCastAlum, 0, legH + baseBodyH - 0.01, isCarcassD * 0.5 + 0.008);
  addPart(island, bevelledBox(isW + 0.006, 0.02, 0.022, 0.003, 4), mcm.dieCastAlum, 0, legH + 0.01, isCarcassD * 0.5 + 0.008);
  addArcwareWalnutBayFronts(island, mcm, isW, legH, legH + baseBodyH, -isCarcassD * 0.5 + 0.01, 4, -1);
  addPart(island, bevelledBox(isW + 0.04, counterT, isTopD, 0.006, 4, 0.95, 0.95), mcm.formicaWhite, 0, counterY + counterT * 0.5, 0.16, true);

  const isSurfY = counterY + counterT;
  addPart(island, bevelledBox(0.78, 0.012, 0.52, 0.003, 4, 0.7, 0.7), mcm.brushedStainless, -0.62, isSurfY + 0.0065, 0.02);
  for (const [bx, bz, br] of [[-0.8, -0.11, 0.095], [-0.44, -0.11, 0.08], [-0.8, 0.15, 0.08], [-0.44, 0.15, 0.105]] as const) {
    const trim = addPart(island, prepGeo(new THREE.TorusGeometry(br + 0.01, 0.0045, 12, 36)), mcm.polishedChrome, bx, isSurfY + 0.015, bz);
    trim.rotation.x = Math.PI * 0.5;
    addPart(island, prepGeo(new THREE.CylinderGeometry(br + 0.004, br, 0.003, 36)), mcm.blackenedSteel, bx, isSurfY + 0.014, bz);
    for (const cr of [br * 0.84, br * 0.52]) {
      const coil = addPart(island, prepGeo(new THREE.TorusGeometry(cr, 0.005, 12, 36)), mcm.formicaCharcoal, bx, isSurfY + 0.019, bz);
      coil.rotation.x = Math.PI * 0.5;
    }
    addPart(island, prepGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 24)), mcm.brushedStainless, bx, isSurfY + 0.02, bz);
  }
  for (let k = 0; k < 4; k++) addKnurledKnob(island, mcm, -0.28, isSurfY + 0.0125, -0.15 + k * 0.1, 'y');

  // Suspended brushed-stainless & walnut range hood over cooktop
  addPart(island, bevelledBox(0.86, 0.082, 0.58, 0.005, 4, 0.8, 0.8), mcm.brushedStainless, -0.62, 1.96, 0.02, true);
  addPart(island, bevelledBox(0.868, 0.02, 0.588, 0.003, 4, 0.8, 0.8), mcm.walnut, -0.62, 1.988, 0.02);
  addPart(island, bevelledBox(0.74, 0.008, 0.46, 0.002, 3), mcm.blackenedSteel, -0.62, 1.914, 0.02);
  addPart(island, bevelledBox(0.28, 0.372, 0.22, 0.004, 4), mcm.brushedStainless, -0.62, 2.19, 0.02);

  // Octagonal `8`-seg Bialetti Moka Express pot + `44`-seg stoneware kettle & fruit bowl
  const moka = new THREE.Group();
  moka.name = 'stahl.kitchen.mokaEspressoMaker';
  moka.position.set(-0.44, isSurfY + 0.022, 0.15);
  addPart(moka, prepGeo(new THREE.CylinderGeometry(0.036, 0.052, 0.078, 8)), mcm.polishedChrome, 0, 0.039, 0);
  addPart(moka, prepGeo(new THREE.CylinderGeometry(0.038, 0.038, 0.012, 8)), mcm.dieCastAlum, 0, 0.085, 0);
  addPart(moka, prepGeo(new THREE.CylinderGeometry(0.055, 0.036, 0.088, 8)), mcm.polishedChrome, 0, 0.136, 0);
  addPart(moka, prepGeo(new THREE.CylinderGeometry(0.012, 0.054, 0.016, 8)), mcm.polishedChrome, 0, 0.189, 0);
  addPart(moka, prepGeo(new THREE.CylinderGeometry(0.012, 0.008, 0.016, 16)), mcm.formicaCharcoal, 0, 0.205, 0);
  addPart(moka, buildTubeGeo([[0, 0.17, 0.044], [0, 0.168, 0.076], [0, 0.118, 0.08], [0, 0.095, 0.042]], 24, 0.0065, 14), mcm.formicaCharcoal, 0, 0, 0);
  attachAssetInteraction(moka, {
    kind: 'toggle', id: 'stahl-moka-espresso', label: 'Brew Stovetop Moka Espresso',
    activeLabel: 'Turn Off Stovetop Espresso Maker',
    audio: { openPreset: 'espressoExtract', activeLoopPreset: 'espressoMachine', volume: 0.42 },
  });
  island.add(moka);

  addPart(island, buildStonewareVesselGeo(0.082, 0.098, 0.052, 0.135), mcm.stonewareWhite, -0.8, isSurfY + 0.022, -0.11, true);
  addPart(island, prepGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.01, 44)), mcm.walnut, -0.8, isSurfY + 0.16, -0.11);
  addPart(island, buildTubeGeo([[-0.865, isSurfY + 0.11, -0.11], [-0.84, isSurfY + 0.22, -0.11], [-0.76, isSurfY + 0.22, -0.11], [-0.735, isSurfY + 0.11, -0.11]], 28, 0.0055, 14), mcm.blackenedSteel, 0, 0, 0);

  addPart(island, buildStonewareVesselGeo(0.082, 0.155, 0.17, 0.062), mcm.porcelainWhite, 0.78, isSurfY + 0.001, 0.16, true);
  const citrusGeo = prepGeo(new THREE.SphereGeometry(0.034, 24, 18));
  for (const [ox, oz, fmat] of [[0.74, 0.14, mcm.formicaPersimmon], [0.82, 0.15, mcm.formicaMustard], [0.78, 0.2, mcm.formicaMustard]] as const) {
    addPart(island, citrusGeo, fmat, ox, isSurfY + 0.058, oz);
  }
  attachAssetMetadata(island, {
    name: 'Koenig Floating Walnut & Formica Breakfast Peninsula with Thermador 4-Burner Cooktop',
    brand: 'Arcware / Thermador', collection: 'Case Study House #22 Kitchen Island (1960)', sku: 'CSH22-ISL-3240',
    finish: 'Book-Matched American Black Walnut, Crisp White Formica & Brushed Stainless Steel', category: 'joinery', dimensionsMm: [3280, 1040, 914],
  });
  kitchen.add(island);

  // 3 Counter Barstools: `24`-seg slender blackened-steel rod legs, `36`-seg footrest ring & plump tufted cushion
  const stoolLegGeo = prepGeo(new THREE.CylinderGeometry(0.0085, 0.007, 0.61, 24));
  const stoolFootRingGeo = prepGeo(new THREE.TorusGeometry(0.172, 0.007, 16, 36));
  const stoolPanGeo = prepGeo(new THREE.CylinderGeometry(0.182, 0.168, 0.018, 36));
  const stoolCushionGeo = buildTuftedCushionGeo({ width: 0.355, height: 0.054, depth: 0.355, crown: 0.014, cornerPower: 0.42, tuftsX: 1, tuftsZ: 1, segX: 28, segY: 10, segZ: 28 });
  const stoolBackGeo = bevelledBox(0.32, 0.105, 0.022, 0.006, 4, 0.5, 0.5);
  const stoolPostGeo = prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.135, 24));

  for (const [sIdx, sx] of [[1, 2.25], [2, 3.3], [3, 4.35]] as const) {
    const stool = new THREE.Group();
    const sName = `stahl.kitchen.counterStool_${sIdx}`;
    stool.name = sName;
    stool.position.set(sx, 0, -1.28);
    stool.rotation.y = Math.PI;

    const seatH = 0.65;
    for (const lx of [-0.145, 0.145]) {
      for (const lz of [-0.145, 0.145]) {
        const leg = addPart(stool, stoolLegGeo, mcm.blackenedSteel, lx, 0.305, lz);
        leg.rotation.z = -lx * 0.22;
        leg.rotation.x = lz * 0.22;
      }
    }
    const footRing = addPart(stool, stoolFootRingGeo, mcm.blackenedSteel, 0, 0.22, 0);
    footRing.rotation.x = Math.PI * 0.5;
    addPart(stool, stoolPanGeo, mcm.walnut, 0, seatH - 0.036, 0);

    const cushGroup = new THREE.Group();
    cushGroup.position.y = seatH;
    addPart(cushGroup, stoolCushionGeo, mcm.saddleLeather, 0, 0, 0, true);
    addCushionTuftButtons(cushGroup, { width: 0.355, height: 0.054, depth: 0.355, crown: 0.014, tuftsX: 1, tuftsZ: 1, material: mcm.saddleLeather });
    stool.add(cushGroup);

    addPart(stool, stoolBackGeo, mcm.walnut, 0, seatH + 0.112, -0.172);
    addPart(stool, stoolPostGeo, mcm.blackenedSteel, -0.09, seatH + 0.042, -0.172);
    addPart(stool, stoolPostGeo, mcm.blackenedSteel, 0.09, seatH + 0.042, -0.172);

    registerSeat(ctx, stool, {
      id: `${sName}.seat`, label: `Sit on Mid-Century Breakfast Bar Counter Stool ${sIdx}`,
      aliases: [sName, 'counter stool', 'bar stool'], localSeatPos: [0, seatH + 0.02, 0],
      localFootOffset: [0, 0, -0.56], localForward: [0, 0, 1], material: 'leather',
    });
    attachAssetMetadata(stool, {
      name: 'Mid-Century Steel, Walnut & Saddle-Leather Counter Stool', brand: 'Van Keppel-Green / Laverne',
      collection: 'California Modern Bar Seating', sku: `VKG-STL-${sIdx}`,
      finish: 'Blackened Steel Rod, Turned American Walnut & Tufted Saddle Leather', category: 'furniture', dimensionsMm: [390, 390, 770],
    });
    kitchen.add(stool);
  }

  // Legacy luminous ceiling grid group (preserved for circuit binding & structure.ts compatibility)
  const lumGrid = new THREE.Group();
  lumGrid.name = 'stahl.kitchen.luminousCeilingGrid';
  const lumPanelMat = new THREE.MeshStandardMaterial({ color: 0xfffef8, emissive: new THREE.Color(0xfff1d2), emissiveIntensity: 1.45, roughness: 0.28 });
  if (lumGroup) lumGroup.emissives.push(lumPanelMat);
  addPart(lumGrid, bevelledBox(3.75, 0.016, 3.27, 0.003, 3), lumPanelMat, 3.2, 2.37, -3.72);
  kitchen.add(lumGrid);

  parent.add(kitchen);
  return kitchen;
}

export function buildBreezewayAndCentralBathCore(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  cuts: { readonly northWoodsCut: CutawayWallDescriptor },
  ceilingTopY: number
): void {
  buildFloorToCeilingSlidingWardrobe(parent, mcm, {
    name: 'stahl.breezeway.linenClosetCabinet', xCenter: -6.54, zCenter: -1.41, widthM: 1.36, depthM: 0.34,
    heightM: ceilingTopY - 0.002, facing: '+z', doorMatA: mcm.formicaAqua, doorMatB: mcm.walnut,
    brandLabel: 'Breezeway Color-Blocked Formica & Walnut Linen Closet',
  });

  const bath = new THREE.Group();
  bath.name = 'stahl.bathCore.interior';

  // Exact `4"x4"` (`TILE_4X4 = 0.816`) glazed ceramic mosaic tile floor & wainscots (`>= 2 mm` proud of walls)
  const tileFloor = addPart(bath, bevelledBox(2.44, 0.0024, 4.18, 0.001, 2, TILE_4X4, TILE_4X4), mcm.mosaicBlue, -5.996, 0.0018, -3.82);
  tileFloor.name = 'stahl.bath.mosaicFloor';
  tileFloor.receiveShadow = true;
  tagCollisionRole(tileFloor, 'ignore');

  const wainscotH = 2.18;
  addPart(bath, bevelledBox(0.006, wainscotH, 3.08, 0.0015, 2, TILE_4X4, TILE_4X4), mcm.mosaicSand, -7.23, 0.004 + wainscotH * 0.5, -3.28);
  addPart(bath, bevelledBox(0.006, wainscotH, 3.08, 0.0015, 2, TILE_4X4, TILE_4X4), mcm.mosaicSand, -4.762, 0.004 + wainscotH * 0.5, -3.28);
  const northBlueTile = addPart(bath, bevelledBox(2.44, wainscotH, 0.012, 0.002, 3, TILE_4X4, TILE_4X4), mcm.mosaicBlue, -5.996, 0.004 + wainscotH * 0.5, -5.922);
  tagCutaway(northBlueTile, cuts.northWoodsCut);

  // Sunken `4"x4"` mosaic tile Roman tub & fluted-glass walk-in shower
  const romanTub = new THREE.Group();
  romanTub.name = 'stahl.bath.romanTubShowerCabinet';
  romanTub.position.set(-5.996, 0, -5.4);

  addPart(romanTub, bevelledBox(2.436, 0.34, 0.14, 0.006, 4, TILE_4X4, TILE_4X4), mcm.mosaicBlue, 0, 0.174, 0.5, true);
  addPart(romanTub, bevelledBox(0.88, 0.15, 0.2, 0.006, 4, TILE_4X4, TILE_4X4), mcm.mosaicBlue, 0.32, 0.079, 0.672, true);
  addPart(romanTub, bevelledBox(0.82, 0.17, 0.18, 0.006, 4, TILE_4X4, TILE_4X4), mcm.mosaicBlue, 0.32, 0.089, 0.338, true);
  addPart(romanTub, bevelledBox(0.42, 0.38, 0.856, 0.006, 4, TILE_4X4, TILE_4X4), mcm.mosaicBlue, -1.01, 0.194, -0.001, true);
  addPart(romanTub, bevelledBox(1.99, 0.12, 0.09, 0.005, 4, TILE_4X4, TILE_4X4), mcm.mosaicBlue, 0.2, 0.064, -0.455);
  addPart(romanTub, bevelledBox(0.09, 0.12, 0.76, 0.005, 4, TILE_4X4, TILE_4X4), mcm.mosaicBlue, 1.175, 0.064, -0.02);
  addPart(romanTub, prepGeo(new THREE.CylinderGeometry(0.046, 0.044, 0.005, 36)), mcm.polishedChrome, 0.196, 0.0065, -0.04);
  addPart(romanTub, prepGeo(new THREE.CylinderGeometry(0.028, 0.028, 0.005, 36)), mcm.blackenedSteel, 0.196, 0.008, -0.04);

  const trackTopY = 2.06;
  const glassH = trackTopY - 0.34 - 0.038;
  const glassMidY = 0.34 + 0.019 + glassH * 0.5;
  addPart(romanTub, bevelledBox(2.43, 0.028, 0.056, 0.003, 4), mcm.dieCastAlum, 0, trackTopY - 0.014, 0.5);
  addPart(romanTub, bevelledBox(2.43, 0.016, 0.052, 0.003, 4), mcm.dieCastAlum, 0, 0.354, 0.5);

  const gPanelW = 1.25;
  const towelBarGeo = buildCurvedGrabHandleGeo(0.46, 0.032, false, 0.0075);
  for (const [idx, gx, gzOff, dir, label] of [
    [1, -0.584, -0.013, 1, 'Slide Roman Shower Left Fluted-Glass Door'],
    [2, 0.586, 0.013, -1, 'Slide Roman Shower Right Fluted-Glass Door'],
  ] as const) {
    const gp = new THREE.Group();
    gp.name = `stahl.bath.showerGlassDoor_${idx}`;
    gp.position.set(gx, glassMidY, 0.5 + gzOff);
    addPart(gp, prepGeo(new THREE.BoxGeometry(gPanelW - 0.048, glassH - 0.048, 0.01)), mcm.flutedGlass, 0, 0, 0);
    addPart(gp, bevelledBox(0.022, glassH - 0.008, 0.018, 0.003, 3), mcm.dieCastAlum, -gPanelW * 0.5 + 0.011, 0, 0);
    addPart(gp, bevelledBox(0.022, glassH - 0.008, 0.018, 0.003, 3), mcm.dieCastAlum, gPanelW * 0.5 - 0.011, 0, 0);
    addPart(gp, bevelledBox(gPanelW - 0.048, 0.018, 0.018, 0.003, 3), mcm.dieCastAlum, 0, glassH * 0.5 - 0.013, 0);
    addPart(gp, bevelledBox(gPanelW - 0.048, 0.018, 0.018, 0.003, 3), mcm.dieCastAlum, 0, -glassH * 0.5 + 0.013, 0);
    const tb = addPart(gp, towelBarGeo, mcm.polishedChrome, 0, -0.06, idx === 2 ? 0.009 : -0.009);
    if (idx === 1) tb.rotation.y = Math.PI;
    attachAssetInteraction(gp, {
      kind: 'slide', id: `stahl-bath-shower-door-${idx}`, label,
      slideDelta: [dir * 1.05, 0, 0], audio: { openPreset: 'drawerSlide', volume: 0.48 },
    });
    romanTub.add(gp);
  }

  // Curved `TubeGeometry` (`>= 40` segs) chrome tub spout & showerhead arm + `24`-seg cross valves
  const showerFixture = new THREE.Group();
  showerFixture.name = 'stahl.bath.thermostaticShower';
  showerFixture.position.set(1.228, 0, -0.02);

  const valveEscutcheon = addPart(showerFixture, prepGeo(new THREE.CylinderGeometry(0.088, 0.088, 0.012, 32)), mcm.polishedChrome, -0.008, 1.16, 0);
  valveEscutcheon.rotation.z = Math.PI * 0.5;
  for (const vz of [-0.042, 0.042]) {
    const stem = addPart(showerFixture, prepGeo(new THREE.CylinderGeometry(0.014, 0.018, 0.036, 24)), mcm.polishedChrome, -0.028, 1.16, vz);
    stem.rotation.z = Math.PI * 0.5;
    addPart(showerFixture, prepGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.064, 24)), mcm.polishedChrome, -0.046, 1.16, vz);
    const crossZ = addPart(showerFixture, prepGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.064, 24)), mcm.polishedChrome, -0.046, 1.16, vz);
    crossZ.rotation.x = Math.PI * 0.5;
  }

  addPart(showerFixture, buildTubeGeo([[-0.004, 0.56, 0], [-0.08, 0.566, 0], [-0.145, 0.558, 0], [-0.175, 0.525, 0]], 42, 0.014, 18), mcm.polishedChrome, 0, 0, 0);
  const armFlange = addPart(showerFixture, prepGeo(new THREE.CylinderGeometry(0.028, 0.032, 0.01, 28)), mcm.polishedChrome, -0.007, 1.98, 0);
  armFlange.rotation.z = Math.PI * 0.5;
  addPart(showerFixture, buildTubeGeo([[-0.008, 1.98, 0], [-0.12, 2.04, 0], [-0.24, 2.02, 0], [-0.305, 1.935, 0]], 44, 0.0105, 18), mcm.polishedChrome, 0, 0, 0);
  const showerCone = addPart(showerFixture, prepGeo(new THREE.ConeGeometry(0.068, 0.088, 36)), mcm.polishedChrome, -0.325, 1.895, 0);
  showerCone.rotation.z = -0.35;

  const showerSprayMat = new THREE.MeshPhysicalMaterial({ color: 0xdaf4ff, transparent: true, opacity: 0.38, roughness: 0.08 });
  const showerSpray = addPart(showerFixture, prepGeo(new THREE.ConeGeometry(0.22, 1.76, 28, 1, true)), showerSprayMat, -0.47, 0.98, 0);
  showerSpray.visible = false;
  attachAssetInteraction(showerFixture, {
    kind: 'toggle', id: 'stahl-roman-shower-valve', label: 'Turn On Roman Tub & Thermostatic Shower',
    activeLabel: 'Turn Off Roman Shower', onToggle: (active) => { showerSpray.visible = active; },
    audio: { openPreset: 'switchClick', activeLoopPreset: 'waterTapFlow', volume: 0.5 },
  });
  romanTub.add(showerFixture);
  attachAssetMetadata(romanTub, {
    name: 'Koenig Mosaic-Tiled Sunken Roman Tub & Fluted-Glass Walk-In Shower',
    brand: 'Mosaic Tile Co. / American Standard', collection: 'Case Study House #22 Master Bath (1960)', sku: 'CSH22-ROMAN-2440',
    finish: 'Horizon Blue 4"x4" Glazed Ceramic Mosaic Tile, Fluted Architectural Glass & Chrome', category: 'sanitaryware', dimensionsMm: [2440, 1020, 2060],
  });
  bath.add(romanTub);

  // Floating 2.16 m walnut vanity & twin sculpted oval porcelain undermount sinks
  const vanity = new THREE.Group();
  vanity.name = 'stahl.bath.doubleVanityCabinet';
  const vLen = 2.16;
  const vDepth = 0.56;
  vanity.position.set(-6.94, 0, -3.64);

  const vBaseY = 0.2;
  const vBodyH = 0.62;
  const vTopY = vBaseY + vBodyH;
  const vTopT = 0.032;

  addPart(vanity, bevelledBox(vDepth - 0.044, 0.41, vLen, 0.005, 4, 0.85, 0.85), mcm.walnut, -0.022, vBaseY + 0.205, 0, true);
  addPart(vanity, bevelledBox(vDepth - 0.068, 0.202, 0.52, 0.004, 4, 0.85, 0.85), mcm.walnut, -0.008, vTopY - 0.105, 0, true);
  for (const ez of [-vLen * 0.5 + 0.09, vLen * 0.5 - 0.09]) {
    addPart(vanity, bevelledBox(vDepth - 0.068, 0.202, 0.18, 0.004, 4, 0.85, 0.85), mcm.walnut, -0.008, vTopY - 0.105, ez, true);
  }
  addPart(vanity, bevelledBox(0.022, 0.202, vLen - 0.04, 0.003, 3, 0.85, 0.85), mcm.walnut, -vDepth * 0.5 + 0.011, vTopY - 0.105, 0);
  addPart(vanity, bevelledBox(0.022, 0.018, vLen + 0.004, 0.003, 4), mcm.dieCastAlum, vDepth * 0.5 - 0.011, vTopY - 0.009, 0);
  addPart(vanity, bevelledBox(0.022, 0.018, vLen + 0.004, 0.003, 4), mcm.dieCastAlum, vDepth * 0.5 - 0.011, vBaseY + 0.009, 0);

  for (let di = 0; di < 3; di++) {
    const dy = vBaseY + 0.03 + di * 0.192;
    addPart(vanity, bevelledBox(0.018, 0.156, 0.44, 0.004, 4, 0.8, 0.8), mcm.walnut, vDepth * 0.5 - 0.006, dy + 0.078, 0);
    addPart(vanity, bevelledBox(0.012, 0.024, 0.44, 0.0025, 3), mcm.dieCastAlum, vDepth * 0.5 - 0.013, dy + 0.17, 0);
  }

  const vDoorW = 0.82;
  for (const [idx, dz, xOff, dir, mat] of [[1, -0.65, -0.012, 1, mcm.walnut], [2, 0.65, 0.008, -1, mcm.formicaWhite]] as const) {
    const vd = new THREE.Group();
    vd.name = `stahl.bath.vanitySlide_${idx}`;
    vd.position.set(vDepth * 0.5 - 0.01 + xOff, vBaseY + vBodyH * 0.5, dz);
    addPart(vd, bevelledBox(0.016, vBodyH - 0.08, vDoorW, 0.004, 4, 0.8, 0.8), mat, 0, -0.016, 0);
    addPart(vd, bevelledBox(0.012, 0.028, vDoorW, 0.0025, 3), mcm.dieCastAlum, -0.003, vBodyH * 0.5 - 0.036, 0);
    attachAssetInteraction(vd, {
      kind: 'slide', id: `stahl-bath-vanity-door-${idx}`, label: `Slide Double Vanity Cabinet Panel ${idx}`,
      slideDelta: [0, 0, dir * 0.42], audio: { openPreset: 'drawerSlide', volume: 0.44 },
    });
    vanity.add(vd);
  }

  const vCounterY = vTopY + 0.001;
  const vSurfY = vCounterY + vTopT;
  addTwinCutoutCounter(vanity, mcm.formicaWhite, {
    axis: 'z', xMin: -vDepth * 0.5, xMax: vDepth * 0.5 + 0.02, zMin: -vLen * 0.5 - 0.01, zMax: vLen * 0.5 + 0.01,
    yMid: vCounterY + vTopT * 0.5, thickness: vTopT, holeA: [0.035, -0.56], holeB: [0.035, 0.56], hx: 0.122, hz: 0.162,
  });

  const ovalBasinGeo = buildSculptedBasinGeo({ width: 0.36, depth: 0.48, bowlDepth: 0.155, rimWidth: 0.056, radialSegments: 48 });
  const vanityFaucetGeo = buildCurvedFaucetGeo({ reach: 0.14, rise: 0.15, style: 'swivel', tubularSegments: 44, radialSegments: 18 });
  const vStreamMat = new THREE.MeshPhysicalMaterial({ color: 0xd8f3ff, transparent: true, opacity: 0.6, roughness: 0.05 });

  for (const [bIdx, bz] of [[1, -0.56], [2, 0.56]] as const) {
    addPart(vanity, ovalBasinGeo, mcm.porcelainWhite, 0.035, vCounterY - 0.0045, bz);
    addPart(vanity, prepGeo(new THREE.CylinderGeometry(0.026, 0.024, 0.005, 32)), mcm.polishedChrome, 0.035, vCounterY - 0.156, bz);

    const bTap = new THREE.Group();
    bTap.name = `stahl.bath.vanityTap_${bIdx}`;
    bTap.position.set(-0.175, vSurfY + 0.001, bz);
    addPart(bTap, bevelledBox(0.05, 0.012, 0.16, 0.004, 4), mcm.polishedChrome, 0, 0.006, 0);
    addPart(bTap, prepGeo(new THREE.CylinderGeometry(0.015, 0.018, 0.024, 24)), mcm.polishedChrome, 0, 0.022, 0);
    const spout = addPart(bTap, vanityFaucetGeo, mcm.polishedChrome, 0, 0.03, 0);
    spout.rotation.y = Math.PI * 0.5;
    for (const hz of [-0.055, 0.055]) {
      addPart(bTap, prepGeo(new THREE.CylinderGeometry(0.013, 0.016, 0.028, 24)), mcm.polishedChrome, 0, 0.025, hz);
      const lever = addPart(bTap, prepGeo(new THREE.CylinderGeometry(0.004, 0.0055, 0.044, 24)), mcm.polishedChrome, 0, 0.038, hz + Math.sign(hz) * 0.02);
      lever.rotation.x = Math.sign(hz) * 1.4;
    }
    const vStream = addPart(bTap, prepGeo(new THREE.CylinderGeometry(0.005, 0.007, 0.26, 20)), vStreamMat, 0.14, 0.022, 0);
    vStream.visible = false;
    attachAssetInteraction(bTap, {
      kind: 'toggle', id: `stahl-bath-vanity-tap-${bIdx}`, label: `Turn On Master Bath Basin Faucet ${bIdx}`,
      activeLabel: `Turn Off Master Bath Basin Faucet ${bIdx}`, onToggle: (active) => { vStream.visible = active; },
      audio: { openPreset: 'switchClick', activeLoopPreset: 'waterTapFlow', volume: 0.42 },
    });
    vanity.add(bTap);
  }

  for (const [ti, ty, tmat] of [[0, 0.018, mcm.pillowLinen], [1, 0.053, mcm.throwOchre], [2, 0.086, mcm.formicaAqua]] as const) {
    addPart(vanity, buildTuftedCushionGeo({ width: 0.24 - ti * 0.012, height: 0.032, depth: 0.31 - ti * 0.012, segX: 20, segY: 8, segZ: 20 }), tmat, 0.02, vSurfY + ty, 0);
  }

  // Bevelled mirror cabinet (`>= 3.0 mm` proud of West mosaic wall) + `32`-seg opal vanity bar luminaire
  addPart(vanity, bevelledBox(0.034, 1.06, 2.12, 0.004, 4, 0.85, 0.85), mcm.walnut, -vDepth * 0.5 + 0.013, 1.54, 0);
  addPart(vanity, bevelledBox(0.008, 1.01, 2.07, 0.002, 3), mcm.plateMirror, -vDepth * 0.5 + 0.035, 1.54, 0);
  addPart(vanity, bevelledBox(0.004, 1.01, 0.008, 0.001, 2), mcm.dieCastAlum, -vDepth * 0.5 + 0.041, 1.54, 0);
  addPart(vanity, bevelledBox(0.024, 0.058, 2.04, 0.004, 4), mcm.polishedChrome, -vDepth * 0.5 + 0.014, 2.15, 0);
  const barDiffuserMat = new THREE.MeshStandardMaterial({ color: 0xfffcf4, emissive: new THREE.Color(0xffe9c4), emissiveIntensity: 1.4, roughness: 0.28 });
  const barDiffuser = addPart(vanity, prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 1.98, 32)), barDiffuserMat, -vDepth * 0.5 + 0.052, 2.15, 0);
  barDiffuser.rotation.x = Math.PI * 0.5;
  const bathLightGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlBathVanity;
  if (bathLightGrp) bathLightGrp.emissives.push(barDiffuserMat);

  attachAssetMetadata(vanity, {
    name: 'Koenig Floating Walnut & White Formica Double-Basin Master Vanity & Mirror Cabinet',
    brand: 'Arcware / Formica / American Standard', collection: 'Case Study House #22 Master Bath (1960)', sku: 'CSH22-VAN-2160',
    finish: 'Book-Matched American Walnut, Crisp White Formica, Vitreous China & Chrome', category: 'sanitaryware', dimensionsMm: [2160, 560, 2180],
  });
  bath.add(vanity);

  addPart(bath, bevelledBox(0.58, 1.18, 0.032, 0.005, 4, 0.7, 0.7), mcm.walnut, -5.056, 0.596, -3.86, true);
  addPart(bath, bevelledBox(0.586, 0.018, 0.038, 0.003, 3), mcm.dieCastAlum, -5.056, 0.014, -3.86);

  // 1960 One-Piece Low-Profile Porcelain WC (`48`-seg LatheGeometry bowl pedestal + bevelled tank + curved trip lever)
  const wc = new THREE.Group();
  wc.name = 'stahl.bath.midCenturyWc';
  wc.position.set(-5.08, 0.0045, -3.32);

  const wcBowlGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.146, 0), new THREE.Vector2(0.142, 0.025),
    new THREE.Vector2(0.118, 0.14), new THREE.Vector2(0.126, 0.22), new THREE.Vector2(0.178, 0.305),
    new THREE.Vector2(0.198, 0.375), new THREE.Vector2(0.194, 0.392), new THREE.Vector2(0.158, 0.388),
    new THREE.Vector2(0.132, 0.31), new THREE.Vector2(0.068, 0.24), new THREE.Vector2(0, 0.235),
  ], 48);
  wcBowlGeo.scale(1.36, 1, 0.96);
  wcBowlGeo.computeVertexNormals();
  addPart(wc, prepGeo(wcBowlGeo), mcm.porcelainWhite, -0.075, 0, 0, true);

  const wcSeatGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.188, 0), new THREE.Vector2(0.2, 0.008),
    new THREE.Vector2(0.196, 0.022), new THREE.Vector2(0.16, 0.026), new THREE.Vector2(0, 0.027),
  ], 48);
  wcSeatGeo.scale(1.36, 1, 0.96);
  wcSeatGeo.computeVertexNormals();
  addPart(wc, prepGeo(wcSeatGeo), mcm.porcelainWhite, -0.075, 0.394, 0, true);

  addPart(wc, bevelledBox(0.215, 0.36, 0.48, 0.018, 5), mcm.porcelainWhite, 0.2, 0.42, 0, true);
  addPart(wc, bevelledBox(0.23, 0.026, 0.496, 0.008, 4), mcm.porcelainWhite, 0.2, 0.614, 0, true);

  const flushHandle = new THREE.Group();
  flushHandle.position.set(0.09, 0.555, 0.165);
  const fhBase = addPart(flushHandle, prepGeo(new THREE.CylinderGeometry(0.013, 0.015, 0.012, 24)), mcm.polishedChrome, -0.004, 0, 0);
  fhBase.rotation.z = Math.PI * 0.5;
  addPart(flushHandle, buildTubeGeo([[-0.008, 0, 0], [-0.024, 0, 0.006], [-0.028, -0.004, 0.042], [-0.028, -0.012, 0.072]], 28, 0.0055, 16), mcm.polishedChrome, 0, 0, 0);
  wc.add(flushHandle);

  attachAssetInteraction(wc, {
    kind: 'toggle', id: 'stahl-bath-wc-flush', label: 'Flush Mid-Century One-Piece WC',
    activeLabel: 'Reset WC Cistern', onToggle: (active) => { flushHandle.rotation.z = active ? 0.38 : 0; },
    audio: { openPreset: 'cisternFlush', volume: 0.6 },
  });
  attachAssetMetadata(wc, {
    name: 'American Standard Master One-Piece Low-Profile Vitreous China Water Closet (1960)',
    brand: 'American-Standard', collection: 'Case Study House #22 Sanitaryware Specification', sku: 'AS-2000-1PC-WHT',
    finish: 'Glazed White Vitreous China & Polished Chrome Trip Lever', category: 'sanitaryware', dimensionsMm: [690, 495, 625],
  });
  bath.add(wc);

  parent.add(bath);
}
