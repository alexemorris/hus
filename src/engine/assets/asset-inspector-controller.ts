import * as THREE from 'three';
import type {
  InspectedAssetAction,
  InspectedAssetSnapshot,
} from '../../core/assets/asset-metadata.ts';
import { getAttachedAudioEmitters, playFoleyAtObject } from '../audio/spatial-emitters.ts';
import type { RigCamera } from '../camera/camera-rig.ts';
import type { SceneInteractionManager } from '../interaction/interaction-manager.ts';
import { getRoomZoneRegistrations } from '../rooms/room-zone-registry.ts';
import { Emitter } from '../util/emitter.ts';
import { intersectVisibleObjects } from '../util/object-utils.ts';
import { resolveAssetMetadataHit } from './smart-asset.ts';

export interface AssetInspectorControllerHost {
  readonly scene: THREE.Scene;
  readonly interactions: SceneInteractionManager;
  setRayFromClient(clientX: number, clientY: number): THREE.Raycaster;
  isPickExcluded(mesh: THREE.Mesh): boolean;
  isWalkthroughActive(): boolean;
  deactivateOtherTools(): void;
  getRoomLabel?(zoneId: string): string | undefined;
  frameWorldBounds(min: THREE.Vector3, max: THREE.Vector3, center: THREE.Vector3): void;
  handleInteractable(id: string): boolean;
  requestRender(): void;
}

const tmpBox = new THREE.Box3();
const tmpMeshBox = new THREE.Box3();
const tmpCenter = new THREE.Vector3();
const tmpSize = new THREE.Vector3();

function computeAssetWorldBounds(
  scene: THREE.Scene,
  assetRoot: THREE.Object3D,
  outBox: THREE.Box3
): void {
  outBox.makeEmpty();
  assetRoot.updateWorldMatrix(true, true);
  assetRoot.traverse((child) => {
    if (child instanceof THREE.Mesh && !child.userData?.excludeFromPick) {
      tmpMeshBox.setFromObject(child);
      if (!tmpMeshBox.isEmpty()) {
        outBox.union(tmpMeshBox);
      }
    }
  });
  if (!outBox.isEmpty()) return;

  // Fallback when constituent meshes were absorbed into static batches (__batchOriginalParent)
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || obj.userData?.excludeFromPick) return;
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur === assetRoot) {
        tmpMeshBox.setFromObject(obj);
        if (!tmpMeshBox.isEmpty()) outBox.union(tmpMeshBox);
        break;
      }
      const savedParent = (cur.userData as Record<string, unknown> | undefined)
        ?.__batchOriginalParent as THREE.Object3D | undefined;
      cur = savedParent ?? cur.parent;
    }
  });

  if (outBox.isEmpty()) {
    assetRoot.getWorldPosition(tmpCenter);
    outBox.min.set(tmpCenter.x - 0.25, tmpCenter.y - 0.25, tmpCenter.z - 0.25);
    outBox.max.set(tmpCenter.x + 0.25, tmpCenter.y + 0.25, tmpCenter.z + 0.25);
  }
}

function findRoomZoneAt(x: number, y: number, z: number): string | null {
  const regs = getRoomZoneRegistrations();
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i]!;
    if (r.excludedCutout?.(x, z)) continue;
    let lx = x;
    let ly = y;
    let lz = z;
    if (r.obb) {
      const dx = x - r.obb.offset[0];
      const dz = z - r.obb.offset[2];
      const cosY = Math.cos(r.obb.rotationY);
      const sinY = Math.sin(r.obb.rotationY);
      lx = dx * cosY - dz * sinY;
      ly = y - r.obb.offset[1];
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
      return r.zoneId;
    }
  }
  return null;
}

/**
 * In-viewer Smart Asset Inspector controller: raycasts into static-batched or unbatched
 * scene geometry, resolves `AssetMetadata` via `WeakMap` parent walking, highlights the
 * selected asset with a non-pickable 3D bounding wireframe, and exposes interactive triggers.
 */
export class AssetInspectorController {
  public readonly changed = new Emitter<[snapshot: InspectedAssetSnapshot | null]>();
  public readonly modeChanged = new Emitter<[active: boolean]>();

  private readonly host: AssetInspectorControllerHost;
  private inspectMode = false;
  private inspectedRoot: THREE.Object3D | null = null;
  private currentSnapshot: InspectedAssetSnapshot | null = null;
  private readonly highlightHelper: THREE.LineSegments;
  private readonly highlightBoxGeo: THREE.EdgesGeometry;
  private readonly highlightMat: THREE.LineBasicMaterial;

  public constructor(host: AssetInspectorControllerHost) {
    this.host = host;
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.highlightBoxGeo = new THREE.EdgesGeometry(unitBox);
    unitBox.dispose();
    this.highlightMat = new THREE.LineBasicMaterial({
      color: 0xf2c46d,
      transparent: true,
      opacity: 0.88,
      depthTest: true,
    });
    this.highlightHelper = new THREE.LineSegments(this.highlightBoxGeo, this.highlightMat);
    this.highlightHelper.name = '__assetInspectorHighlight';
    this.highlightHelper.visible = false;
    this.highlightHelper.renderOrder = 999;
    this.highlightHelper.userData = {
      excludeFromPick: true,
      isAnnotationGroup: true,
    };
    this.host.scene.add(this.highlightHelper);
  }

  public isInspectMode(): boolean {
    return this.inspectMode;
  }

  public setInspectMode(active: boolean): boolean {
    if (active && this.host.isWalkthroughActive()) return false;
    if (this.inspectMode === active) return this.inspectMode;
    if (active) {
      this.host.deactivateOtherTools();
    }
    this.inspectMode = active;
    if (!active && this.inspectedRoot !== null) {
      this.clear();
    }
    this.modeChanged.emit(this.inspectMode);
    this.host.requestRender();
    return this.inspectMode;
  }

  public toggleInspectMode(): boolean {
    return this.setInspectMode(!this.inspectMode);
  }

  public getInspected(): InspectedAssetSnapshot | null {
    return this.currentSnapshot;
  }

  public hasInspectableAtClient(clientX: number, clientY: number): boolean {
    return this.pickAssetAtClient(clientX, clientY) !== null;
  }

  public inspectAtClient(clientX: number, clientY: number): InspectedAssetSnapshot | null {
    const picked = this.pickAssetAtClient(clientX, clientY);
    if (!picked) {
      if (this.inspectMode) {
        this.clear();
      }
      return null;
    }
    return this.selectAssetRoot(picked.root);
  }

  public selectAssetRoot(root: THREE.Object3D): InspectedAssetSnapshot | null {
    const hit = resolveAssetMetadataHit(root);
    if (!hit) return null;
    this.inspectedRoot = hit.root;
    this.rebuildSnapshotAndHighlight();
    this.changed.emit(this.currentSnapshot);
    this.host.requestRender();
    return this.currentSnapshot;
  }

  public refreshSnapshot(): void {
    if (!this.inspectedRoot) return;
    this.rebuildSnapshotAndHighlight();
    this.changed.emit(this.currentSnapshot);
  }

  public clear(): void {
    if (!this.inspectedRoot && !this.currentSnapshot) return;
    this.inspectedRoot = null;
    this.currentSnapshot = null;
    this.highlightHelper.visible = false;
    this.changed.emit(null);
    this.host.requestRender();
  }

  public frameInspected(): void {
    if (!this.currentSnapshot) return;
    const [minX, minY, minZ] = this.currentSnapshot.worldBoundsMin;
    const [maxX, maxY, maxZ] = this.currentSnapshot.worldBoundsMax;
    const [cx, cy, cz] = this.currentSnapshot.worldCenter;
    this.host.frameWorldBounds(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ),
      new THREE.Vector3(cx, cy, cz)
    );
  }

  public triggerAction(actionId: string): boolean {
    if (!this.inspectedRoot) return false;
    if (actionId === '__sound__') {
      return this.playSound();
    }
    const ok = this.host.handleInteractable(actionId);
    if (ok) {
      this.rebuildSnapshotAndHighlight();
      this.changed.emit(this.currentSnapshot);
      this.host.requestRender();
    }
    return ok;
  }

  public playSound(): boolean {
    if (!this.inspectedRoot) return false;
    const emitters = getAttachedAudioEmitters(this.inspectedRoot);
    if (emitters.length > 0) {
      const first = emitters[0]!;
      if (first.options.kind === 'continuous') {
        first.setActive(!first.isActive());
      } else {
        first.trigger();
      }
      this.rebuildSnapshotAndHighlight();
      this.changed.emit(this.currentSnapshot);
      return true;
    }
    playFoleyAtObject(this.inspectedRoot, 'switchClick', { dryGain: 0.55 });
    return true;
  }

  public collectDynamicObjects(target: Set<THREE.Object3D>): void {
    target.add(this.highlightHelper);
  }

  public dispose(): void {
    this.host.scene.remove(this.highlightHelper);
    this.highlightBoxGeo.dispose();
    this.highlightMat.dispose();
  }

  private pickAssetAtClient(
    clientX: number,
    clientY: number
  ): { readonly root: THREE.Object3D } | null {
    const raycaster = this.host.setRayFromClient(clientX, clientY);
    const hits = intersectVisibleObjects(raycaster, this.host.scene.children, true);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i]! as THREE.Intersection & { readonly originalMesh?: THREE.Mesh };
      if (!(hit.object instanceof THREE.Mesh)) continue;
      if (this.host.isPickExcluded(hit.object) || hit.object.userData?.isAnnotationGroup) continue;
      const candidate = hit.originalMesh ?? hit.object;
      const resolved = resolveAssetMetadataHit(candidate);
      if (resolved) {
        return { root: resolved.root };
      }
    }
    return null;
  }

  private rebuildSnapshotAndHighlight(): void {
    const root = this.inspectedRoot;
    if (!root) {
      this.currentSnapshot = null;
      this.highlightHelper.visible = false;
      return;
    }
    const resolved = resolveAssetMetadataHit(root);
    if (!resolved) {
      this.currentSnapshot = null;
      this.highlightHelper.visible = false;
      return;
    }

    computeAssetWorldBounds(this.host.scene, resolved.root, tmpBox);
    tmpBox.getCenter(tmpCenter);
    tmpBox.getSize(tmpSize);

    const pad = 0.018;
    this.highlightHelper.position.copy(tmpCenter);
    this.highlightHelper.scale.set(
      Math.max(0.08, tmpSize.x + pad * 2),
      Math.max(0.08, tmpSize.y + pad * 2),
      Math.max(0.08, tmpSize.z + pad * 2)
    );
    this.highlightHelper.updateMatrixWorld(true);
    this.highlightHelper.visible = true;

    const actions: InspectedAssetAction[] = [
      ...this.host.interactions.getInspectedAssetActions(resolved.root),
    ];
    const emitters = getAttachedAudioEmitters(resolved.root);
    const hasSpatialAudio = emitters.length > 0 || actions.length > 0;

    let roomZoneId: string | null = null;
    for (let cur: THREE.Object3D | null = resolved.root; cur !== null; cur = cur.parent) {
      const u = cur.userData as Record<string, unknown> | undefined;
      if (typeof u?.zoneId === 'string' && u.zoneId.length > 0) {
        roomZoneId = u.zoneId;
        break;
      }
    }
    if (!roomZoneId) {
      roomZoneId = findRoomZoneAt(tmpCenter.x, tmpCenter.y, tmpCenter.z);
    }
    const roomLabel = roomZoneId ? this.host.getRoomLabel?.(roomZoneId) : undefined;

    this.currentSnapshot = {
      assetUuid: resolved.root.uuid,
      metadata: resolved.metadata,
      roomZoneId,
      ...(roomLabel ? { roomLabel } : {}),
      worldCenter: [tmpCenter.x, tmpCenter.y, tmpCenter.z],
      worldBoundsMin: [tmpBox.min.x, tmpBox.min.y, tmpBox.min.z],
      worldBoundsMax: [tmpBox.max.x, tmpBox.max.y, tmpBox.max.z],
      actions,
      hasSpatialAudio,
    };
  }
}

export type { RigCamera };
