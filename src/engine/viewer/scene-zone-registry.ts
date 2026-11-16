import * as THREE from 'three';
import type { FloorDefinition } from '../../core/types/scene.ts';
import type { BuildingId, RoomBoundingBox } from '../../core/types/topology.ts';
import type {
  CameraPresetDefinition,
  SceneBuilderContext,
  SceneZoneModule,
  ZoneIndicatorMaterials,
} from './scene-types.ts';

/**
 * Composable registry of 3D zone modules for a property.
 */
export class SceneZoneRegistry {
  private readonly modules: SceneZoneModule[] = [];
  private readonly presets = new Map<string, CameraPresetDefinition>();
  private readonly interiorBounds: RoomBoundingBox[] = [];

  public constructor(initialModules: readonly SceneZoneModule[]) {
    for (const mod of initialModules) {
      this.registerZoneModule(mod);
    }
  }

  public registerZoneModule(mod: SceneZoneModule): void {
    this.modules.push(mod);
    if (mod.interiorBounds) {
      for (const b of mod.interiorBounds) {
        this.interiorBounds.push(b);
      }
    }
    if (mod.cameraPresets) {
      for (const p of mod.cameraPresets) {
        this.presets.set(p.id, p);
      }
    }
  }

  public addInteriorBounds(bounds: readonly RoomBoundingBox[]): void {
    for (const b of bounds) {
      const exists = this.interiorBounds.some(
        (e) =>
          e.minX === b.minX &&
          e.maxX === b.maxX &&
          e.minY === b.minY &&
          e.maxY === b.maxY &&
          e.minZ === b.minZ &&
          e.maxZ === b.maxZ
      );
      if (!exists) {
        this.interiorBounds.push(b);
      }
    }
  }

  public ensureTopCameraPreset(
    floors?: readonly FloorDefinition[],
    fallbackBounds?: readonly RoomBoundingBox[]
  ): void {
    if (this.presets.has('top')) return;
    const boundsSource =
      this.interiorBounds.length > 0
        ? this.interiorBounds
        : fallbackBounds && fallbackBounds.length > 0
          ? fallbackBounds
          : [];
    let minX = -6;
    let maxX = 6;
    let minZ = -6;
    let maxZ = 6;
    if (boundsSource.length > 0) {
      minX = Number.POSITIVE_INFINITY;
      maxX = Number.NEGATIVE_INFINITY;
      minZ = Number.POSITIVE_INFINITY;
      maxZ = Number.NEGATIVE_INFINITY;
      for (const b of boundsSource) {
        if (b.minX < minX) minX = b.minX;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.minZ < minZ) minZ = b.minZ;
        if (b.maxZ > maxZ) maxZ = b.maxZ;
      }
    }
    const sortedFloors =
      floors && floors.length > 0
        ? [...floors].sort((a, b) => a.elevationY - b.elevationY)
        : undefined;
    const baseY = sortedFloors?.[0]?.elevationY ?? 0;
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const spanX = Math.max(4, maxX - minX);
    const spanZ = Math.max(4, maxZ - minZ);
    const maxSpan = Math.max(spanX, spanZ);
    const height = Math.max(22, maxSpan * 1.45);
    const effectiveVertSpan = Math.max(spanZ, spanX / 1.45);
    const orthoZoom = Math.min(1.08, Math.max(0.28, (11.2 * 0.84) / effectiveVertSpan));
    const buildingId: BuildingId = this.modules[0]?.buildingId ?? 'building';

    this.presets.set('top', {
      id: 'top',
      label: 'Floor Plan',
      buildingId,
      pos: new THREE.Vector3(cx, baseY + height, cz + 0.01),
      target: new THREE.Vector3(cx, baseY, cz),
      useOrthographic: true,
      orthoZoom,
    });
  }

  public getInteriorBounds(): readonly RoomBoundingBox[] {
    return this.interiorBounds;
  }

  public getModules(): readonly SceneZoneModule[] {
    return this.modules;
  }

  public getCameraPreset(id: string): CameraPresetDefinition | undefined {
    return this.presets.get(id);
  }

  public getAllCameraPresets(): readonly CameraPresetDefinition[] {
    return Array.from(this.presets.values());
  }

  public isPointInsideInteriorRoom(x: number, y: number, z: number): boolean {
    return this.interiorBounds.some(
      (b) =>
        x >= b.minX &&
        x <= b.maxX &&
        y >= b.minY &&
        y <= b.maxY &&
        z >= b.minZ &&
        z <= b.maxZ
    );
  }

  public arePointsInSameInteriorRoom(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number
  ): boolean {
    return this.interiorBounds.some(
      (b) =>
        x1 >= b.minX &&
        x1 <= b.maxX &&
        y1 >= b.minY &&
        y1 <= b.maxY &&
        z1 >= b.minZ &&
        z1 <= b.maxZ &&
        x2 >= b.minX &&
        x2 <= b.maxX &&
        y2 >= b.minY &&
        y2 <= b.maxY &&
        z2 >= b.minZ &&
        z2 <= b.maxZ
    );
  }

  public buildAllZones(ctx: SceneBuilderContext): ZoneIndicatorMaterials {
    const switchLedMats: Record<string, THREE.MeshStandardMaterial> = {};
    const sensorLedMats: Record<string, THREE.MeshStandardMaterial> = {};
    const displayMats: Record<string, THREE.MeshStandardMaterial> = {};
    for (const mod of this.modules) {
      const res = mod.build(ctx);
      if (mod.variations && mod.variations.length > 0) {
        ctx.variations?.registerAll(mod.variations);
      }
      if (res.switchLedMats) Object.assign(switchLedMats, res.switchLedMats);
      if (res.sensorLedMats) Object.assign(sensorLedMats, res.sensorLedMats);
      if (res.displayMats) Object.assign(displayMats, res.displayMats);
    }
    return {
      ...(Object.keys(switchLedMats).length > 0 ? { switchLedMats } : {}),
      ...(Object.keys(sensorLedMats).length > 0 ? { sensorLedMats } : {}),
      ...(Object.keys(displayMats).length > 0 ? { displayMats } : {}),
    };
  }

  public async buildAllZonesAsync(
    ctx: SceneBuilderContext,
    options?: {
      readonly yieldIfNeeded?: (label?: string) => Promise<void>;
      readonly onProgress?: (label: string, fraction01: number) => Promise<void> | void;
    }
  ): Promise<ZoneIndicatorMaterials> {
    let merged: ZoneIndicatorMaterials = {};
    const total = Math.max(1, this.modules.length);
    for (let i = 0; i < this.modules.length; i++) {
      const mod = this.modules[i]!;
      const baseLabel = `Building ${mod.name}…`;
      await options?.onProgress?.(baseLabel, i / total);
      await options?.yieldIfNeeded?.(baseLabel);

      const scopedCtx: SceneBuilderContext = {
        ...ctx,
        yieldIfNeeded: async (subLabel?: string) => {
          await options?.yieldIfNeeded?.(subLabel);
        },
        reportZoneProgress: async (subLabel: string, subFrac01: number) => {
          const clamped = Math.max(0, Math.min(1, subFrac01));
          await options?.onProgress?.(subLabel, (i + clamped) / total);
          await options?.yieldIfNeeded?.(subLabel);
        },
      };

      const res = mod.buildAsync ? await mod.buildAsync(scopedCtx) : mod.build(scopedCtx);
      if (mod.variations && mod.variations.length > 0) {
        ctx.variations?.registerAll(mod.variations);
      }
      if (res.switchLedMats) {
        merged = { ...merged, switchLedMats: { ...merged.switchLedMats, ...res.switchLedMats } };
      }
      if (res.sensorLedMats) {
        merged = { ...merged, sensorLedMats: { ...merged.sensorLedMats, ...res.sensorLedMats } };
      }
      if (res.displayMats) {
        merged = { ...merged, displayMats: { ...merged.displayMats, ...res.displayMats } };
      }
      await options?.onProgress?.(baseLabel, (i + 1) / total);
      await options?.yieldIfNeeded?.();
    }
    return merged;
  }
}
