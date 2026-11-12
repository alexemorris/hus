import * as THREE from 'three';
import type { LightGroupMap, BifoldPanelRef, ZoneIndicatorMaterials } from '../scene-types.ts';
import type { RoomLodController } from '../../lod/lod-manager.ts';
import { SceneBatchOptimizer } from '../../rendering/scene-batch-optimizer.ts';
import type { TradeViewController } from '../../trade-views/index.ts';
import type { CutawayController } from '../../cutaway/cutaway-controller.ts';
import type { PropertySceneLayers, RoomSwitchLedBinding } from '../scene-content.ts';
import type { ViewerRenderer } from './viewer-renderer.ts';

export interface StaticSceneServiceHost {
  readonly scene: THREE.Scene;
  readonly layers: PropertySceneLayers;
  readonly renderer: ViewerRenderer;
  readonly lodController: RoomLodController;
  readonly lightGroups: LightGroupMap;
  readonly indicatorMats: ZoneIndicatorMaterials;
  readonly roomSwitchLedMats: readonly RoomSwitchLedBinding[];
  /** Shared, live array of clickable device meshes — passed by reference. */
  readonly interactiveMeshes: THREE.Object3D[];
  readonly getExtraInteractiveMeshes?: () => readonly THREE.Object3D[];
  readonly bifoldPanels: readonly BifoldPanelRef[];
  readonly tradeViews: TradeViewController;
  readonly cutaways: CutawayController;
  /** Objects that move at runtime and must keep matrix auto-update. */
  collectDynamicObjects(target: Set<THREE.Object3D>): void;
  /** Optional subset of continuously-moving objects excluded from initial static batching. */
  collectBatchExcludedObjects?(target: Set<THREE.Object3D>): void;
}

/** Shadow casters smaller than this world radius are not worth a shadow (m). */
const MIN_SHADOW_CASTER_RADIUS_M = 0.25;
const MAX_ANISOTROPY = 8;
/** Unbatched interior soft-furnishing / fitting casters safe to skip during active sun scrubbing. */
const SCRUB_DEFERRABLE_UNBATCHED_RE =
  /\.(kingCastIronBed\.footThrow|deepPileBathMat\.tuftedPile|beanbag\.|heritageReededMirror\.reededBrassFrame|diningTable\.extendedTabletop)$/;

/**
 * Static-scene optimisation: draw-call batching (`SceneBatchOptimizer`) and
 * matrix freezing / texture anisotropy / small-caster culling.
 */
export class StaticSceneService {
  public readonly batchOptimizer: SceneBatchOptimizer;
  private readonly host: StaticSceneServiceHost;
  private scrubDeferrableShadowCasters: THREE.Mesh[] = [];
  private interactiveScrubCastersSuppressed = false;

  public constructor(host: StaticSceneServiceHost) {
    this.host = host;
    this.batchOptimizer = new SceneBatchOptimizer({
      layers: host.layers,
      lodController: host.lodController,
      lightGroups: host.lightGroups,
      indicatorMats: host.indicatorMats,
      roomSwitchLedMats: host.roomSwitchLedMats,
      interactiveMeshes: host.interactiveMeshes,
      ...(host.getExtraInteractiveMeshes ? { getExtraInteractiveMeshes: host.getExtraInteractiveMeshes } : {}),
      bifoldPanels: host.bifoldPanels,
      getDynamicObjects: () => {
        const dynamicObjects = new Set<THREE.Object3D>();
        if (host.collectBatchExcludedObjects) {
          host.collectBatchExcludedObjects(dynamicObjects);
        } else {
          host.collectDynamicObjects(dynamicObjects);
        }
        return dynamicObjects;
      },
      onBeforeBatchChange: () => {
        host.tradeViews.suspend();
      },
      onAfterBatchChange: () => {
        host.cutaways.collectDynamicCutawayWalls();
        host.tradeViews.resume();
      },
    });
  }

  /**
   * Freezes world matrices of everything static, raises texture anisotropy and
   * drops shadows from tiny casters.
   */
  public freezeStaticMatrices(): void {
    const { scene } = this.host;
    scene.updateMatrixWorld(true);
    scene.matrixWorldAutoUpdate = false;
    const dynamicObjects = new Set<THREE.Object3D>();
    this.host.collectDynamicObjects(dynamicObjects);

    const maxAnisotropy = Math.min(MAX_ANISOTROPY, this.host.renderer.getMaxAnisotropy());
    if (this.interactiveScrubCastersSuppressed) {
      for (let i = 0; i < this.scrubDeferrableShadowCasters.length; i++) {
        this.scrubDeferrableShadowCasters[i]!.castShadow = true;
      }
    }
    const seenMaterials = new Set<THREE.Material>();
    const nextScrubDeferrable: THREE.Mesh[] = [];

    scene.traverse((obj) => {
      const isStaticObject = obj !== scene && !dynamicObjects.has(obj);
      if (isStaticObject) {
        obj.matrixAutoUpdate = false;
      }
      // Clear .static for 1 rendered frame so WebGPU RenderObject / Geometries / NodeMaterialObserver
      // always run updateForRender() on any newly restored or mutated meshes before locking .static = true.
      (obj as unknown as { static?: boolean }).static = false;
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const u = obj.userData as Record<string, unknown> | undefined;
      for (const mat of mats) {
        if (!mat || seenMaterials.has(mat)) continue;
        seenMaterials.add(mat);
        const stdMat = mat as THREE.MeshStandardMaterial;
        for (const tex of [stdMat.map, stdMat.normalMap, stdMat.roughnessMap, stdMat.bumpMap]) {
          if (tex && tex.anisotropy < maxAnisotropy && tex.anisotropy !== maxAnisotropy) {
            const isZeroSizedCanvas =
              typeof HTMLCanvasElement !== 'undefined' &&
              tex.image instanceof HTMLCanvasElement &&
              (tex.image.width === 0 || tex.image.height === 0);
            tex.anisotropy = maxAnisotropy;
            if (!isZeroSizedCanvas) {
              tex.needsUpdate = true;
            }
          }
        }
      }

      if (obj.castShadow) {
        if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
        const sphere = obj.geometry.boundingSphere;
        if (sphere) {
          const maxScale = Math.max(Math.abs(obj.scale.x), Math.abs(obj.scale.y), Math.abs(obj.scale.z));
          if (sphere.radius * maxScale < MIN_SHADOW_CASTER_RADIUS_M) obj.castShadow = false;
        }
        if (
          obj.castShadow &&
          (u?.lodTier === 1 || SCRUB_DEFERRABLE_UNBATCHED_RE.test(obj.name))
        ) {
          nextScrubDeferrable.push(obj);
          if (this.interactiveScrubCastersSuppressed) {
            obj.castShadow = false;
          }
        }
      }
    });
    this.scrubDeferrableShadowCasters = nextScrubDeferrable;
  }

  /**
   * Keeps architectural `LOD0` shells, roofs, windows, doors, vehicles, trees, hedges & terrain
   * casting crisp shadows during active scrubbing while skipping `LOD1` interior furniture batches.
   */
  public setInteractiveScrubShadowCasters(scrubActive: boolean): void {
    if (this.interactiveScrubCastersSuppressed === scrubActive) return;
    this.interactiveScrubCastersSuppressed = scrubActive;
    const nextCast = !scrubActive;
    for (let i = 0; i < this.scrubDeferrableShadowCasters.length; i++) {
      this.scrubDeferrableShadowCasters[i]!.castShadow = nextCast;
    }
  }

}
