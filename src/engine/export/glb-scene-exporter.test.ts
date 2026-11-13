import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  convertHeightfieldToNormalRgba,
  exportPropertySceneToGlb,
  shouldExcludeObjectFromGlbExport,
  type GlbExportViewerLike,
} from './glb-scene-exporter.ts';

interface FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

class FakeContext2D {
  public fillStyle = '#000000';
  private flipRows = false;

  public constructor(private readonly canvas: FakeCanvas) {}

  public translate(): void {}

  public scale(_x: number, y: number): void {
    if (y < 0) this.flipRows = !this.flipRows;
  }

  public fillRect(): void {
    const hex = /^#([0-9a-f]{6})$/i.exec(this.fillStyle)?.[1] ?? '000000';
    const pixels = this.canvas.pixels;
    for (let o = 0; o < pixels.length; o += 4) {
      pixels[o] = parseInt(hex.slice(0, 2), 16);
      pixels[o + 1] = parseInt(hex.slice(2, 4), 16);
      pixels[o + 2] = parseInt(hex.slice(4, 6), 16);
      pixels[o + 3] = 255;
    }
  }

  public createImageData(width: number, height: number): FakeImageData {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }

  public getImageData(): FakeImageData {
    return {
      data: new Uint8ClampedArray(this.canvas.pixels),
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  /** Like the real API, `putImageData` ignores the current transform. */
  public putImageData(image: FakeImageData): void {
    this.canvas.pixels.set(image.data);
  }

  /** Nearest-neighbour blit that honours the vertical flip set up through `scale(1, -1)`. */
  public drawImage(source: FakeCanvas, _dx: number, _dy: number, dw: number, dh: number): void {
    const src = source.pixels;
    const dst = this.canvas.pixels;
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(source.height - 1, Math.floor((y * source.height) / dh));
      const dy = this.flipRows ? dh - 1 - y : y;
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(source.width - 1, Math.floor((x * source.width) / dw));
        const s = (sy * source.width + sx) * 4;
        const d = (dy * this.canvas.width + x) * 4;
        dst[d] = src[s]!;
        dst[d + 1] = src[s + 1]!;
        dst[d + 2] = src[s + 2]!;
        dst[d + 3] = src[s + 3]!;
      }
    }
  }
}

const FAKE_IMAGE_MAGIC = 0x46494d47;

class FakeCanvas {
  public width = 0;
  public height = 0;
  private buffer = new Uint8ClampedArray(0);
  private readonly context = new FakeContext2D(this);

  public get pixels(): Uint8ClampedArray {
    const size = this.width * this.height * 4;
    if (this.buffer.length !== size) this.buffer = new Uint8ClampedArray(size);
    return this.buffer;
  }

  public getContext(): FakeContext2D {
    return this.context;
  }

  /** Writes `[magic, width, height, ...rgba]` instead of a real PNG so tests can read pixels back. */
  public toBlob(callback: (blob: Blob) => void): void {
    const header = new DataView(new ArrayBuffer(12));
    header.setUint32(0, FAKE_IMAGE_MAGIC, true);
    header.setUint32(4, this.width, true);
    header.setUint32(8, this.height, true);
    callback(new Blob([header.buffer, new Uint8Array(this.pixels)]));
  }
}

class FakeFileReader {
  public result: ArrayBuffer | null = null;
  public onloadend: (() => void) | null = null;

  public readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}

beforeAll(() => {
  vi.stubGlobal('HTMLCanvasElement', FakeCanvas);
  vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
  vi.stubGlobal('FileReader', FakeFileReader);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

interface GltfTextureRef {
  readonly index: number;
  readonly extensions?: { readonly KHR_texture_transform?: { readonly scale?: number[] } };
}

interface GltfJson {
  readonly extensionsUsed?: string[];
  readonly scenes: { readonly name?: string; readonly nodes?: number[] }[];
  readonly nodes: {
    readonly name?: string;
    readonly mesh?: number;
    readonly children?: number[];
    readonly matrix?: number[];
    readonly extras?: Record<string, unknown>;
  }[];
  readonly materials: {
    readonly name?: string;
    readonly normalTexture?: GltfTextureRef;
    readonly extensions?: Record<string, unknown>;
    readonly pbrMetallicRoughness: { readonly metallicRoughnessTexture?: GltfTextureRef };
  }[];
  readonly textures: { readonly source: number }[];
  readonly images: { readonly bufferView: number }[];
  readonly bufferViews: { readonly byteOffset?: number; readonly byteLength: number }[];
}

interface ParsedGlb {
  readonly magic: number;
  readonly version: number;
  readonly declaredLength: number;
  readonly json: GltfJson;
  readonly bin: Uint8Array;
}

function parseGlb(bytes: Uint8Array): ParsedGlb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))
  ) as GltfJson;
  const binHeader = 20 + jsonLength;
  const binLength = view.getUint32(binHeader, true);
  expect(view.getUint32(binHeader + 4, true)).toBe(0x004e4942);
  return {
    magic: view.getUint32(0, true),
    version: view.getUint32(4, true),
    declaredLength: view.getUint32(8, true),
    json,
    bin: bytes.subarray(binHeader + 8, binHeader + 8 + binLength),
  };
}

function readExportedImage(glb: ParsedGlb, textureIndex: number): FakeImageData {
  const image = glb.json.images[glb.json.textures[textureIndex]!.source]!;
  const bufferView = glb.json.bufferViews[image.bufferView]!;
  const start = bufferView.byteOffset ?? 0;
  const bytes = glb.bin.slice(start, start + bufferView.byteLength);
  const header = new DataView(bytes.buffer, 0, 12);
  expect(header.getUint32(0, true)).toBe(FAKE_IMAGE_MAGIC);
  return {
    width: header.getUint32(4, true),
    height: header.getUint32(8, true),
    data: new Uint8ClampedArray(bytes.subarray(12)),
  };
}

describe('convertHeightfieldToNormalRgba', () => {
  const size = 8;
  const centre = (4 * size + 4) * 4;

  it('maps a flat heightfield to the neutral tangent-space normal', () => {
    const rgba = convertHeightfieldToNormalRgba(new Float32Array(size * size).fill(0.4), size, size);
    expect(rgba).toHaveLength(size * size * 4);
    for (let o = 0; o < rgba.length; o += 4) {
      expect(Array.from(rgba.subarray(o, o + 4))).toEqual([128, 128, 255, 255]);
    }
  });

  it('tilts red below 128 on a +X slope and green above 128 on a +Y slope', () => {
    const slopeX = new Float32Array(size * size);
    const slopeY = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        slopeX[y * size + x] = x / (size - 1);
        slopeY[y * size + x] = y / (size - 1);
      }
    }

    const nX = convertHeightfieldToNormalRgba(slopeX, size, size, { strength: 4 });
    expect(nX[centre]!).toBeLessThan(128);
    expect(nX[centre + 1]).toBe(128);
    expect(nX[centre + 2]!).toBeLessThan(255);
    expect(nX[centre + 3]).toBe(255);

    const nY = convertHeightfieldToNormalRgba(slopeY, size, size, { strength: 4 });
    expect(nY[centre]).toBe(128);
    expect(nY[centre + 1]!).toBeGreaterThan(128);

    const gentle = convertHeightfieldToNormalRgba(slopeX, size, size, { strength: 1 });
    expect(gentle[centre]!).toBeGreaterThan(nX[centre]!);
    expect(gentle[centre]!).toBeLessThan(128);
  });

  it('clamps at the borders unless wrapping is requested', () => {
    const ramp = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) ramp[y * size + x] = x / (size - 1);
    }
    const leftEdge = 4 * size * 4;
    const clamped = convertHeightfieldToNormalRgba(ramp, size, size, { strength: 4 });
    const wrapped = convertHeightfieldToNormalRgba(ramp, size, size, { strength: 4, wrapS: true });
    // Clamped: the ramp keeps rising at x = 0. Wrapped: x = -1 is the ramp's high end, a downhill step.
    expect(clamped[leftEdge]!).toBeLessThan(128);
    expect(wrapped[leftEdge]!).toBeGreaterThan(128);
  });

  it('rejects buffers that do not cover the declared size', () => {
    expect(() => convertHeightfieldToNormalRgba(new Float32Array(10), 4, 4)).toThrow(/smaller than 4x4/);
    expect(() => convertHeightfieldToNormalRgba(new Float32Array(0), 0, 4)).toThrow(/Invalid heightfield size/);
  });
});

describe('shouldExcludeObjectFromGlbExport', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const named = <T extends THREE.Object3D>(obj: T, name: string, userData: object = {}): T => {
    obj.name = name;
    Object.assign(obj.userData, userData);
    return obj;
  };

  it('excludes helpers flagged through userData', () => {
    for (const flag of [
      'excludeFromExport',
      'isShadowPassHook',
      'isAnnotationGroup',
      'isWeatherOverlay',
      'isSecurityFovCone',
      'isFittingFx',
    ]) {
      expect(shouldExcludeObjectFromGlbExport(named(new THREE.Group(), 'helper', { [flag]: true }))).toBe(true);
      expect(shouldExcludeObjectFromGlbExport(named(new THREE.Group(), 'helper', { [flag]: false }))).toBe(false);
    }
  });

  it('excludes reserved helper names and prefixes', () => {
    for (const name of [
      'ufh.heatingPipesLayer',
      '__fullSceneShaderWarmupGroup',
      '__hus_weather_system__',
      '__cutawayShadowPassStart',
      'unifi.frustum.camera.drive',
      'unifi.frustumMesh.camera.drive',
    ]) {
      expect(shouldExcludeObjectFromGlbExport(named(new THREE.Group(), name))).toBe(true);
    }
    expect(shouldExcludeObjectFromGlbExport(named(new THREE.Group(), 'ufh.manifold'))).toBe(false);
  });

  it('excludes meshes that only carry invisible or additive materials', () => {
    const collisionGuard = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ colorWrite: false }));
    const xrayOverlay = new THREE.Mesh(
      box,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    const glowDecal = new THREE.Mesh(
      box,
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true })
    );
    const noMaterial = new THREE.Mesh(box);
    (noMaterial as { material: unknown }).material = null;
    const allHidden = new THREE.Mesh(box, [
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending }),
    ]);

    for (const mesh of [collisionGuard, xrayOverlay, glowDecal, noMaterial, allHidden]) {
      expect(shouldExcludeObjectFromGlbExport(mesh)).toBe(true);
    }
  });

  it('excludes additive helper lines and points but not plain ones', () => {
    const additive = { blending: THREE.AdditiveBlending };
    expect(shouldExcludeObjectFromGlbExport(new THREE.LineSegments(box, new THREE.LineBasicMaterial(additive)))).toBe(true);
    expect(shouldExcludeObjectFromGlbExport(new THREE.Points(box, new THREE.PointsMaterial(additive)))).toBe(true);
    expect(
      shouldExcludeObjectFromGlbExport(
        named(new THREE.Line(box, new THREE.LineBasicMaterial()), 'fov', { isSecurityFovCone: true })
      )
    ).toBe(true);
    expect(shouldExcludeObjectFromGlbExport(new THREE.Line(box, new THREE.LineBasicMaterial()))).toBe(false);
  });

  it('keeps architecture, furniture, glazing and the site ground', () => {
    const wall = named(new THREE.Mesh(box, new THREE.MeshStandardMaterial()), 'shell.wall.north');
    const sofa = named(new THREE.Mesh(box, new THREE.MeshPhysicalMaterial({ sheen: 1 })), 'furniture.sofa');
    const glazing = named(
      new THREE.Mesh(box, new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.25, depthWrite: false })),
      'window.glass'
    );
    const ground = named(new THREE.Mesh(box, new THREE.MeshStandardMaterial()), 'environment.siteGround');
    const partlyVisible = new THREE.Mesh(box, [
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      new THREE.MeshStandardMaterial(),
    ]);

    for (const obj of [wall, sofa, glazing, ground, partlyVisible, new THREE.Group()]) {
      expect(shouldExcludeObjectFromGlbExport(obj)).toBe(false);
    }
  });
});

describe('exportPropertySceneToGlb', () => {
  const BUMP_SIZE = 8;
  const ROUGH_SIZE = 4;

  function buildSyntheticProperty() {
    const box = new THREE.BoxGeometry(1, 1, 1);

    // Height rises with the row index; with flipY the first row sits at the top of the image.
    const bumpData = new Uint8Array(BUMP_SIZE * BUMP_SIZE);
    for (let y = 0; y < BUMP_SIZE; y++) {
      for (let x = 0; x < BUMP_SIZE; x++) bumpData[y * BUMP_SIZE + x] = y * 30;
    }
    const bumpMap = new THREE.DataTexture(bumpData, BUMP_SIZE, BUMP_SIZE, THREE.RedFormat);
    bumpMap.flipY = true;
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.repeat.set(2, 2);
    bumpMap.needsUpdate = true;

    // Roughness lives in G; R is deliberately different so a channel mix-up is visible.
    const roughData = new Uint8Array(ROUGH_SIZE * ROUGH_SIZE * 2);
    for (let i = 0; i < ROUGH_SIZE * ROUGH_SIZE; i++) {
      roughData[i * 2] = 7;
      roughData[i * 2 + 1] = 40 + Math.floor(i / ROUGH_SIZE) * 50;
    }
    const roughnessMap = new THREE.DataTexture(roughData, ROUGH_SIZE, ROUGH_SIZE, THREE.RGFormat);
    roughnessMap.flipY = true;
    roughnessMap.needsUpdate = true;

    const wallMaterial = new THREE.MeshStandardMaterial({
      name: 'plaster',
      color: 0xd8d2c4,
      bumpMap,
      bumpScale: 0.2,
      roughnessMap,
    });

    const scene = new THREE.Scene();
    const house = new THREE.Group();
    house.name = 'house';
    scene.add(house);

    const room = new THREE.Group();
    room.name = 'room.kitchen';
    room.position.set(2, 0, 3);
    room.userData.zoneId = 'kitchen';
    room.userData.roomFinishes = { flooring: 'Pale tumbled limestone flagstones' };
    house.add(room);

    const wall = new THREE.Mesh(box, wallMaterial);
    wall.name = 'kitchen.wall';
    const secondWall = new THREE.Mesh(box, wallMaterial);
    secondWall.name = 'kitchen.wall.east';
    const collisionGuard = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ colorWrite: false }));
    collisionGuard.name = 'kitchen.collisionGuard';
    const shelf = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ name: 'oak' }));
    shelf.name = 'kitchen.shelf';
    collisionGuard.add(shelf);
    const glowDecal = new THREE.Mesh(
      box,
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true })
    );
    glowDecal.name = 'kitchen.glowDecal';
    const hidden = new THREE.Mesh(box, new THREE.MeshStandardMaterial());
    hidden.name = 'kitchen.hiddenLod';
    hidden.visible = false;
    const pendant = new THREE.PointLight(0xffffff, 3);
    pendant.name = 'kitchen.pendantLight';
    room.add(wall, secondWall, collisionGuard, glowDecal, hidden, pendant);

    const frustum = new THREE.Group();
    frustum.name = 'unifi.frustum.camera.drive';
    frustum.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial()));
    const annotations = new THREE.Group();
    annotations.name = 'annotations.pins';
    annotations.userData.isAnnotationGroup = true;
    annotations.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial()));
    const guides = new THREE.Group();
    guides.name = 'guides.linesOnly';
    guides.add(new THREE.Line(box, new THREE.LineBasicMaterial()));
    house.add(frustum, annotations, guides);

    const groundMaterial = new THREE.MeshStandardMaterial({ name: 'turf', color: 0x55713a });
    (groundMaterial as unknown as { colorNode: unknown }).colorNode = { isNode: true };
    const ground = new THREE.Mesh(box, groundMaterial);
    ground.name = 'environment.siteGround';
    scene.add(ground);

    return { scene, wallMaterial, bumpMap, roughData };
  }

  it('writes a valid .glb with helpers stripped, hierarchy kept and bump maps as normal textures', async () => {
    const { scene, wallMaterial, bumpMap, roughData } = buildSyntheticProperty();

    const calls: string[] = [];
    let batched = true;
    let ceilingCutaway = true;
    const viewer: GlbExportViewerLike = {
      scene,
      staticScene: {
        batchOptimizer: {
          isBatched: () => batched,
          unbatchAll: () => {
            batched = false;
            calls.push('unbatchAll');
          },
        },
      },
      camera: { rig: { perspCamera: { fov: 42 } } },
      setTradeView: (view) => calls.push(`trade:${view}`),
      setUfhLayerVisible: (visible) => calls.push(`ufh:${visible}`),
      setFloorViewMode: (mode) => calls.push(`floor:${mode}`),
      isCeilingCutaway: () => ceilingCutaway,
      toggleCeilingCutaway: () => {
        ceilingCutaway = !ceilingCutaway;
        calls.push('toggleCeilingCutaway');
      },
      setLodPolicyMode: (mode) => calls.push(`lod:${mode}`),
      getPropertyName: () => 'Synthetic Farmhouse',
      getZoneRegistry: () => ({
        getAllCameraPresets: () => [
          { id: 'overview', pos: new THREE.Vector3(1, 8, 12), target: new THREE.Vector3(0, 1, 0) },
        ],
      }),
    };

    const result = await exportPropertySceneToGlb(viewer);

    expect(calls).toEqual([
      'unbatchAll',
      'trade:owner',
      'ufh:false',
      'floor:all',
      'toggleCeilingCutaway',
      'lod:lod2',
    ]);
    expect(ceilingCutaway).toBe(false);

    const glb = parseGlb(result.glbBytes);
    expect(glb.magic).toBe(0x46546c67);
    expect(glb.version).toBe(2);
    expect(glb.declaredLength).toBe(result.glbBytes.byteLength);

    const { json } = glb;
    expect(json.scenes[0]!.name).toBe('Synthetic Farmhouse');
    const nodeNames = json.nodes.map((n) => n.name);
    expect([...nodeNames].sort()).toEqual([
      'environment.siteGround',
      'house',
      'kitchen.collisionGuard',
      'kitchen.shelf',
      'kitchen.wall',
      'kitchen.wall.east',
      'room.kitchen',
    ]);

    const nodeIndex = (name: string): number => nodeNames.indexOf(name);
    const houseNode = json.nodes[nodeIndex('house')]!;
    const roomNode = json.nodes[nodeIndex('room.kitchen')]!;
    expect(json.scenes[0]!.nodes).toEqual(
      expect.arrayContaining([nodeIndex('house'), nodeIndex('environment.siteGround')])
    );
    expect(houseNode.children).toEqual([nodeIndex('room.kitchen')]);
    expect(roomNode.children).toEqual(
      expect.arrayContaining([nodeIndex('kitchen.wall'), nodeIndex('kitchen.wall.east')])
    );
    expect(roomNode.mesh).toBeUndefined();
    expect(roomNode.matrix!.slice(12, 15)).toEqual([2, 0, 3]);
    expect(roomNode.extras).toEqual({
      zoneId: 'kitchen',
      roomFinishes: { flooring: 'Pale tumbled limestone flagstones' },
    });

    // An invisible parent mesh survives as a plain group so its visible child keeps its place.
    const guardNode = json.nodes[nodeIndex('kitchen.collisionGuard')]!;
    expect(guardNode.mesh).toBeUndefined();
    expect(guardNode.children).toEqual([nodeIndex('kitchen.shelf')]);

    expect(json.extensionsUsed ?? []).not.toContain('EXT_materials_bump');
    expect(json.extensionsUsed ?? []).not.toContain('KHR_lights_punctual');

    expect(json.materials.map((m) => m.name).sort()).toEqual(['oak', 'plaster', 'turf']);
    const plaster = json.materials.find((m) => m.name === 'plaster')!;
    expect(plaster.extensions?.EXT_materials_bump).toBeUndefined();
    expect(plaster.normalTexture).toBeDefined();
    expect(plaster.normalTexture!.extensions?.KHR_texture_transform?.scale).toEqual([2, 2]);
    expect(plaster.pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined();

    expect(result.meshCount).toBe(4);
    expect(result.materialCount).toBe(3);
    expect(result.convertedBumpMaps).toBe(1);
    expect(result.cameraPresets).toEqual([
      { id: 'overview', position: [1, 8, 12], target: [0, 1, 0], fovDeg: 42 },
    ]);

    // glTF images start at v = 0, so a flipY source arrives with its rows reversed.
    const normalImage = readExportedImage(glb, plaster.normalTexture!.index);
    expect([normalImage.width, normalImage.height]).toEqual([BUMP_SIZE, BUMP_SIZE]);
    const centre = (4 * BUMP_SIZE + 4) * 4;
    expect(normalImage.data[centre]).toBe(128);
    expect(normalImage.data[centre + 1]!).toBeGreaterThan(128);
    expect(normalImage.data[centre + 2]!).toBeGreaterThan(128);

    const roughImage = readExportedImage(
      glb,
      plaster.pbrMetallicRoughness.metallicRoughnessTexture!.index
    );
    expect([roughImage.width, roughImage.height]).toEqual([ROUGH_SIZE, ROUGH_SIZE]);
    for (let row = 0; row < ROUGH_SIZE; row++) {
      const sourceRow = ROUGH_SIZE - 1 - row;
      expect(roughImage.data[row * ROUGH_SIZE * 4 + 1]).toBe(roughData[sourceRow * ROUGH_SIZE * 2 + 1]);
    }

    // The live scene's materials are never mutated.
    expect(wallMaterial.bumpMap).toBe(bumpMap);
    expect(wallMaterial.normalMap).toBeNull();
  });

  it('exports a bare scene and drops textures that have no pixels instead of throwing', async () => {
    const scene = new THREE.Scene();
    const emptyCanvas = new FakeCanvas() as unknown as HTMLCanvasElement;
    const material = new THREE.MeshStandardMaterial({
      name: 'unloaded',
      map: new THREE.CanvasTexture(emptyCanvas),
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.name = 'crate';
    scene.add(mesh);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await exportPropertySceneToGlb(scene);
      const { json } = parseGlb(result.glbBytes);
      expect(json.scenes[0]!.name).toBe('HusjsPropertyScene');
      expect(json.nodes.map((n) => n.name)).toEqual(['crate']);
      expect(json.textures).toBeUndefined();
      expect(result.cameraPresets).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Dropped 1 texture(s)'));
    } finally {
      warn.mockRestore();
    }
  });
});
