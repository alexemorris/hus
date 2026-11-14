#!/usr/bin/env node
/**
 * Empirical GPU + CPU memory & WebGPU fragment-texture-limit diagnostic for Hus.js homes.
 *
 * Runs each target house in an isolated child process under either a desktop macOS profile
 * or a simulated iPhone / iPadOS Safari profile (with real pixel-backed Canvas2D elements so
 * procedural textures, `SceneBatchOptimizer`, `MaterialTextureDeduplicator`, and
 * `releaseUploadedStaticCanvases` execute their true browser runtime paths).
 *
 * Usage:
 *   node tools/measure-ios-memory.mjs --all-examples
 *   node tools/measure-ios-memory.mjs --house /path/to/my-house/index.ts
 *   node tools/measure-ios-memory.mjs --all-examples --json
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveHouseModulePath } from './husjs-zfight.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_HOUSES = ['simple-flat', 'simple-house', 'stahl-house'];
const MIB = 1024 * 1024;

const DEVICE_PROFILES = {
  desktop: {
    label: 'Desktop (macOS Retina DPR 2)',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    maxTouchPoints: 0,
    dpr: 2,
    viewportW: 1920,
    viewportH: 1080,
    gpuRenderer: 'Apple M3 Max',
    gpuVendor: 'Apple Inc.',
    deviceMemoryGb: 32,
    hardwareConcurrency: 14,
    search: '',
  },
  iphone: {
    label: 'iOS Safari (iPhone 16 Pro DPR 3)',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    dpr: 3,
    viewportW: 430,
    viewportH: 932,
    gpuRenderer: 'Apple GPU',
    gpuVendor: 'Apple Inc.',
    deviceMemoryGb: null,
    hardwareConcurrency: 6,
    search: '?mobile=1',
  },
  ipad: {
    label: 'iPadOS Safari (Macintosh UA + 5 Touch DPR 2)',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    maxTouchPoints: 5,
    dpr: 2,
    viewportW: 1366,
    viewportH: 1024,
    gpuRenderer: 'Apple GPU',
    gpuVendor: 'Apple Inc.',
    deviceMemoryGb: null,
    hardwareConcurrency: 8,
    search: '',
  },
};

function installSimulatedBrowserGlobals(spec, createCanvasFn) {
  const createdCanvases = new Set();
  const nav = {
    userAgent: spec.userAgent,
    maxTouchPoints: spec.maxTouchPoints,
    hardwareConcurrency: spec.hardwareConcurrency,
    ...(spec.deviceMemoryGb !== null ? { deviceMemory: spec.deviceMemoryGb } : {}),
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
    writable: true,
  });
  const win = {
    devicePixelRatio: spec.dpr,
    innerWidth: spec.viewportW,
    innerHeight: spec.viewportH,
    screen: { width: spec.viewportW, height: spec.viewportH },
    location: { search: spec.search, href: `https://hus.local/${spec.search}` },
    matchMedia: (q) => ({
      matches:
        spec.maxTouchPoints > 0 &&
        (q.includes('pointer: coarse') || q.includes('hover: none')),
    }),
  };
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  });
  const doc = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        const c = createCanvasFn(300, 150);
        createdCanvases.add(c);
        return c;
      }
      return { style: {}, addEventListener: () => {}, removeEventListener: () => {} };
    },
    createElementNS: (_ns, tag) => doc.createElement(tag),
  };
  Object.defineProperty(globalThis, 'document', {
    value: doc,
    configurable: true,
    writable: true,
  });
  return createdCanvases;
}

function bytesPerTexel(THREE, format, type) {
  const ch =
    format === THREE.RedFormat
      ? 1
      : format === THREE.RGFormat
        ? 2
        : 4;
  const bpc =
    type === THREE.FloatType
      ? 4
      : type === THREE.HalfFloatType
        ? 2
        : 1;
  return ch * bpc;
}

export function countMaterialSampledTextures(THREE, mat, receiveShadow) {
  if (!mat) return 0;
  const isUnlit = mat.type === 'MeshBasicMaterial';
  if (isUnlit) {
    return (mat.map ? 1 : 0) + (mat.alphaMap ? 1 : 0);
  }
  const excludeIndoor = Boolean(mat.userData?.excludeIndoorLighting);
  let count = 2 + 1;
  if (receiveShadow) count += 2;
  if (!excludeIndoor) count += 4;

  const uniqueTex = new Set();
  const addTex = (t) => {
    if (t && typeof t === 'object' && t.isTexture) uniqueTex.add(t);
  };

  addTex(mat.map);
  addTex(mat.alphaMap);
  addTex(mat.aoMap);
  addTex(mat.emissiveMap);
  addTex(mat.lightMap);
  if (mat.normalMap) {
    addTex(mat.normalMap);
  } else if (mat.bumpMap) {
    addTex(mat.bumpMap);
  }
  if (mat.roughnessMap && mat.metalnessMap && mat.roughnessMap === mat.metalnessMap) {
    addTex(mat.roughnessMap);
  } else {
    addTex(mat.roughnessMap);
    addTex(mat.metalnessMap);
  }
  if (mat.type === 'MeshPhysicalMaterial') {
    if ((mat.clearcoat ?? 0) > 0) {
      addTex(mat.clearcoatMap);
      addTex(mat.clearcoatRoughnessMap);
      addTex(mat.clearcoatNormalMap);
    }
    if ((mat.sheen ?? 0) > 0) {
      addTex(mat.sheenColorMap);
      addTex(mat.sheenRoughnessMap);
    }
    if ((mat.iridescence ?? 0) > 0) {
      addTex(mat.iridescenceMap);
      addTex(mat.iridescenceThicknessMap);
    }
    if ((mat.anisotropy ?? 0) > 0) {
      addTex(mat.anisotropyMap);
    }
    if ((mat.specularIntensity ?? 1) > 0) {
      addTex(mat.specularIntensityMap);
      addTex(mat.specularColorMap);
    }
    if ((mat.transmission ?? 0) > 0) {
      count += 1;
      addTex(mat.transmissionMap);
      addTex(mat.thicknessMap);
    }
  }
  const extraTsl = mat.userData?.extraSampledTextures;
  if (Array.isArray(extraTsl)) {
    for (const t of extraTsl) addTex(t);
  }
  count += uniqueTex.size;
  void THREE;
  return count;
}

async function runBatchProfileMeasurements(houseSpecs, profileKey, cwd) {
  const spec = DEVICE_PROFILES[profileKey];
  const resolvedSpecs = houseSpecs.map((hs) => {
    const mp = resolveHouseModulePath(hs, { cwd, repoRoot: REPO_ROOT });
    const tr = mp.includes("/src/homes/")
      ? resolve(mp.slice(0, mp.indexOf("/src/homes/")))
      : REPO_ROOT;
    return { houseSpec: hs, modulePath: mp, targetRepoRoot: tr };
  });
  const allowedRoots = [...new Set([cwd, REPO_ROOT, ...resolvedSpecs.map((r) => r.targetRepoRoot)])];
  const targetRepoRoot = resolvedSpecs[0]?.targetRepoRoot ?? REPO_ROOT;
  const threeDir = existsSync(join(REPO_ROOT, "node_modules/three/build/three.module.js"))
    ? join(REPO_ROOT, "node_modules/three")
    : join(targetRepoRoot, "node_modules/three");

  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: targetRepoRoot,
    logLevel: 'error',
    clearScreen: false,
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { noExternal: true },
    server: {
      middlewareMode: true,
      hmr: false,
      ws: false,
      watch: null,
      fs: { allow: allowedRoots },
    },
    resolve: {
      dedupe: ['three', 'preact', '@preact/signals'],
      alias: [
        { find: /^husjs\/(.+)$/, replacement: join(REPO_ROOT, 'src/husjs/$1.ts') },
        { find: /^husjs$/, replacement: join(REPO_ROOT, 'src/husjs/index.ts') },
        { find: /^three\/(.+)$/, replacement: join(threeDir, "$1") },
        { find: /^three$/, replacement: join(threeDir, "build/three.module.js") },
      ],
    },
  });

  try {
    const THREE = await server.ssrLoadModule(join(threeDir, 'build/three.module.js'));
    const headlessCanvasMod = await server.ssrLoadModule(
      join(REPO_ROOT, 'src/engine/textures/headless-canvas.ts')
    );
    const createdCanvases = installSimulatedBrowserGlobals(spec, (w, h) => {
      const prevDoc = globalThis.document;
      delete globalThis.document;
      try {
        return headlessCanvasMod.createRuntimeOrHeadlessCanvas(w, h);
      } finally {
        globalThis.document = prevDoc;
      }
    });

    const perfMod = await server.ssrLoadModule(join(REPO_ROOT, 'src/engine/perf/device-tier.ts'));
    const tierSettingsMod = await server.ssrLoadModule(
      join(REPO_ROOT, 'src/engine/perf/tier-settings.ts')
    );
    const hdrProcMod = await server.ssrLoadModule(
      join(REPO_ROOT, 'src/engine/lighting/env/hdr-processing.ts')
    );
    const hdrCacheMod = await server.ssrLoadModule(
      join(REPO_ROOT, 'src/engine/lighting/env/hdr-cache-and-pmrem.ts')
    );
    const texRegMod = await server.ssrLoadModule(
      join(REPO_ROOT, 'src/engine/textures/texture-registry.ts')
    );
    const viewerMod = await server.ssrLoadModule(join(REPO_ROOT, 'src/husjs/viewer.ts'));

    const isMobile = perfMod.detectMobile();
    const isIOS = perfMod.detectIOS();
    const tier = perfMod.estimateInitialTier({
      gpuRenderer: spec.gpuRenderer,
      gpuVendor: spec.gpuVendor,
      deviceMemoryGb: spec.deviceMemoryGb,
      hardwareConcurrency: spec.hardwareConcurrency,
      isMobile,
      isIOS,
      isTouch: spec.maxTouchPoints > 0,
      maxTextureSize: 8192,
    });
    const tierSettings = tierSettingsMod.getTierSettings(tier, spec.dpr);
    const clampedPr = tierSettingsMod.clampPixelRatioForViewport(
      tier,
      tierSettings.pixelRatio,
      spec.viewportW,
      spec.viewportH
    );

    const results = [];
    for (const { houseSpec, modulePath } of resolvedSpecs) {
      createdCanvases.length = 0;
    const mod = await server.ssrLoadModule(modulePath);
    const candidates = Object.values(mod);
    let profile = null;
    let houseId = houseSpec;
    for (const val of candidates) {
      if (val && typeof val === 'object' && typeof val.createSceneProfile === 'function') {
        profile = val.createSceneProfile();
        houseId = val.id ?? profile.id ?? houseSpec;
        break;
      }
      if (val && typeof val === 'object' && typeof val.createZoneRegistry === 'function') {
        profile = val;
        houseId = val.id ?? houseSpec;
        break;
      }
    }
    if (!profile) throw new Error(`Could not extract profile from ${modulePath}`);

    const scene = new THREE.Scene();
    const layers = viewerMod.createPropertySceneLayers(scene, profile.floors);
    const lodController = new viewerMod.RoomLodController(profile.lodRegistrations);
    const registry = profile.createZoneRegistry();
    const built = viewerMod.buildPropertySceneContent(layers, {
      profile,
      registry,
      lodController,
      ceilingCutaway: false,
    });

    const optimizer = new viewerMod.SceneBatchOptimizer({
      layers,
      lodController,
      interactiveMeshes: built.interactiveMeshes,
      bifoldPanels: built.bifoldPanels,
      lightGroups: built.lightGroups,
      indicatorMats: built.indicatorMats,
      roomSwitchLedMats: built.roomSwitchLedMats,
      getDynamicObjects: () => new Set(),
      batchHooks: profile.batchHooks,
    });
    optimizer.optimize();

    const retainedCanvases = new Set();
    if (built.tvOffTexture?.image) retainedCanvases.add(built.tvOffTexture.image);
    for (const t of built.tvArtTextures ?? []) {
      if (t?.image) retainedCanvases.add(t.image);
    }
    const mutableMats = optimizer.getMutableMaterials();
    for (const mat of mutableMats) {
      for (const key of Object.keys(mat)) {
        const v = mat[key];
        if (v && typeof v === 'object' && v.isTexture && v.image) {
          retainedCanvases.add(v.image);
        }
      }
    }
    texRegMod.releaseUploadedStaticCanvases(createdCanvases, retainedCanvases);

    const uniqueGeos = new Set();
    const uniqueTexSources = new Map();
    let maxSampledTextures = 0;
    let worstMaterialName = '';
    let meshCount = 0;

    scene.traverse((obj) => {
      if (!obj || !obj.isMesh) return;
      meshCount++;
      if (obj.geometry) uniqueGeos.add(obj.geometry);
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat) continue;
        const sampled = countMaterialSampledTextures(THREE, mat, obj.receiveShadow);
        if (sampled > maxSampledTextures) {
          maxSampledTextures = sampled;
          worstMaterialName = mat.name || mat.type;
        }
        for (const key of Object.keys(mat)) {
          const val = mat[key];
          if (val && typeof val === 'object' && val.isTexture && val.image) {
            const srcKey = val.image.data ?? val.image;
            if (!uniqueTexSources.has(srcKey)) {
              uniqueTexSources.set(srcKey, val);
            }
          }
        }
      }
    });

    let totalGeoBytes = 0;
    let vegGeoBytes = 0;
    for (const geo of uniqueGeos) {
      let bytes = 0;
      for (const attrName of Object.keys(geo.attributes)) {
        const attr = geo.attributes[attrName];
        if (attr?.array?.byteLength) bytes += attr.array.byteLength;
      }
      if (geo.index?.array?.byteLength) bytes += geo.index.array.byteLength;
      totalGeoBytes += bytes;
      if (geo.attributes.aVegMeta || geo.attributes.aVegPivot) {
        vegGeoBytes += bytes;
      }
    }

    let gpuTextureBytes = 0;
    let maxTexDimension = 0;
    for (const tex of uniqueTexSources.values()) {
      const w = Number(tex.image?.width ?? 0);
      const h = Number(tex.image?.height ?? 0);
      if (w <= 0 || h <= 0) continue;
      maxTexDimension = Math.max(maxTexDimension, w, h);
      const bpp = bytesPerTexel(THREE, tex.format, tex.type);
      const mipFactor = tex.generateMipmaps === false ? 1 : 4 / 3;
      gpuTextureBytes += Math.ceil(w * h * bpp * mipFactor);
    }

    let liveCanvasBytes = 0;
    for (const c of createdCanvases) {
      if (c.width > 0 && c.height > 0) {
        liveCanvasBytes += c.width * c.height * 4;
      }
    }

    const shadowBytes = tierSettings.shadowMapSize * tierSettings.shadowMapSize * 8;
    const fbW = Math.round(spec.viewportW * clampedPr);
    const fbH = Math.round(spec.viewportH * clampedPr);
    const frameBufferBytes = fbW * fbH * 12;
    const postFxBytes = tierSettings.postProcessing
      ? fbW * fbH * 12 +
        (tierSettings.ambientOcclusion ? Math.ceil((fbW * fbH) / 4) * 8 : 0) +
        (tierSettings.bloom ? Math.ceil((fbW * fbH) / 2) * 8 : 0)
      : 0;

    const maxCachedCells = hdrCacheMod.getMaxHdrCachedCells(isMobile);
    const maxHdrWidth = hdrProcMod.resolveMaxHdrDetailWidth(
      { maxTextureDimension2D: 8192, maxBufferSize: 268_435_456 },
      isMobile
    );
    const activeHdrWidth = isMobile ? 512 : Math.min(4096, maxHdrWidth);
    const hdrCellBytes =
      activeHdrWidth * (activeHdrWidth / 2) * 8 + (isMobile ? 4 * MIB : 25.17 * MIB);
    const hdrTotalBytes = Math.round(hdrCellBytes * Math.min(2, maxCachedCells));

    const totalGpuBytes =
      totalGeoBytes + gpuTextureBytes + shadowBytes + frameBufferBytes + postFxBytes + hdrTotalBytes;

    results.push({
      houseId,
      profileKey,
      label: spec.label,
      isMobile,
      isIOS,
      tier,
      meshCount,
      uniqueGeometries: uniqueGeos.size,
      uniqueTextures: uniqueTexSources.size,
      maxTexDimension,
      maxSampledTextures,
      worstMaterialName,
      geometryMiB: +(totalGeoBytes / MIB).toFixed(2),
      vegetationGeoMiB: +(vegGeoBytes / MIB).toFixed(2),
      gpuTextureMiB: +(gpuTextureBytes / MIB).toFixed(2),
      liveCanvasMiB: +(liveCanvasBytes / MIB).toFixed(2),
      shadowMiB: +(shadowBytes / MIB).toFixed(2),
      renderTargetsMiB: +((frameBufferBytes + postFxBytes) / MIB).toFixed(2),
      hdrMiB: +(hdrTotalBytes / MIB).toFixed(2),
      totalGpuMiB: +(totalGpuBytes / MIB).toFixed(2),
    });
    }
    return results;
  } finally {
    await server.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const workerProfIdx = argv.indexOf("--worker-profile");
  if (workerProfIdx !== -1) {
    const profileKey = argv[workerProfIdx + 1];
    const houseSpecs = argv.slice(workerProfIdx + 2);
    const results = await runBatchProfileMeasurements(houseSpecs, profileKey, process.cwd());
    process.stdout.write(JSON.stringify(results) + "\n");
    return;
  }
  const workerIdx = argv.indexOf("--worker-single");
  if (workerIdx !== -1) {
    const houseSpec = argv[workerIdx + 1];
    const profileKey = argv[workerIdx + 2];
    const results = await runBatchProfileMeasurements([houseSpec], profileKey, process.cwd());
    process.stdout.write(JSON.stringify(results[0]) + "\n");
    return;
  }

  const json = argv.includes("--json");
  const allExamples = argv.includes("--all-examples");
  const houses = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--house" && argv[i + 1]) {
      houses.push(argv[++i]);
    }
  }
  if (allExamples || houses.length === 0) {
    for (const h of EXAMPLE_HOUSES) {
      if (!houses.includes(h)) houses.push(h);
    }
  }

  let profiles = ["desktop", "iphone", "ipad"];
  const profFlagIdx = argv.indexOf("--profiles");
  if (profFlagIdx !== -1 && argv[profFlagIdx + 1]) {
    profiles = argv[profFlagIdx + 1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => Boolean(DEVICE_PROFILES[s]));
  }
  const byProfile = new Map();
  const selfPath = fileURLToPath(import.meta.url);

  for (const prof of profiles) {
    const { stdout } = await execFileAsync(
      process.execPath,
      [selfPath, "--worker-profile", prof, ...houses],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 32 * MIB }
    );
    const lines = stdout.trim().split("\n");
    byProfile.set(prof, JSON.parse(lines[lines.length - 1]));
  }

  const rows = [];
  for (let i = 0; i < houses.length; i++) {
    for (const prof of profiles) {
      rows.push(byProfile.get(prof)[i]);
    }
  }

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  for (const r of rows) {
    console.log(
      `${r.houseId.padEnd(16)} | ${r.profileKey.padEnd(7)} | tier=${r.tier.padEnd(6)} | ` +
        `totalGPU=${String(r.totalGpuMiB).padStart(6)} MiB ` +
        `(tex=${r.gpuTextureMiB} MiB, geo=${r.geometryMiB} MiB [veg=${r.vegetationGeoMiB}], ` +
        `shadow=${r.shadowMiB} MiB, rt=${r.renderTargetsMiB} MiB, hdr=${r.hdrMiB} MiB) | ` +
        `liveCanvas=${r.liveCanvasMiB} MiB | maxTex=${r.maxTexDimension}px | maxSampled=${r.maxSampledTextures}/16`
    );
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  existsSync(resolve(process.argv[1])) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
