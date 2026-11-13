import * as THREE from 'three';
import { NodeMaterial, PointsNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import type { TradeView } from '../../core/types/twin-ux.ts';
import { classifyObject, isRenderableObject, type TradeCategory } from './trade-classifier.ts';
import { TRADE_CATEGORY_COLORS, TRADE_VIEW_PROFILES, type TradeDisplayMode } from './trade-view-profiles.ts';
import { ServiceScheduleIndex, type ServicePoint } from './service-labels.ts';

/** Opacity multiplier for ghosted geometry. */
export const TRADE_GHOST_OPACITY = 0.12;
/** Emissive intensity used to tint highlighted geometry. */
export const TRADE_HIGHLIGHT_EMISSIVE_INTENSITY = 0.55;
/**
 * Layer used to hide geometry. The app's cameras and raycasters only use layer 0, and
 * `WebGLShadowMap` tests object layers against the main camera, so moving an object onto this layer
 * removes it from colour, shadow and picking passes without fighting the LOD / floor-mode systems
 * that own `Object3D.visible`.
 */
export const TRADE_HIDDEN_LAYER = 31;

type Renderable = THREE.Mesh | THREE.Line | THREE.Points;
type MaterialSlot = THREE.Material | THREE.Material[];

interface EmissiveMaterial extends THREE.Material {
  emissive: THREE.Color;
  emissiveIntensity: number;
  emissiveMap: THREE.Texture | null;
}

interface ColorMaterial extends THREE.Material {
  color: THREE.Color;
}

function hasEmissive(m: THREE.Material): m is EmissiveMaterial {
  const r = m as Partial<EmissiveMaterial>;
  return r.emissive instanceof THREE.Color && typeof r.emissiveIntensity === 'number';
}

function hasColor(m: THREE.Material): m is ColorMaterial {
  return (m as Partial<ColorMaterial>).color instanceof THREE.Color;
}

interface CustomNodeShaderMaterial extends THREE.Material {
  readonly isShaderMaterial?: boolean;
  readonly isPointsNodeMaterial?: boolean;
  readonly isSpriteNodeMaterial?: boolean;
  fragmentNode?: unknown;
  outputNode?: unknown;
  vertexNode?: unknown;
  positionNode?: unknown;
  aoNode?: unknown;
  envNode?: unknown;
  lightsNode?: unknown;
  normalNode?: unknown;
  roughnessNode?: unknown;
  metalnessNode?: unknown;
  colorNode?: unknown;
  emissiveNode?: unknown;
}

function isCustomShader(m: THREE.Material): boolean {
  if (m instanceof PointsNodeMaterial || m instanceof SpriteNodeMaterial) {
    return true;
  }
  const n = m as CustomNodeShaderMaterial;
  if (n.isShaderMaterial || n.isPointsNodeMaterial || n.isSpriteNodeMaterial) {
    return true;
  }
  if (
    n.fragmentNode != null ||
    n.outputNode != null ||
    n.vertexNode != null ||
    n.positionNode != null
  ) {
    return true;
  }
  if (m instanceof NodeMaterial && !hasColor(m) && !hasEmissive(m)) {
    return true;
  }
  return false;
}

function copyTslMaterialNodes(
  source: THREE.Material,
  target: THREE.Material,
  includeColorAndEmissive: boolean
): void {
  const src = source as CustomNodeShaderMaterial;
  const dst = target as CustomNodeShaderMaterial;
  if (src.aoNode !== undefined) dst.aoNode = src.aoNode;
  if (src.envNode !== undefined) dst.envNode = src.envNode;
  if (src.lightsNode !== undefined) dst.lightsNode = src.lightsNode;
  if (src.normalNode !== undefined) dst.normalNode = src.normalNode;
  if (src.roughnessNode !== undefined) dst.roughnessNode = src.roughnessNode;
  if (src.metalnessNode !== undefined) dst.metalnessNode = src.metalnessNode;
  if (includeColorAndEmissive) {
    if (src.colorNode !== undefined) dst.colorNode = src.colorNode;
    if (src.emissiveNode !== undefined) dst.emissiveNode = src.emissiveNode;
  }
}

interface RenderableRecord {
  readonly obj: Renderable;
  readonly category: TradeCategory;
  originalMaterial: MaterialSlot;
  originalCastShadow: boolean;
  originalLayersMask: number;
  /** What this controller last assigned (null = untouched / owner state). */
  appliedMaterial: MaterialSlot | null;
  appliedCastShadow: boolean;
  appliedLayersMask: number;
  mode: TradeDisplayMode;
}

export interface TradeViewControllerOptions {
  readonly roots: readonly THREE.Object3D[];
  readonly requestRender: () => void;
  readonly invalidateShadows: () => void;
}

/**
 * Applies trade-view overlays (ghost / hidden / highlight per {@link TradeCategory}) to the live scene.
 *
 * Fully reversible: every material, `castShadow` flag and layer mask that is changed is recorded and
 * restored exactly when returning to the `owner` view (or on {@link suspend} / {@link dispose}).
 * Light objects and light intensities are never modified.
 *
 * Interaction with `SceneBatchOptimizer`: call {@link suspend} before `optimize()` / `unbatchAll()`
 * and {@link resume} afterwards (re-indexes the new mesh tree and re-applies the current view).
 */
export class TradeViewController {
  private readonly roots: readonly THREE.Object3D[];
  private readonly requestRender: () => void;
  private readonly invalidateShadows: () => void;

  private view: TradeView = 'owner';
  private records: RenderableRecord[] = [];
  private recordByObject = new Map<THREE.Object3D, RenderableRecord>();
  private readonly ghostBySource = new Map<THREE.Material, THREE.Material>();
  private readonly highlightBySource = new Map<TradeCategory, Map<THREE.Material, THREE.Material>>();
  private readonly sourceByClone = new Map<THREE.Material, THREE.Material>();
  private readonly categoryCounts = new Map<TradeCategory, number>();
  private readonly services = new ServiceScheduleIndex();
  private suspended = false;
  private indexed = false;
  private disposed = false;

  public constructor(options: TradeViewControllerOptions) {
    this.roots = options.roots;
    this.requestRender = options.requestRender;
    this.invalidateShadows = options.invalidateShadows;
  }

  /**
   * Traverses the roots, classifies every renderable and caches its original render state.
   * Safe to call repeatedly (e.g. after batching changes); the current view is re-applied.
   */
  public indexScene(): void {
    if (this.disposed) return;
    this.restoreAll();
    this.records = [];
    this.recordByObject = new Map();
    this.categoryCounts.clear();

    const visit = (node: THREE.Object3D): void => {
      if (node.name === '__hus_fitting_halos__') return;
      const u = node.userData as Record<string, unknown> | undefined;
      if (
        u &&
        (u['isAnnotationGroup'] ||
          u['isSecurityFovCone'] ||
          u['tradeViewIgnore'] ||
          u['isFittingHaloCloud'])
      ) {
        return;
      }
      if (isRenderableObject(node) && !(node instanceof THREE.Sprite)) {
        const category = classifyObject(node);
        const original = this.toSourceSlot(node.material as MaterialSlot);
        if (original !== node.material) node.material = original;
        const record: RenderableRecord = {
          obj: node,
          category,
          originalMaterial: original,
          originalCastShadow: node.castShadow,
          originalLayersMask: node.layers.mask,
          appliedMaterial: null,
          appliedCastShadow: node.castShadow,
          appliedLayersMask: node.layers.mask,
          mode: 'normal',
        };
        this.records.push(record);
        this.recordByObject.set(node, record);
        this.categoryCounts.set(category, (this.categoryCounts.get(category) ?? 0) + 1);
      }
      for (const child of node.children) visit(child);
    };
    for (const root of this.roots) visit(root);
    this.indexed = true;
    if (!this.suspended) this.applyCurrentView();
  }

  /**
   * Snapshots service-point positions (sockets, switches, fittings, sanitaryware, manifold...) for
   * schedule export. Call while the scene is UNBATCHED (before the first `optimize()`), since
   * batching merges small devices into shared draw calls.
   */
  public captureServicePoints(): void {
    this.services.capture(this.roots);
  }

  public collectServicePoints(view: TradeView = this.view): ServicePoint[] {
    if (!this.services.hasCapture()) this.services.capture(this.roots);
    return this.services.collect(view);
  }

  public exportServiceScheduleCsv(view: TradeView = this.view): string {
    if (!this.services.hasCapture()) this.services.capture(this.roots);
    return this.services.exportCsv(view);
  }

  public setView(view: TradeView): void {
    if (this.disposed) return;
    if (!this.indexed) this.indexScene();
    this.view = view;
    if (this.suspended) return;
    this.applyCurrentView();
  }

  public getView(): TradeView {
    return this.view;
  }

  /** Category assigned to a renderable at the last {@link indexScene}. */
  public getCategory(obj: THREE.Object3D): TradeCategory | undefined {
    return this.recordByObject.get(obj)?.category;
  }

  public getCategoryCounts(): ReadonlyMap<TradeCategory, number> {
    return this.categoryCounts;
  }

  /** Restores original render state without forgetting the selected view (use around batching). */
  public suspend(): void {
    if (this.suspended) return;
    this.restoreAll();
    this.suspended = true;
  }

  /** Re-indexes the (possibly re-batched) scene and re-applies the selected view. */
  public resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.indexScene();
  }

  public dispose(): void {
    if (this.disposed) return;
    const hadChanges = this.restoreAll();
    this.disposed = true;
    const disposed = new Set<THREE.Material>();
    for (const clone of this.sourceByClone.keys()) {
      if (!disposed.has(clone)) {
        clone.dispose();
        disposed.add(clone);
      }
    }
    this.sourceByClone.clear();
    this.ghostBySource.clear();
    this.highlightBySource.clear();
    this.records = [];
    this.recordByObject.clear();
    if (hadChanges) {
      this.invalidateShadows();
      this.requestRender();
    }
  }

  private applyCurrentView(): void {
    const profile = TRADE_VIEW_PROFILES[this.view];
    let changed = false;
    for (const rec of this.records) {
      this.syncExternalChanges(rec);
      const mode = profile[rec.category];
      if (mode === rec.mode && rec.appliedMaterial !== null) continue;
      if (mode === 'normal' && rec.mode === 'normal') continue;
      this.applyMode(rec, mode);
      changed = true;
    }
    if (changed) {
      this.invalidateShadows();
      this.requestRender();
    }
  }

  /**
   * If another system (UFH overlay, LOD shadow culling, cutaways...) replaced a material or toggled
   * shadows while an overlay was active, adopt that as the new "original" so we never resurrect stale state.
   */
  private syncExternalChanges(rec: RenderableRecord): void {
    const obj = rec.obj;
    const expectedMaterial = rec.appliedMaterial ?? rec.originalMaterial;
    if (obj.material !== expectedMaterial) {
      rec.originalMaterial = this.toSourceSlot(obj.material as MaterialSlot);
      rec.appliedMaterial = null;
      rec.mode = 'normal';
      obj.material = rec.originalMaterial;
    }
    if (obj.castShadow !== rec.appliedCastShadow) {
      rec.originalCastShadow = obj.castShadow;
      rec.appliedCastShadow = obj.castShadow;
    }
    if (obj.layers.mask !== rec.appliedLayersMask) {
      rec.originalLayersMask = obj.layers.mask;
      rec.appliedLayersMask = obj.layers.mask;
    }
  }

  private applyMode(rec: RenderableRecord, mode: TradeDisplayMode): void {
    const obj = rec.obj;
    let material: MaterialSlot = rec.originalMaterial;
    let castShadow = rec.originalCastShadow;
    let layersMask = rec.originalLayersMask;
    if (mode === 'ghost') {
      material = this.mapSlot(rec.originalMaterial, (m) => this.getGhost(m));
      castShadow = false;
    } else if (mode === 'highlight') {
      material = this.mapSlot(rec.originalMaterial, (m) => this.getHighlight(m, rec.category));
    } else if (mode === 'hidden') {
      layersMask = (1 << TRADE_HIDDEN_LAYER) >>> 0;
      castShadow = false;
    }
    obj.material = material;
    obj.castShadow = castShadow;
    obj.layers.mask = layersMask;
    rec.appliedMaterial = mode === 'normal' ? null : material;
    rec.appliedCastShadow = castShadow;
    rec.appliedLayersMask = layersMask;
    rec.mode = mode;
  }

  /** Restores every touched record to its original state. Returns true if anything changed. */
  private restoreAll(): boolean {
    let changed = false;
    for (const rec of this.records) {
      this.syncExternalChanges(rec);
      if (rec.mode === 'normal' && rec.appliedMaterial === null) continue;
      rec.obj.material = rec.originalMaterial;
      rec.obj.castShadow = rec.originalCastShadow;
      rec.obj.layers.mask = rec.originalLayersMask;
      rec.appliedMaterial = null;
      rec.appliedCastShadow = rec.originalCastShadow;
      rec.appliedLayersMask = rec.originalLayersMask;
      rec.mode = 'normal';
      changed = true;
    }
    if (changed) {
      this.invalidateShadows();
      this.requestRender();
    }
    return changed;
  }

  private mapSlot(slot: MaterialSlot, fn: (m: THREE.Material) => THREE.Material): MaterialSlot {
    if (Array.isArray(slot)) return slot.map(fn);
    return fn(slot);
  }

  private toSourceSlot(slot: MaterialSlot): MaterialSlot {
    if (Array.isArray(slot)) {
      let anyClone = false;
      const mapped = slot.map((m) => {
        const src = this.sourceByClone.get(m);
        if (src) anyClone = true;
        return src ?? m;
      });
      return anyClone ? mapped : slot;
    }
    return this.sourceByClone.get(slot) ?? slot;
  }

  private getGhost(source: THREE.Material): THREE.Material {
    if (isCustomShader(source)) return source;
    let ghost = this.ghostBySource.get(source);
    if (!ghost) {
      ghost = source.clone();
      copyTslMaterialNodes(source, ghost, true);
      ghost.transparent = true;
      ghost.opacity = Math.min(1, source.opacity) * TRADE_GHOST_OPACITY;
      ghost.depthWrite = false;
      if (
        ghost instanceof THREE.MeshPhysicalMaterial ||
        (ghost as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial
      ) {
        (ghost as THREE.MeshPhysicalMaterial).transmission = 0;
      }
      ghost.userData = { ...source.userData, isTradeViewGhost: true };
      this.ghostBySource.set(source, ghost);
      this.sourceByClone.set(ghost, source);
    }
    return ghost;
  }

  private getHighlight(source: THREE.Material, category: TradeCategory): THREE.Material {
    if (isCustomShader(source)) return source;
    let byCat = this.highlightBySource.get(category);
    if (!byCat) {
      byCat = new Map();
      this.highlightBySource.set(category, byCat);
    }
    let hl = byCat.get(source);
    if (!hl) {
      const tint = new THREE.Color(TRADE_CATEGORY_COLORS[category]);
      if (hasEmissive(source)) {
        // Already-glowing materials (live lamp emissives driven by KNX) are left untouched so
        // their on/off state stays live.
        const glowing = source.emissiveIntensity > 0 && source.emissive.getHex() !== 0;
        if (glowing) {
          byCat.set(source, source);
          return source;
        }
        const clone = source.clone() as EmissiveMaterial;
        copyTslMaterialNodes(source, clone, false);
        clone.emissive.copy(tint);
        clone.emissiveIntensity = TRADE_HIGHLIGHT_EMISSIVE_INTENSITY;
        clone.emissiveMap = null;
        if (hasColor(clone)) clone.color.lerp(tint, 0.25);
        hl = clone;
      } else if (hasColor(source)) {
        const clone = source.clone() as ColorMaterial;
        copyTslMaterialNodes(source, clone, false);
        clone.color.lerp(tint, 0.6);
        hl = clone;
      } else {
        byCat.set(source, source);
        return source;
      }
      hl.userData = { ...source.userData, isTradeViewHighlight: true };
      byCat.set(source, hl);
      this.sourceByClone.set(hl, source);
    }
    return hl;
  }
}
