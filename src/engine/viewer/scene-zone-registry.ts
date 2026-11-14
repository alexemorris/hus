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
 *
 * Home-agnostic: a home supplies its own module list (see
 * `homes/<home>/zone-modules.ts`). The registry aggregates camera presets and
 * interior room bounds from every registered module and builds them in order.
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

  /**
   * Appends fallback interior room AABBs when modules omit explicit `interiorBounds`.
   */
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

  /**
   * Synthesizes a `'top'` plan camera preset centered over the property's interior/room bounds
   * whenever the house omits an explicit `'top'` preset, so clicking `Plan` in `TopBar` always works.
   */
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
    // CameraRig uses ORTHO_HALF_HEIGHT = 5.6 (total height = 11.2m at zoom=1).
    const effectiveVertSpan = Math.max(spanZ, spanX / 1.45);
    const orthoZoom = Math.min(1.08, Math.max(0.28, (11.2 * 0.84) / effectiveVertSpan));
    const buildingId: BuildingId = this.modules[0]?.buildingId ?? ('mainHouse' as BuildingId);

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

  /**
   * Returns true if the 3D point (x, y, z) is inside any registered interior room.
   */
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

  /**
   * Returns true if both 3D points lie inside the exact same interior room bounding box.
   */
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
    let merged: ZoneIndicatorMaterials = {};
    for (const mod of this.modules) {
      const res = mod.build(ctx);
      if (mod.variations && mod.variations.length > 0) {
        ctx.variations?.registerAll(mod.variations);
      }
      merged = { ...merged, ...res };
    }
    return merged;
  }
}
