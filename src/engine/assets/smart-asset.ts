/**
 * Zero-`ctx` Self-Contained Smart Asset Trait System.
 *
 * Encapsulates:
 *  - `AssetMetadata` (brand, SKU, finish, dimensions, productUrl, schematicUrl, links, price)
 *  - `AssetInteractionSpec` (`'hinge' | 'slide' | 'toggle' | 'custom'` + spatial foley/loop audio)
 *  - Idempotent auto-discovery (`bindSmartAssetsInScene`)
 *  - Live Bill-of-Materials & Schematic schedule extraction (`collectSceneAssetSchedule`)
 *
 * All attachments store state strictly in `WeakMap<THREE.Object3D, ...>` with zero `userData`
 * mutations so `SceneFingerprinter` snapshots remain 100% untouched when no scene geometry changes.
 */
import * as THREE from 'three';
import type {
  AssetMetadata,
  AssetScheduleEntry,
  AssetScheduleOptions,
  AssetScheduleReport,
} from '../../core/assets/asset-metadata.ts';
import type { ContinuousAudioPreset, FoleyAudioPreset } from '../../core/types/acoustics.ts';
import type { Vec3Tuple } from '../../core/types/scene.ts';
import type { SoundSynthToolkit } from '../audio/sound-engine.ts';
import {
  attachAudioEmitter,
  getAttachedAudioEmitters,
  type AudioEmitterHandle,
} from '../audio/spatial-emitters.ts';
import type { InteractionTarget } from '../geometry/mesh-traits.ts';
import { InteractionRegistry } from '../interaction/interaction-registry.ts';
import { getRoomZoneRegistrations } from '../rooms/room-zone-registry.ts';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface AssetInteractionAudio {
  /** One-shot spatial foley played on open / activation. */
  readonly openPreset?: FoleyAudioPreset;
  /** One-shot spatial foley played on close / deactivation (defaults to `openPreset` if omitted). */
  readonly closePreset?: FoleyAudioPreset;
  /** Continuous spatial audio bed active while `active === true` (e.g. `'waterTapFlow'`). */
  readonly activeLoopPreset?: ContinuousAudioPreset;
  readonly volume?: number;
  readonly refDistance?: number;
  readonly maxDistance?: number;
  readonly isExterior?: boolean;
  /** Optional custom Web Audio procedural recipe on toggle/trigger. */
  readonly recipe?: (toolkit: SoundSynthToolkit, active: boolean) => void;
}

export interface AssetHingeInteractionSpec {
  readonly kind: 'hinge';
  readonly id?: string;
  readonly label: string;
  /** Hinge pivot offset in parent/target space (`[dx, dy, dz]`). When `[0, 0, 0]`, rotates `target` directly around its local origin without wrapping a new parent group! */
  readonly pivotOffset: Vec3Tuple;
  readonly axis?: 'x' | 'y' | 'z';
  readonly openAngle: number;
  readonly initialAngle?: number;
  readonly speed?: number;
  readonly walkthroughBarge?: boolean;
  readonly acousticPortal?: boolean;
  /** Optional pair/group key within the owning asset (or scene) so paired doors open together. */
  readonly linkGroup?: string;
  readonly audio?: AssetInteractionAudio;
}

export interface AssetSlideInteractionSpec {
  readonly kind: 'slide';
  readonly id?: string;
  readonly label: string;
  readonly slideDelta: Vec3Tuple;
  readonly speed?: number;
  readonly acousticPortal?: boolean;
  readonly audio?: AssetInteractionAudio;
}

export interface AssetToggleStepState {
  readonly active: boolean;
  readonly progress: number;
  readonly elapsedActiveSec: number;
}

export interface AssetToggleInteractionSpec {
  readonly kind: 'toggle' | 'custom';
  readonly id?: string;
  readonly label: string;
  /** Optional active-state label (e.g. `"Turn Off Tap"` when active vs `"Turn On Tap"` when idle). */
  readonly activeLabel?: string;
  readonly initialActive?: boolean;
  readonly speed?: number;
  /** Optional auto-off duration in seconds (e.g. `6.0` for an espresso shot or `2.4` for a cistern lever return). */
  readonly autoResetAfterSec?: number;
  /** Optional explicit clickable sub-targets (defaults to `targetMeshOrGroup` and its descendant meshes). */
  readonly clickableTargets?: readonly THREE.Object3D[];
  /** Optional extra animated roots to unbatch & mark dynamic when triggered. */
  readonly dynamicTargets?: readonly THREE.Object3D[];
  readonly onToggle?: (active: boolean, obj: THREE.Object3D) => void;
  readonly onStep?: (dtSeconds: number, state: AssetToggleStepState, obj: THREE.Object3D) => boolean | void;
  readonly audio?: AssetInteractionAudio;
}

export type AssetInteractionSpec =
  | AssetHingeInteractionSpec
  | AssetSlideInteractionSpec
  | AssetToggleInteractionSpec;

export interface AttachedAssetInteractionRecord {
  readonly target: THREE.Object3D;
  readonly spec: AssetInteractionSpec;
}

export interface ResolvedAssetMetadataHit {
  readonly root: THREE.Object3D;
  readonly metadata: AssetMetadata;
}

// -----------------------------------------------------------------------------
// WeakMap Storage (Zero userData key mutations!)
// -----------------------------------------------------------------------------

const metadataMap = new WeakMap<THREE.Object3D, AssetMetadata>();
const interactionSpecsMap = new WeakMap<THREE.Object3D, AssetInteractionSpec[]>();
const boundSpecsByRegistry = new WeakMap<InteractionRegistry, WeakSet<AssetInteractionSpec>>();

function getParentOrBatchParent(obj: THREE.Object3D): THREE.Object3D | null {
  const savedParent = (obj.userData as Record<string, unknown> | undefined)?.__batchOriginalParent as
    | THREE.Object3D
    | undefined;
  return savedParent ?? obj.parent;
}

function resolveRegistry(target: InteractionTarget): InteractionRegistry {
  if (target instanceof InteractionRegistry) {
    return target;
  }
  return target.interactions;
}

function getBoundSet(registry: InteractionRegistry): WeakSet<AssetInteractionSpec> {
  let set = boundSpecsByRegistry.get(registry);
  if (!set) {
    set = new WeakSet<AssetInteractionSpec>();
    boundSpecsByRegistry.set(registry, set);
  }
  return set;
}

// -----------------------------------------------------------------------------
// Public Metadata API
// -----------------------------------------------------------------------------

/**
 * Attaches product, finish, dimensional, and technical schematic metadata to `object3d`
 * in a `WeakMap` (zero `userData` mutation) and returns `object3d` for fluent chaining.
 */
export function attachAssetMetadata<T extends THREE.Object3D>(
  object3d: T,
  metadata: AssetMetadata
): T {
  const frozen: AssetMetadata = Object.freeze({
    ...metadata,
    ...(metadata.dimensionsMm ? { dimensionsMm: Object.freeze([...metadata.dimensionsMm]) as readonly [number, number, number] } : {}),
    ...(metadata.links ? { links: Object.freeze(metadata.links.map((l) => Object.freeze({ ...l }))) } : {}),
    ...(metadata.price ? { price: Object.freeze({ ...metadata.price }) } : {}),
  });
  metadataMap.set(object3d, frozen);
  return object3d;
}

/** Returns metadata attached directly to `object3d` without walking ancestors. */
export function getDirectAssetMetadata(object3d: THREE.Object3D | null | undefined): AssetMetadata | null {
  if (!object3d) return null;
  return metadataMap.get(object3d) ?? null;
}

/**
 * Walks up the parent chain (including `__batchOriginalParent` for static-batched sub-meshes)
 * from any clicked child mesh to resolve the nearest owning asset root and its `AssetMetadata`.
 */
export function resolveAssetMetadataHit(
  object3d: THREE.Object3D | null | undefined
): ResolvedAssetMetadataHit | null {
  let cur: THREE.Object3D | null | undefined = object3d;
  while (cur) {
    const meta = metadataMap.get(cur);
    if (meta) {
      return { root: cur, metadata: meta };
    }
    cur = getParentOrBatchParent(cur);
  }
  return null;
}

/**
 * Walks up the parent chain from `object3d` (any child mesh or the asset root itself)
 * and returns the nearest `AssetMetadata`, or `null` if none is attached.
 */
export function getAssetMetadata(object3d: THREE.Object3D | null | undefined): AssetMetadata | null {
  return resolveAssetMetadataHit(object3d)?.metadata ?? null;
}

// -----------------------------------------------------------------------------
// Public Interaction Attachment & Auto-Discovery API
// -----------------------------------------------------------------------------

/**
 * Attaches a declarative, zero-`ctx` interaction specification (plus optional spatial foley /
 * active loop audio) directly onto `targetMeshOrGroup` in a `WeakMap`.
 */
export function attachAssetInteraction<T extends THREE.Object3D>(
  targetMeshOrGroup: T,
  spec: AssetInteractionSpec
): AssetInteractionSpec {
  let list = interactionSpecsMap.get(targetMeshOrGroup);
  if (!list) {
    list = [];
    interactionSpecsMap.set(targetMeshOrGroup, list);
  }
  list.push(spec);
  return spec;
}

/**
 * Marks an `AssetInteractionSpec` as already bound on `target` (used by hybrid catalog builders
 * when `ctx` is explicitly passed so `bindSmartAssetsInScene` skips re-binding idempotently),
 * and wires any `spec.audio` override onto the legacy interactable ID!
 */
export function markAssetInteractionBound(
  target: InteractionTarget,
  spec: AssetInteractionSpec,
  legacyInteractableId?: string
): void {
  const registry = resolveRegistry(target);
  getBoundSet(registry).add(spec);
  if (legacyInteractableId && spec.audio) {
    registry.setInteractableAudioOverride(legacyInteractableId, spec.audio);
  }
}

/** Returns all `AssetInteractionSpec`s attached to `root` and any of its descendants. */
export function getAttachedAssetInteractions(
  root: THREE.Object3D
): readonly AttachedAssetInteractionRecord[] {
  const out: AttachedAssetInteractionRecord[] = [];
  root.traverse((obj) => {
    const specs = interactionSpecsMap.get(obj);
    if (specs) {
      for (let i = 0; i < specs.length; i++) {
        out.push({ target: obj, spec: specs[i]! });
      }
    }
  });
  return out;
}

export interface BindSmartAssetsResult {
  readonly boundInteractions: number;
  readonly registeredAudioEmitters: number;
}

/**
 * Walks `sceneOrSubtree` once and idempotently binds any unbound `attachAssetInteraction`
 * and `attachAudioEmitter` attachments into `target` (`InteractionRegistry` or `SceneBuilderContext`).
 *
 * Safe to invoke repeatedly after `buildAllZones(ctx)` or after dynamically adding smart assets
 * to a live scene (`scene.add(asset)`).
 */
export function bindSmartAssetsInScene(
  sceneOrSubtree: THREE.Object3D,
  target: InteractionTarget
): BindSmartAssetsResult {
  const registry = resolveRegistry(target);
  const boundSet = getBoundSet(registry);

  let boundInteractions = 0;
  let registeredAudioEmitters = 0;

  // Group linked hinge doors by `(owningAssetRoot ?? sceneOrSubtree)` + `linkGroup`
  const pendingLinkGroups = new Map<THREE.Object3D, Map<string, string[]>>();

  const pendingRecords: AttachedAssetInteractionRecord[] = [];
  sceneOrSubtree.traverse((obj) => {
    const specs = interactionSpecsMap.get(obj);
    if (specs) {
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]!;
        if (!boundSet.has(spec)) {
          pendingRecords.push({ target: obj, spec });
        }
      }
    }
  });

  for (let i = 0; i < pendingRecords.length; i++) {
    const { target: obj, spec } = pendingRecords[i]!;
    if (boundSet.has(spec)) continue;
    boundSet.add(spec);

    let activeLoopEmitter: AudioEmitterHandle | null = null;
    if (spec.audio?.activeLoopPreset) {
      activeLoopEmitter = attachAudioEmitter(obj, {
        kind: 'continuous',
        preset: spec.audio.activeLoopPreset,
        autoplay: spec.kind === 'toggle' || spec.kind === 'custom' ? Boolean(spec.initialActive) : false,
        volume: spec.audio.volume ?? 0.85,
        refDistance: spec.audio.refDistance ?? 1.4,
        maxDistance: spec.audio.maxDistance ?? 16,
        ...(spec.audio.isExterior !== undefined ? { isExterior: spec.audio.isExterior } : {}),
      });
      registry.registerSmartAudioEmitter(activeLoopEmitter);
      registeredAudioEmitters++;
    }

    const smartId = registry.registerSmartInteraction(obj, spec, activeLoopEmitter);
    boundInteractions++;

    if (spec.kind === 'hinge' && spec.linkGroup) {
      const ownerRoot = resolveAssetMetadataHit(obj)?.root ?? sceneOrSubtree;
      let byGroup = pendingLinkGroups.get(ownerRoot);
      if (!byGroup) {
        byGroup = new Map<string, string[]>();
        pendingLinkGroups.set(ownerRoot, byGroup);
      }
      let ids = byGroup.get(spec.linkGroup);
      if (!ids) {
        ids = [];
        byGroup.set(spec.linkGroup, ids);
      }
      ids.push(smartId);
    }
  }

  for (const byGroup of pendingLinkGroups.values()) {
    for (const ids of byGroup.values()) {
      if (ids.length >= 2) {
        for (let i = 0; i + 1 < ids.length; i += 2) {
          registry.linkSmartHingePair(ids[i]!, ids[i + 1]!);
        }
      }
    }
  }

  const emitters = getAttachedAudioEmitters(sceneOrSubtree);
  for (let i = 0; i < emitters.length; i++) {
    if (registry.registerSmartAudioEmitter(emitters[i]!)) {
      registeredAudioEmitters++;
    }
  }

  return { boundInteractions, registeredAudioEmitters };
}

// -----------------------------------------------------------------------------
// Procurement & Schematic Schedule Extractor
// -----------------------------------------------------------------------------

const tmpSchedulePos = new THREE.Vector3();

function inferZoneForObject(
  obj: THREE.Object3D,
  getZoneLabel?: (zoneId: string) => string
): string {
  for (let cur: THREE.Object3D | null = obj; cur !== null; cur = getParentOrBatchParent(cur)) {
    const u = cur.userData as Record<string, unknown> | undefined;
    if (typeof u?.zoneId === 'string' && u.zoneId.length > 0) {
      return getZoneLabel ? getZoneLabel(u.zoneId) : u.zoneId;
    }
  }

  const registrations = getRoomZoneRegistrations();
  if (registrations.length > 0) {
    obj.getWorldPosition(tmpSchedulePos);
    const wx = tmpSchedulePos.x;
    const wy = tmpSchedulePos.y;
    const wz = tmpSchedulePos.z;
    for (let i = 0; i < registrations.length; i++) {
      const r = registrations[i]!;
      if (r.excludedCutout?.(wx, wz)) continue;
      let lx = wx;
      let ly = wy;
      let lz = wz;
      if (r.obb) {
        const dx = wx - r.obb.offset[0];
        const dz = wz - r.obb.offset[2];
        const cosY = Math.cos(r.obb.rotationY);
        const sinY = Math.sin(r.obb.rotationY);
        lx = dx * cosY - dz * sinY;
        ly = wy - r.obb.offset[1];
        lz = dx * sinY + dz * cosY;
      }
      const b = r.obb ? r.obb.bounds : r.bounds;
      if (
        lx >= b.minX - 0.15 &&
        lx <= b.maxX + 0.15 &&
        ly >= b.minY - 0.25 &&
        ly <= b.maxY + 0.35 &&
        lz >= b.minZ - 0.15 &&
        lz <= b.maxZ + 0.15
      ) {
        return getZoneLabel ? getZoneLabel(r.zoneId) : r.zoneId;
      }
    }
  }

  for (let cur: THREE.Object3D | null = obj; cur !== null; cur = getParentOrBatchParent(cur)) {
    const u = cur.userData as Record<string, unknown> | undefined;
    if (typeof u?.floorId === 'string' && u.floorId.length > 0) {
      return u.floorId;
    }
  }
  return 'unassigned';
}

/**
 * Traverses any built house scene (or subtree), discovers all placed smart assets carrying
 * `AssetMetadata`, deduplicates/counts them by `(sku, name, finish[, zone])`, and returns a
 * structured Bill-of-Materials & Technical Schematic schedule report.
 */
export function collectSceneAssetSchedule(
  scene: THREE.Object3D,
  options: AssetScheduleOptions = {}
): AssetScheduleReport {
  scene.updateMatrixWorld(true);
  const groupByZone = options.groupByZone ?? false;

  interface MutableBucket {
    readonly key: string;
    readonly meta: AssetMetadata;
    quantity: number;
    readonly zonesSet: Set<string>;
    readonly primaryZone?: string;
  }

  const buckets = new Map<string, MutableBucket>();
  let totalPlacedAssets = 0;

  // Walk hierarchy; when a parent asset embeds a sub-asset that also carries its own metadata
  // (e.g. a washstand that embeds a deck mixer tap, or a bespoke bathroom with standalone taps),
  // both are counted unless they are literally the same Object3D.
  scene.traverse((obj) => {
    const meta = metadataMap.get(obj);
    if (!meta) return;

    totalPlacedAssets++;
    const zone = inferZoneForObject(obj, options.getZoneLabel);
    const keyParts = [
      meta.sku ?? '',
      meta.brand ?? '',
      meta.name,
      meta.finish ?? '',
      ...(groupByZone ? [zone] : []),
    ];
    const key = keyParts.join('|');

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        meta,
        quantity: 0,
        zonesSet: new Set<string>(),
        ...(groupByZone ? { primaryZone: zone } : {}),
      };
      buckets.set(key, bucket);
    }
    bucket.quantity += 1;
    bucket.zonesSet.add(zone);
  });

  const entries: AssetScheduleEntry[] = Array.from(buckets.values())
    .map((b) => {
      const m = b.meta;
      const zones = Array.from(b.zonesSet).sort();
      return {
        key: b.key,
        name: m.name,
        ...(m.brand !== undefined ? { brand: m.brand } : {}),
        ...(m.collection !== undefined ? { collection: m.collection } : {}),
        ...(m.sku !== undefined ? { sku: m.sku } : {}),
        ...(m.finish !== undefined ? { finish: m.finish } : {}),
        ...(m.category !== undefined ? { category: m.category } : {}),
        ...(m.dimensionsMm !== undefined ? { dimensionsMm: m.dimensionsMm } : {}),
        ...(m.productUrl !== undefined ? { productUrl: m.productUrl } : {}),
        ...(m.schematicUrl !== undefined ? { schematicUrl: m.schematicUrl } : {}),
        ...(m.links !== undefined ? { links: m.links } : {}),
        ...(m.price !== undefined ? { unitPrice: m.price } : {}),
        quantity: b.quantity,
        zones,
        ...(b.primaryZone !== undefined ? { primaryZone: b.primaryZone } : {}),
      };
    })
    .sort((a, b) => {
      if (groupByZone && (a.primaryZone ?? '') !== (b.primaryZone ?? '')) {
        return (a.primaryZone ?? '').localeCompare(b.primaryZone ?? '');
      }
      const catCmp = (a.category ?? 'zzz').localeCompare(b.category ?? 'zzz');
      if (catCmp !== 0) return catCmp;
      const brandCmp = (a.brand ?? '').localeCompare(b.brand ?? '');
      if (brandCmp !== 0) return brandCmp;
      return a.name.localeCompare(b.name);
    });

  return {
    ...(options.houseId !== undefined ? { houseId: options.houseId } : {}),
    ...(options.houseName !== undefined ? { houseName: options.houseName } : {}),
    groupByZone,
    totalPlacedAssets,
    uniqueEntries: entries.length,
    entries,
  };
}
