import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CutawayWallDescriptor } from 'husjs';
import { SeatInteractable, collectSeatClickableMeshes } from 'husjs/catalog/furniture';
import { applyMetricBoxUVs } from 'husjs/materials';
import { attachAssetMetadata, prepGeo, tagCollisionRole, tagCutaway } from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import type { McmMaterials } from './mcm-materials.ts';
import {
  addCushionTuftButtons,
  bevelledBox,
  buildChamferedOvalSlabGeo,
  buildCushionWeltLoopGeo,
  buildEamesFiberglassBucketGeo,
  buildMoldedPlywoodShellGeo,
  buildNelsonSaucerShadeGeo,
  buildPinchPleatDraperyGeo,
  buildSaarinenTulipPedestalGeo,
  buildSweptSpiderBaseGeo,
  buildTuftedCushionGeo,
} from './sculpted-geometry.ts';

const UP_AXIS = new THREE.Vector3(0, 1, 0);

export function addMesh(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos?: readonly [number, number, number],
  rot?: readonly [number, number, number],
  shadow: boolean | 'cast' = false
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (shadow) {
    m.castShadow = true;
    if (shadow === true) m.receiveShadow = true;
  }
  parent.add(m);
  return m;
}

export function makeLatheGeo(pts: readonly [number, number][], segs: number): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/** Bevelled book/magazine/print slab with centered [0..1] planar UVs on `axis` ('y' top or 'z' front). */
export function buildPlanarArtworkSlabGeo(
  w: number,
  h: number,
  d: number,
  radius = 0.0022,
  axis: 'y' | 'z' = 'y'
): THREE.BufferGeometry {
  const geo = new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, Math.min(w, h, d) * 0.42));
  geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / Math.max(1e-4, w) + 0.5;
    const v = axis === 'y' ? 0.5 - pos.getZ(i) / Math.max(1e-4, d) : pos.getY(i) / Math.max(1e-4, h) + 0.5;
    uv.setXY(i, u, v);
  }
  return prepGeo(geo);
}

/** Cylinder/dowel oriented cleanly between two 3D points. */
export function makeSpanCylinder(
  a: THREE.Vector3,
  b: THREE.Vector3,
  rTop: number,
  rBot: number,
  radialSegs: number,
  mat: THREE.Material,
  castShadow = false
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(1e-4, dir.length());
  const mesh = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(rTop, rBot, len, radialSegs)), mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP_AXIS, dir.normalize());
  mesh.castShadow = castShadow;
  return mesh;
}

/** Smooth continuous catenary saddle-leather sling (`32` curve segs, bevelled edges & vertex normals). */
function buildVkgCatenarySlingGeo(width: number, curveSegs = 32, thickness = 0.014): THREE.BufferGeometry {
  const curve = new THREE.SplineCurve([
    new THREE.Vector2(-0.345, 0.675),
    new THREE.Vector2(-0.322, 0.702),
    new THREE.Vector2(-0.255, 0.515),
    new THREE.Vector2(-0.155, 0.342),
    new THREE.Vector2(0.045, 0.332),
    new THREE.Vector2(0.255, 0.362),
    new THREE.Vector2(0.316, 0.348),
    new THREE.Vector2(0.312, 0.312),
  ]);
  const pts = curve.getSpacedPoints(curveSegs);
  const halfT = thickness * 0.5;
  const topPts: THREE.Vector2[] = [];
  const botPts: THREE.Vector2[] = [];
  for (let i = 0; i <= curveSegs; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[Math.min(curveSegs, i + 1)]!;
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const nx = -(p1.y - p0.y) / len;
    const ny = (p1.x - p0.x) / len;
    topPts.push(new THREE.Vector2(pts[i]!.x + nx * halfT, pts[i]!.y + ny * halfT));
    botPts.push(new THREE.Vector2(pts[i]!.x - nx * halfT, pts[i]!.y - ny * halfT));
  }
  const shape = new THREE.Shape(topPts);
  for (let i = botPts.length - 1; i >= 0; i--) shape.lineTo(botPts[i]!.x, botPts[i]!.y);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    steps: 14,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.0035,
    bevelThickness: 0.0035,
  });
  geo.translate(0, 0, -width * 0.5);
  geo.rotateY(-Math.PI * 0.5);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const hw = Math.max(0.05, width * 0.5);
  for (let i = 0; i < pos.count; i++) {
    const su = Math.min(1, Math.abs(pos.getX(i)) / hw);
    const sagWeight = Math.max(0, 1 - Math.pow((pos.getZ(i) + 0.02) / 0.34, 2));
    pos.setY(i, pos.getY(i) - (1 - su * su) * 0.015 * sagWeight);
  }
  geo.computeVertexNormals();
  return prepGeo(applyMetricBoxUVs(geo, { tileW: 0.55, tileH: 0.55 }));
}

export function registerSeat(
  ctx: SceneBuilderContext,
  root: THREE.Object3D,
  options: {
    readonly id: string;
    readonly label: string;
    readonly aliases: readonly string[];
    readonly localSeatPos: readonly [number, number, number];
    readonly localFootOffset: readonly [number, number, number];
    readonly localForward: readonly [number, number, number];
    readonly material: 'linen' | 'leather' | 'timber' | 'velvet';
  }
): void {
  if (!ctx.interactions) return;
  ctx.interactions.registerAnimatedInteractable(
    new SeatInteractable({
      id: options.id,
      label: options.label,
      aliases: options.aliases,
      anchor: root,
      clickableTargets: collectSeatClickableMeshes(root),
      localSeatPos: options.localSeatPos,
      localFootOffset: options.localFootOffset,
      localForward: options.localForward,
      material: options.material,
    })
  );
}

/** Adds covered tuft buttons and upper/lower perimeter welt piping loops to a cushion parent. */
function attachTuftButtonsAndWelt(
  target: THREE.Object3D,
  weltGeo: THREE.BufferGeometry,
  opts: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly crown: number;
    readonly tuftsX: number;
    readonly tuftsZ: number;
    readonly tuftDepth: number;
    readonly material: THREE.Material;
  }
): void {
  addCushionTuftButtons(target, opts);
  const wy = opts.height * 0.46 + opts.crown * 0.12;
  addMesh(target, weltGeo, opts.material, [0, -wy, 0]);
  addMesh(target, weltGeo, opts.material, [0, wy, 0]);
}

/**
 * Tailored Florence Knoll Model 65 / 63 Tufted Lounge Sofa (`3-seat` or `2-seat` settee)
 * with bevelled chrome architectural frame, plump dimpled `buildTuftedCushionGeo` cushions,
 * covered buttons, continuous perimeter welt piping loops, and plump accent pillows.
 */
export function buildFlorenceKnollSofa(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  options: {
    readonly name: string;
    readonly seats: 2 | 3;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
    readonly upholstery: 'ivory' | 'camel';
  }
): THREE.Group {
  const { name, seats, position, rotationY, upholstery } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(position[0], position[1], position[2]);
  g.rotation.y = rotationY;

  const fabMat = upholstery === 'ivory' ? mcm.boucleIvory : mcm.boucleCamel;
  const seatW = seats === 3 ? 0.72 : 0.73;
  const totalInnerW = seatW * seats;
  const armW = 0.085;
  const totalW = totalInnerW + armW * 2;
  const depth = 0.84;
  const legH = 0.175;
  const railT = 0.024;

  // Exposed bevelled chrome architectural perimeter cradle & legs + leveling glides
  const railXGeo = bevelledBox(totalW - 0.02, railT, railT, 0.0028, 3, 0.5, 0.5);
  for (const rz of [-depth * 0.5 + 0.04, depth * 0.5 - 0.04]) {
    addMesh(g, railXGeo, mcm.polishedChrome, [0, legH + railT * 0.5, rz]);
  }
  const railZGeo = bevelledBox(railT, railT, depth - 0.08 - railT * 2 - 0.006, 0.0028, 3, 0.5, 0.5);
  for (const rx of [-totalW * 0.5 + 0.03, totalW * 0.5 - 0.03]) {
    addMesh(g, railZGeo, mcm.polishedChrome, [rx, legH + railT * 0.5, 0]);
  }
  const glideH = 0.006;
  const legClearH = legH - glideH - 0.0015;
  const legGeo = bevelledBox(railT, legClearH, railT, 0.0028, 3, 0.5, 0.5);
  const glideGeo = prepGeo(new THREE.CylinderGeometry(0.011, 0.013, glideH, 20));
  const legXs = seats === 3 ? [-totalW * 0.5 + 0.03, 0, totalW * 0.5 - 0.03] : [-totalW * 0.5 + 0.03, totalW * 0.5 - 0.03];
  for (const lx of legXs) {
    for (const lz of [-depth * 0.5 + 0.04, depth * 0.5 - 0.04]) {
      addMesh(g, legGeo, mcm.polishedChrome, [lx, glideH + legClearH * 0.5, lz], undefined, 'cast');
      addMesh(g, glideGeo, mcm.blackenedSteel, [lx, glideH * 0.5, lz]);
    }
  }

  // Radiused upholstered deck, outer back shell & tailored box arms (`>= 2.5 mm` clear gaps)
  const deckY = legH + railT + 0.0025;
  const deckH = 0.102;
  const outerBackH = 0.555;
  addMesh(g, bevelledBox(totalInnerW - 0.008, deckH, depth - 0.135, 0.016, 4, 0.6, 0.6), fabMat, [0, deckY + deckH * 0.5, 0.052], undefined, true);
  addMesh(g, bevelledBox(totalInnerW - 0.008, outerBackH, 0.086, 0.018, 5, 0.6, 0.6), fabMat, [0, deckY + outerBackH * 0.5, -depth * 0.5 + 0.048], undefined, true);

  const armH = 0.428;
  const armGeo = bevelledBox(armW, armH, depth - 0.012, 0.015, 5, 0.6, 0.6);
  const armWeltGeo = buildCushionWeltLoopGeo(armW - 0.006, depth - 0.02, 0.018, 0.0038, 56);
  for (const sx of [-1, 1]) {
    const ax = sx * (totalW * 0.5 - armW * 0.5);
    addMesh(g, armGeo, fabMat, [ax, deckY + armH * 0.5, 0], undefined, true);
    addMesh(g, armWeltGeo, fabMat, [ax, deckY + armH - 0.003, 0]);
  }

  // Plump dimpled seat & back cushions with covered tuft buttons & continuous welt piping loops
  const seatCushW = seatW - 0.016;
  const seatCushH = 0.128;
  const seatCushD = 0.615;
  const seatCrown = 0.022;
  const seatCushGeo = buildTuftedCushionGeo({
    width: seatCushW, height: seatCushH, depth: seatCushD, crown: seatCrown,
    tuftsX: 3, tuftsZ: 2, tuftDepth: 0.016, tuftRadius: 0.052, segX: 38, segY: 12, segZ: 30, tileM: 0.55,
  });
  const seatWeltGeo = buildCushionWeltLoopGeo(seatCushW * 0.96, seatCushD * 0.96, 0.038, 0.0046, 68);

  const backCushW = seatW - 0.018;
  const backCushThick = 0.138;
  const backCushH = 0.355;
  const backCrown = 0.02;
  const backCushGeo = buildTuftedCushionGeo({
    width: backCushW, height: backCushThick, depth: backCushH, crown: backCrown,
    tuftsX: 3, tuftsZ: 2, tuftDepth: 0.015, tuftRadius: 0.048, segX: 38, segY: 12, segZ: 26, tileM: 0.55,
  });
  const backWeltGeo = buildCushionWeltLoopGeo(backCushW * 0.96, backCushH * 0.96, 0.036, 0.0045, 64);

  for (let i = 0; i < seats; i++) {
    const cx = -totalInnerW * 0.5 + seatW * (i + 0.5);
    const scY = deckY + deckH + seatCushH * 0.5 + seatCrown * 0.55;
    const sc = addMesh(g, seatCushGeo, fabMat, [cx, scY, 0.078], undefined, true);
    sc.name = `${name}.seatCushion_${i + 1}`;
    const seatDecor = new THREE.Group();
    seatDecor.position.set(cx, scY, 0.078);
    attachTuftButtonsAndWelt(seatDecor, seatWeltGeo, {
      width: seatCushW, height: seatCushH, depth: seatCushD, crown: seatCrown,
      tuftsX: 3, tuftsZ: 2, tuftDepth: 0.016, material: fabMat,
    });

    const bcY = deckY + deckH + seatCushH + backCushH * 0.5 + 0.01;
    const bcZ = -depth * 0.5 + 0.095 + backCushThick * 0.5 + 0.012;
    const bcRot: readonly [number, number, number] = [Math.PI * 0.5 - 0.09, 0, 0];
    const bc = addMesh(g, backCushGeo, fabMat, [cx, bcY, bcZ], bcRot, true);
    bc.name = `${name}.backCushion_${i + 1}`;
    const backDecor = new THREE.Group();
    backDecor.position.set(cx, bcY, bcZ);
    backDecor.rotation.x = bcRot[0];
    attachTuftButtonsAndWelt(backDecor, backWeltGeo, {
      width: backCushW, height: backCushThick, depth: backCushH, crown: backCrown,
      tuftsX: 3, tuftsZ: 2, tuftDepth: 0.015, material: fabMat,
    });
    g.add(seatDecor, backDecor);
  }

  // Plump sculpted mid-century accent pillows with perimeter equator welt seams
  const pillowGeo = buildTuftedCushionGeo({
    width: 0.41, height: 0.125, depth: 0.34, crown: 0.026, cornerPower: 0.34, segX: 28, segY: 10, segZ: 24, tileM: 0.48,
  });
  const pillowWeltGeo = buildCushionWeltLoopGeo(0.41 * 1.018, 0.34 * 1.018, 0.048, 0.0042, 52);
  const accentSpecs: readonly [number, number, THREE.Material][] =
    seats === 3
      ? [
          [totalInnerW * 0.5 - 0.23, -0.36, upholstery === 'ivory' ? mcm.throwOchre : mcm.boucleIvory],
          [-totalInnerW * 0.5 + 0.24, 0.34, mcm.throwOlive],
        ]
      : [[totalInnerW * 0.5 - 0.23, -0.36, upholstery === 'ivory' ? mcm.throwOchre : mcm.boucleIvory]];

  for (const [px, rotY, pMat] of accentSpecs) {
    const pGrp = new THREE.Group();
    pGrp.position.set(px, deckY + deckH + seatCushH + 0.165, 0.055);
    pGrp.rotation.set(Math.PI * 0.5 - 0.24, rotY, rotY > 0 ? -0.12 : 0.14);
    addMesh(pGrp, pillowGeo, pMat, undefined, undefined, 'cast');
    addMesh(pGrp, pillowWeltGeo, pMat);
    g.add(pGrp);
  }

  registerSeat(ctx, g, {
    id: `${name}.seat`,
    label: seats === 3 ? 'Sit on Florence Knoll Tufted Sofa' : 'Sit on Florence Knoll Lounge Settee',
    aliases: [name, 'knoll sofa', 'living sofa'],
    localSeatPos: [0, deckY + deckH + seatCushH, 0.08],
    localFootOffset: [0, 0, 0.72],
    localForward: [0, 0, 1],
    material: 'linen',
  });

  attachAssetMetadata(g, {
    name: seats === 3 ? 'Florence Knoll Model 65 Parallel Bar Tufted Sofa' : 'Florence Knoll Model 63 Tufted Lounge Settee',
    brand: 'Knoll Associates',
    collection: 'Florence Knoll 1954 Lounge Collection',
    sku: seats === 3 ? 'KN-65-3S-BCL' : 'KN-63-2S-BCL',
    finish: upholstery === 'ivory' ? 'Warm Ivory Bouclé Wool & Polished Chrome' : 'Camel Bouclé Wool & Polished Chrome',
    category: 'furniture',
    dimensionsMm: [Math.round(totalW * 1000), 840, 780],
  });

  parent.add(g);
  return g;
}

/** Tufted Eames black-leather cushion + covered buttons + perimeter welt loops. */
function buildEamesLeatherPadGroup(
  width: number,
  height: number,
  depth: number,
  crown: number,
  tuftDepth: number,
  leatherMat: THREE.Material,
  pos: readonly [number, number, number]
): THREE.Group {
  const grp = new THREE.Group();
  grp.position.set(pos[0], pos[1], pos[2]);
  addMesh(
    grp,
    buildTuftedCushionGeo({
      width, height, depth, crown, tuftsX: 2, tuftsZ: 2, tuftDepth, tuftRadius: 0.05, segX: 34, segY: 12, segZ: 26, tileM: 0.5,
    }),
    leatherMat,
    undefined,
    undefined,
    true
  );
  const weltGeo = buildCushionWeltLoopGeo(width * 0.96, depth * 0.96, 0.038, 0.0044, 60);
  attachTuftButtonsAndWelt(grp, weltGeo, {
    width, height, depth, crown, tuftsX: 2, tuftsZ: 2, tuftDepth, material: leatherMat,
  });
  return grp;
}

/**
 * Sculpted Eames Lounge Chair & Ottoman (Herman Miller 670 / 671, 1956):
 * 3 true 3D compound-curved `buildMoldedPlywoodShellGeo` rosewood shells + 1 ottoman shell,
 * dimpled `buildTuftedCushionGeo` cushions + covered buttons + welt seams, sculpted leather
 * armrests, die-cast aluminum back braces & shock mounts, and swept 5-star / 4-star spider bases.
 */
export function buildEamesLoungeAndOttoman(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
  }
): THREE.Group {
  const { name, position, rotationY } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(position[0], position[1], position[2]);
  g.rotation.y = rotationY;

  const chair = new THREE.Group();
  chair.name = `${name}.chair670`;
  addMesh(chair, buildSweptSpiderBaseGeo(5, 0.37, 0.25, 0.038), mcm.dieCastAlum, undefined, undefined, 'cast');
  addMesh(chair, prepGeo(new THREE.CylinderGeometry(0.023, 0.027, 0.135, 28)), mcm.blackenedSteel, [0, 0.235, 0]);

  const tiltCradle = new THREE.Group();
  tiltCradle.position.set(0, 0.305, -0.02);
  tiltCradle.rotation.x = -0.24; // Signature 15° permanent lounge recline
  chair.add(tiltCradle);

  addMesh(tiltCradle, bevelledBox(0.24, 0.018, 0.22, 0.005, 3, 0.4, 0.4), mcm.blackenedSteel, [0, -0.018, 0.01]);
  const seatShellGeo = buildMoldedPlywoodShellGeo({
    width: 0.68, depth: 0.54, sideCurl: 0.115, foreAftDish: 0.022, frontLipDrop: 0.026, cornerRound: 0.24, thickness: 0.014, segU: 32, segV: 22,
  });
  addMesh(tiltCradle, seatShellGeo, mcm.rosewood, [0, 0, 0.03], undefined, 'cast');
  tiltCradle.add(buildEamesLeatherPadGroup(0.61, 0.10, 0.50, 0.02, 0.016, mcm.blackLeather, [0, 0.08, 0.032]));

  // Lower lumbar & upper headrest compound-curved rosewood shells + 2x2 tufted leather cushions
  const backShellSpecs = [
    { y: 0.25, z: -0.25, tilt: 0.07, w: 0.66, d: 0.295, curl: 0.108, pw: 0.595, ph: 0.092, pd: 0.268, td: 0.015 },
    { y: 0.55, z: -0.27, tilt: 0.05, w: 0.64, d: 0.26, curl: 0.096, pw: 0.575, ph: 0.088, pd: 0.236, td: 0.014 },
  ] as const;
  for (const bs of backShellSpecs) {
    const unit = new THREE.Group();
    unit.position.set(0, bs.y, bs.z);
    unit.rotation.x = Math.PI * 0.5 - bs.tilt;
    const shGeo = buildMoldedPlywoodShellGeo({
      width: bs.w, depth: bs.d, sideCurl: bs.curl, foreAftDish: 0.014, frontLipDrop: 0.006, cornerRound: 0.23, thickness: 0.014, segU: 32, segV: 22,
    });
    addMesh(unit, shGeo, mcm.rosewood, undefined, undefined, 'cast');
    unit.add(buildEamesLeatherPadGroup(bs.pw, bs.ph, bs.pd, 0.018, bs.td, mcm.blackLeather, [0, 0.073, 0]));
    tiltCradle.add(unit);
  }

  // Die-cast aluminum back braces & neoprene shock-mount pucks
  const spineGeo = bevelledBox(0.028, 0.42, 0.018, 0.005, 4, 0.4, 0.4);
  const lowerBraceGeo = bevelledBox(0.024, 0.016, 0.21, 0.004, 3, 0.4, 0.4);
  const puckGeo = prepGeo(new THREE.CylinderGeometry(0.021, 0.021, 0.014, 24));
  for (const sx of [-0.19, 0.19]) {
    addMesh(tiltCradle, spineGeo, mcm.dieCastAlum, [sx, 0.40, -0.29], [-0.067, 0, 0], 'cast');
    addMesh(tiltCradle, lowerBraceGeo, mcm.dieCastAlum, [sx, 0.055, -0.185], [0.62, 0, 0]);
    for (const [py, pz] of [[0.25, -0.266], [0.55, -0.286]] as const) {
      addMesh(tiltCradle, puckGeo, mcm.formicaCharcoal, [sx, py, pz], [Math.PI * 0.5 - 0.06, 0, 0]);
    }
  }

  // Sculpted curved leather armrests + side neoprene shock mounts
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.022, -0.185),
    new THREE.Vector3(0, 0.01, -0.06),
    new THREE.Vector3(0, 0.012, 0.09),
    new THREE.Vector3(0, -0.02, 0.185),
  ]);
  const armCoreGeo = prepGeo(new THREE.TubeGeometry(armCurve, 28, 0.044, 20, false));
  armCoreGeo.scale(1.28, 0.78, 1);
  armCoreGeo.computeVertexNormals();
  const armWeltGeo = buildCushionWeltLoopGeo(0.104, 0.355, 0.036, 0.0038, 48);
  const sideShockGeo = prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.016, 24));
  for (const sx of [-1, 1]) {
    const armGrp = new THREE.Group();
    armGrp.position.set(sx * 0.368, 0.198, -0.018);
    armGrp.rotation.z = -sx * 0.08;
    addMesh(armGrp, armCoreGeo, mcm.blackLeather, undefined, undefined, 'cast');
    addMesh(armGrp, armWeltGeo, mcm.blackLeather, [0, -0.012, 0]);
    addMesh(tiltCradle, sideShockGeo, mcm.formicaCharcoal, [sx * 0.334, 0.195, -0.165], [0, 0, Math.PI * 0.5]);
    tiltCradle.add(armGrp);
  }
  g.add(chair);

  // 671 Matching Ottoman (`+0.88 m` forward along local +Z)
  const ottoman = new THREE.Group();
  ottoman.name = `${name}.ottoman671`;
  ottoman.position.set(0, 0, 0.88);
  addMesh(ottoman, buildSweptSpiderBaseGeo(4, 0.29, 0.28, 0.034), mcm.dieCastAlum, undefined, undefined, 'cast');
  addMesh(ottoman, prepGeo(new THREE.CylinderGeometry(0.021, 0.024, 0.115, 24)), mcm.blackenedSteel, [0, 0.26, 0]);
  const ottoShellGeo = buildMoldedPlywoodShellGeo({
    width: 0.65, depth: 0.53, sideCurl: 0.082, foreAftDish: 0.018, frontLipDrop: 0.018, cornerRound: 0.24, thickness: 0.014, segU: 32, segV: 22,
  });
  addMesh(ottoman, ottoShellGeo, mcm.rosewood, [0, 0.32, 0], undefined, 'cast');
  ottoman.add(buildEamesLeatherPadGroup(0.59, 0.096, 0.49, 0.02, 0.016, mcm.blackLeather, [0, 0.398, 0]));
  g.add(ottoman);

  registerSeat(ctx, g, {
    id: `${name}.seat`,
    label: 'Recline in Eames 670 Lounge Chair',
    aliases: [name, 'eames lounge', 'rosewood lounge chair'],
    localSeatPos: [0, 0.39, 0.02],
    localFootOffset: [0.58, 0, 0.42],
    localForward: [0, 0, 1],
    material: 'leather',
  });

  attachAssetMetadata(g, {
    name: 'Eames Lounge Chair & Ottoman (670 / 671)',
    brand: 'Herman Miller',
    collection: 'Charles & Ray Eames 1956',
    sku: 'HM-670-671-PAL',
    finish: 'Molded Santos Palisander Rosewood, Black Aniline Leather & Die-Cast Aluminum',
    category: 'furniture',
    dimensionsMm: [840, 1460, 840],
  });

  parent.add(g);
  return g;
}

/**
 * Van Keppel-Green Saddle-Leather & Steel Sling Lounge Chair:
 * `bevelledBox` blackened-steel square-tube sled frame, smooth 32-segment catenary
 * curved saddle-leather sling, and cylindrical/superellipsoid headrest bolster.
 */
export function buildVkgSlingLoungeChair(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
  }
): THREE.Group {
  const { name, position, rotationY } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(position[0], position[1], position[2]);
  g.rotation.y = rotationY;

  const w = 0.66;
  const d = 0.72;
  const tube = 0.022;
  const legFH = 0.54 - tube - 0.006;
  const legBH = 0.69;
  const legFGeo = bevelledBox(tube, legFH, tube, 0.003, 3, 0.5, 0.5);
  const legBGeo = bevelledBox(tube, legBH, tube, 0.003, 3, 0.5, 0.5);
  const runnerGeo = bevelledBox(tube, tube, d - 0.04, 0.003, 3, 0.5, 0.5);
  const armGeo = bevelledBox(0.038, 0.02, d - 0.13, 0.005, 4, 0.55, 0.55);

  for (const sx of [-1, 1]) {
    const x = sx * (w * 0.5 - tube * 0.5);
    addMesh(g, legFGeo, mcm.blackenedSteel, [x, tube + 0.003 + legFH * 0.5, d * 0.5 - 0.04], undefined, 'cast');
    addMesh(g, legBGeo, mcm.blackenedSteel, [x, tube + 0.005 + legBH * 0.5, -d * 0.5 + 0.05], [-0.14, 0, 0], 'cast');
    addMesh(g, runnerGeo, mcm.blackenedSteel, [x, 0.011, 0]);
    addMesh(g, armGeo, mcm.walnut, [x, 0.554, 0.025], undefined, 'cast');
  }
  const barGeo = bevelledBox(w - tube * 2 - 0.004, tube, tube, 0.003, 3, 0.5, 0.5);
  for (const [cy, cz] of [[0.34, d * 0.5 - 0.05], [0.30, -d * 0.5 + 0.08], [0.685, -d * 0.5 + 0.025]] as const) {
    addMesh(g, barGeo, mcm.blackenedSteel, [0, cy, cz]);
  }

  addMesh(g, buildVkgCatenarySlingGeo(w - 0.068, 32, 0.014), mcm.saddleLeather, undefined, undefined, true);
  const bolsterGeo = prepGeo(
    applyMetricBoxUVs(new THREE.CapsuleGeometry(0.052, w - 0.224, 14, 28), { tileW: 0.45, tileH: 0.45 })
  );
  addMesh(g, bolsterGeo, mcm.saddleLeather, [0, 0.642, -0.252], [0, 0, Math.PI * 0.5], 'cast');

  const strapGeo = bevelledBox(0.026, 0.095, 0.075, 0.004, 3, 0.35, 0.35);
  for (const sx of [-0.18, 0.18]) {
    addMesh(g, strapGeo, mcm.saddleLeather, [sx, 0.678, -0.292], [0.35, 0, 0]);
  }

  registerSeat(ctx, g, {
    id: `${name}.seat`,
    label: 'Sit in Van Keppel-Green Sling Lounge Chair',
    aliases: [name, 'sling chair', 'vkg chair'],
    localSeatPos: [0, 0.39, 0.02],
    localFootOffset: [0, 0, 0.68],
    localForward: [0, 0, 1],
    material: 'leather',
  });

  attachAssetMetadata(g, {
    name: 'Van Keppel-Green Saddle-Leather & Steel Sling Lounge Chair',
    brand: 'Hendrik Van Keppel & Taylor Green (VKG)',
    collection: 'Beverly Hills Indoor-Outdoor Modern',
    sku: 'VKG-504-SLG',
    finish: 'Saddle Tan Aniline Leather, American Walnut Arm Caps & Charcoal Square Steel',
    category: 'furniture',
    dimensionsMm: [660, 720, 740],
  });

  parent.add(g);
  return g;
}

/**
 * Low Honed Roman Travertine & American Walnut Slat Coffee Table (`1380 x 740 x 360 mm`)
 * with `bevelledBox` honed travertine slab, recessed blackened-steel T-base,
 * 48-seg `LatheGeometry` Murano amber glass bowl, and bevelled art books & June 1960 *Arts & Architecture*.
 */
export function buildTravertineCoffeeTable(
  parent: THREE.Object3D,
  mcm: McmMaterials,
  position: readonly [number, number, number]
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'stahl.living.coffeeTable';
  g.position.set(position[0], position[1], position[2]);

  const w = 1.38;
  const d = 0.74;
  const h = 0.36;
  const topT = 0.032;
  const legS = 0.022;
  const frameTopY = h - topT - 0.002;

  const legGeo = bevelledBox(legS, frameTopY, legS, 0.0025, 3, 0.5, 0.5);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addMesh(g, legGeo, mcm.blackenedSteel, [sx * (w * 0.5 - 0.065), frameTopY * 0.5, sz * (d * 0.5 - 0.065)], undefined, 'cast');
    }
  }
  const railX = bevelledBox(w - 0.13 - legS - 0.004, legS, legS, 0.0025, 3, 0.5, 0.5);
  const railZ = bevelledBox(legS, legS, d - 0.13 - legS - 0.004, 0.0025, 3, 0.5, 0.5);
  for (const ry of [0.132, frameTopY - legS * 0.5]) {
    for (const sz of [-1, 1]) addMesh(g, railX, mcm.blackenedSteel, [0, ry, sz * (d * 0.5 - 0.065)]);
    for (const sx of [-1, 1]) addMesh(g, railZ, mcm.blackenedSteel, [sx * (w * 0.5 - 0.065), ry, 0]);
  }
  addMesh(g, bevelledBox(w - 0.13 - legS - 0.004, legS, legS * 1.2, 0.0025, 3, 0.5, 0.5), mcm.blackenedSteel, [0, frameTopY - legS * 0.5, 0]);

  const slatGeo = bevelledBox(w - 0.17, 0.014, 0.054, 0.003, 3, 0.7, 0.7);
  for (let i = -3; i <= 3; i++) {
    addMesh(g, slatGeo, mcm.walnut, [0, 0.132 + legS * 0.5 + 0.009, i * 0.082], undefined, 'cast');
  }

  const topSlab = addMesh(g, bevelledBox(w, topT, d, 0.005, 4, 1.1, 1.1), mcm.travertine, [0, h - topT * 0.5, 0], undefined, true);
  topSlab.name = 'stahl.living.coffeeTable.travertineTop';

  // Tabletop objects (`>= 1.6 mm` clear above `y = 0.36` -> zero coplanar z-fighting)
  const surfY = h + 0.0016;
  addMesh(g, bevelledBox(0.27, 0.022, 0.34, 0.003, 3, 0.5, 0.5), mcm.formicaWhite, [-0.36, surfY + 0.011, 0.08], [0, 0.08, 0], 'cast');
  const magGeo = buildPlanarArtworkSlabGeo(0.245, 0.009, 0.32, 0.002, 'y');
  const magTop = addMesh(g, magGeo, mcm.aaCoverMat, [-0.34, surfY + 0.0281, 0.06], [0, -0.14, 0], 'cast');
  magTop.name = 'stahl.living.artsAndArchitecture1960';

  const vaseGeo = makeLatheGeo([[0, 0], [0.048, 0], [0.084, 0.072], [0.074, 0.162], [0.036, 0.214], [0.043, 0.244], [0.036, 0.244], [0.03, 0.205], [0, 0.205]], 48);
  const muranoGeo = makeLatheGeo([[0, 0], [0.056, 0], [0.092, 0.022], [0.098, 0.048], [0.086, 0.056], [0.07, 0.044], [0.048, 0.018], [0, 0.016]], 48);
  const bowlGeo = makeLatheGeo([[0, 0], [0.055, 0], [0.132, 0.04], [0.152, 0.078], [0.143, 0.078], [0.12, 0.04], [0.045, 0.012], [0, 0.012]], 48);
  addMesh(g, vaseGeo, mcm.ceramicTeal, [0.34, surfY, -0.11], undefined, 'cast');
  addMesh(g, muranoGeo, mcm.muranoAmberGlass, [0.02, surfY, 0.12], undefined, 'cast');
  addMesh(g, bowlGeo, mcm.walnut, [0.17, surfY, -0.03], undefined, 'cast');

  attachAssetMetadata(g, {
    name: 'Honed Roman Travertine & Walnut-Slat Architectural Coffee Table',
    brand: 'Case Study Custom / Van Keppel-Green',
    collection: 'CSH #22 Pavilion Furnishings',
    sku: 'CSH22-CT-1380',
    finish: 'Vein-Cut Honed Roman Travertine, American Black Walnut & Matte Charcoal Steel',
    category: 'furniture',
    dimensionsMm: [1380, 740, 360],
  });

  parent.add(g);
  return g;
}

/** Sculptural Walnut & Satin-Brass Tripod Floor Lamp (`24`-seg legs, `48`-seg linen drum shade). */
export function buildWalnutTripodFloorLamp(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  position: readonly [number, number, number]
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'stahl.living.tripodFloorLamp';
  g.position.set(position[0], position[1], position[2]);

  const hubY = 0.96;
  const hubPt = new THREE.Vector3(0, hubY, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + 0.35;
    const footPt = new THREE.Vector3(Math.cos(a) * 0.255, 0.035, Math.sin(a) * 0.255);
    const tipPt = new THREE.Vector3(Math.cos(a) * 0.264, 0.002, Math.sin(a) * 0.264);
    g.add(
      makeSpanCylinder(footPt, hubPt, 0.012, 0.019, 24, mcm.walnut, true),
      makeSpanCylinder(tipPt, footPt, 0.011, 0.0085, 24, mcm.satinBrass, false)
    );
  }
  addMesh(g, prepGeo(new THREE.CylinderGeometry(0.025, 0.029, 0.072, 28)), mcm.satinBrass, [0, hubY, 0]);
  addMesh(g, prepGeo(new THREE.CylinderGeometry(0.009, 0.011, 0.54, 24)), mcm.satinBrass, [0, hubY + 0.27, 0]);

  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xfaf3e4,
    map: mcm.pillowLinen.map,
    normalMap: mcm.pillowLinen.normalMap,
    normalScale: new THREE.Vector2(0.24, 0.24),
    emissive: new THREE.Color(0xffd598),
    emissiveIntensity: 1.15,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  addMesh(g, prepGeo(new THREE.CylinderGeometry(0.20, 0.24, 0.34, 48, 4, true)), shadeMat, [0, 1.48, 0]);
  addMesh(g, prepGeo(new THREE.TorusGeometry(0.20, 0.003, 12, 48)), mcm.satinBrass, [0, 1.65, 0], [Math.PI * 0.5, 0, 0]);
  addMesh(g, prepGeo(new THREE.TorusGeometry(0.24, 0.003, 12, 48)), mcm.satinBrass, [0, 1.31, 0], [Math.PI * 0.5, 0, 0]);
  addMesh(g, prepGeo(new THREE.SphereGeometry(0.04, 24, 18)), shadeMat, [0, 1.45, 0]);

  const grp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlLivingCones;
  if (grp) grp.emissives.push(shadeMat);
  ctx.addGlowPool('stahlLivingCones' as never, position[0], 0.008, position[2], 1.15, 0.18);

  attachAssetMetadata(g, {
    name: 'Mid-Century Sculpted Walnut & Brass Tripod Floor Lamp',
    brand: 'Greta Magnusson Grossman / Lightolier',
    collection: 'California Modern Lighting 1958',
    sku: 'LT-1958-TRP',
    finish: 'Turned American Walnut, Satin Brass & Linen Cocoon Drum Shade',
    category: 'lighting',
    dimensionsMm: [480, 480, 1650],
  });

  parent.add(g);
  return g;
}

/** Multi-harmonic floor-to-ceiling sheer pinch-pleat drapery stack (`buildPinchPleatDraperyGeo(..., 80, 20)`). */
export function addSheerPinchPleatDraperyStack(
  parent: THREE.Object3D,
  mcm: McmMaterials,
  options: {
    readonly name: string;
    readonly axis: 'x' | 'z';
    readonly center: readonly [number, number];
    readonly widthM: number;
    readonly ceilingTopY: number;
    readonly cutaway: CutawayWallDescriptor;
  }
): void {
  const { name, axis, center, widthM, ceilingTopY, cutaway } = options;
  const g = new THREE.Group();
  g.name = name;
  const botY = 0.012;
  const h = ceilingTopY - 0.022 - botY;
  g.position.set(center[0], botY + h * 0.5, center[1]);
  if (axis === 'z') g.rotation.y = Math.PI * 0.5;

  addMesh(g, bevelledBox(widthM + 0.06, 0.018, 0.032, 0.003, 3, 0.5, 0.5), mcm.dieCastAlum, [0, h * 0.5 + 0.01, 0]);
  const drapeMesh = addMesh(g, buildPinchPleatDraperyGeo(widthM, h, 0.048, 10, 80, 20), mcm.sheerCasement);
  drapeMesh.name = `${name}.pleats`;

  tagCollisionRole(g, 'ignore');
  tagCutaway(g, cutaway);
  parent.add(g);
}

/** Adds 4 splayed 24-seg walnut dowel legs, shock mounts, glides & 12-seg Eiffel wire cross-struts. */
export function addEamesDowelEiffelBase(parent: THREE.Object3D, mcm: McmMaterials): void {
  const glideGeo = prepGeo(new THREE.CylinderGeometry(0.013, 0.015, 0.008, 20));
  const shockGeo = prepGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 20));
  const midPts: THREE.Vector3[] = [];
  const topPts: THREE.Vector3[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const bot = new THREE.Vector3(sx * 0.21, 0.008, sz * 0.205);
    const top = new THREE.Vector3(sx * 0.142, 0.422, sz * 0.135);
    parent.add(makeSpanCylinder(bot, top, 0.014, 0.0092, 24, mcm.walnut, true));
    addMesh(parent, glideGeo, mcm.blackenedSteel, [bot.x, 0.004, bot.z]);
    addMesh(parent, shockGeo, mcm.formicaCharcoal, [top.x, top.y + 0.005, top.z]);
    midPts.push(new THREE.Vector3().lerpVectors(bot, top, 0.44));
    topPts.push(new THREE.Vector3().lerpVectors(bot, top, 0.93));
  }
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    const prev = (i + 3) % 4;
    parent.add(
      makeSpanCylinder(midPts[i]!, midPts[next]!, 0.003, 0.003, 12, mcm.blackenedSteel),
      makeSpanCylinder(topPts[i]!, midPts[next]!, 0.0028, 0.0028, 12, mcm.blackenedSteel),
      makeSpanCylinder(topPts[i]!, midPts[prev]!, 0.0028, 0.0028, 12, mcm.blackenedSteel)
    );
  }
  parent.add(
    makeSpanCylinder(topPts[0]!, topPts[2]!, 0.003, 0.003, 12, mcm.blackenedSteel),
    makeSpanCylinder(topPts[1]!, topPts[3]!, 0.003, 0.003, 12, mcm.blackenedSteel)
  );
}

/**
 * Eero Saarinen Oval Tulip Dining Table (`72`-seg pedestal + `80 x 7` chamfered knife-edge oval top),
 * 6 Eames `DSW` Molded Fiberglass Chairs (`40 x 30` organic buckets + `24`-seg dowels + `12`-seg Eiffel struts),
 * and George Nelson Saucer Bubble Pendant (`64 x 40` cocoon shade + `40`-seg brushed-steel rings).
 */
export function buildSaarinenDiningSetAndNelsonPendant(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  center: readonly [number, number],
  ceilingTopY: number
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'stahl.dining.saarinenOvalSet';
  g.position.set(center[0], 0.0006, center[1]);

  const pedestal = addMesh(g, buildSaarinenTulipPedestalGeo(0.36, 0.056, 0.25, 0.716, 72), mcm.porcelainWhite, undefined, undefined, 'cast');
  pedestal.scale.set(0.88, 1, 1.18);

  const topThick = 0.026;
  const tableTop = addMesh(g, buildChamferedOvalSlabGeo(0.61, 0.99, topThick, 80, 7, 0.95), mcm.travertine, [0, 0.717, 0], undefined, true);
  tableTop.name = 'stahl.dining.saarinenTop';

  const surfY = 0.717 + topThick + 0.0014;
  addMesh(
    g,
    makeLatheGeo([[0, 0], [0.064, 0], [0.175, 0.046], [0.196, 0.088], [0.184, 0.088], [0.154, 0.046], [0.048, 0.014], [0, 0.014]], 48),
    mcm.walnut,
    [0, surfY, 0],
    undefined,
    'cast'
  );

  const holderGeo = makeLatheGeo([[0, 0], [0.042, 0], [0.036, 0.01], [0.011, 0.038], [0.009, 0.072], [0.016, 0.09], [0.01, 0.09], [0, 0.082]], 40);
  for (const [cx, cz, ch] of [[-0.08, -0.34, 0.19], [0.07, 0.36, 0.24]] as const) {
    addMesh(g, holderGeo, mcm.satinBrass, [cx, surfY, cz], undefined, 'cast');
    addMesh(g, prepGeo(new THREE.CylinderGeometry(0.0068, 0.0098, ch, 20)), mcm.pillowLinen, [cx, surfY + 0.088 + ch * 0.5, cz]);
  }

  attachAssetMetadata(tableTop, {
    name: 'Saarinen Oval Pedestal Dining Table (198 cm)',
    brand: 'Knoll Associates',
    collection: 'Eero Saarinen Pedestal Collection (1957)',
    sku: 'KN-173-OVAL-TRV',
    finish: 'Honed Roman Travertine Beveled Oval Top & Molded White Rilsan Aluminum Base',
    category: 'furniture',
    dimensionsMm: [1220, 1980, 742],
  });

  const dswShellGeo = buildEamesFiberglassBucketGeo('DSW', 40, 30);
  const chairSpecs: readonly { readonly x: number; readonly z: number; readonly rotY: number; readonly mat: THREE.Material; readonly colorLabel: string }[] = [
    { x: 0, z: -1.16, rotY: 0, mat: mcm.fiberglassOchre, colorLabel: 'Ochre Light' },
    { x: 0, z: 1.16, rotY: Math.PI, mat: mcm.fiberglassOchre, colorLabel: 'Ochre Light' },
    { x: -0.78, z: -0.44, rotY: Math.PI * 0.5, mat: mcm.fiberglassParchment, colorLabel: 'Parchment' },
    { x: -0.78, z: 0.44, rotY: Math.PI * 0.5, mat: mcm.fiberglassSeafoam, colorLabel: 'Seafoam Green' },
    { x: 0.78, z: -0.44, rotY: -Math.PI * 0.5, mat: mcm.fiberglassSeafoam, colorLabel: 'Seafoam Green' },
    { x: 0.78, z: 0.44, rotY: -Math.PI * 0.5, mat: mcm.fiberglassParchment, colorLabel: 'Parchment' },
  ];

  chairSpecs.forEach((cs, idx) => {
    const ch = new THREE.Group();
    const chName = `stahl.dining.eamesChair_${idx + 1}`;
    ch.name = chName;
    ch.position.set(cs.x, 0, cs.z);
    ch.rotation.y = cs.rotY;
    addMesh(ch, dswShellGeo, cs.mat, [0, 0.445, 0.01], undefined, true);
    addEamesDowelEiffelBase(ch, mcm);

    registerSeat(ctx, ch, {
      id: `${chName}.seat`,
      label: `Sit in Eames Fiberglass Dining Chair (${cs.colorLabel})`,
      aliases: [chName, 'eames dining chair'],
      localSeatPos: [0, 0.46, 0.02],
      localFootOffset: [0, 0, -0.58],
      localForward: [0, 0, 1],
      material: 'timber',
    });

    attachAssetMetadata(ch, {
      name: `Eames Molded Fiberglass Dowel-Leg Side Chair (DSW — ${cs.colorLabel})`,
      brand: 'Herman Miller',
      collection: 'Charles & Ray Eames Fiberglass Group',
      sku: `HM-DSW-${idx + 1}`,
      finish: `${cs.colorLabel} Fiberglass Shell, American Walnut Dowels & Black Wire Cross-Struts`,
      category: 'furniture',
      dimensionsMm: [465, 550, 810],
    });
    g.add(ch);
  });
  parent.add(g);

  // George Nelson Saucer Bubble Pendant (`64 x 40` cocoon shade + `40`-seg brushed-steel rings)
  const saucerGroup = new THREE.Group();
  saucerGroup.name = 'stahl.dining.nelsonSaucerPendant';
  saucerGroup.position.set(center[0], 0, center[1]);
  const saucerY = 1.92;
  const cocoonMat = new THREE.MeshStandardMaterial({
    color: 0xfffaf0,
    normalMap: mcm.opalGlass.normalMap,
    normalScale: new THREE.Vector2(0.26, 0.26),
    emissive: new THREE.Color(0xffd6a0),
    emissiveIntensity: 1.45,
    roughness: 0.42,
    side: THREE.DoubleSide,
  });
  const cordLen = Math.max(0.05, ceilingTopY - 0.018 - (saucerY + 0.136));
  addMesh(saucerGroup, buildNelsonSaucerShadeGeo(0.42, 0.25, 64, 40), cocoonMat, [0, saucerY, 0]);
  addMesh(saucerGroup, prepGeo(new THREE.CylinderGeometry(0.103, 0.103, 0.016, 40)), mcm.brushedStainless, [0, saucerY + 0.128, 0]);
  addMesh(saucerGroup, prepGeo(new THREE.CylinderGeometry(0.101, 0.101, 0.014, 40)), mcm.brushedStainless, [0, saucerY - 0.128, 0]);
  addMesh(saucerGroup, prepGeo(new THREE.CylinderGeometry(0.062, 0.056, 0.018, 40)), mcm.brushedStainless, [0, ceilingTopY - 0.009, 0]);
  addMesh(saucerGroup, prepGeo(new THREE.CylinderGeometry(0.0042, 0.0042, cordLen, 16)), mcm.blackenedSteel, [0, saucerY + 0.136 + cordLen * 0.5, 0]);

  const dinGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlDiningPendant;
  if (dinGrp) dinGrp.emissives.push(cocoonMat);

  attachAssetMetadata(saucerGroup, {
    name: 'George Nelson Saucer Bubble Pendant (Medium)',
    brand: 'Howard Miller / Herman Miller',
    collection: 'George Nelson Bubble Lamps (1952)',
    sku: 'GN-BUBBLE-SAUCER-M',
    finish: 'Translucent Sprayed Resin Cocoon Web & Brushed Nickel End Rings',
    category: 'lighting',
    dimensionsMm: [840, 840, 260],
  });

  parent.add(saucerGroup);
  return g;
}
