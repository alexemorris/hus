import * as THREE from 'three';
import {
  getOrCreateCachedTexture,
} from 'husjs/materials';
import {
  attachAssetMetadata,
  prepGeo,
  sharedCylinderGeometry,
  tagHighLodDetail,
} from 'husjs/objects';
import {
  buildCuratedMirrorsArtAndRugs,
} from 'husjs/catalog/furniture';
import { FFL_FIRST } from './electrical-and-rooms.ts';


import { addBox, createTurnedWalnutMaterial } from './interiors-first-furniture.ts';

function getSepiaFamilyPhotoTexture(variantIdx: number): THREE.DataTexture {
  return getOrCreateCachedTexture(`simpleHouse.landing.familyPhoto.${variantIdx}`, () => {
    const w = 96;
    const h = 120;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const ny = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const nx = x / (w - 1);
        // Wide cream conservation mount (`22%` margin) + warm charcoal inner wash line
        const inAperture = nx > 0.22 && nx < 0.78 && ny > 0.2 && ny < 0.8;
        const onBevelLine =
          !inAperture &&
          nx > 0.2 &&
          nx < 0.8 &&
          ny > 0.18 &&
          ny < 0.82 &&
          (Math.abs(nx - 0.21) < 0.012 ||
            Math.abs(nx - 0.79) < 0.012 ||
            Math.abs(ny - 0.19) < 0.01 ||
            Math.abs(ny - 0.81) < 0.01);

        let r = 243;
        let g = 238;
        let b = 226;

        if (onBevelLine) {
          r = 188;
          g = 178;
          b = 160;
        } else if (inAperture) {
          const u = (nx - 0.22) / 0.56;
          const v = (ny - 0.2) / 0.6;
          const vignette = 1 - 0.28 * Math.hypot(u - 0.5, v - 0.5);
          if (variantIdx % 2 === 0) {
            // Warm sepia portrait silhouette against soft studio backdrop
            const headDist = Math.hypot((u - 0.5) * 1.15, (v - 0.62) * 1.35);
            const shoulderDist = Math.hypot((u - 0.5) * 0.82, (v - 0.24) * 1.05);
            const isSubject = headDist < 0.16 || (v < 0.45 && shoulderDist < 0.31);
            const tone = isSubject ? 0.36 + 0.12 * u : 0.78 - 0.14 * v;
            r = Math.round(232 * tone * vignette);
            g = Math.round(212 * tone * vignette);
            b = Math.round(184 * tone * vignette);
          } else {
            // Warm sepia coastal/countryside horizon vignette
            const horizon = 0.46 + 0.04 * Math.sin(u * Math.PI * 2 + variantIdx);
            const isLand = v < horizon;
            const tone = isLand
              ? 0.42 + 0.16 * (v / horizon)
              : 0.84 - 0.12 * ((v - horizon) / (1 - horizon));
            r = Math.round(234 * tone * vignette);
            g = Math.round(216 * tone * vignette);
            b = Math.round(190 * tone * vignette);
          }
        }

        const p = (y * w + x) * 4;
        data[p] = Math.max(0, Math.min(255, r));
        data[p + 1] = Math.max(0, Math.min(255, g));
        data[p + 2] = Math.max(0, Math.min(255, b));
        data[p + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}

function getAntiquarianMapTexture(plateIdx: number): THREE.DataTexture {
  return getOrCreateCachedTexture(`simpleHouse.study.antiquarianMap.${plateIdx}`, () => {
    const w = 128;
    const h = 104;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const ny = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const nx = x / (w - 1);
        const inMap = nx > 0.15 && nx < 0.85 && ny > 0.16 && ny < 0.84;
        const onRule =
          nx > 0.13 &&
          nx < 0.87 &&
          ny > 0.14 &&
          ny < 0.86 &&
          !inMap;
        let r = 240;
        let g = 234;
        let b = 219;
        if (onRule) {
          r = 128;
          g = 114;
          b = 94;
        } else if (inMap) {
          const u = (nx - 0.15) / 0.7;
          const v = (ny - 0.16) / 0.68;
          const coast = 0.52 + 0.14 * Math.sin(v * 5.2 + plateIdx * 1.7) + 0.07 * Math.cos(u * 6.4);
          const isShire = u < coast;
          const grid =
            Math.abs(((u * 6) % 1) - 0.5) > 0.47 || Math.abs(((v * 5) % 1) - 0.5) > 0.47;
          if (grid) {
            r = 148;
            g = 136;
            b = 116;
          } else if (isShire) {
            const parishTint = ((Math.floor(u * 4 + v * 3) + plateIdx) % 3);
            r = parishTint === 0 ? 222 : parishTint === 1 ? 210 : 226;
            g = parishTint === 0 ? 206 : parishTint === 1 ? 212 : 216;
            b = parishTint === 0 ? 178 : parishTint === 1 ? 184 : 192;
          } else {
            r = 214;
            g = 219;
            b = 214;
          }
        }
        const p = (y * w + x) * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}

/**
 * Curated organic/symmetrical 6-frame family photograph gallery cluster (`180x230 mm` to `240x300 mm`
 * dark walnut & brushed aged-brass frames with wide cream conservation mounts & warm sepia vignettes).
 * Local origin `(0, 0, 0)` is the cluster center (`z = 0` flush with wall, projecting into `+Z`).
 */
export function buildFamilyPhotoGalleryCluster(
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
    readonly brassMat: THREE.Material;
  }
): THREE.Group {
  const { name, position, rotationY, brassMat } = options;
  const root = new THREE.Group();
  root.name = name;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const walnutFrameMat = createTurnedWalnutMaterial(`${name}.darkWalnutFrame`);
  const glassMat = new THREE.MeshPhysicalMaterial({
    name: `${name}.conservationGlass`,
    color: 0xf7faf8,
    transparent: true,
    opacity: 0.18,
    roughness: 0.08,
    ior: 1.5,
  });

  // Harmonious salon-hung 2-row x 3-column cluster of mixed portrait & landscape frames (`total span ~0.88 m W x 0.64 m H`)
  const frames: readonly {
    readonly dx: number;
    readonly dy: number;
    readonly w: number;
    readonly h: number;
    readonly useBrass: boolean;
  }[] = [
    { dx: -0.305, dy: 0.165, w: 0.21, h: 0.265, useBrass: false },
    { dx: 0.0, dy: 0.175, w: 0.24, h: 0.3, useBrass: true },
    { dx: 0.305, dy: 0.165, w: 0.21, h: 0.265, useBrass: false },
    { dx: -0.295, dy: -0.165, w: 0.22, h: 0.185, useBrass: true },
    { dx: 0.0, dy: -0.175, w: 0.195, h: 0.245, useBrass: false },
    { dx: 0.295, dy: -0.165, w: 0.22, h: 0.185, useBrass: true },
  ];

  frames.forEach((spec, idx) => {
    const fg = new THREE.Group();
    fg.name = `${name}.photoFrame_${idx + 1}`;
    fg.position.set(spec.dx, spec.dy, 0);
    root.add(fg);

    const frameMat = spec.useBrass ? brassMat : walnutFrameMat;
    const rim = spec.useBrass ? 0.011 : 0.016;
    const depth = 0.018;
    const innerW = spec.w - rim * 2;
    const innerH = spec.h - rim * 2;

    const photoMat = new THREE.MeshStandardMaterial({
      name: `${fg.name}.mountedSepiaPrint`,
      map: getSepiaFamilyPhotoTexture(idx),
      roughness: 0.8,
    });

    addBox(fg, `${fg.name}.backing`, [innerW, innerH, 0.006], [0, 0, 0.003], walnutFrameMat);
    addBox(fg, `${fg.name}.printSheet`, [innerW, innerH, 0.002], [0, 0, 0.008], photoMat);
    const glz = addBox(fg, `${fg.name}.glazing`, [innerW, innerH, 0.002], [0, 0, 0.012], glassMat);
    glz.castShadow = false;

    addBox(fg, `${fg.name}.railTop`, [spec.w, rim, depth], [0, spec.h * 0.5 - rim * 0.5, depth * 0.5], frameMat);
    addBox(fg, `${fg.name}.railBottom`, [spec.w, rim, depth], [0, -(spec.h * 0.5 - rim * 0.5), depth * 0.5], frameMat);
    addBox(fg, `${fg.name}.stileLeft`, [rim, innerH, depth], [-(spec.w * 0.5 - rim * 0.5), 0, depth * 0.5], frameMat);
    addBox(fg, `${fg.name}.stileRight`, [rim, innerH, depth], [spec.w * 0.5 - rim * 0.5, 0, depth * 0.5], frameMat);
  });

  return attachAssetMetadata(root, {
    name: 'Curated 6-Piece Dark Walnut & Aged Brass Family Portrait Gallery',
    brand: 'Bespoke Framing',
    collection: 'Conservation Mount Series',
    sku: 'FRM-GAL-6PC',
    finish: 'Dark Waxed Walnut, Brushed Aged Brass & Cream Conservation Mounts',
    category: 'decor',
    dimensionsMm: [880, 20, 650],
  });
}

/**
 * Framed pair of 18th-century English county & estate survey maps (`460 x 380 mm` each)
 * in dark walnut & gilt-slip Hogarth frames for the Study East wall.
 */
export function buildAntiquarianMapDiptych(
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
    readonly brassMat: THREE.Material;
  }
): THREE.Group {
  const { name, position, rotationY, brassMat } = options;
  const root = new THREE.Group();
  root.name = name;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const walnutMat = createTurnedWalnutMaterial(`${name}.hogarthWalnut`);
  const w = 0.46;
  const h = 0.38;
  const rim = 0.022;
  const d = 0.022;

  for (const [idx, dx] of [
    [0, -0.275],
    [1, 0.275],
  ] as const) {
    const mg = new THREE.Group();
    mg.name = `${name}.mapFrame_${idx + 1}`;
    mg.position.set(dx, 0, 0);
    root.add(mg);

    const mapMat = new THREE.MeshStandardMaterial({
      name: `${mg.name}.countySurveyPlate`,
      map: getAntiquarianMapTexture(idx),
      roughness: 0.78,
    });
    const innerW = w - rim * 2;
    const innerH = h - rim * 2;
    addBox(mg, `${mg.name}.backing`, [innerW - 0.002, innerH - 0.002, 0.008], [0, 0, 0.004], walnutMat);
    addBox(mg, `${mg.name}.engraving`, [innerW - 0.002, innerH - 0.002, 0.003], [0, 0, 0.011], mapMat);
    void brassMat;
    addBox(mg, `${mg.name}.railTop`, [w, rim, d], [0, h * 0.5 - rim * 0.5, d * 0.5], walnutMat);
    addBox(mg, `${mg.name}.railBottom`, [w, rim, d], [0, -(h * 0.5 - rim * 0.5), d * 0.5], walnutMat);
    addBox(mg, `${mg.name}.stileLeft`, [rim, innerH, d], [-(w * 0.5 - rim * 0.5), 0, d * 0.5], walnutMat);
    addBox(mg, `${mg.name}.stileRight`, [rim, innerH, d], [w * 0.5 - rim * 0.5, 0, d * 0.5], walnutMat);
  }

  return attachAssetMetadata(root, {
    name: 'Pair of John Cary Antiquarian English County Survey Maps in Hogarth Frames',
    brand: 'Grosvenor Prints',
    collection: '18th-Century Cartography',
    sku: 'GRP-MAP-DIP-990',
    finish: 'Ebonised Walnut & Gilt Sight-Edge Slip',
    category: 'decor',
    dimensionsMm: [1010, 22, 380],
  });
}

/**
 * Single framed heritage botanical watercolour plate (`420 x 520 mm` with cream wash-line mount
 * & aged-brass/walnut Hogarth frame) centered above the Guest Bedroom headboard (`y = 0` center).
 */
export function buildSingleBotanicalWatercolourFrame(
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
    readonly brassMat: THREE.Material;
  }
): THREE.Group {
  const fullGrid = buildCuratedMirrorsArtAndRugs({
    kind: 'curtisBotanicalGrid',
    name: `${options.name}_source`,
    botanicalLayout: '2x2',
  });
  const plate = fullGrid.getObjectByName(`${options.name}_source.plate_1`);

  const root = new THREE.Group();
  root.name = options.name;
  root.position.set(options.position[0], options.position[1], options.position[2]);
  root.rotation.y = options.rotationY;

  if (plate) {
    plate.removeFromParent();
    plate.name = `${options.name}.botanicalPlate`;
    plate.position.set(0, 0, 0);
    plate.scale.set(1.24, 1.18, 1);
    root.add(plate);
  }

  // Subtle brass hanging ring at top rail
  const ring = new THREE.Mesh(sharedCylinderGeometry(0.014, 0.014, 0.005, 16), options.brassMat);
  ring.name = `${options.name}.brassHangingRing`;
  ring.rotation.x = Math.PI * 0.5;
  ring.position.set(0, 0.275, 0.012);
  tagHighLodDetail(ring);
  root.add(ring);

  return attachAssetMetadata(root, {
    name: 'Framed William Curtis Botanical Watercolour Study',
    brand: 'Kew Botanical Prints',
    collection: 'Flora Londinensis',
    sku: 'KEW-BOT-420',
    finish: 'Ebonised Hogarth Frame & Cream Wash-Line Conservation Mount',
    category: 'decor',
    dimensionsMm: [422, 24, 520],
  });
}

export function buildArticulatedBrassDeskLamp(
  namePrefix: string,
  brassMat: THREE.Material,
  position: readonly [number, number, number],
  rotationY = 0
): THREE.Group {
  const root = new THREE.Group();
  root.name = namePrefix;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const bulbMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.bulb`,
    color: 0xfff3d6,
    emissive: new THREE.Color(0xffb85c),
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });

  const base = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.075, 0.082, 0.018, 20)), brassMat);
  base.name = `${namePrefix}.base`;
  base.position.set(0, 0.009, 0);
  base.castShadow = true;
  root.add(base);

  const lowerStem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.007, 0.008, 0.28, 12)), brassMat);
  lowerStem.name = `${namePrefix}.lowerArm`;
  lowerStem.position.set(0, 0.155, -0.025);
  lowerStem.rotation.x = -0.18;
  lowerStem.castShadow = true;
  root.add(lowerStem);

  const knuckle = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.013, 12, 10)), brassMat);
  knuckle.name = `${namePrefix}.knuckle`;
  knuckle.position.set(0, 0.295, -0.05);
  root.add(knuckle);

  const upperArm = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.006, 0.007, 0.2, 12)), brassMat);
  upperArm.name = `${namePrefix}.upperArm`;
  upperArm.position.set(0, 0.355, 0.03);
  upperArm.rotation.x = 0.95;
  upperArm.castShadow = true;
  root.add(upperArm);

  const shade = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.078, 0.105, 20, 1, true)), brassMat);
  shade.name = `${namePrefix}.coneShade`;
  shade.position.set(0, 0.365, 0.125);
  shade.rotation.x = 0.32;
  shade.castShadow = true;
  root.add(shade);

  const bulb = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.022, 12, 10)), bulbMat);
  bulb.name = `${namePrefix}.filamentBulb`;
  bulb.position.set(0, 0.348, 0.132);
  root.add(bulb);

  return root;
}

/**
 * Airing cupboard interior (`X in [1.45, 2.35], Z in [-2.33, -1.65]`):
 * slatted European oak linen shelves, folded White Company Hydrocotton towels & insulated copper DHW cylinder.
 */
export function buildAiringCupboardFittings(
  parent: THREE.Object3D,
  oakMat: THREE.Material,
  copperMat: THREE.Material
): void {
  const airing = new THREE.Group();
  airing.name = 'simpleHouse.airingCupboard';
  parent.add(airing);

  const linenMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.airingCupboard.whiteCoLinen',
    color: 0xf5f2ea,
    roughness: 0.9,
  });

  // Insulated copper domestic hot-water cylinder on West side of airing cupboard (`X = 1.66, Z = -2.08`)
  const cyl = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.18, 0.18, 1.04, 18)), copperMat);
  cyl.name = 'simpleHouse.airingCupboard.hotWaterCylinder';
  cyl.position.set(1.71, FFL_FIRST + 0.522, -2.08);
  cyl.castShadow = true;
  airing.add(cyl);

  const dome = new THREE.Mesh(
    prepGeo(new THREE.SphereGeometry(0.18, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)),
    copperMat
  );
  dome.name = 'simpleHouse.airingCupboard.cylinderDome';
  dome.position.set(1.71, FFL_FIRST + 1.042, -2.08);
  airing.add(dome);

  // Slatted oak linen shelving on East half & upper full-width tier (`Z in [-2.31, -1.96]`)
  for (const [tierIdx, sy, minX] of [
    [1, FFL_FIRST + 0.68, 1.94],
    [2, FFL_FIRST + 1.12, 1.94],
    [3, FFL_FIRST + 1.56, 1.54],
    [4, FFL_FIRST + 1.96, 1.54],
  ] as const) {
    const sw = 2.33 - minX;
    const cx = (minX + 2.33) * 0.5;
    for (let s = 0; s < 5; s++) {
      const sz = -2.29 + s * 0.075;
      addBox(
        airing,
        `simpleHouse.airingCupboard.slat_${tierIdx}_${s + 1}`,
        [sw, 0.016, 0.052],
        [cx, sy, sz],
        oakMat
      );
    }
    addBox(
      airing,
      `simpleHouse.airingCupboard.foldedTowels_${tierIdx}`,
      [Math.min(0.34, sw - 0.06), 0.11, 0.28],
      [2.11, sy + 0.065, -2.14],
      linenMat
    );
  }
}

