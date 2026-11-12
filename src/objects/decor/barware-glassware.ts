import * as THREE from 'three';
import {
  createBrushedStainlessTexture,
  createPolishedChromeTexture,
} from '../../engine/textures/timber-and-metal-textures.ts';
import { prepGeo } from '../shared/scene-helpers.ts';

export interface BarwareMaterialSuite {
  readonly crystalGlass: THREE.MeshPhysicalMaterial;
  readonly cutCrystalFacet: THREE.MeshPhysicalMaterial;
  readonly seaMistGinGlass: THREE.MeshPhysicalMaterial;
  readonly amberSingleMaltLiquid: THREE.MeshPhysicalMaterial;
  readonly ginClearLiquid: THREE.MeshPhysicalMaterial;
  readonly polishedChrome: THREE.MeshPhysicalMaterial;
  readonly brushedStainless: THREE.MeshStandardMaterial;
  readonly stonewareOatmeal: THREE.MeshStandardMaterial;
  readonly stonewareCreamGlaze: THREE.MeshPhysicalMaterial;
  readonly naturalCork: THREE.MeshStandardMaterial;
  readonly walnutCorkTop: THREE.MeshStandardMaterial;
  readonly parchmentLabel: THREE.MeshStandardMaterial;
  readonly slateBotanicalLabel: THREE.MeshStandardMaterial;
  readonly champagneGreenGlass: THREE.MeshPhysicalMaterial;
  readonly burgundyAntiqueGlass: THREE.MeshPhysicalMaterial;
  readonly sanPellegrinoEmeraldGlass: THREE.MeshPhysicalMaterial;
  readonly goldFoilCapsule: THREE.MeshStandardMaterial;
  readonly crimsonFoilCapsule: THREE.MeshStandardMaterial;
  readonly sanPellegrinoBlueLabel: THREE.MeshStandardMaterial;
  readonly biscottiCrumb: THREE.MeshStandardMaterial;
}

let cachedBarwareMaterials: BarwareMaterialSuite | null = null;

export function getBarwareMaterialSuite(): BarwareMaterialSuite {
  if (cachedBarwareMaterials) return cachedBarwareMaterials;

  const chromeTex = createPolishedChromeTexture();
  const brushedTex = createBrushedStainlessTexture();

  cachedBarwareMaterials = {
    crystalGlass: new THREE.MeshPhysicalMaterial({
      name: 'barware.leadFreeCrystal',
      color: 0xf4f9fd,
      transparent: true,
      opacity: 0.34,
      roughness: 0.04,
      metalness: 0.0,
      ior: 1.52,
      reflectivity: 0.92,
      clearcoat: 0.4,
      clearcoatRoughness: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    cutCrystalFacet: new THREE.MeshPhysicalMaterial({
      name: 'barware.cutCrystalHeavySham',
      color: 0xe9f3fa,
      transparent: true,
      opacity: 0.44,
      roughness: 0.04,
      metalness: 0.04,
      ior: 1.54,
      reflectivity: 0.95,
      clearcoat: 0.5,
      clearcoatRoughness: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    seaMistGinGlass: new THREE.MeshPhysicalMaterial({
      name: 'barware.seaMistApothecaryGlass',
      color: 0xd9eee9,
      transparent: true,
      opacity: 0.42,
      roughness: 0.05,
      metalness: 0.0,
      ior: 1.52,
      clearcoat: 0.4,
      clearcoatRoughness: 0.05,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    amberSingleMaltLiquid: new THREE.MeshPhysicalMaterial({
      name: 'barware.amberSingleMaltWhisky',
      color: 0xb86214,
      emissive: new THREE.Color(0x3a1902),
      emissiveIntensity: 0.16,
      transparent: true,
      opacity: 0.78,
      roughness: 0.05,
      metalness: 0.0,
      ior: 1.36,
      clearcoat: 0.35,
    }),
    ginClearLiquid: new THREE.MeshPhysicalMaterial({
      name: 'barware.botanicalGinLiquid',
      color: 0xeef8f7,
      transparent: true,
      opacity: 0.24,
      roughness: 0.04,
      metalness: 0.0,
      ior: 1.36,
      depthWrite: false,
    }),
    polishedChrome: new THREE.MeshPhysicalMaterial({
      name: 'barware.polishedChrome',
      color: 0xeaf0f6,
      map: chromeTex,
      metalness: 0.95,
      roughness: 0.1,
      clearcoat: 0.22,
      clearcoatRoughness: 0.08,
    }),
    brushedStainless: new THREE.MeshStandardMaterial({
      name: 'barware.brushedStainless',
      color: 0xd6dbe0,
      map: brushedTex,
      metalness: 0.9,
      roughness: 0.22,
    }),
    stonewareOatmeal: new THREE.MeshStandardMaterial({
      name: 'barware.stonewareOatmeal',
      color: 0xdfd7c8,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    stonewareCreamGlaze: new THREE.MeshPhysicalMaterial({
      name: 'barware.stonewareCreamGlaze',
      color: 0xf3eee3,
      roughness: 0.2,
      metalness: 0.0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.12,
      side: THREE.DoubleSide,
    }),
    naturalCork: new THREE.MeshStandardMaterial({
      name: 'barware.naturalCork',
      color: 0xb98e63,
      roughness: 0.86,
      metalness: 0.0,
    }),
    walnutCorkTop: new THREE.MeshStandardMaterial({
      name: 'barware.smokedOakCorkTop',
      color: 0x45362c,
      roughness: 0.48,
      metalness: 0.02,
    }),
    parchmentLabel: new THREE.MeshStandardMaterial({
      name: 'barware.parchmentSpiritLabel',
      color: 0xf0e9da,
      roughness: 0.65,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    slateBotanicalLabel: new THREE.MeshStandardMaterial({
      name: 'barware.slateBotanicalGinLabel',
      color: 0xd8e2e0,
      roughness: 0.58,
      metalness: 0.04,
      side: THREE.DoubleSide,
    }),
    champagneGreenGlass: new THREE.MeshPhysicalMaterial({
      name: 'barware.champagneCuveeGlass',
      color: 0x18301d,
      roughness: 0.12,
      metalness: 0.08,
      clearcoat: 0.65,
      clearcoatRoughness: 0.08,
    }),
    burgundyAntiqueGlass: new THREE.MeshPhysicalMaterial({
      name: 'barware.burgundyDeadLeafGlass',
      color: 0x2a2117,
      roughness: 0.13,
      metalness: 0.08,
      clearcoat: 0.65,
      clearcoatRoughness: 0.08,
    }),
    sanPellegrinoEmeraldGlass: new THREE.MeshPhysicalMaterial({
      name: 'barware.sanPellegrinoEmerald',
      color: 0x1c663d,
      roughness: 0.1,
      metalness: 0.06,
      clearcoat: 0.6,
      clearcoatRoughness: 0.06,
    }),
    goldFoilCapsule: new THREE.MeshStandardMaterial({
      name: 'barware.champagneGoldFoil',
      color: 0xd8b458,
      roughness: 0.26,
      metalness: 0.84,
    }),
    crimsonFoilCapsule: new THREE.MeshStandardMaterial({
      name: 'barware.burgundyCrimsonCapsule',
      color: 0x6e1d26,
      roughness: 0.34,
      metalness: 0.48,
    }),
    sanPellegrinoBlueLabel: new THREE.MeshStandardMaterial({
      name: 'barware.sanPellegrinoLabel',
      color: 0xc4e2f2,
      roughness: 0.42,
      metalness: 0.02,
    }),
    biscottiCrumb: new THREE.MeshStandardMaterial({
      name: 'barware.almondBiscotti',
      color: 0xc69358,
      roughness: 0.78,
      metalness: 0.0,
    }),
  };

  return cachedBarwareMaterials;
}

/**
 * Cut-crystal Old Fashioned rocks tumbler (`Ø82 × 94 mm`, `14 mm` heavy sham base,
 * closed inner+outer wall `LatheGeometry` + subtle 12-facet lower cut-crystal sham collar).
 */
export function buildCrystalRocksTumbler(namePrefix: string): THREE.Group {
  const mats = getBarwareMaterialSuite();
  const group = new THREE.Group();
  group.name = namePrefix;

  const wallPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(0.0375, 0.0),
    new THREE.Vector2(0.0392, 0.003),
    new THREE.Vector2(0.0398, 0.015),
    new THREE.Vector2(0.0405, 0.052),
    new THREE.Vector2(0.041, 0.093),
    new THREE.Vector2(0.0402, 0.094),
    new THREE.Vector2(0.0388, 0.0928),
    new THREE.Vector2(0.0378, 0.05),
    new THREE.Vector2(0.0365, 0.016),
    new THREE.Vector2(0.024, 0.0142),
    new THREE.Vector2(0.0001, 0.014),
  ];
  const bowl = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(wallPts, 24)),
    mats.crystalGlass
  );
  bowl.name = `${namePrefix}.crystalWall`;
  group.add(bowl);

  // Subtle 12-facet cut-crystal heavy sham refraction prism band around the lower 24 mm
  const shamPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0012),
    new THREE.Vector2(0.0382, 0.0012),
    new THREE.Vector2(0.0394, 0.024),
    new THREE.Vector2(0.0372, 0.024),
    new THREE.Vector2(0.0355, 0.0135),
    new THREE.Vector2(0.0001, 0.013),
  ];
  const sham = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(shamPts, 12)),
    mats.cutCrystalFacet
  );
  sham.name = `${namePrefix}.cutShamBase`;
  group.add(sham);

  return group;
}

/**
 * Stemmed Bordeaux red wine glass (`Ø76 mm` foot, `Ø6 mm` drawn stem, `Ø86 mm` tulip bowl, `215 mm` H),
 * closed inner+outer wall `LatheGeometry(points, 24)`.
 */
export function buildCrystalBordeauxGlass(namePrefix: string): THREE.Mesh {
  const mats = getBarwareMaterialSuite();
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(0.038, 0.0),
    new THREE.Vector2(0.0372, 0.0024),
    new THREE.Vector2(0.011, 0.0065),
    new THREE.Vector2(0.0034, 0.014),
    new THREE.Vector2(0.003, 0.056),
    new THREE.Vector2(0.0032, 0.096),
    new THREE.Vector2(0.0085, 0.106),
    new THREE.Vector2(0.028, 0.118),
    new THREE.Vector2(0.0415, 0.14),
    new THREE.Vector2(0.043, 0.166),
    new THREE.Vector2(0.0402, 0.194),
    new THREE.Vector2(0.0365, 0.2142),
    new THREE.Vector2(0.0358, 0.215),
    new THREE.Vector2(0.0351, 0.214),
    new THREE.Vector2(0.0386, 0.193),
    new THREE.Vector2(0.0412, 0.165),
    new THREE.Vector2(0.0396, 0.14),
    new THREE.Vector2(0.0255, 0.12),
    new THREE.Vector2(0.007, 0.111),
    new THREE.Vector2(0.0001, 0.109),
  ];
  const mesh = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(pts, 24)), mats.crystalGlass);
  mesh.name = namePrefix;
  return mesh;
}

/**
 * Tall stemmed Champagne flute (`Ø68 mm` foot, `Ø5.6 mm` drawn stem, `Ø52 -> Ø42 mm` slender tulip bowl, `225 mm` H),
 * closed inner+outer wall `LatheGeometry(points, 24)`.
 */
export function buildCrystalChampagneFlute(namePrefix: string): THREE.Mesh {
  const mats = getBarwareMaterialSuite();
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(0.034, 0.0),
    new THREE.Vector2(0.0332, 0.0022),
    new THREE.Vector2(0.0095, 0.006),
    new THREE.Vector2(0.003, 0.013),
    new THREE.Vector2(0.0028, 0.06),
    new THREE.Vector2(0.003, 0.102),
    new THREE.Vector2(0.0075, 0.112),
    new THREE.Vector2(0.0195, 0.128),
    new THREE.Vector2(0.0258, 0.156),
    new THREE.Vector2(0.0252, 0.19),
    new THREE.Vector2(0.0218, 0.2242),
    new THREE.Vector2(0.0211, 0.225),
    new THREE.Vector2(0.0204, 0.224),
    new THREE.Vector2(0.0236, 0.189),
    new THREE.Vector2(0.0241, 0.156),
    new THREE.Vector2(0.0178, 0.13),
    new THREE.Vector2(0.0055, 0.116),
    new THREE.Vector2(0.0001, 0.114),
  ];
  const mesh = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(pts, 24)), mats.crystalGlass);
  mesh.name = namePrefix;
  return mesh;
}

/**
 * Heavy shouldered crystal whisky decanter (`224 mm` H total) with `18 mm` crystal sham base,
 * closed inner+outer crystal walls, warm amber single-malt fill, and faceted cut-crystal stopper.
 */
export function buildCrystalWhiskyDecanter(namePrefix: string): THREE.Group {
  const mats = getBarwareMaterialSuite();
  const group = new THREE.Group();
  group.name = namePrefix;

  // Outer+inner thin-walled heavy-sham shouldered crystal vessel (`y = 0..0.182 m`, Ø108 mm)
  const vesselPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(0.049, 0.0),
    new THREE.Vector2(0.0525, 0.004),
    new THREE.Vector2(0.054, 0.024),
    new THREE.Vector2(0.0545, 0.112),
    new THREE.Vector2(0.052, 0.126),
    new THREE.Vector2(0.036, 0.138),
    new THREE.Vector2(0.0215, 0.146),
    new THREE.Vector2(0.0205, 0.172),
    new THREE.Vector2(0.0255, 0.18),
    new THREE.Vector2(0.0248, 0.182),
    new THREE.Vector2(0.0175, 0.181),
    new THREE.Vector2(0.0165, 0.146),
    new THREE.Vector2(0.032, 0.134),
    new THREE.Vector2(0.048, 0.12),
    new THREE.Vector2(0.049, 0.024),
    new THREE.Vector2(0.036, 0.0185),
    new THREE.Vector2(0.0001, 0.018),
  ];
  const vessel = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(vesselPts, 28)),
    mats.crystalGlass
  );
  vessel.name = `${namePrefix}.vessel`;
  group.add(vessel);

  // Subtle 10-facet cut-crystal base collar for refractive sparkle
  const baseFacetPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0015),
    new THREE.Vector2(0.0505, 0.0015),
    new THREE.Vector2(0.0532, 0.032),
    new THREE.Vector2(0.0495, 0.032),
    new THREE.Vector2(0.042, 0.017),
    new THREE.Vector2(0.0001, 0.0165),
  ];
  const baseFacet = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(baseFacetPts, 10)),
    mats.cutCrystalFacet
  );
  baseFacet.name = `${namePrefix}.facetedBase`;
  group.add(baseFacet);

  // Warm amber single-malt whisky fill (`y = 0.019..0.098 m`)
  const whiskyPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.019),
    new THREE.Vector2(0.035, 0.0195),
    new THREE.Vector2(0.0475, 0.025),
    new THREE.Vector2(0.0478, 0.096),
    new THREE.Vector2(0.045, 0.098),
    new THREE.Vector2(0.0001, 0.0972),
  ];
  const whiskyFill = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(whiskyPts, 24)),
    mats.amberSingleMaltLiquid
  );
  whiskyFill.name = `${namePrefix}.amberSingleMaltFill`;
  group.add(whiskyFill);

  // Octagonal faceted cut-crystal stopper (`y = 0.160..0.224 m`, exact top = 224 mm!)
  const stopperPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.16),
    new THREE.Vector2(0.0145, 0.162),
    new THREE.Vector2(0.0158, 0.181),
    new THREE.Vector2(0.023, 0.186),
    new THREE.Vector2(0.0315, 0.198),
    new THREE.Vector2(0.0315, 0.212),
    new THREE.Vector2(0.0225, 0.223),
    new THREE.Vector2(0.0001, 0.224),
  ];
  const stopper = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(stopperPts, 8)),
    mats.cutCrystalFacet
  );
  stopper.name = `${namePrefix}.facetedStopper`;
  group.add(stopper);

  return group;
}

/**
 * Squat artisanal Gin (`205 mm` H) or Single Malt (`218 mm` H) apothecary bottle
 * with thin-walled `LatheGeometry`, liquid core, wrap-around front label, and wood-topped cork.
 */
export function buildArtisanalSpiritBottle(
  namePrefix: string,
  variant: 'botanicalGin' | 'singleMalt'
): THREE.Group {
  const mats = getBarwareMaterialSuite();
  const group = new THREE.Group();
  group.name = namePrefix;

  const isGin = variant === 'botanicalGin';
  const totalH = isGin ? 0.205 : 0.218;
  const shoulderY = isGin ? 0.132 : 0.142;
  const neckTopY = totalH - 0.014;
  const bodyR = isGin ? 0.044 : 0.046;

  const bottlePts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(bodyR - 0.004, 0.0),
    new THREE.Vector2(bodyR, 0.005),
    new THREE.Vector2(bodyR + 0.001, shoulderY - 0.016),
    new THREE.Vector2(bodyR - 0.005, shoulderY),
    new THREE.Vector2(0.02, shoulderY + 0.015),
    new THREE.Vector2(0.0175, neckTopY - 0.008),
    new THREE.Vector2(0.0205, neckTopY - 0.004),
    new THREE.Vector2(0.0205, neckTopY),
    new THREE.Vector2(0.0145, neckTopY),
    new THREE.Vector2(0.0145, shoulderY + 0.014),
    new THREE.Vector2(bodyR - 0.008, shoulderY - 0.004),
    new THREE.Vector2(bodyR - 0.004, 0.014),
    new THREE.Vector2(0.0001, 0.012),
  ];
  const glass = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(bottlePts, 24)),
    isGin ? mats.seaMistGinGlass : mats.crystalGlass
  );
  glass.name = `${namePrefix}.bottleGlass`;
  group.add(glass);

  // Liquid fill inside the bottle
  const fillTopY = shoulderY - 0.022;
  const liquidPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.013),
    new THREE.Vector2(bodyR - 0.0055, 0.015),
    new THREE.Vector2(bodyR - 0.005, fillTopY),
    new THREE.Vector2(0.0001, fillTopY),
  ];
  const liquid = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(liquidPts, 20)),
    isGin ? mats.ginClearLiquid : mats.amberSingleMaltLiquid
  );
  liquid.name = `${namePrefix}.liquidFill`;
  group.add(liquid);

  // Front wrap-around paper label (`+Z` facing)
  const label = new THREE.Mesh(
    prepGeo(
      new THREE.CylinderGeometry(
        bodyR + 0.0014,
        bodyR + 0.0014,
        isGin ? 0.068 : 0.074,
        22,
        1,
        true,
        -0.95,
        1.9
      )
    ),
    isGin ? mats.slateBotanicalLabel : mats.parchmentLabel
  );
  label.name = `${namePrefix}.label`;
  label.position.set(0, isGin ? 0.068 : 0.072, 0);
  group.add(label);

  // Natural cork plug + turned dark smoked-oak T-top cap (`top = totalH`)
  const corkPlug = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.0132, 0.018, 16)),
    mats.naturalCork
  );
  corkPlug.name = `${namePrefix}.corkPlug`;
  corkPlug.position.set(0, neckTopY - 0.005, 0);
  group.add(corkPlug);

  const woodCap = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0215, 0.021, 0.014, 20)),
    mats.walnutCorkTop
  );
  woodCap.name = `${namePrefix}.woodStopperCap`;
  woodCap.position.set(0, totalH - 0.007, 0);
  group.add(woodCap);

  return group;
}

/**
 * Stack of 2 `LatheGeometry` stoneware saucers + 2 nested latte/cappuccino cups (`~124 mm` H).
 */
export function buildStonewareLatteCupStack(namePrefix: string): THREE.Group {
  const mats = getBarwareMaterialSuite();
  const group = new THREE.Group();
  group.name = namePrefix;

  const saucerPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(0.044, 0.0),
    new THREE.Vector2(0.048, 0.0035),
    new THREE.Vector2(0.071, 0.013),
    new THREE.Vector2(0.072, 0.0165),
    new THREE.Vector2(0.0695, 0.017),
    new THREE.Vector2(0.046, 0.0068),
    new THREE.Vector2(0.028, 0.0055),
    new THREE.Vector2(0.026, 0.0072),
    new THREE.Vector2(0.0001, 0.0052),
  ];
  const saucerGeo = prepGeo(new THREE.LatheGeometry(saucerPts, 24));

  for (let s = 0; s < 2; s++) {
    const saucer = new THREE.Mesh(saucerGeo, mats.stonewareOatmeal);
    saucer.name = `${namePrefix}.saucer_${s + 1}`;
    saucer.position.set(0, s * 0.011, 0);
    group.add(saucer);
  }

  const cupPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(0.025, 0.0),
    new THREE.Vector2(0.027, 0.005),
    new THREE.Vector2(0.038, 0.022),
    new THREE.Vector2(0.045, 0.046),
    new THREE.Vector2(0.0465, 0.062),
    new THREE.Vector2(0.0448, 0.063),
    new THREE.Vector2(0.0428, 0.0612),
    new THREE.Vector2(0.041, 0.044),
    new THREE.Vector2(0.0335, 0.02),
    new THREE.Vector2(0.021, 0.0065),
    new THREE.Vector2(0.0001, 0.006),
  ];
  const cupGeo = prepGeo(new THREE.LatheGeometry(cupPts, 24));
  const earGeo = prepGeo(new THREE.TorusGeometry(0.0155, 0.0038, 8, 16, Math.PI * 1.12));

  for (let c = 0; c < 2; c++) {
    const cupHolder = new THREE.Group();
    cupHolder.name = `${namePrefix}.cup_${c + 1}`;
    cupHolder.position.set(0, 0.0175 + c * 0.045, 0);
    cupHolder.rotation.y = c === 0 ? 0.55 : -0.48;
    cupHolder.rotation.z = c === 1 ? 0.035 : 0;

    const cupMesh = new THREE.Mesh(
      cupGeo,
      c === 0 ? mats.stonewareOatmeal : mats.stonewareCreamGlaze
    );
    cupMesh.name = `${namePrefix}.cup_${c + 1}.bowl`;
    cupHolder.add(cupMesh);

    const ear = new THREE.Mesh(earGeo, mats.stonewareCreamGlaze);
    ear.name = `${namePrefix}.cup_${c + 1}.handle`;
    ear.rotation.z = -Math.PI * 0.5;
    ear.position.set(0.043, 0.036, 0);
    cupHolder.add(ear);

    group.add(cupHolder);
  }

  return group;
}

/**
 * Smoked-oak & polished-chrome gallery-rail serving tray holding:
 * - Sealed crystal coffee-bean / almond-biscotti apothecary jar with brushed-stainless lid
 * - 2 cut-crystal Old Fashioned rocks tumblers (`Ø82 × 94 mm`, `14 mm` heavy sham base)
 */
export function buildMinibarCounterServingTray(
  namePrefix: string,
  smokedOakHorizontalMat: THREE.Material
): THREE.Group {
  const mats = getBarwareMaterialSuite();
  const group = new THREE.Group();
  group.name = namePrefix;

  const trayW = 0.304;
  const trayD = 0.236;
  const deckH = 0.014;

  // Smoked-oak tray base board
  const baseBoard = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(trayW, deckH, trayD)),
    smokedOakHorizontalMat
  );
  baseBoard.name = `${namePrefix}.oakBase`;
  baseBoard.position.set(0, deckH * 0.5, 0);
  group.add(baseBoard);

  // 4 turned Polished Chrome corner stanchions + continuous Ø5 mm perimeter gallery rail
  const rx = trayW * 0.5 - 0.012;
  const rz = trayD * 0.5 - 0.012;
  const railY = deckH + 0.022;

  const postGeo = prepGeo(new THREE.CylinderGeometry(0.0038, 0.0045, 0.022, 12));
  for (const [tag, px, pz] of [
    ['nw', -rx, -rz],
    ['ne', rx, -rz],
    ['sw', -rx, rz],
    ['se', rx, rz],
  ] as const) {
    const post = new THREE.Mesh(postGeo, mats.polishedChrome);
    post.name = `${namePrefix}.chromePost.${tag}`;
    post.position.set(px, deckH + 0.011, pz);
    group.add(post);
  }

  const railPath = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-rx, railY, -rz),
      new THREE.Vector3(rx, railY, -rz),
      new THREE.Vector3(rx, railY, rz),
      new THREE.Vector3(-rx, railY, rz),
    ],
    true,
    'catmullrom',
    0.08
  );
  const galleryRail = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(railPath, 36, 0.0025, 10, true)),
    mats.polishedChrome
  );
  galleryRail.name = `${namePrefix}.chromeGalleryRail`;
  group.add(galleryRail);

  // Rear-left sealed crystal apothecary jar (`Ø96 × 158 mm`) with stainless lid & biscotti fill
  const jarGroup = new THREE.Group();
  jarGroup.name = `${namePrefix}.apothecaryJar`;
  jarGroup.position.set(-0.072, deckH, -0.036);

  const jarPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(0.044, 0.0),
    new THREE.Vector2(0.048, 0.006),
    new THREE.Vector2(0.048, 0.122),
    new THREE.Vector2(0.043, 0.132),
    new THREE.Vector2(0.041, 0.14),
    new THREE.Vector2(0.0385, 0.14),
    new THREE.Vector2(0.0395, 0.13),
    new THREE.Vector2(0.0445, 0.12),
    new THREE.Vector2(0.0445, 0.01),
    new THREE.Vector2(0.0001, 0.009),
  ];
  const jarBody = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(jarPts, 24)),
    mats.crystalGlass
  );
  jarBody.name = `${namePrefix}.apothecaryJar.glassVessel`;
  jarGroup.add(jarBody);

  // Biscotti sticks inside the apothecary jar
  const biscottiGeo = prepGeo(new THREE.CapsuleGeometry(0.01, 0.068, 6, 10));
  for (const [bIdx, [bx, bz, rxRot, rzRot]] of [
    [-0.014, -0.008, 0.18, -0.22],
    [0.014, -0.01, -0.14, 0.25],
    [-0.004, 0.014, -0.24, -0.12],
    [0.012, 0.012, 0.2, 0.18],
  ].entries()) {
    const stick = new THREE.Mesh(biscottiGeo, mats.biscottiCrumb);
    stick.name = `${namePrefix}.apothecaryJar.biscotti_${bIdx + 1}`;
    stick.scale.set(1.25, 1, 0.68);
    stick.position.set(bx, 0.052, bz);
    stick.rotation.set(rxRot, bIdx * 0.7, rzRot);
    jarGroup.add(stick);
  }

  // Stepped brushed-stainless airtight lid + polished-chrome finial
  const jarLidPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.134),
    new THREE.Vector2(0.038, 0.134),
    new THREE.Vector2(0.0445, 0.139),
    new THREE.Vector2(0.0445, 0.148),
    new THREE.Vector2(0.042, 0.15),
    new THREE.Vector2(0.011, 0.15),
    new THREE.Vector2(0.013, 0.158),
    new THREE.Vector2(0.0001, 0.159),
  ];
  const jarLid = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(jarLidPts, 24)),
    mats.brushedStainless
  );
  jarLid.name = `${namePrefix}.apothecaryJar.stainlessLid`;
  jarGroup.add(jarLid);
  group.add(jarGroup);

  // 2 cut-crystal Old Fashioned rocks tumblers (`Ø82 × 94 mm`, `14 mm` heavy sham base)
  const tumbler1 = buildCrystalRocksTumbler(`${namePrefix}.rocksTumbler_1`);
  tumbler1.position.set(0.068, deckH, -0.032);
  group.add(tumbler1);

  const tumbler2 = buildCrystalRocksTumbler(`${namePrefix}.rocksTumbler_2`);
  tumbler2.position.set(0.022, deckH, 0.056);
  group.add(tumbler2);

  return group;
}

/**
 * Horizontal `LatheGeometry` Champagne or Burgundy 750 ml wine bottle (`300 mm` long,
 * laid horizontally along `Z` with neck & foil capsule facing `+Z` toward the glazed fridge door).
 */
export function buildHorizontalWineBottle(
  namePrefix: string,
  varietal: 'champagne' | 'burgundy'
): THREE.Group {
  const mats = getBarwareMaterialSuite();
  const group = new THREE.Group();
  group.name = namePrefix;

  const isChamp = varietal === 'champagne';
  const rBody = isChamp ? 0.043 : 0.041;

  // Profile along +Y (0 = punt base, 0.295 = cork/foil lip), then rotated +90° around X so lip points +Z!
  const bodyPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.014),
    new THREE.Vector2(rBody - 0.008, 0.0),
    new THREE.Vector2(rBody, 0.006),
    new THREE.Vector2(rBody, 0.135),
    new THREE.Vector2(rBody - 0.008, 0.175),
    new THREE.Vector2(0.02, 0.218),
    new THREE.Vector2(0.015, 0.285),
    new THREE.Vector2(0.0001, 0.286),
  ];
  const bottleMesh = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(bodyPts, 20)),
    isChamp ? mats.champagneGreenGlass : mats.burgundyAntiqueGlass
  );
  bottleMesh.name = `${namePrefix}.glassBody`;
  bottleMesh.rotation.x = Math.PI * 0.5;
  bottleMesh.position.set(0, rBody, -0.145);
  group.add(bottleMesh);

  // Foil capsule & cordon collar on the neck facing +Z
  const foilPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0215, 0.212),
    new THREE.Vector2(0.0158, 0.28),
    new THREE.Vector2(0.0172, 0.286),
    new THREE.Vector2(0.0168, 0.294),
    new THREE.Vector2(0.0001, 0.294),
  ];
  const foilMesh = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(foilPts, 18)),
    isChamp ? mats.goldFoilCapsule : mats.crimsonFoilCapsule
  );
  foilMesh.name = `${namePrefix}.foilCapsule`;
  foilMesh.rotation.x = Math.PI * 0.5;
  foilMesh.position.set(0, rBody, -0.145);
  group.add(foilMesh);

  // Cream waist label band
  const labelBand = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(rBody + 0.0008, rBody + 0.0008, 0.068, 18)),
    mats.parchmentLabel
  );
  labelBand.name = `${namePrefix}.label`;
  labelBand.rotation.x = Math.PI * 0.5;
  labelBand.position.set(0, rBody, -0.055);
  group.add(labelBand);

  return group;
}

/**
 * Upright `LatheGeometry` chilled San Pellegrino (`176 mm` H) or Fever-Tree tonic mixer bottle (`148 mm` H)
 * for the upper perforated chrome shelf inside `.wineCooler`.
 */
export function buildChilledBeverageBottle(
  namePrefix: string,
  kind: 'sanPellegrino' | 'tonicMixer'
): THREE.Group {
  const mats = getBarwareMaterialSuite();
  const group = new THREE.Group();
  group.name = namePrefix;

  const isSp = kind === 'sanPellegrino';
  const r = isSp ? 0.029 : 0.026;
  const h = isSp ? 0.176 : 0.148;

  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(r - 0.003, 0.0),
    new THREE.Vector2(r, 0.005),
    new THREE.Vector2(r, h * 0.54),
    new THREE.Vector2(r * 0.68, h * 0.74),
    new THREE.Vector2(0.0125, h * 0.88),
    new THREE.Vector2(0.0135, h - 0.008),
    new THREE.Vector2(0.0001, h - 0.008),
  ];
  const body = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(pts, 18)),
    isSp ? mats.sanPellegrinoEmeraldGlass : mats.crystalGlass
  );
  body.name = `${namePrefix}.body`;
  group.add(body);

  const label = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(r + 0.0007, r + 0.0007, isSp ? 0.046 : 0.04, 18)),
    isSp ? mats.sanPellegrinoBlueLabel : mats.parchmentLabel
  );
  label.name = `${namePrefix}.label`;
  label.position.set(0, h * 0.34, 0);
  group.add(label);

  const cap = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0138, 0.0138, 0.012, 16)),
    isSp ? mats.sanPellegrinoBlueLabel : mats.goldFoilCapsule
  );
  cap.name = `${namePrefix}.crownCap`;
  cap.position.set(0, h - 0.004, 0);
  group.add(cap);

  return group;
}
