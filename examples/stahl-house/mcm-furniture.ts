import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  SeatInteractable,
  collectSeatClickableMeshes,
  createSculptedCushionGeometry,
} from 'husjs/catalog/furniture';
import {
  attachAssetMetadata,
  prepGeo,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import { metricBox, type McmMaterials } from './mcm-materials.ts';

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

/**
 * Tailored Florence Knoll Model 65 / 63 Tufted Lounge Sofa (`3-seat` or `2-seat` settee)
 * with exposed brushed-chrome tubular base frame, crisp box-welted bouclé cushions & button tufting.
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

  // Exposed chrome architectural perimeter cradle & 4 corner legs (+ center legs on 3-seat)
  const railXGeo = prepGeo(new THREE.BoxGeometry(totalW - 0.02, railT, railT));
  for (const rz of [-depth * 0.5 + 0.04, depth * 0.5 - 0.04]) {
    const rail = new THREE.Mesh(railXGeo, mcm.polishedChrome);
    rail.position.set(0, legH + railT * 0.5, rz);
    g.add(rail);
  }
  const railZGeo = prepGeo(new THREE.BoxGeometry(railT, railT, depth - 0.08 - railT * 2 - 0.006));
  for (const rx of [-totalW * 0.5 + 0.03, totalW * 0.5 - 0.03]) {
    const sRail = new THREE.Mesh(railZGeo, mcm.polishedChrome);
    sRail.position.set(rx, legH + railT * 0.5, 0);
    g.add(sRail);
  }
  const legClearH = legH - 0.003;
  const legGeo = prepGeo(new THREE.BoxGeometry(railT, legClearH, railT));
  const legXs = seats === 3 ? [-totalW * 0.5 + 0.03, 0, totalW * 0.5 - 0.03] : [-totalW * 0.5 + 0.03, totalW * 0.5 - 0.03];
  for (const lx of legXs) {
    for (const lz of [-depth * 0.5 + 0.04, depth * 0.5 - 0.04]) {
      const leg = new THREE.Mesh(legGeo, mcm.polishedChrome);
      leg.position.set(lx, legClearH * 0.5, lz);
      leg.castShadow = true;
      g.add(leg);
    }
  }

  // Upholstered deck, back shell & crisp box arms (3 mm clear gaps to avoid coplanar overlap)
  const deckY = legH + railT + 0.003;
  const deckH = 0.105;
  const deck = new THREE.Mesh(metricBox(totalInnerW - 0.008, deckH, depth - 0.13, 0.65, 0.65), fabMat);
  deck.position.set(0, deckY + deckH * 0.5, 0.05);
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);

  const outerBackH = 0.555;
  const outerBack = new THREE.Mesh(metricBox(totalInnerW - 0.008, outerBackH, 0.085, 0.65, 0.65), fabMat);
  outerBack.position.set(0, deckY + outerBackH * 0.5, -depth * 0.5 + 0.048);
  outerBack.castShadow = outerBack.receiveShadow = true;
  g.add(outerBack);

  const armH = 0.425;
  const armGeo = metricBox(armW, armH, depth - 0.01, 0.65, 0.65);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, fabMat);
    arm.position.set(sx * (totalW * 0.5 - armW * 0.5), deckY + armH * 0.5, 0);
    arm.castShadow = arm.receiveShadow = true;
    g.add(arm);
  }

  // Individual sculpted seat & back cushions with grid button tufting
  const seatCushH = 0.135;
  const seatCushD = 0.62;
  const seatCushGeo = prepGeo(createSculptedCushionGeometry(seatW - 0.012, seatCushH, seatCushD, 14, 6, 12, 0.46, 'standard'));
  const backCushH = 0.36;
  const backCushD = 0.145;
  const backCushGeo = prepGeo(createSculptedCushionGeometry(seatW - 0.014, backCushH, backCushD, 14, 8, 8, 0.46, 'standard'));
  const btnGeo = prepGeo(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 10));

  for (let i = 0; i < seats; i++) {
    const cx = -totalInnerW * 0.5 + seatW * (i + 0.5);
    const sc = new THREE.Mesh(seatCushGeo, fabMat);
    sc.name = `${name}.seatCushion_${i + 1}`;
    const scY = deckY + deckH + seatCushH * 0.5 - 0.004;
    const scZ = 0.075;
    sc.position.set(cx, scY, scZ);
    sc.castShadow = sc.receiveShadow = true;
    g.add(sc);

    for (const bx of [-seatW * 0.24, seatW * 0.24]) {
      for (const bz of [-0.14, 0.14]) {
        const btn = new THREE.Mesh(btnGeo, fabMat);
        btn.name = `${name}.button_s_${i}_${bx > 0 ? 'r' : 'l'}_${bz > 0 ? 'f' : 'b'}`;
        btn.position.set(cx + bx, scY + seatCushH * 0.5 - 0.002, scZ + bz);
        g.add(btn);
      }
    }

    const bc = new THREE.Mesh(backCushGeo, fabMat);
    bc.name = `${name}.backCushion_${i + 1}`;
    const bcY = deckY + deckH + seatCushH + backCushH * 0.5 - 0.025;
    const bcZ = -depth * 0.5 + 0.09 + backCushD * 0.5;
    bc.position.set(cx, bcY, bcZ);
    bc.rotation.x = -0.09;
    bc.castShadow = bc.receiveShadow = true;
    g.add(bc);

    for (const bx of [-seatW * 0.24, seatW * 0.24]) {
      for (const by of [-0.08, 0.08]) {
        const btn = new THREE.Mesh(btnGeo, fabMat);
        btn.name = `${name}.button_b_${i}_${bx > 0 ? 'r' : 'l'}_${by > 0 ? 'u' : 'd'}`;
        btn.rotation.x = Math.PI * 0.5 - 0.09;
        btn.position.set(cx + bx, bcY + by, bcZ + backCushD * 0.5 - 0.003 - by * 0.09);
        g.add(btn);
      }
    }
  }

  // Accent mid-century bolster pillow on one end
  const accentMat = upholstery === 'ivory' ? mcm.throwOchre : mcm.boucleIvory;
  const accentPillow = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(0.42, 0.34, 0.13, 10, 8, 6, 0.52, 'standard', true)),
    accentMat
  );
  accentPillow.position.set(totalInnerW * 0.5 - 0.24, deckY + deckH + seatCushH + 0.14, 0.06);
  accentPillow.rotation.set(-0.14, -0.38, 0.12);
  accentPillow.castShadow = true;
  g.add(accentPillow);

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

/** Builds a curved molded plywood veneer U-shell (extruded rounded-corner channel) for Eames 670/671. */
function createCurvedPlywoodShellGeo(width: number, height: number, wingDepth: number, thick = 0.014): THREE.BufferGeometry {
  const r = 0.075;
  const hw = width * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, wingDepth);
  shape.lineTo(-hw, r);
  shape.quadraticCurveTo(-hw, 0, -hw + r, 0);
  shape.lineTo(hw - r, 0);
  shape.quadraticCurveTo(hw, 0, hw, r);
  shape.lineTo(hw, wingDepth);
  shape.lineTo(hw - thick, wingDepth);
  shape.lineTo(hw - thick, r + thick * 0.4);
  shape.quadraticCurveTo(hw - thick, thick, hw - r, thick);
  shape.lineTo(-hw + r, thick);
  shape.quadraticCurveTo(-hw + thick, thick, -hw + thick, r + thick * 0.4);
  shape.lineTo(-hw + thick, wingDepth);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    curveSegments: 10,
  });
  geo.translate(0, 0, -height * 0.5);
  return prepGeo(geo);
}

function addSwivelStarBase(
  parent: THREE.Object3D,
  arms: 4 | 5,
  radius: number,
  hubTopY: number,
  mcm: McmMaterials
): void {
  const hub = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.032, 0.038, hubTopY - 0.055, 16)), mcm.blackenedSteel);
  hub.position.y = 0.055 + (hubTopY - 0.055) * 0.5;
  parent.add(hub);

  const armLen = radius - 0.025;
  const armGeo = prepGeo(new THREE.BoxGeometry(0.026, 0.018, armLen));
  const capGeo = prepGeo(new THREE.BoxGeometry(0.018, 0.005, armLen - 0.01));
  const glideGeo = prepGeo(new THREE.CylinderGeometry(0.022, 0.026, 0.012, 12));

  for (let i = 0; i < arms; i++) {
    const a = (i * Math.PI * 2) / arms + Math.PI / arms;
    const armGrp = new THREE.Group();
    armGrp.rotation.y = a;

    const strut = new THREE.Mesh(armGeo, mcm.blackenedSteel);
    strut.position.set(0, 0.052, armLen * 0.5 + 0.018);
    strut.rotation.x = 0.21;
    const cap = new THREE.Mesh(capGeo, mcm.dieCastAlum);
    cap.position.set(0, 0.062, armLen * 0.5 + 0.018);
    cap.rotation.x = 0.21;
    const glide = new THREE.Mesh(glideGeo, mcm.dieCastAlum);
    glide.position.set(0, 0.006, radius);
    armGrp.add(strut, cap, glide);
    parent.add(armGrp);
  }
}

/**
 * Sculpted Eames Lounge Chair & Ottoman (Herman Miller 670 / 671, 1956):
 * 3 curved Santos Palisander rosewood veneer shells, tufted black aniline leather cushions,
 * die-cast aluminum backrest spines, and 5-star / 4-star swivel bases.
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

  // --- 670 Lounge Chair ---
  const chair = new THREE.Group();
  chair.name = `${name}.chair670`;
  addSwivelStarBase(chair, 5, 0.37, 0.285, mcm);

  const tiltCradle = new THREE.Group();
  tiltCradle.position.set(0, 0.31, -0.02);
  tiltCradle.rotation.x = -0.24; // Signature 15° permanent lounge recline!
  chair.add(tiltCradle);

  // Seat rosewood shell (lying horizontally in cradle)
  const seatShell = new THREE.Mesh(createCurvedPlywoodShellGeo(0.68, 0.54, 0.14), mcm.rosewood);
  seatShell.rotation.x = Math.PI * 0.5;
  seatShell.position.set(0, 0, 0.03);
  seatShell.castShadow = true;
  tiltCradle.add(seatShell);

  const seatPad = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(0.63, 0.125, 0.52, 12, 6, 10, 0.5, 'standard')),
    mcm.blackLeather
  );
  seatPad.position.set(0, 0.082, 0.035);
  seatPad.castShadow = true;
  tiltCradle.add(seatPad);

  // Mid lumbar & upper headrest rosewood shells
  const lumbarShell = new THREE.Mesh(createCurvedPlywoodShellGeo(0.66, 0.31, 0.13), mcm.rosewood);
  lumbarShell.rotation.x = -0.14;
  lumbarShell.position.set(0, 0.24, -0.25);
  lumbarShell.castShadow = true;
  tiltCradle.add(lumbarShell);

  const lumbarPad = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(0.61, 0.28, 0.115, 12, 8, 6, 0.5, 'standard')),
    mcm.blackLeather
  );
  lumbarPad.rotation.x = -0.14;
  lumbarPad.position.set(0, 0.245, -0.175);
  lumbarPad.castShadow = true;
  tiltCradle.add(lumbarPad);

  const headShell = new THREE.Mesh(createCurvedPlywoodShellGeo(0.64, 0.26, 0.11), mcm.rosewood);
  headShell.rotation.x = -0.1;
  headShell.position.set(0, 0.55, -0.29);
  headShell.castShadow = true;
  tiltCradle.add(headShell);

  const headPad = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(0.59, 0.24, 0.11, 12, 8, 6, 0.5, 'standard')),
    mcm.blackLeather
  );
  headPad.rotation.x = -0.1;
  headPad.position.set(0, 0.55, -0.22);
  headPad.castShadow = true;
  tiltCradle.add(headPad);

  // Die-cast aluminum rear spine brackets linking lumbar & headrest shells + upholstered armrests
  const spineGeo = prepGeo(new THREE.BoxGeometry(0.028, 0.42, 0.022));
  for (const sx of [-0.19, 0.19]) {
    const spine = new THREE.Mesh(spineGeo, mcm.dieCastAlum);
    spine.position.set(sx, 0.39, -0.288);
    spine.rotation.x = -0.12;
    tiltCradle.add(spine);
  }
  const armPadGeo = prepGeo(createSculptedCushionGeometry(0.115, 0.085, 0.38, 8, 6, 8, 0.52, 'standard'));
  for (const sx of [-1, 1]) {
    const armPad = new THREE.Mesh(armPadGeo, mcm.blackLeather);
    armPad.position.set(sx * 0.375, 0.21, -0.02);
    armPad.castShadow = true;
    tiltCradle.add(armPad);
  }

  g.add(chair);

  // --- 671 Matching Ottoman (`+0.88 m` forward along local +Z) ---
  const ottoman = new THREE.Group();
  ottoman.name = `${name}.ottoman671`;
  ottoman.position.set(0, 0, 0.88);
  addSwivelStarBase(ottoman, 4, 0.29, 0.31, mcm);

  const ottoShell = new THREE.Mesh(createCurvedPlywoodShellGeo(0.65, 0.53, 0.095), mcm.rosewood);
  ottoShell.rotation.x = Math.PI * 0.5;
  ottoShell.position.set(0, 0.32, 0);
  ottoShell.castShadow = true;
  const ottoPad = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(0.61, 0.12, 0.49, 12, 6, 10, 0.5, 'standard')),
    mcm.blackLeather
  );
  ottoPad.position.set(0, 0.39, 0);
  ottoPad.castShadow = true;
  ottoman.add(ottoShell, ottoPad);
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
 * Van Keppel-Green / Mid-Century Corded & Saddle-Leather Sling Lounge Chair
 * (as photographed by Julius Shulman in Case Study House #22!).
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

  // Blackened square-tube steel architectural sled/cradle frame
  const legFH = 0.54 - tube - 0.006;
  const legFGeo = prepGeo(new THREE.BoxGeometry(tube, legFH, tube));
  const legBH = 0.69;
  const legBGeo = prepGeo(new THREE.BoxGeometry(tube, legBH, tube));
  const runnerGeo = prepGeo(new THREE.BoxGeometry(tube, tube, d - 0.04));
  const armGeo = prepGeo(new THREE.BoxGeometry(0.036, 0.018, d - 0.13));

  for (const sx of [-1, 1]) {
    const x = sx * (w * 0.5 - tube * 0.5);
    const lf = new THREE.Mesh(legFGeo, mcm.blackenedSteel);
    lf.position.set(x, tube + 0.003 + legFH * 0.5, d * 0.5 - 0.04);
    const lb = new THREE.Mesh(legBGeo, mcm.blackenedSteel);
    lb.position.set(x, tube + 0.005 + legBH * 0.5, -d * 0.5 + 0.05);
    lb.rotation.x = -0.14;
    const runner = new THREE.Mesh(runnerGeo, mcm.blackenedSteel);
    runner.position.set(x, 0.011, 0);
    const arm = new THREE.Mesh(armGeo, mcm.walnut);
    arm.position.set(x, 0.553, 0.025);
    lf.castShadow = lb.castShadow = true;
    g.add(lf, lb, runner, arm);
  }
  for (const [cy, cz] of [[0.34, d * 0.5 - 0.05], [0.30, -d * 0.5 + 0.08], [0.68, -d * 0.5 - 0.01]] as const) {
    const bar = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(w - tube * 2 - 0.006, tube, tube)), mcm.blackenedSteel);
    bar.position.set(0, cy, cz);
    g.add(bar);
  }

  // Saddle-leather / corded taut sling seat & backrest
  const seatSling = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(w - 0.06, 0.065, d - 0.14, 10, 4, 10, 0.44, 'standard')),
    mcm.saddleLeather
  );
  seatSling.position.set(0, 0.36, 0.02);
  seatSling.rotation.x = -0.1;
  seatSling.castShadow = true;

  const backSling = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(w - 0.06, 0.34, 0.055, 10, 6, 4, 0.44, 'standard')),
    mcm.saddleLeather
  );
  backSling.position.set(0, 0.56, -d * 0.5 + 0.06);
  backSling.rotation.x = -0.18;
  backSling.castShadow = true;
  g.add(seatSling, backSling);

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
 * styled with *Arts & Architecture* June 1960 magazine, studio ceramic vessel,
 * amber Murano Sommerso glass ashtray, and turned walnut bowl.
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
  const frameTopY = h - topT - 0.003;

  // Blackened-steel architectural frame & 4 corner legs
  const legGeo = prepGeo(new THREE.BoxGeometry(legS, frameTopY, legS));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mcm.blackenedSteel);
      leg.position.set(sx * (w * 0.5 - 0.045), frameTopY * 0.5, sz * (d * 0.5 - 0.045));
      leg.castShadow = true;
      g.add(leg);
    }
  }
  const railX = prepGeo(new THREE.BoxGeometry(w - 0.09 - legS - 0.006, legS, legS));
  const railZ = prepGeo(new THREE.BoxGeometry(legS, legS, d - 0.09 - legS - 0.006));
  for (const ry of [0.135, frameTopY - legS * 0.5]) {
    for (const sz of [-1, 1]) {
      const rx = new THREE.Mesh(railX, mcm.blackenedSteel);
      rx.position.set(0, ry, sz * (d * 0.5 - 0.045));
      g.add(rx);
    }
    for (const sx of [-1, 1]) {
      const rz = new THREE.Mesh(railZ, mcm.blackenedSteel);
      rz.position.set(sx * (w * 0.5 - 0.045), ry, 0);
      g.add(rz);
    }
  }

  // Lower American walnut slatted magazine shelf (`7` longitudinal walnut slats)
  const slatGeo = metricBox(w - 0.14, 0.014, 0.056, 0.7, 0.7);
  for (let i = -3; i <= 3; i++) {
    const slat = new THREE.Mesh(slatGeo, mcm.walnut);
    slat.position.set(0, 0.135 + legS * 0.5 + 0.010, i * 0.088);
    g.add(slat);
  }

  // Vein-cut honed Roman travertine slab top
  const topSlab = new THREE.Mesh(metricBox(w, topT, d, 0.95, 0.95), mcm.travertine);
  topSlab.name = 'stahl.living.coffeeTable.travertineTop';
  topSlab.position.y = h - topT * 0.5;
  topSlab.castShadow = topSlab.receiveShadow = true;
  g.add(topSlab);

  const surfY = h + 0.0008;

  // Two Arts & Architecture magazine issues (June 1960 Case Study House #22 feature!)
  const magBase = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.25, 0.009, 0.325)), mcm.formicaWhite);
  magBase.position.set(-0.36, surfY + 0.0045, 0.08);
  magBase.rotation.y = 0.08;
  const magTop = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.25, 0.009, 0.325)), mcm.aaCoverMat);
  magTop.name = 'stahl.living.artsAndArchitecture1960';
  magTop.position.set(-0.34, surfY + 0.0142, 0.06);
  magTop.rotation.y = -0.14;
  magTop.castShadow = true;
  g.add(magBase, magTop);

  // Mid-century studio stoneware teal ceramic vessel (`LatheGeometry`)
  const vasePts = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.048, 0),
    new THREE.Vector2(0.084, 0.075),
    new THREE.Vector2(0.072, 0.165),
    new THREE.Vector2(0.036, 0.215),
    new THREE.Vector2(0.044, 0.245),
    new THREE.Vector2(0.037, 0.245),
    new THREE.Vector2(0.031, 0.21),
  ];
  const vase = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(vasePts, 20)), mcm.ceramicTeal);
  vase.position.set(0.34, surfY, -0.11);
  vase.castShadow = true;
  g.add(vase);

  // Murano Sommerso amber faceted glass ashtray
  const ashtray = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.078, 0.062, 0.036, 8)), mcm.muranoAmberGlass);
  ashtray.position.set(0.04, surfY + 0.018, 0.12);
  g.add(ashtray);

  // Sculptural turned American walnut bowl
  const bowlPts = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.055, 0),
    new THREE.Vector2(0.135, 0.042),
    new THREE.Vector2(0.152, 0.078),
    new THREE.Vector2(0.144, 0.078),
    new THREE.Vector2(0.122, 0.042),
    new THREE.Vector2(0.045, 0.012),
    new THREE.Vector2(0.001, 0.012),
  ];
  const bowl = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(bowlPts, 22)), mcm.walnut);
  bowl.position.set(0.16, surfY, -0.02);
  bowl.castShadow = true;
  g.add(bowl);

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

/** Sculptural Walnut & Satin-Brass Tripod Floor Lamp wired to `stahlLivingCones`. */
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
  const legLen = 0.99;
  const legGeo = prepGeo(new THREE.CylinderGeometry(0.012, 0.019, legLen, 10));
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + 0.35;
    const leg = new THREE.Mesh(legGeo, mcm.walnut);
    leg.position.set(Math.cos(a) * 0.135, hubY * 0.5, Math.sin(a) * 0.135);
    leg.rotation.order = 'YXZ';
    leg.rotation.y = -a + Math.PI * 0.5;
    leg.rotation.x = 0.27;
    leg.castShadow = true;
    g.add(leg);
  }
  const brassCollar = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.026, 0.028, 0.065, 14)), mcm.satinBrass);
  brassCollar.position.y = hubY;
  const stem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.009, 0.011, 0.54, 12)), mcm.satinBrass);
  stem.position.y = hubY + 0.27;

  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xfaf3e4,
    emissive: new THREE.Color(0xffd598),
    emissiveIntensity: 1.15,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  const shade = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.20, 0.24, 0.34, 24, 1, true)), shadeMat);
  shade.position.y = 1.48;
  const bulb = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.038, 12, 10)), shadeMat);
  bulb.position.y = 1.45;
  g.add(brassCollar, stem, shade, bulb);

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

/**
 * Sheer floor-to-ceiling architectural pinch-pleat open casement drapery panel stack
 * parked neatly beside structural H-columns so the 270° Los Angeles vista stays wide open.
 */
export function addSheerPinchPleatDraperyStack(
  parent: THREE.Object3D,
  mcm: McmMaterials,
  options: {
    readonly name: string;
    readonly axis: 'x' | 'z'; // 'z' = runs along Z beside East glass; 'x' = runs along X beside South glass
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
  const topY = ceilingTopY - 0.022;
  const h = topY - botY;
  g.position.set(center[0], botY + h * 0.5, center[1]);
  if (axis === 'z') g.rotation.y = Math.PI * 0.5;

  // Slim anodized ceiling drapery track
  const track = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(widthM + 0.06, 0.018, 0.028)), mcm.dieCastAlum);
  track.position.y = h * 0.5 + 0.009;
  g.add(track);

  // Continuous sinusoidal pinch-pleat sheer casement ribbon (`8` crisp architectural pleats)
  const segU = 36;
  const segV = 8;
  const posArr = new Float32Array((segU + 1) * (segV + 1) * 3);
  const uvArr = new Float32Array((segU + 1) * (segV + 1) * 2);
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    const y = (0.5 - v) * h;
    const flare = 1 + 0.08 * v;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const x = (u - 0.5) * widthM * flare;
      const pleat = Math.sin(u * Math.PI * 15) * 0.036;
      const idx = iv * (segU + 1) + iu;
      posArr[idx * 3] = x;
      posArr[idx * 3 + 1] = y;
      posArr[idx * 3 + 2] = pleat;
      uvArr[idx * 2] = u;
      uvArr[idx * 2 + 1] = v;
    }
  }
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * (segU + 1) + iu;
      const b = a + 1;
      const c = a + (segU + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const drapeGeo = new THREE.BufferGeometry();
  drapeGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  drapeGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  drapeGeo.setIndex(indices);
  drapeGeo.computeVertexNormals();

  const drapeMesh = new THREE.Mesh(prepGeo(drapeGeo), mcm.sheerCasement);
  drapeMesh.name = `${name}.pleats`;
  g.add(drapeMesh);

  tagCollisionRole(g, 'ignore');
  tagCutaway(g, cutaway);
  parent.add(g);
}

/**
 * Eero Saarinen Oval Tulip Dining Table (`1980 x 1220 x 740 mm`) surrounded by
 * 6 Eames Molded Fiberglass Dining Chairs (`DSW` / `DAR` in parchment, ochre & seafoam),
 * plus George Nelson Saucer Bubble Pendant overhead.
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

  // --- Saarinen Cast-Aluminum White Rilsan Tulip Pedestal (`LatheGeometry`) ---
  const pedPts = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.35, 0),
    new THREE.Vector2(0.34, 0.016),
    new THREE.Vector2(0.16, 0.065),
    new THREE.Vector2(0.082, 0.22),
    new THREE.Vector2(0.066, 0.44),
    new THREE.Vector2(0.095, 0.62),
    new THREE.Vector2(0.24, 0.708),
    new THREE.Vector2(0.001, 0.708),
  ];
  const pedestal = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(pedPts, 28)), mcm.porcelainWhite);
  pedestal.scale.set(0.88, 1, 1.18);
  pedestal.castShadow = true;
  g.add(pedestal);

  // Beveled Oval Honed Roman Travertine Top (`1.22 m` X-width x `1.98 m` Z-length)
  const ovalShape = new THREE.Shape();
  ovalShape.absellipse(0, 0, 0.61, 0.99, 0, Math.PI * 2, false, 0);
  const topGeo = new THREE.ExtrudeGeometry(ovalShape, {
    depth: 0.024,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.012,
    bevelThickness: 0.008,
    curveSegments: 36,
  });
  topGeo.rotateX(Math.PI * 0.5);
  const tableTop = new THREE.Mesh(prepGeo(topGeo), mcm.travertine);
  tableTop.name = 'stahl.dining.saarinenTop';
  tableTop.position.y = 0.742;
  tableTop.castShadow = tableTop.receiveShadow = true;
  g.add(tableTop);

  // Centerpiece sculptural walnut bowl + pair of satin-brass mid-century taper candlesticks
  const surfY = 0.751;
  const centerBowlPts = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.065, 0),
    new THREE.Vector2(0.175, 0.048),
    new THREE.Vector2(0.195, 0.088),
    new THREE.Vector2(0.184, 0.088),
    new THREE.Vector2(0.155, 0.048),
    new THREE.Vector2(0.001, 0.014),
  ];
  const centerBowl = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(centerBowlPts, 24)), mcm.walnut);
  centerBowl.position.set(0, surfY, 0);
  centerBowl.castShadow = true;
  g.add(centerBowl);

  for (const [cx, cz, ch] of [[-0.08, -0.34, 0.19], [0.07, 0.36, 0.24]] as const) {
    const holder = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.012, 0.042, 0.09, 14)), mcm.satinBrass);
    holder.position.set(cx, surfY + 0.045, cz);
    const taper = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.007, 0.01, ch, 10)), mcm.pillowLinen);
    taper.position.set(cx, surfY + 0.09 + ch * 0.5, cz);
    g.add(holder, taper);
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

  // --- 6 Eames Molded Fiberglass Dowel-Leg Dining Chairs (`DSW`) ---
  const chairSpecs: readonly {
    readonly x: number;
    readonly z: number;
    readonly rotY: number;
    readonly mat: THREE.Material;
    readonly colorLabel: string;
  }[] = [
    { x: 0, z: -1.16, rotY: 0, mat: mcm.fiberglassOchre, colorLabel: 'Ochre Light' },
    { x: 0, z: 1.16, rotY: Math.PI, mat: mcm.fiberglassOchre, colorLabel: 'Ochre Light' },
    { x: -0.78, z: -0.44, rotY: Math.PI * 0.5, mat: mcm.fiberglassParchment, colorLabel: 'Parchment' },
    { x: -0.78, z: 0.44, rotY: Math.PI * 0.5, mat: mcm.fiberglassSeafoam, colorLabel: 'Seafoam Green' },
    { x: 0.78, z: -0.44, rotY: -Math.PI * 0.5, mat: mcm.fiberglassSeafoam, colorLabel: 'Seafoam Green' },
    { x: 0.78, z: 0.44, rotY: -Math.PI * 0.5, mat: mcm.fiberglassParchment, colorLabel: 'Parchment' },
  ];

  const legDowelGeo = prepGeo(new THREE.CylinderGeometry(0.013, 0.009, 0.435, 10));
  const wireStrutGeo = prepGeo(new THREE.CylinderGeometry(0.0035, 0.0035, 0.36, 6));

  chairSpecs.forEach((cs, idx) => {
    const ch = new THREE.Group();
    const chName = `stahl.dining.eamesChair_${idx + 1}`;
    ch.name = chName;
    ch.position.set(cs.x, 0, cs.z);
    ch.rotation.y = cs.rotY;

    // Molded fiberglass waterfall seat + contoured bucket backrest
    const seatBucket = new THREE.Mesh(
      prepGeo(createSculptedCushionGeometry(0.465, 0.042, 0.44, 10, 4, 10, 0.52, 'standard')),
      cs.mat
    );
    seatBucket.position.set(0, 0.44, 0.015);
    seatBucket.castShadow = true;

    const backBucket = new THREE.Mesh(
      prepGeo(createSculptedCushionGeometry(0.45, 0.35, 0.036, 10, 8, 4, 0.52, 'standard')),
      cs.mat
    );
    backBucket.position.set(0, 0.625, -0.195);
    backBucket.rotation.x = -0.16;
    backBucket.castShadow = true;
    ch.add(seatBucket, backBucket);

    // 4 splayed walnut dowel legs + blackened-steel X-wire cross-struts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(legDowelGeo, mcm.walnut);
        leg.position.set(sx * 0.18, 0.215, sz * 0.175);
        leg.rotation.z = -sx * 0.15;
        leg.rotation.x = sz * 0.15;
        leg.castShadow = true;
        ch.add(leg);
      }
    }
    for (const ry of [0.35, -0.35]) {
      const wire = new THREE.Mesh(wireStrutGeo, mcm.blackenedSteel);
      wire.position.set(0, 0.27, 0);
      wire.rotation.set(Math.PI * 0.5, 0, ry);
      ch.add(wire);
    }

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

  // --- George Nelson Saucer Bubble Pendant (`LatheGeometry` ribbed cocoon) ---
  const saucerGroup = new THREE.Group();
  saucerGroup.name = 'stahl.dining.nelsonSaucerPendant';
  saucerGroup.position.set(center[0], 0, center[1]);

  const saucerY = 1.92;
  const saucerPts: THREE.Vector2[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 = bottom ring, 1 = top ring
    const y = (t - 0.5) * 0.25;
    const r = 0.08 + 0.34 * Math.sin(t * Math.PI);
    saucerPts.push(new THREE.Vector2(r, y));
  }
  const cocoonMat = new THREE.MeshStandardMaterial({
    color: 0xfffaf0,
    emissive: new THREE.Color(0xffd6a0),
    emissiveIntensity: 1.45,
    roughness: 0.46,
    side: THREE.DoubleSide,
  });
  const saucerMesh = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(saucerPts, 32)), cocoonMat);
  saucerMesh.position.y = saucerY;
  const topCap = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.086, 0.086, 0.016, 20)), mcm.brushedStainless);
  topCap.position.y = saucerY + 0.128;
  const botCap = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.082, 0.082, 0.014, 20)), mcm.brushedStainless);
  botCap.position.y = saucerY - 0.128;
  const cordLen = ceilingTopY - (saucerY + 0.136);
  const cord = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.0045, 0.0045, cordLen, 8)), mcm.blackenedSteel);
  cord.position.y = saucerY + 0.136 + cordLen * 0.5;
  saucerGroup.add(saucerMesh, topCap, botCap, cord);

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

