import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { getHeritageLimePlasterNormalMap, MICRO_SURFACE_MAP_SIZE } from '../micro-surface-detail.ts';
import {
  PAINT_SHEENS,
  clearPaintMaterialCache,
  computePaintLrv,
  computePaintSpecularResponse,
  createPaintMaterial,
  createRoomPaintScheme,
  getCachedPaintMaterial,
  getPaintMaterialInfo,
  getPaintSheenDescriptor,
  getPaintSwatch,
  listPaintSwatches,
  paintSpecFromSwatch,
  registerPaintSwatch,
  resolvePaintColor,
  type PaintSheen,
} from '../paint-system.ts';

describe('husjs physical architectural paint system', () => {
  beforeEach(() => {
    clearPaintMaterialCache();
  });

  it('models all 9 architectural paint sheens with zero transmission and monotonic physical gloss ordering', () => {
    const allSheens: readonly PaintSheen[] = [
      'limewash',
      'dead-flat',
      'estate-emulsion',
      'modern-emulsion',
      'estate-eggshell',
      'exterior-eggshell',
      'satinwood',
      'modern-eggshell',
      'full-gloss',
    ];
    expect(Object.keys(PAINT_SHEENS)).toHaveLength(9);

    for (const sheen of allSheens) {
      const desc = getPaintSheenDescriptor(sheen);
      const mat = createPaintMaterial({ color: 'wimborne-white', sheen });
      expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(mat.transmission).toBe(0);
      expect(mat.metalness).toBe(0);
      expect(mat.roughness).toBeCloseTo(desc.roughness, 5);
      expect(mat.ior).toBeCloseTo(desc.ior, 5);
      expect(mat.clearcoat).toBeCloseTo(desc.clearcoat, 5);
      expect(mat.clearcoatRoughness).toBeCloseTo(desc.clearcoatRoughness, 5);
      expect(mat.sheen).toBeCloseTo(desc.sheen, 5);
      expect(mat.sheenRoughness).toBeCloseTo(desc.sheenRoughness, 5);

      if (desc.sheen > 0) {
        // Mineral/chalk finishes must tint sheenColor above 0x000000 so WebGPU/WebGL2 sheen renders
        expect(mat.sheenColor.r + mat.sheenColor.g + mat.sheenColor.b).toBeGreaterThan(0.5);
      }
    }

    // Strict monotonic physical gloss ladder:
    // dead-flat <= estate-emulsion < modern-emulsion < estate-eggshell < satinwood < modern-eggshell < full-gloss
    const orderedLadder: readonly PaintSheen[] = [
      'dead-flat',
      'estate-emulsion',
      'modern-emulsion',
      'estate-eggshell',
      'satinwood',
      'modern-eggshell',
      'full-gloss',
    ];

    const mats = orderedLadder.map((sheen) =>
      createPaintMaterial({ color: 'school-house-white', sheen })
    );
    const descs = orderedLadder.map((sheen) => getPaintSheenDescriptor(sheen));
    const responses = mats.map((mat) => computePaintSpecularResponse(mat));

    // dead-flat <= estate-emulsion in glossPercent, and strictly increasing specular response across the whole ladder
    expect(descs[0]!.glossPercent).toBeLessThanOrEqual(descs[1]!.glossPercent);
    for (let i = 1; i < descs.length - 1; i++) {
      expect(descs[i]!.glossPercent).toBeLessThan(descs[i + 1]!.glossPercent);
      expect(descs[i]!.clearcoat).toBeLessThan(descs[i + 1]!.clearcoat);
    }

    for (let i = 0; i < mats.length - 1; i++) {
      expect(mats[i]!.roughness).toBeGreaterThan(mats[i + 1]!.roughness);
      expect(mats[i]!.ior).toBeLessThanOrEqual(mats[i + 1]!.ior);
      expect(descs[i]!.reflectivity).toBeLessThan(descs[i + 1]!.reflectivity);
      expect(responses[i]!).toBeLessThan(responses[i + 1]!);
    }

    // Limewash is ultra-matt (~1.5% GU) below dead-flat (~2% GU)
    expect(getPaintSheenDescriptor('limewash').glossPercent).toBeLessThan(
      getPaintSheenDescriptor('dead-flat').glossPercent
    );
    expect(computePaintSpecularResponse('limewash')).toBeLessThan(
      computePaintSpecularResponse('dead-flat')
    );
  });

  it('resolves verified Farrow & Ball and Neptune swatches case/slug-insensitively plus raw ColorRepresentations', () => {
    const requiredFbHexes: Readonly<Record<string, `#${string}`>> = {
      'light-blue': '#B5BBB4',
      'farrows-cream': '#E9D8B4',
      cromarty: '#CACCC0',
      'setting-plaster': '#D9C0AE',
      'wimborne-white': '#F4F2E7',
      'school-house-white': '#E3DED0',
      'slipper-satin': '#E6E0D2',
      'shaded-white': '#D5CFC0',
      'shadow-white': '#DCD7C8',
      'skimming-stone': '#DBD5CA',
      'drop-cloth': '#C5BDAC',
      string: '#D8CBAE',
      'james-white': '#E9E7D8',
      pointing: '#F3EFE3',
      dimity: '#EAE1D3',
      'all-white': '#F6F6F2',
      'white-tie': '#EFE9D8',
      'new-white': '#EFE6CF',
      'joas-white': '#DBCFBB',
      jitney: '#C1B2A2',
      'templeton-pink': '#CDB19D',
      'pink-ground': '#EAD4C6',
      'sulking-room-pink': '#AA8D87',
      'hague-blue': '#3F4D57',
      'green-smoke': '#6F7B71',
      pigeon: '#9A9F94',
      'card-room-green': '#878F81',
      'french-gray': '#B0AF9B',
      'off-black': '#454749',
      railings: '#45494C',
      'down-pipe': '#606565',
    };

    for (const [slug, expectedHex] of Object.entries(requiredFbHexes)) {
      const resolved = resolvePaintColor(slug);
      expect(resolved.hex).toBe(expectedHex);
      expect(resolved.brand).toBe('Farrow & Ball');
      expect(resolved.code).toMatch(/^No\.\s*\d+$/);
      expect(resolved.recommendedWhites.length).toBeGreaterThan(0);
      expect(resolved.productUrl).toBe(`https://www.farrow-ball.com/paint/${slug}`);
      expect(resolved.lrv).toBeGreaterThan(0);
      expect(resolved.lrv).toBeLessThan(100);
    }

    // Namespaced, display-name, and code lookups resolve identically
    expect(resolvePaintColor('farrow-ball:light-blue').hex).toBe('#B5BBB4');
    expect(resolvePaintColor("Farrow's Cream").hex).toBe('#E9D8B4');
    expect(getPaintSwatch('No. 22')?.slug).toBe('light-blue');

    // Neptune swatches
    for (const neptuneSlug of ['shingle', 'ink', 'salt', 'old-chalk']) {
      const sw = resolvePaintColor(`neptune:${neptuneSlug}`);
      expect(sw.brand).toBe('Neptune');
      expect(sw.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(sw.recommendedWhites.length).toBeGreaterThan(0);
      expect(resolvePaintColor(neptuneSlug).hex).toBe(sw.hex);
    }

    expect(listPaintSwatches('Farrow & Ball').length).toBeGreaterThanOrEqual(31);
    expect(listPaintSwatches('Neptune').length).toBeGreaterThanOrEqual(4);

    // Raw THREE.ColorRepresentation & inline custom spec support
    expect(resolvePaintColor('#e6e1d3').hex).toBe('#E6E1D3');
    expect(resolvePaintColor(0xe6e1d3).hex).toBe('#E6E1D3');
    expect(resolvePaintColor(new THREE.Color(0xe6e1d3)).hex).toBe('#E6E1D3');

    const custom = resolvePaintColor({
      color: '#D9C8B4',
      name: 'Warm Lime Plaster',
      brand: 'Atelier',
      code: 'AT-04',
      complementaryWhite: 'wimborne-white',
    });
    expect(custom.hex).toBe('#D9C8B4');
    expect(custom.name).toBe('Warm Lime Plaster');
    expect(custom.brand).toBe('Atelier');
    expect(custom.code).toBe('AT-04');
    expect(custom.recommendedWhites).toEqual(['wimborne-white']);

    // Custom runtime swatch registration
    const reg = registerPaintSwatch({
      brand: 'Edward Bulmer',
      name: 'Jonquil',
      code: 'EB-JONQUIL',
      hex: '#DFC7B2',
      recommendedWhites: ['wimborne-white'],
      productUrl: 'https://www.edwardbulmerpaint.co.uk/product/natural-paint/jonquil/',
    });
    expect(reg.id).toBe('edward-bulmer:jonquil');
    expect(resolvePaintColor('jonquil').hex).toBe('#DFC7B2');
    expect(computePaintLrv('#FFFFFF')).toBe(100);
    expect(computePaintLrv('#000000')).toBe(0);
  });

  it('deterministically caches MeshPhysicalMaterial instances for SceneBatchOptimizer coalescing and exposes WeakMap metadata', () => {
    const walls = Array.from({ length: 8 }, () =>
      createPaintMaterial({ color: 'cromarty', sheen: 'modern-emulsion' })
    );
    for (let i = 1; i < walls.length; i++) {
      expect(walls[i]).toBe(walls[0]);
    }

    // Equivalent hex / numeric representations hit the exact same cached material instance
    const byNamespaced = createPaintMaterial({
      color: 'farrow-ball:cromarty',
      sheen: 'modern-emulsion',
    });
    const byHex = createPaintMaterial({ color: '#caccc0', sheen: 'modern-emulsion' });
    const byHelper = getCachedPaintMaterial('Cromarty', 'modern-emulsion');
    expect(byNamespaced).toBe(walls[0]);
    expect(byHex).toBe(walls[0]);
    expect(byHelper).toBe(walls[0]);

    // Varying sheen, side, or microTexture produces distinct cached instances
    const eggshell = createPaintMaterial({ color: 'cromarty', sheen: 'estate-eggshell' });
    const doubleSide = createPaintMaterial({
      color: 'cromarty',
      sheen: 'modern-emulsion',
      side: THREE.DoubleSide,
    });
    const withMicro = createPaintMaterial({
      color: 'cromarty',
      sheen: 'modern-emulsion',
      microTexture: true,
    });
    expect(eggshell).not.toBe(walls[0]);
    expect(doubleSide).not.toBe(walls[0]);
    expect(withMicro).not.toBe(walls[0]);
    expect(walls[0]!.roughnessMap).toBeNull();
    expect(withMicro.roughnessMap).toBeInstanceOf(THREE.DataTexture);

    // Estate emulsion & limewash enable headless-safe Uint8Array micro-textures by default
    const estateWall = createPaintMaterial({ color: 'setting-plaster', sheen: 'estate-emulsion' });
    const limewashWall = createPaintMaterial({ color: 'lime-white', sheen: 'limewash' });
    expect(estateWall.roughnessMap).toBeInstanceOf(THREE.DataTexture);
    expect(estateWall.roughnessMap?.image.data).toBeInstanceOf(Uint8Array);
    expect(limewashWall.roughnessMap).toBeInstanceOf(THREE.DataTexture);
    expect(limewashWall.map).toBeInstanceOf(THREE.DataTexture);

    // WeakMap metadata inspection without polluting material properties
    const info = getPaintMaterialInfo(walls[0]);
    expect(info).toBeDefined();
    expect(info?.brand).toBe('Farrow & Ball');
    expect(info?.swatchName).toBe('Cromarty');
    expect(info?.code).toBe('No. 285');
    expect(info?.hex).toBe('#CACCC0');
    expect(info?.sheen).toBe('modern-emulsion');
    expect(info?.glossPercent).toBe(7);
    expect(info?.productUrl).toBe('https://www.farrow-ball.com/paint/cromarty');

    // clearPaintMaterialCache invalidates cached references cleanly
    clearPaintMaterialCache();
    const afterClear = createPaintMaterial({ color: 'cromarty', sheen: 'modern-emulsion' });
    expect(afterClear).not.toBe(walls[0]);
  });

  it('builds harmonised room paint schemes with automatic F&B complementary white trim and wet/high-traffic sheen defaults', () => {
    // Drawing room in Light Blue (No. 22) -> primary recommendedWhite is School House White (No. 291)
    const drawingRoom = createRoomPaintScheme({
      wallColor: 'light-blue',
    });
    expect(drawingRoom.info.walls.swatchName).toBe('Light Blue');
    expect(drawingRoom.info.walls.sheen).toBe('estate-emulsion');
    expect(drawingRoom.info.trim.swatchName).toBe('School House White');
    expect(drawingRoom.info.trim.hex).toBe('#E3DED0');
    expect(drawingRoom.info.trim.sheen).toBe('estate-eggshell');
    expect(drawingRoom.info.ceiling.swatchName).toBe('School House White');
    expect(drawingRoom.info.ceiling.sheen).toBe('dead-flat');
    expect(drawingRoom.info.doors.sheen).toBe('estate-eggshell');
    expect(drawingRoom.doors).toBe(drawingRoom.trim);
    expect(drawingRoom.radiator).toBe(drawingRoom.trim);

    // Farrow's Cream (No. 67) -> primary recommendedWhite is White Tie (No. 2002)
    const bedroom = createRoomPaintScheme({
      wallColor: 'farrows-cream',
      roomKind: 'bedroom',
    });
    expect(bedroom.info.trim.swatchName).toBe('White Tie');
    expect(bedroom.info.trim.hex).toBe('#EFE9D8');
    expect(bedroom.info.walls.sheen).toBe('estate-emulsion');

    // Bathroom, kitchen & hallway automatically default wallSheen to washable 'modern-emulsion'
    const bathroom = createRoomPaintScheme({
      wallColor: 'cromarty',
      roomKind: 'bathroom',
    });
    const kitchen = createRoomPaintScheme({
      wallColor: 'setting-plaster',
      roomKind: 'kitchen',
    });
    const hallway = createRoomPaintScheme({
      wallColor: 'drop-cloth',
      roomKind: 'hallway',
    });
    expect(bathroom.info.walls.sheen).toBe('modern-emulsion');
    expect(bathroom.info.trim.swatchName).toBe('School House White');
    expect(kitchen.info.walls.sheen).toBe('modern-emulsion');
    expect(kitchen.info.trim.swatchName).toBe('School House White');
    expect(hallway.info.walls.sheen).toBe('modern-emulsion');

    // Dark trim override (e.g. Off-Black / Blackened) keeps ceiling bright unless ceilingColor is explicit
    const dramaticStudy = createRoomPaintScheme({
      wallColor: 'hague-blue',
      trimColor: 'railings',
      doorSheen: 'full-gloss',
    });
    expect(dramaticStudy.info.trim.swatchName).toBe('Railings');
    expect(dramaticStudy.info.ceiling.swatchName).toBe('Wimborne White');
    expect(dramaticStudy.info.doors.sheen).toBe('full-gloss');
  });

  it('is 100% headless-Node safe, re-exported from husjs/materials, and check-boundaries clean', async () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');

    const publicMaterialsSpec = ['husjs', 'materials'].join('/');
    const pub = (await import(publicMaterialsSpec)) as Record<string, unknown>;
    expect(pub.PAINT_SHEENS).toBe(PAINT_SHEENS);
    expect(pub.createPaintMaterial).toBe(createPaintMaterial);
    expect(pub.createRoomPaintScheme).toBe(createRoomPaintScheme);
    expect(pub.getCachedPaintMaterial).toBe(getCachedPaintMaterial);
    expect(pub.clearPaintMaterialCache).toBe(clearPaintMaterialCache);
    expect(pub.getPaintMaterialInfo).toBe(getPaintMaterialInfo);
    expect(pub.resolvePaintColor).toBe(resolvePaintColor);
    expect(pub.registerPaintSwatch).toBe(registerPaintSwatch);
    expect(pub.getPaintSwatch).toBe(getPaintSwatch);
    expect(pub.listPaintSwatches).toBe(listPaintSwatches);
    expect(pub.paintSpecFromSwatch).toBe(paintSpecFromSwatch);

    const fromId = paintSpecFromSwatch('farrows-cream', 'estate-emulsion', 'Primary walls');
    expect(fromId).toEqual({
      brand: 'Farrow & Ball',
      name: "Farrow's Cream",
      code: 'No. 67',
      hex: '#E9D8B4',
      sheen: 'estate-emulsion',
      notes: 'Primary walls',
    });

    const mat = createPaintMaterial({ color: 'cromarty', sheen: 'modern-emulsion' });
    const fromMat = paintSpecFromSwatch(mat);
    expect(fromMat).toEqual({
      brand: 'Farrow & Ball',
      name: 'Cromarty',
      code: 'No. 285',
      hex: '#CACCC0',
      sheen: 'modern-emulsion',
    });
  });

  it('shares a single cached 256x256 periodic heritage-lime plaster normal DataTexture across colours and separates material cache keys', () => {
    const flatCream = createPaintMaterial({
      color: 'farrows-cream',
      sheen: 'estate-emulsion',
    });
    const limeCreamA = createPaintMaterial({
      color: 'farrows-cream',
      sheen: 'estate-emulsion',
      plasterRelief: 'heritage-lime',
    });
    const limeCreamB = createPaintMaterial({
      color: '#E9D8B4',
      sheen: 'estate-emulsion',
      plasterRelief: 'heritage-lime',
      plasterReliefScale: 0.2,
    });
    const limeCreamStrong = createPaintMaterial({
      color: 'farrows-cream',
      sheen: 'estate-emulsion',
      plasterRelief: 'heritage-lime',
      plasterReliefScale: 0.32,
    });
    const limeSettingPlaster = createPaintMaterial({
      color: 'setting-plaster',
      sheen: 'estate-emulsion',
      plasterRelief: 'heritage-lime',
    });

    // Zero normalMap when plasterRelief is omitted or "none"
    expect(flatCream.normalMap).toBeNull();

    // Exact material instance hit for identical colour + sheen + plasterRelief + scale
    expect(limeCreamA).toBe(limeCreamB);
    expect(limeCreamA).not.toBe(flatCream);
    expect(limeCreamA).not.toBe(limeCreamStrong);

    // Single shared 256x256 DataTexture across distinct paint colours & relief scales (~0.33 MiB total)
    const sharedNormal = getHeritageLimePlasterNormalMap();
    expect(sharedNormal).toBeInstanceOf(THREE.DataTexture);
    expect(sharedNormal.image.width).toBe(MICRO_SURFACE_MAP_SIZE);
    expect(sharedNormal.image.height).toBe(MICRO_SURFACE_MAP_SIZE);
    expect(sharedNormal.wrapS).toBe(THREE.RepeatWrapping);
    expect(sharedNormal.wrapT).toBe(THREE.RepeatWrapping);
    expect(limeCreamA.normalMap).toBe(sharedNormal);
    expect(limeCreamStrong.normalMap).toBe(sharedNormal);
    expect(limeSettingPlaster.normalMap).toBe(sharedNormal);
    expect(limeCreamA.normalScale.x).toBeCloseTo(0.2, 5);
    expect(limeCreamStrong.normalScale.x).toBeCloseTo(0.32, 5);

    const info = getPaintMaterialInfo(limeCreamA);
    expect(info?.plasterRelief).toBe('heritage-lime');
    expect(info?.plasterReliefScale).toBeCloseTo(0.2, 5);
  });

  it('generates fast, deterministic, seamless 256x256 large-scale limewash micro-textures shared across colours', () => {
    // Warm up JIT once, then measure cold cache generation time
    createPaintMaterial({ color: 'lime-white', sheen: 'limewash' });
    clearPaintMaterialCache();

    const t0 = performance.now();
    const limeA = createPaintMaterial({ color: 'lime-white', sheen: 'limewash' });
    const genMs = performance.now() - t0;
    expect(genMs).toBeLessThan(15);

    const limeB = createPaintMaterial({ color: 'setting-plaster', sheen: 'limewash' });
    const limeC = createPaintMaterial({ color: 'farrows-cream', sheen: 'limewash' });
    const limeCustom = createPaintMaterial({ color: '#D9C8B4', sheen: 'limewash' });

    // Distinct materials per colour, single globally cached 256x256 texture pair
    expect(limeB === limeA).toBe(false);
    expect(limeC === limeA).toBe(false);
    expect(limeCustom === limeA).toBe(false);
    expect(limeA.map).toBeInstanceOf(THREE.DataTexture);
    expect(limeA.roughnessMap).toBeInstanceOf(THREE.DataTexture);
    expect(limeB.map === limeA.map).toBe(true);
    expect(limeC.map === limeA.map).toBe(true);
    expect(limeCustom.map === limeA.map).toBe(true);
    expect(limeB.roughnessMap === limeA.roughnessMap).toBe(true);
    expect(limeC.roughnessMap === limeA.roughnessMap).toBe(true);
    expect(limeCustom.roughnessMap === limeA.roughnessMap).toBe(true);

    const valueMap = limeA.map as THREE.DataTexture;
    const roughMap = limeA.roughnessMap as THREE.DataTexture;
    for (const tex of [valueMap, roughMap]) {
      expect(tex.image.width).toBe(256);
      expect(tex.image.height).toBe(256);
      expect(tex.wrapS).toBe(THREE.RepeatWrapping);
      expect(tex.wrapT).toBe(THREE.RepeatWrapping);
      expect(tex.repeat.x).toBeGreaterThan(0);
      expect(tex.repeat.x).toBeLessThanOrEqual(0.6);
      expect(tex.repeat.y).toBeCloseTo(tex.repeat.x, 5);
    }
    expect(valueMap.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(roughMap.colorSpace).toBe(THREE.NoColorSpace);

    // Chalk and roller profiles remain 64x64 unchanged
    const chalkMat = createPaintMaterial({ color: 'wimborne-white', sheen: 'estate-emulsion' });
    expect(chalkMat.roughnessMap?.image.width).toBe(64);
    expect(chalkMat.roughnessMap?.image.height).toBe(64);

    // Verify seamless toroidal wrap and calibrated chalky modulation ranges
    const assertSeamlessAndInRange = (
      tex: THREE.DataTexture,
      minAllowed: number,
      maxAllowed: number,
      minSpread: number
    ) => {
      const size = tex.image.width;
      const rgba = tex.image.data as Uint8Array;
      let minVal = 255;
      let maxVal = 0;
      for (let i = 0; i < size * size; i++) {
        const b = rgba[i << 2]!;
        if (b < minVal) minVal = b;
        if (b > maxVal) maxVal = b;
      }
      expect(minVal).toBeGreaterThanOrEqual(minAllowed);
      expect(maxVal).toBeLessThanOrEqual(maxAllowed);
      expect(maxVal - minVal).toBeGreaterThanOrEqual(minSpread);

      let seamXSum = 0;
      let seamXMax = 0;
      let seamYSum = 0;
      let seamYMax = 0;
      for (let i = 0; i < size; i++) {
        const dx = Math.abs(rgba[(i * size) << 2]! - rgba[(i * size + size - 1) << 2]!);
        seamXSum += dx;
        if (dx > seamXMax) seamXMax = dx;
        const dy = Math.abs(rgba[i << 2]! - rgba[((size - 1) * size + i) << 2]!);
        seamYSum += dy;
        if (dy > seamYMax) seamYMax = dy;
      }
      expect(seamXSum / size).toBeLessThan(1.5);
      expect(seamYSum / size).toBeLessThan(1.5);
      expect(seamXMax).toBeLessThanOrEqual(4);
      expect(seamYMax).toBeLessThanOrEqual(4);
    };

    assertSeamlessAndInRange(valueMap, 228, 255, 20);
    assertSeamlessAndInRange(roughMap, 236, 253, 12);

    // Byte-for-byte deterministic regeneration across cache clears
    const snapValue = new Uint8Array(valueMap.image.data as Uint8Array);
    const snapRough = new Uint8Array(roughMap.image.data as Uint8Array);
    clearPaintMaterialCache();
    const regen = createPaintMaterial({ color: 'lime-white', sheen: 'limewash' });
    expect(regen.map === valueMap).toBe(false);
    expect(Buffer.compare(Buffer.from(regen.map!.image.data as Uint8Array), Buffer.from(snapValue))).toBe(0);
    expect(Buffer.compare(Buffer.from(regen.roughnessMap!.image.data as Uint8Array), Buffer.from(snapRough))).toBe(0);
  });
});
