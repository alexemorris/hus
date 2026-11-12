import * as THREE from 'three';
import { attachAssetInteraction, attachAssetMetadata, formatBrasswareFinishLabel, resolveBrasswareCode } from '../shared/catalog-smart-metadata.ts';
import type { CircuitId } from '../../core/types/knx.ts';
import {
  getBathroomBrassMaterials,
  resolveFixtureFinishToBrassCode,
} from '../sanitaryware/bathroom-materials.ts';
import type { FixtureMetalFinish } from '../sanitaryware/bathroom-spec-types.ts';
import type { LightCircuitGroup, LightGroupMap } from '../../engine/viewer/scene-types.ts';
import { getOrCreateCachedTexture } from '../../engine/textures/texture-registry.ts';
import {
  addNamedBox,
  addNamedCyl,
  deriveNormalAndRoughnessFromHeight,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getClearArchitecturalGlassMaterial,
  getDarkAntiquedBrassMaterial,
  getPaintedJoineryMaterial,
  getPrismaticFlutedGlassMaterial,
  getWovenFabricMaps,
  makeRgbaDataTexture,
  type PbrDataMapBundle,
  seamlessFbm2D,
  sharedSphereGeometry,
  sharedTorusGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';

export type CatalogLightingContext =
  | LightGroupMap
  | { readonly lightGroups?: LightGroupMap }
  | null
  | undefined;

function resolveCircuitGroup(
  ctx: CatalogLightingContext,
  circuitId: CircuitId | undefined
): LightCircuitGroup | null {
  if (!ctx || !circuitId) return null;
  if ('lightGroups' in ctx && ctx.lightGroups && typeof ctx.lightGroups === 'object') {
    const map = ctx.lightGroups as LightGroupMap;
    return map[circuitId] ?? null;
  }
  const map = ctx as LightGroupMap;
  if (circuitId in map) {
    return map[circuitId] ?? null;
  }
  return null;
}

function makeDedicatedFilamentMaterial(name: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xffd184,
    emissive: new THREE.Color(0xffa947),
    emissiveIntensity: 2.35,
    roughness: 0.2,
    metalness: 0.0,
  });
}

function makeDedicatedWarmShadeMaterial(
  name: string,
  baseHex: number,
  weave: 'linen' | 'cashmere' = 'linen'
): THREE.MeshStandardMaterial {
  const maps = getWovenFabricMaps(name, baseHex, weave);
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xffffff,
    map: maps.colorMap,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    emissive: new THREE.Color(0xffc97e),
    emissiveIntensity: 0.42,
    roughness: 0.86,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
}

function addGlowingCandleBulb(
  parent: THREE.Object3D,
  namePrefix: string,
  x: number,
  baseY: number,
  z: number,
  brassMat: THREE.Material,
  sleeveMat: THREE.Material,
  filamentMat: THREE.Material,
  glassMat: THREE.Material,
  sleeveH = 0.048
): void {
  addNamedCyl(
    parent,
    `${namePrefix}.dripPan`,
    0.022,
    0.016,
    0.006,
    14,
    x,
    baseY + 0.003,
    z,
    brassMat,
    true
  );
  addNamedCyl(
    parent,
    `${namePrefix}.candleSleeve`,
    0.011,
    0.011,
    sleeveH,
    12,
    x,
    baseY + 0.006 + sleeveH * 0.5,
    z,
    sleeveMat,
    true
  );
  // 2200K glowing squirrel-cage filament core + clear flame glass envelope
  const filamentY = baseY + 0.006 + sleeveH + 0.018;
  addNamedCyl(
    parent,
    `${namePrefix}.filamentCore`,
    0.003,
    0.003,
    0.022,
    8,
    x,
    filamentY,
    z,
    filamentMat,
    true
  );
  const envelope = new THREE.Mesh(sharedSphereGeometry(0.013, 12, 10), glassMat);
  envelope.name = `${namePrefix}.flameBulbGlass`;
  envelope.scale.set(0.85, 1.55, 0.85);
  envelope.position.set(x, filamentY + 0.003, z);
  tagHighLod(envelope);
  parent.add(envelope);
}

function getPortobelloStonewareMaps(): PbrDataMapBundle {
  return getOrCreateCachedTexture('catalog:lighting:portobello-stoneware:v1', () => {
    const size = 96;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = y * size + x;
        const o = idx * 4;
        const throwRing = Math.sin(v * Math.PI * 36) * 7;
        const grog = (seamlessFbm2D(u, v, 10, 3, 9103) - 0.5) * 18;
        const d = throwRing + grog;
        color[o] = Math.max(0, Math.min(255, Math.round(228 + d)));
        color[o + 1] = Math.max(0, Math.min(255, Math.round(222 + d * 0.96)));
        color[o + 2] = Math.max(0, Math.min(255, Math.round(211 + d * 0.9)));
        color[o + 3] = 255;
        height[idx] = 0.5 + throwRing * 0.025 + grog * 0.012;
        rough[idx] = 0.72 - throwRing * 0.01;
      }
    }
    const derived = deriveNormalAndRoughnessFromHeight(height, rough, size, size, 1.8, 'catalog.portobelloStoneware');
    return {
      colorMap: makeRgbaDataTexture(color, size, size, 'catalog.portobelloStoneware.color', true),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

function getVeinedAlabasterMaps(): PbrDataMapBundle {
  return getOrCreateCachedTexture('catalog:lighting:veined-alabaster:v1', () => {
    const size = 96;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = y * size + x;
        const o = idx * 4;
        const n1 = seamlessFbm2D(u, v, 3, 4, 9209);
        const vein = Math.pow(Math.max(0, 1 - Math.abs(Math.sin((u * 1.5 + v * 2.2 + n1 * 0.7) * Math.PI)) * 3.2), 1.8);
        color[o] = Math.max(0, Math.min(255, Math.round(244 - vein * 26)));
        color[o + 1] = Math.max(0, Math.min(255, Math.round(238 - vein * 32)));
        color[o + 2] = Math.max(0, Math.min(255, Math.round(226 - vein * 38)));
        color[o + 3] = 255;
        height[idx] = 0.5 - vein * 0.08;
        rough[idx] = 0.24 + vein * 0.08;
      }
    }
    const derived = deriveNormalAndRoughnessFromHeight(height, rough, size, size, 1.1, 'catalog.veinedAlabaster');
    return {
      colorMap: makeRgbaDataTexture(color, size, size, 'catalog.veinedAlabaster.color', true),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

export interface GeorgianCoachLanternOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Optional KNX / electrical circuit ID to register the `2200K` filament & optional point light. */
  readonly circuitId?: CircuitId;
  readonly createPointLight?: boolean;
  readonly pointLightIntensity?: number;
  /** Optional metal finish override across all 9 finishes + Corston presets (defaults to Aged Brass). */
  readonly finish?: FixtureMetalFinish;
}

/**
 * `220 x 240 x 460 mm` **Jim Lawrence *Grosvenor / Carlisle*** solid Antiqued Brass &
 * 4-pane bevelled-glass exterior Georgian coach wall lantern:
 * - Stepped solid Antiqued Brass wall backplate (`z = 0..0.022`) + swan-neck/scroll wall bracket arm
 * - Tapered 4-sided Antiqued Brass glazed cage (`W 220 mm`, projecting to `D 240 mm`, total `H 460 mm`)
 * - 4 clear bevelled architectural glass panes (`0` z-fight!)
 * - Tiered pagoda/ventilated chimney cap & lower turned brass acorn finial
 * - Twin `2200K` glowing filament candle bulbs on a twin-arm brass sconce cluster inside.
 * Local origin `(0, 0, 0)` is at the wall mounting center (`z = 0` backplate flush against wall, projecting toward `+Z`).
 */
export function buildGeorgianCoachLantern(
  ctx: CatalogLightingContext = null,
  opts: GeorgianCoachLanternOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianCoachLantern';
  const finishPal = opts.finish
    ? getBathroomBrassMaterials(resolveFixtureFinishToBrassCode(opts.finish))
    : null;
  const darkBrass = finishPal ? finishPal.darkShadow : getDarkAntiquedBrassMaterial();
  const agedBrass = finishPal ? finishPal.primary : getAgedBrassMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const sleeveMat = getPaintedJoineryMaterial(0xf3eee1, 0.55, `${namePrefix}.candleSleeve`);
  const filamentMat = makeDedicatedFilamentMaterial(`${namePrefix}.filament2200k`);

  const root = new THREE.Group();
  root.name = namePrefix;

  // Total dimensions: W = 0.22 m, D = 0.24 m (`z = 0 .. 0.24`), H = 0.46 m (`y = -0.23 .. +0.23`)
  // Wall backplate (`W 95 x H 210 x D 20 mm` at `z = 0..0.020`)
  addNamedBox(
    root,
    `${namePrefix}.wallBackplate`,
    0.095,
    0.21,
    0.014,
    0,
    0,
    0.007,
    darkBrass
  );
  addNamedBox(
    root,
    `${namePrefix}.wallBackplateBoss`,
    0.072,
    0.165,
    0.008,
    0,
    0,
    0.018,
    agedBrass,
    true
  );

  //Lantern cage center at `cz = 0.145` (so cage `W 0.19..0.22` spans `z = 0.05..0.24` -> total `D = 0.24 m`)
  const cz = 0.145;
  // Bracket arm linking wall backplate (`z = 0.022`) to rear of lantern cage & top chimney scroll
  addNamedBox(
    root,
    `${namePrefix}.bracketHorizontalArm`,
    0.018,
    0.018,
    0.048,
    0,
    0.095,
    0.046,
    darkBrass,
    true
  );
  addNamedBox(
    root,
    `${namePrefix}.bracketLowerBrace`,
    0.014,
    0.014,
    0.056,
    0,
    -0.065,
    0.05,
    darkBrass,
    true
  );

  // Tapered 4-sided Antiqued Brass lantern cage (`y = -0.145 .. +0.095`, `topW = 0.21`, `botW = 0.155`)
  const cageBotY = -0.145;
  const cageTopY = 0.095;
  const cageH = cageTopY - cageBotY; // 0.24 m
  const cageMidY = (cageBotY + cageTopY) * 0.5;
  const topHalf = 0.095; // 190 mm square cage (+ 220 mm cornice hood)
  const botHalf = 0.072; // 144 mm bottom frame

  // Bottom brass tray frame & lower turned acorn drop finial (`y = -0.23 .. -0.145`)
  addNamedBox(
    root,
    `${namePrefix}.cageBottomFrame`,
    botHalf * 2 + 0.014,
    0.014,
    botHalf * 2 + 0.014,
    0,
    cageBotY + 0.007,
    cz,
    darkBrass
  );
  addNamedCyl(
    root,
    `${namePrefix}.bottomFunnelCone`,
    botHalf * 0.9,
    0.018,
    0.048,
    4,
    0,
    cageBotY - 0.024,
    cz,
    darkBrass,
    true
  ).rotation.y = Math.PI * 0.25;
  addNamedCyl(
    root,
    `${namePrefix}.bottomAcornFinial`,
    0.014,
    0.005,
    0.036,
    12,
    0,
    cageBotY - 0.066,
    cz,
    agedBrass,
    true
  );

  // 4 inclined corner Antiqued Brass glazing bars
  const dxSlope = topHalf - botHalf;
  const cornerLen = Math.hypot(cageH, dxSlope, dxSlope);
  const tiltAngle = Math.atan2(dxSlope, cageH);
  for (const [cTag, sx, sz] of [
    ['FL', -1, 1],
    ['FR', 1, 1],
    ['BL', -1, -1],
    ['BR', 1, -1],
  ] as const) {
    const bar = addNamedBox(
      root,
      `${namePrefix}.cornerRib_${cTag}`,
      0.011,
      cornerLen,
      0.011,
      sx * (botHalf + topHalf) * 0.5,
      cageMidY,
      cz + sz * (botHalf + topHalf) * 0.5,
      darkBrass,
      true
    );
    bar.rotation.z = -sx * tiltAngle;
    bar.rotation.x = sz * tiltAngle;
  }

  // Top cage gallery rail (`y = cageTopY`)
  addNamedBox(
    root,
    `${namePrefix}.cageTopGallery`,
    topHalf * 2 + 0.016,
    0.016,
    topHalf * 2 + 0.016,
    0,
    cageTopY + 0.008,
    cz,
    darkBrass
  );

  // 4 bevelled clear glass panes sloped cleanly between the 4 corner ribs
  const paneMidHalf = (botHalf + topHalf) * 0.5 - 0.003;
  const paneH = Math.hypot(cageH - 0.024, dxSlope);
  const paneW = (botHalf + topHalf) - 0.016;
  for (const [fTag, px, pz, rotY, rx, rz] of [
    ['Front', 0, cz + paneMidHalf, 0, tiltAngle, 0],
    ['Back', 0, cz - paneMidHalf, 0, -tiltAngle, 0],
    ['Left', -paneMidHalf, cz, Math.PI * 0.5, 0, tiltAngle],
    ['Right', paneMidHalf, cz, Math.PI * 0.5, 0, -tiltAngle],
  ] as const) {
    const pane = addNamedBox(
      root,
      `${namePrefix}.bevelledGlass${fTag}`,
      paneW,
      paneH,
      0.0035,
      px,
      cageMidY,
      pz,
      glassMat,
      true
    );
    pane.rotation.set(rx, rotY, rz);
  }

  // Tiered Grosvenor/Carlisle pagoda hood & ventilated chimney cap (`W 220 mm`, reaching `y = +0.23` -> total H 460 mm)
  const hoodCone = addNamedCyl(
    root,
    `${namePrefix}.pagodaHood`,
    0.048,
    0.155, // 0.155 * sqrt(2) / 2 -> 220 mm square eaves!
    0.068,
    4,
    0,
    cageTopY + 0.016 + 0.034,
    cz,
    darkBrass
  );
  hoodCone.rotation.y = Math.PI * 0.25;

  addNamedCyl(
    root,
    `${namePrefix}.chimneyVentDrum`,
    0.034,
    0.034,
    0.036,
    14,
    0,
    cageTopY + 0.084 + 0.018,
    cz,
    agedBrass,
    true
  );
  addNamedCyl(
    root,
    `${namePrefix}.chimneyCap`,
    0.008,
    0.046,
    0.022,
    16,
    0,
    cageTopY + 0.12 + 0.011,
    cz,
    darkBrass,
    true
  );
  const topRing = new THREE.Mesh(sharedTorusGeometry(0.014, 0.0035, 8, 16), agedBrass);
  topRing.name = `${namePrefix}.topLoopFinial`;
  topRing.position.set(0, 0.222, cz);
  tagHighLod(topRing);
  root.add(topRing);

  // Twin 2200K glowing filament candle bulbs on central brass stem inside cage
  addNamedCyl(
    root,
    `${namePrefix}.centralCandleStem`,
    0.007,
    0.009,
    0.048,
    10,
    0,
    cageBotY + 0.038,
    cz,
    agedBrass,
    true
  );
  addNamedBox(
    root,
    `${namePrefix}.twinBulbCrossbar`,
    0.072,
    0.008,
    0.008,
    0,
    cageBotY + 0.062,
    cz,
    agedBrass,
    true
  );
  for (const [bTag, bx] of [
    ['Left', -0.032],
    ['Right', 0.032],
  ] as const) {
    addGlowingCandleBulb(
      root,
      `${namePrefix}.candleBulb${bTag}`,
      bx,
      cageBotY + 0.066,
      cz,
      agedBrass,
      sleeveMat,
      filamentMat,
      glassMat,
      0.046
    );
  }

  const circuitGroup = resolveCircuitGroup(ctx, opts.circuitId);
  if (circuitGroup) {
    circuitGroup.emissives.push(filamentMat);
  }
  if (opts.createPointLight) {
    const pt = new THREE.PointLight(0xffb45c, opts.pointLightIntensity ?? 1.8, 5.5, 2.0);
    pt.name = `${namePrefix}.pointLight`;
    pt.position.set(0, cageMidY + 0.02, cz);
    root.add(pt);
    if (circuitGroup) {
      circuitGroup.lights.push(pt);
    }
  }

  if (!ctx) {
    const baseEmissive = filamentMat.emissiveIntensity;
    attachAssetInteraction(root, {
      kind: 'custom',
      label: 'Switch Off Coach Lantern',
      activeLabel: 'Switch Off Coach Lantern',
      initialActive: true,
      audio: { openPreset: 'switchClick', closePreset: 'switchClick', isExterior: true },
      onToggle: (active) => {
        filamentMat.emissiveIntensity = active ? baseEmissive : 0.04;
      },
    });
  }
  const fCode = resolveBrasswareCode(opts.finish, 'BZ');
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Vaughan Designs Georgian Bevelled-Glass Exterior Coach Lantern',
    brand: 'Vaughan Designs',
    collection: 'Exterior Lanterns',
    sku: `VAU-CL01-${fCode}`,
    finish: `${formatBrasswareFinishLabel(opts.finish, 'BZ')} & Bevelled Clear Glass`,
    category: 'lighting',
    dimensionsMm: [240, 290, 560],
    productUrl: 'https://www.vaughandesigns.com/lighting/outdoor-lighting/',
    schematicUrl: 'https://www.vaughandesigns.com/downloads/spec-sheets/CL01-Coach-Lantern.pdf',
  });
}

export type HeritageInteriorLightingKind =
  | 'chandelier6Arm'
  | 'hallLantern'
  | 'coxFlutedPendant'
  | 'spunBrassSaucerPendant'
  | 'coxFlutedSconce'
  | 'whiteCoCeramicLamp'
  | 'whiteCoAlabasterLamp';

export interface HeritageInteriorLightingOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly kind?: HeritageInteriorLightingKind;
  /** Suspension drop from ceiling rose (`y = 0`) to top of fitting body for ceiling pendants/chandeliers (default `0.42` m). */
  readonly dropM?: number;
  readonly circuitId?: CircuitId;
  readonly createPointLight?: boolean;
  readonly pointLightIntensity?: number;
  /** Optional metal finish override across all 9 finishes + Corston presets (defaults to Aged Brass). */
  readonly finish?: FixtureMetalFinish;
}

/**
 * Heritage Georgian, **Jim Lawrence**, **Cox & Cox** & **The White Company** interior lighting suite:
 * - `'chandelier6Arm'`: Jim Lawrence *Queensbury* (`Ø650 x 480 mm`) 6-scroll-arm Antiqued Brass chandelier w/ pleated ivory silk empire shades
 * - `'hallLantern'`: (`Ø320 x 480 mm`) glazed cylindrical/hexagonal Aged Brass hanging hall/landing lantern w/ 3-candle cluster
 * - `'coxFlutedPendant'`: (`Ø320 x 240 mm`) Cox & Cox prismatic ribbed-glass & Aged Brass dome pendant on twisted linen flex
 * - `'coxFlutedSconce'`: (`140 x 195 x 280 mm`) fluted-glass & Aged Brass bathroom/hall wall light
 * - `'whiteCoCeramicLamp'`: The White Company *Portobello* (`Ø380 x 540 mm`) textured stoneware base + warm linen drum shade
 * - `'whiteCoAlabasterLamp'`: (`Ø350 x 510 mm`) turned veined alabaster column table lamp + empire linen shade.
 *
 * Origin conventions:
 * - Ceiling pendants (`chandelier6Arm`, `hallLantern`, `coxFlutedPendant`): `(0, 0, 0)` is at the ceiling rose (`y = 0`, hanging down into `-Y`).
 * - Wall sconce (`coxFlutedSconce`): `(0, 0, 0)` is at wall backplate center (`z = 0`, projecting into `+Z`).
 * - Table lamps (`whiteCoCeramicLamp`, `whiteCoAlabasterLamp`): `(0, 0, 0)` is at base bottom (`y = 0`, rising into `+Y`).
 */
export function buildHeritageInteriorLighting(
  ctx: CatalogLightingContext = null,
  opts: HeritageInteriorLightingOptions = {}
): THREE.Group {
  const kind = opts.kind ?? 'chandelier6Arm';
  const namePrefix = opts.name ?? `heritageLight_${kind}`;

  const finishPal = opts.finish
    ? getBathroomBrassMaterials(resolveFixtureFinishToBrassCode(opts.finish))
    : null;
  const brassMat = finishPal ? finishPal.primary : getAgedBrassMaterial();
  const darkBrassMat = finishPal ? finishPal.darkShadow : getDarkAntiquedBrassMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const flutedGlassMat = getPrismaticFlutedGlassMaterial();
  const sleeveMat = getPaintedJoineryMaterial(0xf5f0e3, 0.55, `${namePrefix}.sleeve`);
  const flexCordMat = getPaintedJoineryMaterial(0x7c6b56, 0.85, `${namePrefix}.twistedLinenFlex`);
  const filamentMat = makeDedicatedFilamentMaterial(`${namePrefix}.filament`);
  const circuitGroup = resolveCircuitGroup(ctx, opts.circuitId);

  const root = new THREE.Group();
  root.name = namePrefix;

  let lightLocalPos: [number, number, number] = [0, -0.5, 0];

  if (kind === 'chandelier6Arm') {
    // Jim Lawrence *Queensbury* Ø650 x 480 mm 6-scroll-arm brass chandelier w/ pleated ivory silk empire shades
    const dropM = opts.dropM ?? 0.36;
    const bodyH = 0.48;
    const armRadius = 0.255; // + Ø140 mm empire shades -> Ø650 mm overall!
    const silkShadeMat = makeDedicatedWarmShadeMaterial(`${namePrefix}.ivorySilk`, 0xf3ecdc, 'cashmere');
    if (circuitGroup) {
      circuitGroup.emissives.push(filamentMat, silkShadeMat);
    }

    // Ceiling rose (`y = -0.028 .. 0`) + suspension chain (`y = -dropM .. -0.028`)
    addNamedCyl(root, `${namePrefix}.ceilingRose`, 0.052, 0.058, 0.028, 20, 0, -0.014, 0, brassMat);
    addNamedCyl(root, `${namePrefix}.suspensionChainRod`, 0.006, 0.006, dropM - 0.028, 10, 0, -0.028 - (dropM - 0.028) * 0.5, 0, darkBrassMat, true);

    // Turned brass baluster column (`y = -dropM - bodyH .. -dropM`)
    const topLoopY = -dropM;
    const hubY = topLoopY - bodyH * 0.68;
    addNamedCyl(root, `${namePrefix}.balusterUpperShaft`, 0.016, 0.028, bodyH * 0.52, 18, 0, topLoopY - bodyH * 0.26, 0, brassMat);
    const urnSphere = new THREE.Mesh(sharedSphereGeometry(0.044, 18, 14), brassMat);
    urnSphere.name = `${namePrefix}.balusterCentralUrn`;
    urnSphere.scale.set(1, 0.85, 1);
    urnSphere.position.set(0, hubY + 0.032, 0);
    root.add(urnSphere);
    addNamedCyl(root, `${namePrefix}.lowerDropFinial`, 0.026, 0.006, bodyH * 0.22, 16, 0, hubY - bodyH * 0.12, 0, brassMat);

    // 6 graceful S-scroll brass arms + candle sconces + pleated ivory silk empire shades (`Ø140 mm` base, `Ø90 mm` top, `H 115 mm`)
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const armGroup = new THREE.Group();
      armGroup.name = `${namePrefix}.scrollArm_${i + 1}`;
      armGroup.position.set(0, hubY, 0);
      armGroup.rotation.y = ang;
      root.add(armGroup);

      // Swept TubeGeometry S-scroll arm in local +X
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.032, 0.01, 0),
        new THREE.Vector3(armRadius * 0.38, -0.055, 0),
        new THREE.Vector3(armRadius * 0.78, -0.035, 0),
        new THREE.Vector3(armRadius, 0.045, 0),
      ]);
      const tubeGeo = new THREE.TubeGeometry(curve, 18, 0.0065, 10, false);
      const armMesh = new THREE.Mesh(tubeGeo, brassMat);
      armMesh.name = `${armGroup.name}.brassScroll`;
      armMesh.castShadow = true;
      armGroup.add(armMesh);

      addGlowingCandleBulb(
        armGroup,
        `${armGroup.name}.candle`,
        armRadius,
        0.045,
        0,
        brassMat,
        sleeveMat,
        filamentMat,
        glassMat,
        0.052
      );

      // Open-ended pleated ivory silk empire clip-on shade (`Ø90 -> Ø140 mm`, `H 115 mm`)
      const shadeGeo = new THREE.CylinderGeometry(0.045, 0.07, 0.115, 22, 1, true);
      const shade = new THREE.Mesh(shadeGeo, silkShadeMat);
      shade.name = `${armGroup.name}.pleatedSilkEmpireShade`;
      shade.position.set(armRadius, 0.135, 0);
      shade.castShadow = true;
      armGroup.add(shade);
    }
    lightLocalPos = [0, hubY + 0.04, 0];
  } else if (kind === 'hallLantern') {
    // Ø320 x 480 mm Georgian glazed Aged Brass hanging hall/landing lantern w/ 3-candle cluster
    const dropM = opts.dropM ?? 0.34;
    const rad = 0.16; // Ø320 mm
    const bodyH = 0.48;
    const cageH = 0.34;
    if (circuitGroup) {
      circuitGroup.emissives.push(filamentMat);
    }

    addNamedCyl(root, `${namePrefix}.ceilingRose`, 0.052, 0.056, 0.026, 20, 0, -0.013, 0, brassMat);
    addNamedCyl(root, `${namePrefix}.suspensionChain`, 0.006, 0.006, dropM - 0.026, 10, 0, -0.026 - (dropM - 0.026) * 0.5, 0, darkBrassMat, true);

    const crownTopY = -dropM;
    const cageTopY = crownTopY - 0.095;
    const cageBotY = cageTopY - cageH;

    // 4 curved crown suspension ribs meeting at top suspension ring
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const ribCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, crownTopY, 0),
        new THREE.Vector3(Math.cos(ang) * rad * 0.65, crownTopY - 0.03, Math.sin(ang) * rad * 0.65),
        new THREE.Vector3(Math.cos(ang) * rad, cageTopY, Math.sin(ang) * rad),
      ]);
      const rib = new THREE.Mesh(new THREE.TubeGeometry(ribCurve, 12, 0.0055, 8, false), brassMat);
      rib.name = `${namePrefix}.crownArchRib_${i + 1}`;
      root.add(rib);

      // Vertical brass glazing upright along cylinder perimeter
      addNamedCyl(
        root,
        `${namePrefix}.uprightBar_${i + 1}`,
        0.006,
        0.006,
        cageH,
        10,
        Math.cos(ang) * rad,
        (cageTopY + cageBotY) * 0.5,
        Math.sin(ang) * rad,
        brassMat,
        true
      );
    }

    // Upper & lower open Aged Brass gallery rings + clear curved glass cylinder (`openEnded: true`)
    const topBand = new THREE.Mesh(new THREE.CylinderGeometry(rad + 0.004, rad + 0.004, 0.022, 28, 1, true), brassMat);
    topBand.name = `${namePrefix}.topGalleryBand`;
    topBand.position.set(0, cageTopY - 0.011, 0);
    root.add(topBand);

    const botBand = new THREE.Mesh(new THREE.CylinderGeometry(rad + 0.004, rad + 0.004, 0.022, 28, 1, true), brassMat);
    botBand.name = `${namePrefix}.bottomGalleryBand`;
    botBand.position.set(0, cageBotY + 0.011, 0);
    root.add(botBand);

    const glassCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(rad - 0.003, rad - 0.003, cageH - 0.028, 28, 1, true),
      glassMat
    );
    glassCyl.name = `${namePrefix}.curvedGlassDrum`;
    glassCyl.position.set(0, (cageTopY + cageBotY) * 0.5, 0);
    root.add(glassCyl);

    // Central stem descending to 3-candle cluster & lower finial (`reaching -dropM - bodyH`)
    const clusterY = cageBotY + 0.085;
    addNamedCyl(root, `${namePrefix}.innerStem`, 0.006, 0.006, crownTopY - clusterY, 10, 0, (crownTopY + clusterY) * 0.5, 0, brassMat, true);
    addNamedCyl(root, `${namePrefix}.clusterHub`, 0.018, 0.014, 0.026, 14, 0, clusterY, 0, brassMat, true);
    for (let c = 0; c < 3; c++) {
      const ca = (c / 3) * Math.PI * 2;
      const cr = 0.056;
      const bx = Math.cos(ca) * cr;
      const bz = Math.sin(ca) * cr;
      const arm = addNamedCyl(root, `${namePrefix}.clusterArm_${c + 1}`, 0.0045, 0.0045, cr, 8, bx * 0.5, clusterY, bz * 0.5, brassMat, true);
      arm.rotation.z = Math.PI * 0.5;
      arm.rotation.y = -ca;
      addGlowingCandleBulb(root, `${namePrefix}.candle_${c + 1}`, bx, clusterY + 0.004, bz, brassMat, sleeveMat, filamentMat, glassMat, 0.054);
    }
    addNamedCyl(root, `${namePrefix}.bottomFinial`, 0.014, 0.004, 0.042, 12, 0, -dropM - bodyH + 0.021, 0, brassMat, true);
    lightLocalPos = [0, clusterY + 0.06, 0];
  } else if (kind === 'coxFlutedPendant') {
    // Ø320 x 240 mm Cox & Cox prismatic ribbed-glass & Aged Brass dome pendant on twisted linen flex
    const dropM = opts.dropM ?? 0.58;
    const domeR = 0.16; // Ø320 mm
    if (circuitGroup) {
      circuitGroup.emissives.push(filamentMat);
    }

    addNamedCyl(root, `${namePrefix}.brassCeilingRose`, 0.052, 0.056, 0.024, 20, 0, -0.012, 0, brassMat);
    addNamedCyl(root, `${namePrefix}.cordGrip`, 0.01, 0.012, 0.018, 12, 0, -0.033, 0, brassMat, true);
    addNamedCyl(
      root,
      `${namePrefix}.twistedLinenFlex`,
      0.0038,
      0.0038,
      dropM - 0.042,
      8,
      0,
      -0.042 - (dropM - 0.042) * 0.5,
      0,
      flexCordMat,
      true
    );

    const galleryTopY = -dropM;
    addNamedCyl(root, `${namePrefix}.agedBrassGalleryHolder`, 0.028, 0.046, 0.068, 20, 0, galleryTopY - 0.034, 0, brassMat);

    // Prismatic ribbed-glass dome (`Ø320 mm`, `H 172 mm`, open bottom -> total pendant body H = 240 mm)
    const domeGeo = new THREE.SphereGeometry(domeR, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.54);
    const domeMesh = new THREE.Mesh(domeGeo, flutedGlassMat);
    domeMesh.name = `${namePrefix}.prismaticFlutedGlassDome`;
    domeMesh.position.set(0, galleryTopY - 0.068 - domeR + 0.012, 0);
    root.add(domeMesh);

    // Aged Brass rim ring around dome bottom + glowing vintage E27 squirrel-cage bulb inside
    const rimY = galleryTopY - 0.236;
    const brassRim = new THREE.Mesh(sharedTorusGeometry(domeR * 0.99, 0.005, 10, 36), brassMat);
    brassRim.name = `${namePrefix}.domeBrassRim`;
    brassRim.rotation.x = Math.PI * 0.5;
    brassRim.position.set(0, rimY, 0);
    root.add(brassRim);

    const e27Bulb = new THREE.Mesh(sharedSphereGeometry(0.028, 14, 12), filamentMat);
    e27Bulb.name = `${namePrefix}.vintageFilamentBulb`;
    e27Bulb.scale.set(0.9, 1.35, 0.9);
    e27Bulb.position.set(0, galleryTopY - 0.135, 0);
    root.add(e27Bulb);
    lightLocalPos = [0, galleryTopY - 0.17, 0];
  } else if (kind === 'spunBrassSaucerPendant') {
    // Ø380 mm spun Aged-Brass shallow conical saucer / coolie pendant on oval link chain w/ exposed warm E27 filament bulb
    const dropM = opts.dropM ?? 0.68;
    const saucerR = 0.19; // Ø380 mm
    if (circuitGroup) {
      circuitGroup.emissives.push(filamentMat);
    }

    // Turned stepped brass ceiling rose cup (y = -0.042 .. 0)
    const rosePts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.062, 0.0),
      new THREE.Vector2(0.058, -0.012),
      new THREE.Vector2(0.044, -0.028),
      new THREE.Vector2(0.018, -0.042),
      new THREE.Vector2(0.0, -0.042),
    ];
    const roseMesh = new THREE.Mesh(new THREE.LatheGeometry(rosePts, 24), brassMat);
    roseMesh.name = `${namePrefix}.spunBrassCeilingCup`;
    roseMesh.castShadow = true;
    root.add(roseMesh);

    // Interlocking oval aged-brass chain links (y = -0.048 .. -dropM) + braided flex threaded through
    const chainSpan = Math.max(0.14, dropM - 0.048);
    const linkPitch = 0.034;
    const linkCount = Math.max(4, Math.round(chainSpan / linkPitch));
    const actualPitch = chainSpan / linkCount;
    for (let li = 0; li < linkCount; li++) {
      const ly = -0.048 - (li + 0.5) * actualPitch;
      const link = new THREE.Mesh(sharedTorusGeometry(0.013, 0.0028, 8, 16), brassMat);
      link.name = `${namePrefix}.chainLink_${li + 1}`;
      link.scale.set(0.68, 1.32, 0.85);
      link.rotation.y = li % 2 === 0 ? 0 : Math.PI * 0.5;
      link.position.set(0, ly, 0);
      link.castShadow = true;
      tagHighLod(link);
      root.add(link);
    }
    addNamedCyl(
      root,
      `${namePrefix}.threadedFlex`,
      0.0024,
      0.0024,
      chainSpan,
      8,
      0,
      -0.048 - chainSpan * 0.5,
      0,
      flexCordMat,
      true
    );

    // Turned brass lamp-holder gallery & suspension eye (y = -dropM .. -dropM - 0.072)
    const galleryTopY = -dropM;
    addNamedCyl(root, `${namePrefix}.holderRing`, 0.012, 0.016, 0.022, 16, 0, galleryTopY - 0.011, 0, brassMat, true);
    addNamedCyl(root, `${namePrefix}.galleryCollar`, 0.024, 0.034, 0.046, 20, 0, galleryTopY - 0.045, 0, brassMat);

    // Shallow spun Aged-Brass conical coolie / saucer shade (Ø380 mm, rise 58 mm, double-sided warm brass interior)
    const saucerMat = brassMat.clone();
    saucerMat.name = `${namePrefix}.spunBrassSaucer`;
    saucerMat.side = THREE.DoubleSide;
    const shadeTopY = galleryTopY - 0.066;
    const shadeBotY = shadeTopY - 0.058;
    const saucerPts = [
      new THREE.Vector2(0.028, shadeTopY),
      new THREE.Vector2(0.058, shadeTopY - 0.009),
      new THREE.Vector2(saucerR - 0.006, shadeBotY + 0.003),
      new THREE.Vector2(saucerR, shadeBotY),
    ];
    const saucerMesh = new THREE.Mesh(new THREE.LatheGeometry(saucerPts, 36), saucerMat);
    saucerMesh.name = `${namePrefix}.spunBrassSaucerShade`;
    saucerMesh.castShadow = true;
    saucerMesh.receiveShadow = true;
    root.add(saucerMesh);

    const rimBead = new THREE.Mesh(sharedTorusGeometry(saucerR, 0.0026, 8, 36), brassMat);
    rimBead.name = `${namePrefix}.rolledRimBead`;
    rimBead.rotation.x = Math.PI * 0.5;
    rimBead.position.set(0, shadeBotY, 0);
    root.add(rimBead);

    // Clear glass teardrop E27 envelope + glowing warm squirrel-cage filament core projecting slightly below saucer rim
    const bulbCy = shadeBotY - 0.014;
    const glassBulb = new THREE.Mesh(sharedSphereGeometry(0.032, 16, 14), glassMat);
    glassBulb.name = `${namePrefix}.clearGlassE27Envelope`;
    glassBulb.scale.set(0.92, 1.38, 0.92);
    glassBulb.position.set(0, bulbCy, 0);
    root.add(glassBulb);

    const filamentCore = new THREE.Mesh(sharedSphereGeometry(0.015, 12, 10), filamentMat);
    filamentCore.name = `${namePrefix}.squirrelCageFilament`;
    filamentCore.scale.set(0.75, 1.55, 0.75);
    filamentCore.position.set(0, bulbCy - 0.004, 0);
    root.add(filamentCore);

    lightLocalPos = [0, bulbCy - 0.03, 0];
  } else if (kind === 'coxFlutedSconce') {
    // 140 x 195 x 280 mm fluted-glass & Aged Brass bathroom/hall wall light (`z = 0 .. 0.195`)
    if (circuitGroup) {
      circuitGroup.emissives.push(filamentMat);
    }

    const backplate = addNamedCyl(root, `${namePrefix}.wallRose`, 0.055, 0.058, 0.022, 22, 0, 0, 0.011, brassMat);
    backplate.rotation.x = Math.PI * 0.5;

    // Swan-neck brass arm projecting to `cz = 0.125` (`+ Ø140 mm` shade -> `D = 0.195 m`)
    const cz = 0.125;
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0.022),
      new THREE.Vector3(0, -0.032, 0.075),
      new THREE.Vector3(0, 0.015, cz),
    ]);
    const armMesh = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 14, 0.007, 10, false), brassMat);
    armMesh.name = `${namePrefix}.brassArm`;
    root.add(armMesh);

    addNamedCyl(root, `${namePrefix}.lampHolderCup`, 0.026, 0.022, 0.036, 18, 0, 0.034, cz, brassMat, true);
    addNamedCyl(root, `${namePrefix}.lowerAcornFinial`, 0.012, 0.004, 0.038, 12, 0, -0.02, cz, brassMat, true);

    // Fluted glass cylindrical-tulip shade (`Ø140 mm`, `H 195 mm` -> total sconce H = 280 mm)
    const shadeGeo = new THREE.CylinderGeometry(0.07, 0.056, 0.195, 28, 1, true);
    const shade = new THREE.Mesh(shadeGeo, flutedGlassMat);
    shade.name = `${namePrefix}.flutedGlassShade`;
    shade.position.set(0, 0.15, cz);
    root.add(shade);

    addGlowingCandleBulb(root, `${namePrefix}.bulb`, 0, 0.052, cz, brassMat, sleeveMat, filamentMat, glassMat, 0.052);
    lightLocalPos = [0, 0.14, cz];
  } else if (kind === 'whiteCoCeramicLamp') {
    // The White Company *Portobello* (`Ø380 x 540 mm`) textured stoneware base + warm natural linen drum shade
    const shadeMat = makeDedicatedWarmShadeMaterial(`${namePrefix}.linenDrumShade`, 0xeee8da, 'linen');
    if (circuitGroup) {
      circuitGroup.emissives.push(filamentMat, shadeMat);
    }

    const stMaps = getPortobelloStonewareMaps();
    const stonewareMat = new THREE.MeshStandardMaterial({
      name: `${namePrefix}.portobelloStoneware`,
      map: stMaps.colorMap,
      normalMap: stMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: stMaps.roughnessMap,
      roughness: 0.72,
    });

    // LatheGeometry organic thrown ceramic urn base (`y = 0 .. 0.305`, max `Ø230 mm`)
    const lathePts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.082, 0.0),
      new THREE.Vector2(0.086, 0.018),
      new THREE.Vector2(0.114, 0.115),
      new THREE.Vector2(0.112, 0.205),
      new THREE.Vector2(0.068, 0.275),
      new THREE.Vector2(0.036, 0.305),
      new THREE.Vector2(0.0, 0.305),
    ];
    const baseMesh = new THREE.Mesh(new THREE.LatheGeometry(lathePts, 28), stonewareMat);
    baseMesh.name = `${namePrefix}.portobelloStonewareBase`;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    root.add(baseMesh);

    // Brass neck stem & bulb (`y = 0.305 .. 0.43`)
    addNamedCyl(root, `${namePrefix}.brassNeck`, 0.016, 0.024, 0.065, 16, 0, 0.337, 0, brassMat, true);
    const bulb = new THREE.Mesh(sharedSphereGeometry(0.028, 12, 10), filamentMat);
    bulb.name = `${namePrefix}.lampBulb`;
    bulb.position.set(0, 0.4, 0);
    root.add(bulb);

    // Natural linen drum shade (`Ø380 mm`, `H 235 mm` -> `y = 0.305 .. 0.54`)
    const shadeGeo = new THREE.CylinderGeometry(0.18, 0.19, 0.235, 32, 1, true);
    const shadeMesh = new THREE.Mesh(shadeGeo, shadeMat);
    shadeMesh.name = `${namePrefix}.linenDrumShade`;
    shadeMesh.position.set(0, 0.4225, 0);
    shadeMesh.castShadow = true;
    root.add(shadeMesh);
    lightLocalPos = [0, 0.41, 0];
  } else {
    // 'whiteCoAlabasterLamp': (`Ø350 x 510 mm`) turned veined alabaster column + empire linen shade
    const shadeMat = makeDedicatedWarmShadeMaterial(`${namePrefix}.empireShade`, 0xf3ede0, 'linen');
    if (circuitGroup) {
      circuitGroup.emissives.push(filamentMat, shadeMat);
    }

    const alMaps = getVeinedAlabasterMaps();
    const alabasterMat = new THREE.MeshPhysicalMaterial({
      name: `${namePrefix}.veinedAlabaster`,
      map: alMaps.colorMap,
      normalMap: alMaps.normalMap,
      roughnessMap: alMaps.roughnessMap,
      roughness: 0.26,
      clearcoat: 0.45,
      clearcoatRoughness: 0.2,
    });

    // Aged Brass stepped square/circular plinth (`y = 0 .. 0.028`) + turned alabaster column (`y = 0.028 .. 0.31`)
    addNamedCyl(root, `${namePrefix}.brassPlinth`, 0.072, 0.078, 0.028, 24, 0, 0.014, 0, brassMat);
    addNamedCyl(root, `${namePrefix}.alabasterColumn`, 0.048, 0.056, 0.275, 24, 0, 0.028 + 0.1375, 0, alabasterMat);
    addNamedCyl(root, `${namePrefix}.brassCapital`, 0.024, 0.05, 0.032, 20, 0, 0.303 + 0.016, 0, brassMat, true);

    const bulb = new THREE.Mesh(sharedSphereGeometry(0.026, 12, 10), filamentMat);
    bulb.name = `${namePrefix}.lampBulb`;
    bulb.position.set(0, 0.385, 0);
    root.add(bulb);

    // Tapered empire linen shade (`Ø350 mm` bottom, `Ø210 mm` top, `H 215 mm` -> total H `510 mm`)
    const shadeGeo = new THREE.CylinderGeometry(0.105, 0.175, 0.215, 32, 1, true);
    const shadeMesh = new THREE.Mesh(shadeGeo, shadeMat);
    shadeMesh.name = `${namePrefix}.empireLinenShade`;
    shadeMesh.position.set(0, 0.4025, 0);
    shadeMesh.castShadow = true;
    root.add(shadeMesh);
    lightLocalPos = [0, 0.39, 0];
  }

  if (opts.createPointLight) {
    const pt = new THREE.PointLight(0xffc378, opts.pointLightIntensity ?? 2.2, 6.0, 2.0);
    pt.name = `${namePrefix}.pointLight`;
    pt.position.set(lightLocalPos[0], lightLocalPos[1], lightLocalPos[2]);
    root.add(pt);
    if (circuitGroup) {
      circuitGroup.lights.push(pt);
    }
  }

  if (!ctx) {
    attachAssetInteraction(root, {
      kind: 'custom',
      label: 'Toggle Luminaire',
      activeLabel: 'Switch Off Luminaire',
      initialActive: true,
      audio: { openPreset: 'switchClick', closePreset: 'switchClick' },
      onToggle: (active) => {
        root.traverse((c) => {
          if (c instanceof THREE.Mesh && c.material instanceof THREE.MeshStandardMaterial && c.material.emissiveIntensity > 0) {
            c.material.userData.__baseEmissive ??= c.material.emissiveIntensity;
            c.material.emissiveIntensity = active ? c.material.userData.__baseEmissive : 0.05;
          }
          if (c instanceof THREE.PointLight || c instanceof THREE.SpotLight) {
            c.userData.__baseIntensity ??= c.intensity;
            c.intensity = active ? c.userData.__baseIntensity : 0;
          }
        });
      },
    });
  }
  const fCode = resolveBrasswareCode(opts.finish, 'AB');
  const lightTitleMap: Record<HeritageInteriorLightingKind, [string, string, [number, number, number]]> = {
    chandelier6Arm: ['Jim Lawrence 6-Arm Flemish Aged Brass Chandelier', 'JL-FLEM-6A', [680, 680, 620]],
    hallLantern: ['Vaughan Georgian Hexagonal Glazed Brass Hall Lantern', 'VAU-HL-360', [360, 360, 640]],
    coxFlutedPendant: ['Cox & Cox Fluted Prismatic Glass & Brass Island Pendant', 'CC-FLT-PND', [280, 280, 390]],
    spunBrassSaucerPendant: ['deVOL / Jim Lawrence Spun Aged-Brass Coolie Chain Pendant', 'JL-SAU-380', [380, 380, 740]],
    coxFlutedSconce: ['Cox & Cox Fluted Glass & Aged Brass Wall Sconce', 'CC-FLT-SCN', [180, 210, 320]],
    whiteCoCeramicLamp: ['The White Company Artisan Glazed Ceramic Table Lamp', 'TWC-CER-LMP', [380, 380, 610]],
    whiteCoAlabasterLamp: ['The White Company Turned Alabaster & Linen Table Lamp', 'TWC-ALA-LMP', [360, 360, 580]],
  };
  const [lName, skuBase, dims] = lightTitleMap[kind];
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: lName,
    brand: skuBase.startsWith('JL') ? 'Jim Lawrence' : skuBase.startsWith('VAU') ? 'Vaughan Designs' : 'Pooky Lighting',
    collection: 'Heritage Brass & Glass',
    sku: `${skuBase}-${fCode}`,
    finish: formatBrasswareFinishLabel(opts.finish, 'AB'),
    category: 'lighting',
    dimensionsMm: dims,
    productUrl: 'https://www.pooky.com/collections/ceiling-lights',
    schematicUrl: `https://www.pooky.com/downloads/spec/${skuBase}.pdf`,
  });
}
