import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import {
  applyMetricBoxUVs,
  createPaintMaterial,
} from 'husjs/materials';
import {
  attachAudioEmitter,
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  createDadoRun,
  prepGeo,
  registerHingedDoor,
  sharedCylinderGeometry,
  tagCutaway,
  tagHighLodDetail,
} from 'husjs/objects';
import {
  buildGeorgianBolectionFireplace,
  buildNeptuneBootBenchAndPegRail,
  buildNeptuneInFrameCabinetRun,
  buildNeptuneLarderPantry,
  buildNeptuneOakPrepIslandTable,
  buildPaintedCorbelKitchenShelf,
  buildPlasterRangeChimneyBreast,
  buildShawsBelfastSinkAndBridgeTap,
  buildTongueAndGrooveDadoPanelling,
  buildWovenCordOakCounterStool,
  getPaleEuropeanOakJoineryMaterial,
} from 'husjs/catalog/architectural';
import {
  buildCuratedMirrorsArtAndRugs,
  buildGeorgianAntiqueCasework,
  buildGeorgianFiresideSet,
  buildNeptuneArmchair,
  buildNeptuneArundelDiningSet,
  buildNeptuneChichesterGlazedDresser,
  buildNeptuneOakTablesAndBedsides,
  buildNeptuneUpholsteredSofa,
  buildWhiteCompanyAccessories,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import {
  buildArmstrongPaperHolder,
  buildArmstrongWallBasinMixer,
  buildPerrinRoweTowelRing,
  buildThomasCrapperDownhamBasin,
  buildThomasCrapperLowLevelWc,
  getBathroomBrassMaterials,
  getHonedCarraraMarbleMaterial,
} from 'husjs/catalog/sanitaryware';
import {
  buildLacancheCluny1000Range,
} from 'husjs/catalog/appliances';
import type { SceneBuilderContext } from 'husjs/viewer';
import { DRAWING_BREAST, IN_X, IN_Z, type SimpleHouseShell } from './architecture.ts';
import { FFL_GROUND, GROUND_CEILING_SOFFIT_Y } from './electrical-and-rooms.ts';

/** Farrow & Ball *Pigeon No. 25* (`#969B90`) calm heritage stone-sage cabinetry palette (`estate-eggshell` 20% sheen). */

function deconflictRomanBlind(blind: THREE.Group, facingZ: 1 | -1): THREE.Group {
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

function deconflictCurtainBrackets(curtains: THREE.Group, inwardSignX: 1 | -1): THREE.Group {
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

const FB_PIGEON_CABINETRY = 0x969b90;
const FB_GREEN_SMOKE = 0x6f7b71;

function addBox(
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

function buildGeorgianCloakroomWashstand(
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
function buildFramedBotanicalStemPrint(namePrefix: string, darkOakMat: THREE.Material): THREE.Group {
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

function applyEstateEggshellPaintToJoinery(
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

function buildFullWidthGeorgianAlcoveBookcase(
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

export function buildSimpleHouseGroundInteriors(
  ctx: SceneBuilderContext,
  shell: SimpleHouseShell
): void {
  const groundGroup = ctx.floor ? ctx.floor('ground').group : ctx.scene;
  const groundCeilingGroup = ctx.floor
    ? ctx.floor('ground').ceilingGroup
    : ctx.groundFloorCeilingGroup;

  const root = new THREE.Group();
  root.name = 'simpleHouse.interiors.ground';
  groundGroup.add(root);

  const brassMats = getBathroomBrassMaterials('SB');
  const carraraMat = getHonedCarraraMarbleMaterial();
  const paleOakMat = getPaleEuropeanOakJoineryMaterial();
  const pigeonEggshellMat = createPaintMaterial({
    color: 'pigeon',
    sheen: 'estate-eggshell',
  });
  const schoolHouseEggshellMat = createPaintMaterial({
    color: 'school-house-white',
    sheen: 'estate-eggshell',
  });
  const darkOakMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.joinery.vintageWalnutOak',
    color: 0x4b3524,
    roughness: 0.52,
  });

  // =========================================================================
  // 1. East Wing — Neptune Olive-Moss, Pale Oak & Carrara Kitchen-Diner
  // =========================================================================
  const kitchenGroup = new THREE.Group();
  kitchenGroup.name = 'simpleHouse.kitchenDiner';
  kitchenGroup.userData.zoneId = 'houseKitchenDiner';
  root.add(kitchenGroup);

  const eastCut = shell.cut('east', 'ground');
  const northCut = shell.cut('north', 'ground');

  // East wall left of chimney breast: Olive-Moss Chichester drawer bank + 40 mm pale oak worktop & leaning vintage breadboards
  const eastBaseNorth = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastBaseNorth',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'paleOak',
    hardwareStyle: 'knobOnly',
    bays: [{ kind: 'drawerBank3', widthM: 0.94 }],
    position: [5.112, FFL_GROUND + 0.001, -2.99],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(eastBaseNorth, eastCut);

  // Two leaning vintage dark-oak chopping boards & turned pepper mill on left pale-oak worktop
  const boardLarge = addBox(
    kitchenGroup,
    'simpleHouse.kitchen.leaningOakBoardLarge',
    [0.022, 0.44, 0.32],
    [5.35, FFL_GROUND + 1.12, -2.86],
    darkOakMat
  );
  boardLarge.rotation.z = 0.1;
  const boardSmall = new THREE.Mesh(
    prepGeo(
      applyMetricBoxUVs(new THREE.BoxGeometry(0.02, 0.34, 0.25), {
        tileW: 0.9,
        tileH: 0.9,
        topTileV: 0.9,
      })
    ),
    paleOakMat
  );
  boardSmall.name = 'simpleHouse.kitchen.leaningOakBoardSmall';
  boardSmall.position.set(5.31, FFL_GROUND + 1.07, -2.92);
  boardSmall.castShadow = true;
  boardSmall.receiveShadow = true;
  kitchenGroup.add(boardSmall);
  boardSmall.rotation.z = 0.13;
  tagCutaway(boardLarge, eastCut);
  tagCutaway(boardSmall, eastCut);

  // Full-height lime-plaster range chimney breast w/ glossy handmade cream metro tile Inglenook & leaning stoneware platters
  const rangeChimneyBreast = buildPlasterRangeChimneyBreast({
    name: 'simpleHouse.kitchen.rangeChimneyBreast',
    widthM: 1.64,
    depthM: 0.66,
    ceilingHeightM: GROUND_CEILING_SOFFIT_Y,
    apertureWidthM: 1.04,
    apertureHeightM: 1.68,
    plasterMaterial: shell.schemes.houseKitchenDiner.walls,
    includeMantlePlatters: true,
    position: [5.412, FFL_GROUND + 0.001, -1.64],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(rangeChimneyBreast, eastCut);

  // Ivory Lacanche Cluny 1000 Classic range cooker recessed inside the metro-tiled Inglenook
  const lacancheRange = buildLacancheCluny1000Range(ctx, {
    name: 'simpleHouse.kitchen.lacancheRange',
    finish: 'ivory',
    cookware: 'dutchOven',
    position: [5.07, FFL_GROUND + 0.001, -1.64],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(lacancheRange, eastCut);

  // East wall right of chimney breast: Olive-Moss drawer cabinet + brushed-stainless espresso machine + framed botanical print
  const eastBaseMid = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastBaseMid',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'paleOak',
    hardwareStyle: 'knobOnly',
    bays: [{ kind: 'drawerBank3', widthM: 0.68 }],
    position: [5.112, FFL_GROUND + 0.001, -0.44],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(eastBaseMid, eastCut);

  const sageEspresso = new THREE.Group();
  sageEspresso.name = 'simpleHouse.kitchen.stainlessEspressoMachine';
  sageEspresso.position.set(5.11, FFL_GROUND + 0.902, -0.28);
  sageEspresso.rotation.y = -Math.PI / 2;
  const ssMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.kitchen.espressoStainless',
    color: 0xd8dce0,
    roughness: 0.24,
    metalness: 0.88,
  });
  const blackTrimMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.kitchen.espressoBlack',
    color: 0x1e2022,
    roughness: 0.45,
    metalness: 0.15,
  });
  const hopperMat = new THREE.MeshPhysicalMaterial({
    name: 'simpleHouse.kitchen.espressoHopper',
    color: 0x3b332c,
    roughness: 0.18,
    transmission: 0,
    transparent: true,
    opacity: 0.82,
  });
  addBox(sageEspresso, 'simpleHouse.kitchen.espressoMachine.dripTray', [0.31, 0.042, 0.30], [0, 0.021, 0.01], ssMat);
  addBox(sageEspresso, 'simpleHouse.kitchen.espressoMachine.dripGrille', [0.27, 0.004, 0.11], [0, 0.045, 0.085], blackTrimMat);
  addBox(sageEspresso, 'simpleHouse.kitchen.espressoMachine.tower', [0.305, 0.195, 0.185], [0, 0.141, -0.047], ssMat);
  addBox(sageEspresso, 'simpleHouse.kitchen.espressoMachine.controlHead', [0.31, 0.092, 0.275], [0, 0.286, -0.002], ssMat);
  const gaugeBezel = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 24)), blackTrimMat);
  gaugeBezel.name = 'simpleHouse.kitchen.espressoMachine.pressureGauge';
  gaugeBezel.rotation.x = Math.PI / 2;
  gaugeBezel.position.set(0, 0.286, 0.139);
  sageEspresso.add(gaugeBezel);
  const groupHead = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.036, 0.034, 0.034, 20)), blackTrimMat);
  groupHead.name = 'simpleHouse.kitchen.espressoMachine.groupHead';
  groupHead.position.set(0.02, 0.221, 0.068);
  sageEspresso.add(groupHead);
  const portafilter = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.011, 0.009, 0.125, 14)), blackTrimMat);
  portafilter.name = 'simpleHouse.kitchen.espressoMachine.portafilterHandle';
  portafilter.rotation.x = Math.PI / 2;
  portafilter.rotation.z = -0.18;
  portafilter.position.set(0.032, 0.208, 0.136);
  sageEspresso.add(portafilter);
  const milkJug = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.036, 0.042, 0.092, 20)), ssMat);
  milkJug.name = 'simpleHouse.kitchen.espressoMachine.milkPitcher';
  milkJug.position.set(-0.078, 0.094, 0.078);
  milkJug.castShadow = true;
  sageEspresso.add(milkJug);
  const beanHopper = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.062, 0.044, 0.068, 24)), hopperMat);
  beanHopper.name = 'simpleHouse.kitchen.espressoMachine.beanHopper';
  beanHopper.position.set(-0.055, 0.368, -0.01);
  sageEspresso.add(beanHopper);
  const hopperLid = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.064, 0.064, 0.008, 24)), blackTrimMat);
  hopperLid.name = 'simpleHouse.kitchen.espressoMachine.hopperLid';
  hopperLid.position.set(-0.055, 0.407, -0.01);
  sageEspresso.add(hopperLid);
  tagCutaway(sageEspresso, eastCut);

  const botanicalPrint = buildFramedBotanicalStemPrint(
    'simpleHouse.kitchen.botanicalPrint',
    darkOakMat
  );
  botanicalPrint.position.set(5.408, FFL_GROUND + 1.35, -0.58);
  botanicalPrint.rotation.y = -Math.PI / 2;
  tagCutaway(botanicalPrint, eastCut);

  // Under-sink Olive-Moss double cupboard + Shaws fireclay Belfast apron sink & Perrin & Rowe Aged Brass bridge mixer
  const eastSinkUnder = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastSinkUnderCabinet',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    heightM: 0.67,
    depthM: 0.58,
    includeMarbleWorktop: false,
    includeUpstand: false,
    hardwareStyle: 'knobOnly',
    bays: [{ kind: 'doubleDoor', widthM: 0.8 }],
    position: [5.122, FFL_GROUND + 0.001, 0.34],
    rotationY: -Math.PI / 2,
  });
  const belfastSink = buildShawsBelfastSinkAndBridgeTap({
    name: 'simpleHouse.kitchen.belfastSink',
    includeCarraraDrainerDeck: false,
    worktopMaterial: 'paleOak',
    includeRinseSpray: false,
    position: [5.055, FFL_GROUND + 0.669, 0.34],
    rotationY: -Math.PI / 2,
  });
  const sinkRearOakUpstand = new THREE.Mesh(
    prepGeo(
      applyMetricBoxUVs(new THREE.BoxGeometry(0.02, 0.075, 0.76), {
        tileW: 0.9,
        tileH: 0.9,
        topTileV: 0.9,
        rotY: Math.PI * 0.5,
      })
    ),
    paleOakMat
  );
  sinkRearOakUpstand.name = 'simpleHouse.kitchen.sinkRearOakUpstand';
  sinkRearOakUpstand.position.set(5.401, FFL_GROUND + 0.938, 0.34);
  sinkRearOakUpstand.castShadow = true;
  sinkRearOakUpstand.receiveShadow = true;
  kitchenGroup.add(sinkRearOakUpstand);
  for (const obj of [eastSinkUnder, belfastSink, sinkRearOakUpstand]) {
    tagCutaway(obj, eastCut);
  }

  const eastBaseSouth = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastBaseSouth',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'paleOak',
    hardwareStyle: 'knobOnly',
    bays: [{ kind: 'singleDoor', widthM: 0.56, hingeSide: 'right' }],
    position: [5.112, FFL_GROUND + 0.001, 1.06],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(eastBaseSouth, eastCut);

  // Open painted Olive-Moss corbelled shelf stacked w/ white fluted stoneware bowls, plates & glass pitcher
  const corbelShelf = buildPaintedCorbelKitchenShelf({
    name: 'simpleHouse.kitchen.oliveCorbelShelf',
    widthM: 1.38,
    paintColor: FB_PIGEON_CABINETRY,
    includeCrockery: true,
    position: [5.41, FFL_GROUND + 1.54, 0.42],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(corbelShelf, eastCut);

  kitchenGroup.add(
    eastBaseNorth,
    rangeChimneyBreast,
    lacancheRange,
    eastBaseMid,
    sageEspresso,
    botanicalPrint,
    eastSinkUnder,
    belfastSink,
    eastBaseSouth,
    corbelShelf
  );

  // North under-window Olive-Moss Chichester prep & dishwasher run (`Z = -4.22`, pale oak worktop)
  const northWindowRun = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.northWindowRun',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'paleOak',
    hardwareStyle: 'knobOnly',
    depthM: 0.58,
    bays: [
      { kind: 'doubleDoor', widthM: 0.94 },
      { kind: 'twinPullOutBin', widthM: 0.54 },
    ],
    position: [2.65, FFL_GROUND + 0.001, -IN_Z + 0.296],
    rotationY: 0,
  });
  tagCutaway(northWindowRun, northCut);
  kitchenGroup.add(northWindowRun);

  // Neptune 1200 mm double larder pantry in Olive-Moss on the West partition
  const larderPantry = buildNeptuneLarderPantry(ctx, {
    name: 'simpleHouse.kitchen.larderPantry',
    paintColor: FB_PIGEON_CABINETRY,
    position: [1.599, FFL_GROUND + 0.001, -2.55],
    rotationY: Math.PI / 2,
  });
  kitchenGroup.add(larderPantry);

  // Central Freestanding Pale European Oak & Honed Carrara Marble Prep Island Table (`1.88 x 0.94 x 0.90 m`)
  const prepIsland = buildNeptuneOakPrepIslandTable({
    name: 'simpleHouse.kitchen.oakPrepIsland',
    widthM: 1.88,
    depthM: 0.94,
    heightM: 0.9,
    includeTabletopStyling: true,
    position: [3.38, FFL_GROUND + 0.001, -0.95],
    rotationY: -Math.PI / 2,
  });
  kitchenGroup.add(prepIsland);

  // 3 Woven Paper-Cord & Pale European Oak Counter Stools tucked along the open-leg West side of the island
  for (const [idx, sz] of [
    [1, -1.5],
    [2, -0.95],
    [3, -0.4],
  ] as const) {
    kitchenGroup.add(
      buildWovenCordOakCounterStool({
        name: `simpleHouse.kitchen.wovenCordStool_${idx}`,
        position: [2.78, FFL_GROUND + 0.001, sz],
        rotationY: Math.PI / 2,
        interactions: ctx.interactions,
      })
    );
  }

  // Twin Spun Aged-Brass Saucer Pendants (`Ø380 mm`) on oval brass link chain + exposed filament bulbs
  for (const [idx, pz] of [
    [1, -1.46],
    [2, -0.44],
  ] as const) {
    groundCeilingGroup.add(
      buildHeritageInteriorLighting(ctx, {
        kind: 'spunBrassSaucerPendant',
        name: `simpleHouse.kitchen.islandPendant_${idx}`,
        position: [3.38, GROUND_CEILING_SOFFIT_Y - 0.003, pz],
        dropM: 0.96,
        circuitId: 'houseKitchenPendants' as CircuitId,
        createPointLight: idx === 1,
      })
    );
  }

  // Dining zone: Arundel 2400 mm weathered oak dining table & chairs + Chichester 1320 mm glazed Welsh dresser in Olive-Moss
  const diningSet = buildNeptuneArundelDiningSet({
    name: 'simpleHouse.dining.arundelSet',
    tableLengthM: 2.4,
    chairStyle: 'wardley',
    position: [3.48, FFL_GROUND + 0.001, 2.35],
    rotationY: Math.PI / 2,
    interactions: ctx.interactions,
  });
  const welshDresser = buildNeptuneChichesterGlazedDresser(ctx, {
    name: 'simpleHouse.dining.chichesterDresser',
    paintColor: FB_PIGEON_CABINETRY,
    position: [1.519, FFL_GROUND + 0.001, 1.85],
    rotationY: Math.PI / 2,
  });
  const southCut = shell.cut('south', 'ground');

  // Tailored oatmeal-linen Roman blind over Kitchen Sink North sash window
  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.kitchen.sinkRomanBlind',
    zone: 'houseKitchenDiner',
    centerX: 2.35,
    width: 1.18,
    railY: FFL_GROUND + 2.55,
    bottomY: FFL_GROUND + 2.16,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: kitchenGroup,
  }), 1);

  // Full-length triple-pinch-pleat warm oatmeal linen curtains on aged-brass poles in Dining zone (East & South sashes)
  const diningCurtainsEast = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.dining.curtainsEast',
    poleName: 'simpleHouse.dining.curtainsEast.pole',
    finialName: 'simpleHouse.dining.curtainsEast.finial',
    bracketName: 'simpleHouse.dining.curtainsEast.bracket',
    panelName: 'simpleHouse.dining.curtainsEast.panel',
    headerName: 'simpleHouse.dining.curtainsEast.header',
    hemName: 'simpleHouse.dining.curtainsEast.hem',
    tieBackName: 'simpleHouse.dining.curtainsEast.tieBack',
    centerZ: 2.1,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.26,
    stackWidthZ: 0.3,
    stackInnerInsetZ: 0.04,
    poleX: IN_X - 0.085,
    wallFaceX: IN_X,
    inwardSignX: -1,
    poleY: FFL_GROUND + 2.6,
    floorY: FFL_GROUND,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xded3c1,
    shadowColorHex: 0xb9aa93,
    trimColorHex: 0xc8baa4,
    brassMat: brassMats.primary,
  });
  deconflictCurtainBrackets(diningCurtainsEast, -1);
  tagCutaway(diningCurtainsEast, eastCut);

  const diningCurtainsSouth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.dining.curtainsSouth',
    poleName: 'simpleHouse.dining.curtainsSouth.pole',
    finialName: 'simpleHouse.dining.curtainsSouth.finial',
    bracketName: 'simpleHouse.dining.curtainsSouth.bracket',
    panelName: 'simpleHouse.dining.curtainsSouth.panel',
    headerName: 'simpleHouse.dining.curtainsSouth.header',
    hemName: 'simpleHouse.dining.curtainsSouth.hem',
    tieBackName: 'simpleHouse.dining.curtainsSouth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.26,
    stackWidthZ: 0.3,
    stackInnerInsetZ: 0.04,
    poleX: 0.085,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_GROUND + 2.6,
    floorY: FFL_GROUND,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xded3c1,
    shadowColorHex: 0xb9aa93,
    trimColorHex: 0xc8baa4,
    brassMat: brassMats.primary,
  });
  diningCurtainsSouth.position.set(3.35, 0, IN_Z);
  diningCurtainsSouth.rotation.y = Math.PI / 2;
  deconflictCurtainBrackets(diningCurtainsSouth, 1);
  tagCutaway(diningCurtainsSouth, southCut);

  const diningRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.dining.radiator',
    zone: 'houseKitchenDiner',
    cx: 3.35,
    floorY: FFL_GROUND + 0.001,
    cz: IN_Z - 0.12,
    width: 0.92,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(diningRadiator, southCut);

  kitchenGroup.add(diningSet, welshDresser, diningCurtainsEast, diningCurtainsSouth, diningRadiator);
  for (const cab of [
    eastBaseNorth,
    eastBaseMid,
    eastSinkUnder,
    eastBaseSouth,
    corbelShelf,
    northWindowRun,
    larderPantry,
    welshDresser,
  ]) {
    applyEstateEggshellPaintToJoinery(cab, pigeonEggshellMat);
  }

  groundCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'chandelier6Arm',
      name: 'simpleHouse.dining.chandelier',
      position: [3.345, GROUND_CEILING_SOFFIT_Y - 0.04, 2.25],
      dropM: 0.44,
      circuitId: 'houseKitchenPendants' as CircuitId,
      createPointLight: true,
    })
  );

  // =========================================================================
  // 2. West Wing — Georgian Drawing Room (houseDrawing: F&B Cromarty + School House White)
  // =========================================================================
  const drawingGroup = new THREE.Group();
  drawingGroup.name = 'simpleHouse.drawingRoom';
  drawingGroup.userData.zoneId = 'houseDrawing';
  root.add(drawingGroup);

  const westCut = shell.cut('west', 'ground');

  const breastGroup = new THREE.Group();
  breastGroup.name = 'simpleHouse.drawing.chimneyBreast';
  const breastD = DRAWING_BREAST.maxX - (-IN_X + 0.004);
  const breastCx = (-IN_X + 0.004 + DRAWING_BREAST.maxX) * 0.5;
  const cheekW = 0.95 - 0.484;
  addBox(
    breastGroup,
    'simpleHouse.drawing.chimneyBreastNorthCheek',
    [breastD, 0.923, cheekW],
    [breastCx, 0.4635, -(0.484 + cheekW * 0.5)],
    shell.schemes.houseDrawing.walls
  );
  addBox(
    breastGroup,
    'simpleHouse.drawing.chimneyBreastSouthCheek',
    [breastD, 0.923, cheekW],
    [breastCx, 0.4635, 0.484 + cheekW * 0.5],
    shell.schemes.houseDrawing.walls
  );
  addBox(
    breastGroup,
    'simpleHouse.drawing.chimneyBreastUpper',
    [breastD, GROUND_CEILING_SOFFIT_Y - 0.929, 1.9],
    [breastCx, 0.925 + (GROUND_CEILING_SOFFIT_Y - 0.929) * 0.5, 0],
    shell.schemes.houseDrawing.walls
  );
  tagCutaway(breastGroup, westCut);
  drawingGroup.add(breastGroup);

  const fireplace = buildGeorgianBolectionFireplace(ctx, {
    name: 'simpleHouse.drawing.bolectionFireplace',
    hearthStyle: 'slate',
    includeStove: true,
    position: [DRAWING_BREAST.maxX + 0.002, FFL_GROUND + 0.001, 0],
    rotationY: Math.PI / 2,
  });
  attachAudioEmitter(fireplace, {
    id: 'simpleHouse.drawing.woodStoveAudio',
    preset: 'woodStove',
    zoneId: 'houseDrawing',
    isExterior: false,
    volume: 0.65,
    refDistance: 1.6,
    maxDistance: 9.0,
  });
  tagCutaway(fireplace, westCut);

  const clubFender = buildGeorgianFiresideSet({
    name: 'simpleHouse.drawing.clubFender',
    fenderWidthM: 1.38,
    fenderDepthM: 0.38,
    position: [-4.20, FFL_GROUND + 0.001, 0],
    rotationY: Math.PI / 2,
    interactions: ctx.interactions,
  });

  const overmantel = buildCuratedMirrorsArtAndRugs({
    kind: 'regencyGiltOvermantel',
    name: 'simpleHouse.drawing.overmantelMirror',
    widthM: 1.32,
    heightM: 1.14,
    position: [DRAWING_BREAST.maxX + 0.004, FFL_GROUND + 1.22, 0],
    rotationY: Math.PI / 2,
  });

  const bookcaseNorth = buildFullWidthGeorgianAlcoveBookcase(ctx, {
    name: 'simpleHouse.drawing.alcoveBookcaseNorth',
    widthM: 3.264,
    heightM: 2.702,
    baseDepthM: 0.435,
    upperDepthM: 0.312,
    paintMat: schoolHouseEggshellMat,
    oakMat: paleOakMat,
    brassMat: brassMats.primary,
    darkBrassMat: brassMats.darkShadow,
    position: [-IN_X + 0.005, FFL_GROUND + 0.001, -2.585],
    rotationY: Math.PI / 2,
  });
  const bookcaseSouth = buildFullWidthGeorgianAlcoveBookcase(ctx, {
    name: 'simpleHouse.drawing.alcoveBookcaseSouth',
    widthM: 3.264,
    heightM: 2.702,
    baseDepthM: 0.435,
    upperDepthM: 0.312,
    paintMat: schoolHouseEggshellMat,
    oakMat: paleOakMat,
    brassMat: brassMats.primary,
    darkBrassMat: brassMats.darkShadow,
    position: [-IN_X + 0.005, FFL_GROUND + 0.001, 2.585],
    rotationY: Math.PI / 2,
  });
  tagCutaway(bookcaseNorth, westCut);
  tagCutaway(bookcaseSouth, westCut);
  ctx.addGlowPool('houseDrawingChandelier' as CircuitId, -5.05, FFL_GROUND + 0.88, -2.585, 0.75, 0.25);
  ctx.addGlowPool('houseDrawingChandelier' as CircuitId, -5.05, FFL_GROUND + 0.88, 2.585, 0.75, 0.25);

  drawingGroup.add(fireplace, clubFender, overmantel, bookcaseNorth, bookcaseSouth);

  const drawingRug = buildCuratedMirrorsArtAndRugs({
    kind: 'zieglerOushak',
    name: 'simpleHouse.drawing.zieglerRug',
    widthM: 2.4,
    lengthM: 3.9,
    position: [-2.95, FFL_GROUND + 0.002, 0],
  });
  const rugTopY = FFL_GROUND + 0.018;

  const sofa = buildNeptuneUpholsteredSofa({
    name: 'simpleHouse.drawing.longIslandSofa',
    model: 'longIsland',
    position: [-3.0, rugTopY, -1.35],
    rotationY: 0,
    interactions: ctx.interactions,
  });
  const armchairWest = buildNeptuneArmchair({
    name: 'simpleHouse.drawing.oliviaArmchairWest',
    model: 'olivia',
    position: [-3.52, rugTopY, 1.32],
    rotationY: Math.PI - 0.22,
    interactions: ctx.interactions,
  });
  const armchairEast = buildNeptuneArmchair({
    name: 'simpleHouse.drawing.oliviaArmchairEast',
    model: 'olivia',
    position: [-2.42, rugTopY, 1.32],
    rotationY: Math.PI + 0.22,
    interactions: ctx.interactions,
  });
  const coffeeTable = buildNeptuneOakTablesAndBedsides({
    name: 'simpleHouse.drawing.henleyCoffeeTable',
    kind: 'henleyCoffeeTable',
    position: [-3.0, rugTopY, 0.0],
    interactions: ctx.interactions,
  });

  const cardTable = buildGeorgianAntiqueCasework(ctx, {
    kind: 'demiLuneCardTable',
    name: 'simpleHouse.drawing.demiLuneCardTable',
    position: [-1.54, FFL_GROUND + 0.001, 2.75],
    rotationY: -Math.PI / 2,
  });
  const constableOil = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.drawing.constableOil',
    position: [-1.274, FFL_GROUND + 1.36, 2.75],
    rotationY: -Math.PI / 2,
  });
  const botanicalGrid = buildCuratedMirrorsArtAndRugs({
    kind: 'curtisBotanicalGrid',
    name: 'simpleHouse.drawing.curtisBotanicals',
    botanicalLayout: '2x2',
    position: [-1.274, FFL_GROUND + 1.24, -2.15],
    rotationY: -Math.PI / 2,
  });
  const drawingRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.drawing.radiator',
    zone: 'houseDrawing',
    cx: -3.35,
    floorY: FFL_GROUND + 0.001,
    cz: -IN_Z + 0.12,
    width: 0.95,
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(drawingRadiator, northCut);

  // Full-length interlined sage-oatmeal triple-pinch-pleat linen curtains on aged-brass poles (South & North Drawing Room sashes)
  const drawingCurtainsSouth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.drawing.curtainsSouth',
    poleName: 'simpleHouse.drawing.curtainsSouth.pole',
    finialName: 'simpleHouse.drawing.curtainsSouth.finial',
    bracketName: 'simpleHouse.drawing.curtainsSouth.bracket',
    panelName: 'simpleHouse.drawing.curtainsSouth.panel',
    headerName: 'simpleHouse.drawing.curtainsSouth.header',
    hemName: 'simpleHouse.drawing.curtainsSouth.hem',
    tieBackName: 'simpleHouse.drawing.curtainsSouth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.28,
    stackWidthZ: 0.32,
    stackInnerInsetZ: 0.04,
    poleX: 0.088,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_GROUND + 2.6,
    floorY: FFL_GROUND,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xd6d4ca,
    shadowColorHex: 0xadb0a4,
    trimColorHex: 0xc2c2b6,
    brassMat: brassMats.primary,
  });
  drawingCurtainsSouth.position.set(-3.35, 0, IN_Z);
  drawingCurtainsSouth.rotation.y = Math.PI / 2;
  deconflictCurtainBrackets(drawingCurtainsSouth, 1);
  tagCutaway(drawingCurtainsSouth, southCut);

  const drawingCurtainsNorth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.drawing.curtainsNorth',
    poleName: 'simpleHouse.drawing.curtainsNorth.pole',
    finialName: 'simpleHouse.drawing.curtainsNorth.finial',
    bracketName: 'simpleHouse.drawing.curtainsNorth.bracket',
    panelName: 'simpleHouse.drawing.curtainsNorth.panel',
    headerName: 'simpleHouse.drawing.curtainsNorth.header',
    hemName: 'simpleHouse.drawing.curtainsNorth.hem',
    tieBackName: 'simpleHouse.drawing.curtainsNorth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.28,
    stackWidthZ: 0.32,
    stackInnerInsetZ: 0.04,
    poleX: 0.088,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_GROUND + 2.6,
    floorY: FFL_GROUND,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xd6d4ca,
    shadowColorHex: 0xadb0a4,
    trimColorHex: 0xc2c2b6,
    brassMat: brassMats.primary,
  });
  drawingCurtainsNorth.position.set(-3.35, 0, -IN_Z);
  drawingCurtainsNorth.rotation.y = -Math.PI / 2;
  deconflictCurtainBrackets(drawingCurtainsNorth, 1);
  tagCutaway(drawingCurtainsNorth, northCut);

  const drawingCardLamp = buildHeritageInteriorLighting(ctx, {
    kind: 'whiteCoCeramicLamp',
    name: 'simpleHouse.drawing.cardTableLamp',
    position: [-1.52, FFL_GROUND + 0.747, 2.75],
    circuitId: 'houseDrawingChandelier' as CircuitId,
    createPointLight: false,
  });
  const coffeeHurricane = buildWhiteCompanyAccessories({
    kind: 'glassHurricane',
    name: 'simpleHouse.drawing.coffeeHurricane',
    position: [-2.82, rugTopY + 0.452, 0.04],
  });

  drawingGroup.add(
    drawingRug,
    sofa,
    armchairWest,
    armchairEast,
    coffeeTable,
    cardTable,
    constableOil,
    botanicalGrid,
    drawingRadiator,
    drawingCurtainsSouth,
    drawingCurtainsNorth,
    drawingCardLamp,
    coffeeHurricane
  );

  groundCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'chandelier6Arm',
      name: 'simpleHouse.drawing.chandelier',
      position: [-3.345, GROUND_CEILING_SOFFIT_Y - 0.04, 0],
      dropM: 0.44,
      circuitId: 'houseDrawingChandelier' as CircuitId,
      createPointLight: true,
    })
  );

  // =========================================================================
  // 3. Rear Boot Lobby & Cloakroom WC (houseCloakroom)
  // =========================================================================
  const cloakGroup = new THREE.Group();
  cloakGroup.name = 'simpleHouse.cloakroomSuite';
  cloakGroup.userData.zoneId = 'houseCloakroom';
  root.add(cloakGroup);

  const dadoWest = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bootLobby.dadoWest',
    lengthM: 2.48,
    heightM: 1.12,
    paintColor: FB_GREEN_SMOKE,
    position: [-1.146, FFL_GROUND + 0.001, -2.935],
    rotationY: Math.PI / 2,
  });
  const dadoNorth = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bootLobby.dadoNorth',
    lengthM: 1.0,
    heightM: 1.12,
    paintColor: FB_GREEN_SMOKE,
    position: [-0.6, FFL_GROUND + 0.001, -IN_Z + 0.004],
    rotationY: 0,
  });
  tagCutaway(dadoNorth, northCut);

  const bootBench = buildNeptuneBootBenchAndPegRail({
    name: 'simpleHouse.bootLobby.bootBench',
    widthM: 1.24,
    depthM: 0.44,
    paintColor: FB_GREEN_SMOKE,
    position: [-1.114, FFL_GROUND + 0.001, -3.45],
    rotationY: Math.PI / 2,
    interactions: ctx.interactions,
  });

  const bootLobbySconce = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.bootLobby.sconce',
    position: [-0.6, FFL_GROUND + 1.72, -IN_Z + 0.004],
    rotationY: 0,
    circuitId: 'houseCloakroomSconces' as CircuitId,
    createPointLight: false,
  });
  tagCutaway(bootLobbySconce, northCut);

  const crapperWc = buildThomasCrapperLowLevelWc({
    namePrefix: 'simpleHouse.cloakroom.thomasCrapperWc',
    finish: 'SB',
    seatFinish: 'darkOak',
    mitreBracketFlange: true,
  });
  crapperWc.position.set(0.64, FFL_GROUND + 0.001, -IN_Z + 0.004);
  tagCutaway(crapperWc, northCut);

  const cloakWashstand = buildGeorgianCloakroomWashstand(
    'simpleHouse.cloakroom.washstand',
    brassMats.primary,
    carraraMat,
    darkOakMat
  );
  cloakWashstand.position.set(1.138, FFL_GROUND + 0.001, -3.05);
  cloakWashstand.rotation.y = -Math.PI / 2;

  const cloakMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'scallopedBrass',
    name: 'simpleHouse.cloakroom.scallopedMirror',
    widthM: 0.5,
    heightM: 0.72,
    position: [1.138, FFL_GROUND + 1.12, -3.05],
    rotationY: -Math.PI / 2,
  });

  const paperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleHouse.cloakroom.paperHolder',
    finish: 'SB',
    style: 'traditional',
    coreClearanceM: 0.0008,
  });
  paperHolder.position.set(1.138, FFL_GROUND + 0.68, -3.72);
  paperHolder.rotation.y = -Math.PI / 2;

  const cloakSconce = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.cloakroom.sconce',
    position: [1.138, FFL_GROUND + 1.56, -2.55],
    rotationY: -Math.PI / 2,
    circuitId: 'houseCloakroomSconces' as CircuitId,
    createPointLight: true,
  });

  // Boot Lobby accessories: Welsh slate boot tray + pair of olive heritage wellington boots + Kubu storage basket
  const bootTrayGroup = new THREE.Group();
  bootTrayGroup.name = 'simpleHouse.bootLobby.slateBootTray';
  bootTrayGroup.position.set(-0.34, FFL_GROUND + 0.002, -3.92);
  bootTrayGroup.rotation.y = -Math.PI / 2;
  tagCutaway(bootTrayGroup, northCut);
  const slateTrayMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.bootLobby.slateMat',
    color: 0x35393c,
    roughness: 0.78,
  });
  const wellyMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.bootLobby.oliveRubberMat',
    color: 0x3b4a3a,
    roughness: 0.44,
  });
  const wellySoleMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.bootLobby.rubberSoleMat',
    color: 0x222422,
    roughness: 0.82,
  });
  addBox(bootTrayGroup, 'simpleHouse.bootLobby.slateBootTray.base', [0.36, 0.018, 0.56], [0, 0.009, 0], slateTrayMat);
  for (const [bIdx, bz, rot] of [
    [1, -0.13, 0.08],
    [2, 0.11, -0.06],
  ] as const) {
    const boot = new THREE.Group();
    boot.name = `simpleHouse.bootLobby.wellingtonBoot_${bIdx}`;
    boot.position.set(-0.02, 0.019, bz);
    boot.rotation.y = rot;
    addBox(boot, `${boot.name}.sole`, [0.24, 0.022, 0.095], [0.03, 0.011, 0], wellySoleMat);
    addBox(boot, `${boot.name}.vamp`, [0.22, 0.064, 0.088], [0.025, 0.055, 0], wellyMat);
    const shaft = new THREE.Mesh(sharedCylinderGeometry(0.052, 0.045, 0.32, 14), wellyMat);
    shaft.name = `${boot.name}.shaft`;
    shaft.position.set(-0.035, 0.22, 0);
    shaft.castShadow = true;
    boot.add(shaft);
    bootTrayGroup.add(boot);
  }
  const bootBasket = buildWhiteCompanyAccessories({
    kind: 'kubuStorageBasket',
    name: 'simpleHouse.bootLobby.kubuBasket',
    position: [-0.9, FFL_GROUND + 0.055, -3.45],
  });

  // Cloakroom WC: Crisp Wimborne White dado rail around Hague Blue walls + lower wainscot panels + Roman blind + brass towel ring
  const cloakDadoRail = createDadoRun({
    name: 'simpleHouse.cloakroom.dadoRail',
    path: [
      [0.06, -1.65],
      [1.15, -1.65],
      [1.15, -IN_Z],
      [0.06, -IN_Z],
    ],
    closed: true,
    roomSide: 'left',
    floorY: FFL_GROUND,
    elevationY: 0.98,
    profile: 'astragal-dado',
    height: 0.048,
    projection: 0.018,
    material: shell.schemes.houseCloakroom.trim,
    gaps: [
      { box: { minX: -0.02, maxX: 0.14, minZ: -2.85, maxZ: -1.85 }, cap: 'selfReturn' },
      { box: { minX: 0.42, maxX: 0.9, minZ: -4.3, maxZ: -4.14 }, cap: 'selfReturn' },
    ],
    cutawayWalls: [northCut],
    floor: 'ground',
    zone: 'houseCloakroom',
  });
  const cloakWainscotEast = addBox(
    cloakGroup,
    'simpleHouse.cloakroom.wainscotEast',
    [0.005, 0.81, 2.54],
    [1.1465, FFL_GROUND + 0.14 + 0.81 * 0.5, -2.935],
    shell.schemes.houseCloakroom.trim
  );
  cloakWainscotEast.castShadow = false;
  const cloakWainscotSouth = addBox(
    cloakGroup,
    'simpleHouse.cloakroom.wainscotSouth',
    [1.06, 0.81, 0.005],
    [0.6, FFL_GROUND + 0.14 + 0.81 * 0.5, -1.6535],
    shell.schemes.houseCloakroom.trim
  );
  cloakWainscotSouth.castShadow = false;

  const cloakTowelRing = buildPerrinRoweTowelRing({
    namePrefix: 'simpleHouse.cloakroom.towelRing',
    finish: 'SB',
  });
  cloakTowelRing.position.set(1.138, FFL_GROUND + 0.88, -2.62);
  cloakTowelRing.rotation.y = -Math.PI / 2;

  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.cloakroom.romanBlind',
    zone: 'houseCloakroom',
    centerX: 0.66,
    width: 0.68,
    railY: FFL_GROUND + 2.42,
    bottomY: FFL_GROUND + 2.1,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: cloakGroup,
  }), 1);

  cloakGroup.add(
    dadoWest,
    dadoNorth,
    bootBench,
    bootTrayGroup,
    bootBasket,
    bootLobbySconce,
    crapperWc,
    cloakWashstand,
    cloakMirror,
    paperHolder,
    cloakTowelRing,
    cloakDadoRail,
    cloakSconce
  );

  // =========================================================================
  // 4. Ground-Floor Corston Toggle Switches, Rotary Dimmer & Power Sockets
  // =========================================================================
  const hallSwitchIds: Record<number, string> = {
    1: 'sw-stair-bottom',
    2: 'sw-hall-lantern',
    3: 'sw-portico-lanterns',
  };
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.hallBottom',
    switchPa: 'plate-hall-bottom',
    location: 'Entrance hall foot of stairs',
    x: -1.147,
    y: FFL_GROUND + 1.15,
    z: 1.75,
    facing: 'east',
    mountedInZoneId: 'houseHall' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (gang): InteractiveUserData => ({
      electricalSwitchId: hallSwitchIds[gang],
    }),
    gangs: [
      { gang: 1, zoneId: 'houseLanding' as RoomZoneId, label: 'Stairwell 2-Way', circuitId: 'houseStairPendant' as CircuitId },
      { gang: 2, zoneId: 'houseHall' as RoomZoneId, label: 'Hallway Lantern', circuitId: 'houseHallLantern' as CircuitId },
      { gang: 3, zoneId: 'houseHall' as RoomZoneId, label: 'Portico Lanterns', circuitId: 'housePorticoLanterns' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.drawing',
    switchPa: 'plate-drawing-door',
    location: 'Drawing room latch jamb',
    x: -1.273,
    y: FFL_GROUND + 1.15,
    z: 0.25,
    facing: 'west',
    mountedInZoneId: 'houseDrawing' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-drawing' }),
    gangs: [
      { gang: 1, zoneId: 'houseDrawing' as RoomZoneId, label: 'Drawing Room Chandelier', circuitId: 'houseDrawingChandelier' as CircuitId },
    ],
  });

  const dimmerGroup = new THREE.Group();
  dimmerGroup.name = 'simpleHouse.dimmer.drawing';
  dimmerGroup.position.set(-1.273, FFL_GROUND + 1.15, 0.12);
  root.add(dimmerGroup);
  addBox(dimmerGroup, 'simpleHouse.dimmer.drawing.plate', [0.004, 0.088, 0.088], [-0.002, 0, 0], brassMats.primary);
  const dimmerKnob = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.019, 0.021, 0.02, 18)),
    brassMats.knurled
  );
  dimmerKnob.name = 'simpleHouse.dimmer.drawing.knob';
  dimmerKnob.rotation.z = Math.PI * 0.5;
  dimmerKnob.position.set(-0.015, 0, 0);
  dimmerKnob.userData = {
    electricalDimmerId: 'dimmer-house-drawing',
    zoneId: 'houseDrawing',
  };
  ctx.interactiveMeshes.push(dimmerKnob);
  dimmerGroup.add(dimmerKnob);

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.kitchen',
    switchPa: 'plate-kitchen',
    location: 'Kitchen hallway jamb',
    x: 1.273,
    y: FFL_GROUND + 1.15,
    z: 2.94,
    facing: 'east',
    mountedInZoneId: 'houseKitchenDiner' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-kitchen' }),
    gangs: [
      { gang: 1, zoneId: 'houseKitchenDiner' as RoomZoneId, label: 'Kitchen & Dining Pendants', circuitId: 'houseKitchenPendants' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.cloakroom',
    switchPa: 'plate-cloakroom',
    location: 'Boot lobby wall',
    x: -0.063,
    y: FFL_GROUND + 1.15,
    z: -2.95,
    facing: 'west',
    mountedInZoneId: 'houseCloakroom' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-cloakroom' }),
    gangs: [
      { gang: 1, zoneId: 'houseCloakroom' as RoomZoneId, label: 'Cloakroom & Boot Lobby', circuitId: 'houseCloakroomSconces' as CircuitId },
    ],
  });

  root.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.drawingNorth',
      zone: 'houseDrawing',
      kind: 'double',
      x: -1.273,
      y: FFL_GROUND + 0.45,
      z: -3.2,
      facing: 'west',
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.drawingSouth',
      zone: 'houseDrawing',
      kind: 'double',
      x: -1.273,
      y: FFL_GROUND + 0.45,
      z: 3.55,
      facing: 'west',
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.kitchenWorktop',
      zone: 'houseKitchenDiner',
      kind: 'double',
      x: 5.409,
      y: FFL_GROUND + 1.08,
      z: 0.95,
      facing: 'west',
      cutawayWall: eastCut,
    })
  );
}
