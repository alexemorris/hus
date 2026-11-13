import * as THREE from 'three';
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

/** Farrow & Ball *Pigeon No. 25* (`#969B90`) calm heritage stone-sage cabinetry palette (`estate-eggshell` 20% sheen). */

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

export const FB_PIGEON_CABINETRY = 0x969b90;
export const FB_GREEN_SMOKE = 0x6f7b71;

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

export function buildGeorgianCloakroomWashstand(
  namePrefix: string,
  brassMat: THREE.Material,
  carraraMat: THREE.Material,
  oakMat: THREE.Material
): THREE.Group {
  const root = new THREE.Group();
  root.name = namePrefix;

  const w = 0.52;
  const d = 0.37;
  const topY = 0.755;
  const slabT = 0.025;
  const apronH = 0.075;
  const legTopY = topY - slabT;

  addBox(root, `${namePrefix}.carraraSlab`, [w, slabT, d], [0, topY - slabT * 0.5, d * 0.5], carraraMat);
  addBox(root, `${namePrefix}.carraraUpstand`, [w, 0.065, 0.018], [0, topY + 0.033, 0.009], carraraMat);

  addBox(
    root,
    `${namePrefix}.oakApronFront`,
    [w - 0.09, apronH, 0.02],
    [0, legTopY - apronH * 0.5 - 0.002, d - 0.038],
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
      [sx * (w * 0.5 - 0.035), legTopY - apronH * 0.5 - 0.002, (d - 0.04) * 0.5],
      oakMat
    );
    const leg = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.013, 0.011, legTopY - 0.002, 14)),
      brassMat
    );
    leg.name = `${namePrefix}.brassConsoleLeg${sTag}`;
    leg.position.set(sx * (w * 0.5 - 0.035), (legTopY - 0.002) * 0.5, d - 0.038);
    leg.castShadow = true;
    root.add(leg);
  }
  const towelRail = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.007, 0.007, w - 0.09, 12)),
    brassMat
  );
  towelRail.name = `${namePrefix}.frontTowelBar`;
  towelRail.rotation.z = Math.PI * 0.5;
  towelRail.position.set(0, 0.58, d - 0.038);
  root.add(towelRail);

  const basin = buildThomasCrapperDownhamBasin({
    namePrefix: `${namePrefix}.downhamBasin`,
    finish: 'SB',
  });
  basin.position.set(0, topY + 0.001, 0.022);
  root.add(basin);

  const wallMixer = buildArmstrongWallBasinMixer({
    namePrefix: `${namePrefix}.wallMixer`,
    finish: 'SB',
    tipCapOffsetM: 0.001,
  });
  wallMixer.position.set(0, topY + 0.255, 0.002);
  root.add(wallMixer);

  return root;
}

/** Framed minimalist botanical stem print + leaning vintage dark-oak breadboards on counter. */
export function buildFramedBotanicalStemPrint(namePrefix: string, darkOakMat: THREE.Material): THREE.Group {
  const root = new THREE.Group();
  root.name = namePrefix;
  const frameW = 0.34;
  const frameH = 0.44;
  const bar = 0.014;
  const paperMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.cottonRagPaper`,
    color: 0xf1eadc,
    roughness: 0.92,
  });
  const inkMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.charcoalInk`,
    color: 0x242622,
    roughness: 0.85,
  });

  // Outer slender walnut-oak frame (z = 0 at wall, projecting +Z)
  addBox(root, `${namePrefix}.frameTop`, [frameW, bar, 0.018], [0, frameH * 0.5 - bar * 0.5, 0.009], darkOakMat);
  addBox(root, `${namePrefix}.frameBot`, [frameW, bar, 0.018], [0, -frameH * 0.5 + bar * 0.5, 0.009], darkOakMat);
  addBox(root, `${namePrefix}.frameLeft`, [bar, frameH - bar * 2, 0.018], [-frameW * 0.5 + bar * 0.5, 0, 0.009], darkOakMat);
  addBox(root, `${namePrefix}.frameRight`, [bar, frameH - bar * 2, 0.018], [frameW * 0.5 - bar * 0.5, 0, 0.009], darkOakMat);
  addBox(root, `${namePrefix}.ragMount`, [frameW - bar * 2, frameH - bar * 2, 0.006], [0, 0, 0.006], paperMat);

  // Minimalist botanical stem & 4 oval leaves
  const stem = addBox(root, `${namePrefix}.botanicalStem`, [0.007, 0.24, 0.002], [0.01, -0.02, 0.011], inkMat);
  stem.rotation.z = -0.12;
  for (const [idx, lx, ly, rx, ry] of [
    [1, -0.032, 0.065, 0.034, 0.044],
    [2, 0.042, 0.035, 0.028, 0.038],
    [3, -0.038, -0.015, 0.03, 0.04],
    [4, 0.035, -0.055, 0.026, 0.034],
  ] as const) {
    const leaf = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(rx, ry, 0.002, 14)), inkMat);
    leaf.name = `${namePrefix}.botanicalLeaf_${idx}`;
    leaf.rotation.x = Math.PI * 0.5;
    leaf.position.set(lx, ly, 0.012);
    root.add(leaf);
  }
  return root;
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
      mat.name.endsWith('.paint')
    ) {
      child.material = eggShellMat;
    }
  });
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
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
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

interface FullWidthGeorgianAlcoveBookcaseOptions {
  readonly name: string;
  readonly widthM: number;
  readonly heightM: number;
  readonly baseDepthM: number;
  readonly upperDepthM: number;
  readonly paintMat: THREE.Material;
  readonly oakMat: THREE.Material;
  readonly brassMat: THREE.Material;
  readonly darkBrassMat: THREE.Material;
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

  const ledMat = new THREE.MeshStandardMaterial({
    name: `${name}.ledWash2700k`,
    color: 0xfff0d4,
    emissive: new THREE.Color(0xffb969),
    emissiveIntensity: 1.35,
    roughness: 0.32,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    name: `${name}.apothecaryGlass`,
    color: 0xdce6e0,
    roughness: 0.08,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    transparent: true,
    opacity: 0.62,
  });
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
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addBox(
      root,
      `${name}.baseCheek${sTag}`,
      [wallT, baseBodyH, carcassInnerD],
      [sign * (w * 0.5 - wallT * 0.5), baseBodyMidY, carcassInnerD * 0.5],
      paintMat
    );
  }

  const bayOpenW = (w - outerScribeW * 2 - midStileW * (nBays - 1)) / nBays;
  const railH = 0.044;
  const doorOpenH = baseBodyH - railH * 2;
  const doorOpenCy = plinthH + railH + doorOpenH * 0.5;
  const fz = baseD - frameT * 0.5;

  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addBox(
      root,
      `${name}.baseScribeStile${sTag}`,
      [outerScribeW, baseBodyH, frameT],
      [sign * (w * 0.5 - outerScribeW * 0.5), baseBodyMidY, fz],
      paintMat
    );
  }

  for (let i = 1; i < nBays; i++) {
    const stileCx = -w * 0.5 + outerScribeW + i * bayOpenW + (i - 0.5) * midStileW;
    addBox(root, `${name}.baseMidStile_${i}`, [midStileW, baseBodyH, frameT], [stileCx, baseBodyMidY, fz], paintMat);
    addBox(
      root,
      `${name}.baseDivider_${i}`,
      [0.018, baseBodyH - wallT * 2 - 0.002, carcassInnerD - 0.02],
      [stileCx, baseBodyMidY, 0.018 + (carcassInnerD - 0.02) * 0.5],
      oakMat
    );
  }

  const doorPivots: THREE.Group[] = [];
  for (let b = 0; b < nBays; b++) {
    const bayCx = -w * 0.5 + outerScribeW + (b + 0.5) * bayOpenW + b * midStileW;
    addBox(root, `${name}.baseRailTop_${b + 1}`, [bayOpenW - 0.0006, railH, frameT], [bayCx, carcassH - railH * 0.5, fz], paintMat);
    addBox(root, `${name}.baseRailBot_${b + 1}`, [bayOpenW - 0.0006, railH, frameT], [bayCx, plinthH + railH * 0.5, fz], paintMat);
    addBox(
      root,
      `${name}.baseInnerShelf_${b + 1}`,
      [bayOpenW + 0.012, 0.018, carcassInnerD - 0.04],
      [bayCx, baseBodyMidY, 0.02 + (carcassInnerD - 0.04) * 0.5],
      oakMat
    );

    const beadT = 0.005;
    const beadD = 0.006;
    const beadZ = baseD + beadD * 0.5 + 0.0004;
    addBox(root, `${name}.baseBeadTop_${b + 1}`, [bayOpenW + beadT * 2, beadT, beadD], [bayCx, doorOpenCy + doorOpenH * 0.5 + beadT * 0.5, beadZ], paintMat);
    addBox(root, `${name}.baseBeadBot_${b + 1}`, [bayOpenW + beadT * 2, beadT, beadD], [bayCx, doorOpenCy - doorOpenH * 0.5 - beadT * 0.5, beadZ], paintMat);
    addBox(root, `${name}.baseBeadLeft_${b + 1}`, [beadT, doorOpenH, beadD], [bayCx - bayOpenW * 0.5 - beadT * 0.5, doorOpenCy, beadZ], paintMat);
    addBox(root, `${name}.baseBeadRight_${b + 1}`, [beadT, doorOpenH, beadD], [bayCx + bayOpenW * 0.5 + beadT * 0.5, doorOpenCy, beadZ], paintMat);

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

    const pivot = registerHingedDoor(ctx, {
      parent: root,
      door: doorGroup,
      hingeOffset: [hingeSign * (leafW * 0.5 - 0.012), 0, leafT * 0.5],
      axis: 'y',
      openAngle: isLeftLeaf ? -Math.PI * 0.39 : Math.PI * 0.39,
    });
    doorPivots.push(pivot);
  }
  if (doorPivots.length === 4) {
    ctx.interactions.linkDoorPair(doorPivots[0]!, doorPivots[1]!);
    ctx.interactions.linkDoorPair(doorPivots[2]!, doorPivots[3]!);
  }

  const counterFrontNosing = 0.018;
  addBox(
    root,
    `${name}.counterLedge`,
    [w, counterH * 0.72, baseD + counterFrontNosing],
    [0, carcassH + counterH * 0.64, (baseD + counterFrontNosing) * 0.5],
    paintMat
  );
  addBox(
    root,
    `${name}.counterCoveUnder`,
    [w - 0.004, counterH * 0.28, baseD + counterFrontNosing * 0.55],
    [0, carcassH + counterH * 0.14, (baseD + counterFrontNosing * 0.55) * 0.5],
    paintMat
  );

  const crownH = 0.096;
  const upperBodyH = totalH - baseH - crownH;
  const upperMidY = baseH + upperBodyH * 0.5;
  const pilasterW = 0.068;
  const upperBayClearW = (w - pilasterW * (nBays + 1)) / nBays;

  const innerSpanW = w - 0.048;
  const nBoards = Math.max(24, Math.round(innerSpanW / 0.096));
  const boardPitch = innerSpanW / nBoards;
  for (let i = 0; i < nBoards; i++) {
    addBox(
      root,
      `${name}.upperTgBack_${i + 1}`,
      [boardPitch - 0.0025, upperBodyH - 0.024, 0.015],
      [-innerSpanW * 0.5 + (i + 0.5) * boardPitch, upperMidY - 0.01, 0.0095],
      paintMat
    );
  }

  const cheekD = upperD - 0.026;
  for (let pIdx = 0; pIdx <= nBays; pIdx++) {
    const px = -w * 0.5 + pilasterW * 0.5 + pIdx * (upperBayClearW + pilasterW);
    if (pIdx === 0 || pIdx === nBays) {
      const sign = pIdx === 0 ? -1 : 1;
      addBox(
        root,
        `${name}.upperOuterCheek_${pIdx === 0 ? 'Left' : 'Right'}`,
        [0.024, upperBodyH, cheekD],
        [sign * (w * 0.5 - 0.012), upperMidY, cheekD * 0.5],
        paintMat
      );
    } else {
      addBox(
        root,
        `${name}.upperBayDivider_${pIdx}`,
        [0.024, upperBodyH - 0.024, cheekD - 0.018],
        [px, upperMidY - 0.01, 0.018 + (cheekD - 0.018) * 0.5],
        paintMat
      );
    }

    addBox(root, `${name}.pilasterBase_${pIdx + 1}`, [pilasterW + 0.004, 0.092, 0.028], [px, baseH + 0.046, upperD - 0.012], paintMat);
    addBox(root, `${name}.pilasterCapital_${pIdx + 1}`, [pilasterW + 0.008, 0.084, 0.032], [px, baseH + upperBodyH - 0.042, upperD - 0.01], paintMat);
    const shaftH = upperBodyH - 0.178;
    const shaftMidY = baseH + 0.093 + shaftH * 0.5;
    addBox(root, `${name}.pilasterCore_${pIdx + 1}`, [pilasterW, shaftH, 0.022], [px, shaftMidY, upperD - 0.014], paintMat);
    for (let f = 0; f < 4; f++) {
      const fx = px - pilasterW * 0.34 + f * (pilasterW * 0.2267);
      const reed = addBox(
        root,
        `${name}.pilasterReed_${pIdx + 1}_${f + 1}`,
        [0.007, shaftH - 0.028, 0.005],
        [fx, shaftMidY, upperD - 0.0002],
        paintMat
      );
      tagHighLodDetail(reed);
    }
  }

  addBox(
    root,
    `${name}.upperSoffit`,
    [w - 0.048, 0.022, cheekD - 0.02],
    [0, baseH + upperBodyH - 0.011, 0.018 + (cheekD - 0.02) * 0.5],
    paintMat
  );
  const friezeH = crownH * 0.38;
  const dentilBandH = crownH * 0.22;
  const cymaCapH = crownH * 0.4;
  const friezeY = totalH - crownH + friezeH * 0.5;
  const dentilY = totalH - cymaCapH - dentilBandH * 0.5;
  const cymaY = totalH - cymaCapH * 0.5;

  addBox(root, `${name}.crownFrieze`, [w, friezeH, upperD + 0.012], [0, friezeY, (upperD + 0.012) * 0.5], paintMat);
  addBox(root, `${name}.crownDentilBacker`, [w, dentilBandH, upperD + 0.022], [0, dentilY, (upperD + 0.022) * 0.5], paintMat);
  const nDentils = Math.floor((w - 0.08) / 0.044);
  const dentilPitch = (w - 0.08) / nDentils;
  for (let d = 0; d < nDentils; d++) {
    const dent = addBox(
      root,
      `${name}.crownDentil_${d + 1}`,
      [0.02, dentilBandH - 0.003, 0.012],
      [-(w - 0.08) * 0.5 + (d + 0.5) * dentilPitch, dentilY, upperD + 0.0285],
      paintMat
    );
    tagHighLodDetail(dent);
  }
  addBox(root, `${name}.crownCymaCap`, [w, cymaCapH, upperD + 0.044], [0, cymaY, (upperD + 0.044) * 0.5], paintMat);

  const bookHexPalette = [0x6a2c22, 0x283b4c, 0x4b5847, 0xcabfa8, 0x7b5638, 0x3b3531, 0xded6c5, 0x876b4d];
  const bookMats = bookHexPalette.map(
    (hex, i) =>
      new THREE.MeshStandardMaterial({
        name: `${name}.bookCloth_${i + 1}`,
        color: hex,
        roughness: 0.66,
      })
  );
  const shelfD = cheekD - 0.024;
  const shelfCz = 0.019 + shelfD * 0.5;

  for (let b = 0; b < nBays; b++) {
    const bayCx = -w * 0.5 + pilasterW + b * (upperBayClearW + pilasterW) + upperBayClearW * 0.5;
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const sy = baseH + ((sIdx + 1) / 5) * (upperBodyH - 0.07);
      addBox(
        root,
        `${name}.shelf_b${b + 1}_s${sIdx + 1}`,
        [upperBayClearW - 0.001, 0.024, shelfD],
        [bayCx, sy, shelfCz],
        paintMat
      );
      const wash = addBox(
        root,
        `${name}.shelfLed_b${b + 1}_s${sIdx + 1}`,
        [upperBayClearW - 0.05, 0.004, 0.009],
        [bayCx, sy - 0.0145, upperD - 0.046],
        ledMat
      );
      tagHighLodDetail(wash);

      const surfaceY = sy + 0.0125;
      const pattern = (b + sIdx) % 3;
      if (pattern === 0) {
        let cursor = bayCx - upperBayClearW * 0.44;
        const count = 7 + ((b + sIdx) % 3);
        for (let k = 0; k < count; k++) {
          const bt = 0.025 + ((k * 7 + b * 3 + sIdx) % 4) * 0.006;
          if (cursor + bt > bayCx + upperBayClearW * 0.14) break;
          const bh = 0.195 + ((k * 5 + sIdx * 3 + b) % 5) * 0.018;
          const bd = 0.165 + ((k + b) % 2) * 0.018;
          const bk = addBox(
            root,
            `${name}.book_b${b + 1}_s${sIdx + 1}_${k + 1}`,
            [bt - 0.0012, bh, bd],
            [cursor + bt * 0.5, surfaceY + bh * 0.5, 0.032 + bd * 0.5],
            bookMats[(k + b * 2 + sIdx * 3) % bookMats.length]!
          );
          tagHighLodDetail(bk);
          cursor += bt + 0.0015;
        }
        const vx = bayCx + upperBayClearW * 0.28;
        const vase = new THREE.Mesh(
          prepGeo(new THREE.CylinderGeometry(0.034, 0.044, 0.155, 16)),
          (b + sIdx) % 2 === 0 ? ceramicCreamMat : ceramicCeladonMat
        );
        vase.name = `${name}.ceramicVessel_b${b + 1}_s${sIdx + 1}`;
        vase.position.set(vx, surfaceY + 0.078, shelfCz);
        vase.castShadow = true;
        tagHighLodDetail(vase);
        root.add(vase);
      } else if (pattern === 1) {
        let cursor = bayCx + upperBayClearW * 0.44;
        const count = 7 + ((b * 2 + sIdx) % 3);
        for (let k = 0; k < count; k++) {
          const bt = 0.026 + ((k * 5 + b + sIdx * 2) % 4) * 0.006;
          if (cursor - bt < bayCx - upperBayClearW * 0.08) break;
          const bh = 0.19 + ((k * 3 + sIdx + b * 2) % 5) * 0.019;
          const bd = 0.168 + ((k + sIdx) % 2) * 0.016;
          const bk = addBox(
            root,
            `${name}.book_b${b + 1}_s${sIdx + 1}_${k + 1}`,
            [bt - 0.0012, bh, bd],
            [cursor - bt * 0.5, surfaceY + bh * 0.5, 0.032 + bd * 0.5],
            bookMats[(k * 2 + b + sIdx) % bookMats.length]!
          );
          tagHighLodDetail(bk);
          cursor -= bt + 0.0015;
        }
        const sx = bayCx - upperBayClearW * 0.27;
        for (let h = 0; h < 3; h++) {
          const stackW = 0.21 - h * 0.014;
          const stackD = 0.165 - h * 0.01;
          const sb = addBox(
            root,
            `${name}.quartoStack_b${b + 1}_s${sIdx + 1}_${h + 1}`,
            [stackW, 0.028, stackD],
            [sx, surfaceY + 0.014 + h * 0.0295, shelfCz],
            bookMats[(h * 3 + b + sIdx) % bookMats.length]!
          );
          tagHighLodDetail(sb);
        }
      } else {
        let leftX = bayCx - upperBayClearW * 0.43;
        for (let k = 0; k < 4; k++) {
          const bt = 0.027 + ((k + b) % 3) * 0.006;
          const bh = 0.205 + ((k * 3 + sIdx) % 4) * 0.017;
          const bk = addBox(
            root,
            `${name}.bookL_b${b + 1}_s${sIdx + 1}_${k + 1}`,
            [bt - 0.0012, bh, 0.172],
            [leftX + bt * 0.5, surfaceY + bh * 0.5, 0.118],
            bookMats[(k + b + sIdx * 2) % bookMats.length]!
          );
          tagHighLodDetail(bk);
          leftX += bt + 0.0015;
        }
        let rightX = bayCx + upperBayClearW * 0.43;
        for (let k = 0; k < 4; k++) {
          const bt = 0.026 + ((k + sIdx) % 3) * 0.006;
          const bh = 0.198 + ((k * 2 + b) % 4) * 0.018;
          const bk = addBox(
            root,
            `${name}.bookR_b${b + 1}_s${sIdx + 1}_${k + 1}`,
            [bt - 0.0012, bh, 0.172],
            [rightX - bt * 0.5, surfaceY + bh * 0.5, 0.118],
            bookMats[(k * 3 + b + sIdx) % bookMats.length]!
          );
          tagHighLodDetail(bk);
          rightX -= bt + 0.0015;
        }
        if (sIdx === 0) {
          const bottle = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.032, 0.036, 0.11, 14)), glassMat);
          bottle.name = `${name}.diffuserBottle_b${b + 1}_s${sIdx + 1}`;
          bottle.position.set(bayCx, surfaceY + 0.055, shelfCz);
          tagHighLodDetail(bottle);
          root.add(bottle);
          const collar = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.015, 0.017, 0.018, 12)), brassMat);
          collar.name = `${name}.diffuserCollar_b${b + 1}_s${sIdx + 1}`;
          collar.position.set(bayCx, surfaceY + 0.119, shelfCz);
          tagHighLodDetail(collar);
          root.add(collar);
        } else {
          const plinth = addBox(root, `${name}.objetPlinth_b${b + 1}_s${sIdx + 1}`, [0.072, 0.022, 0.072], [bayCx, surfaceY + 0.011, shelfCz], oakMat);
          const orb = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.038, 16, 12)), brassMat);
          orb.name = `${name}.brassOrb_b${b + 1}_s${sIdx + 1}`;
          orb.position.set(bayCx, surfaceY + 0.06, shelfCz);
          tagHighLodDetail(plinth);
          tagHighLodDetail(orb);
          root.add(orb);
        }
      }
    }
  }

  root.position.set(opts.position[0], opts.position[1], opts.position[2]);
  root.rotation.y = opts.rotationY;
  return root;
}

