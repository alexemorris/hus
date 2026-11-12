import * as THREE from 'three';
import type { RoomBoundingBox } from '../../core/types/topology.ts';

const OUTLINE_COLOR = 0x6fb7ff;
const OUTLINE_OPACITY = 0.65;
/** Lift above the walking floor so the perimeter outline never z-fights the floor finish (m). */
const FLOOR_LIFT_M = 0.03;

/**
 * Subtle perimeter outline marking a room's footprint during navigator pointer hover.
 * Uses a thin line loop without any translucent floor fill plane so floors never
 * acquire a blue tint sheet. Created lazily on first use so it stays out of static snapshots.
 */
export class RoomHighlight {
  private readonly scene: THREE.Scene;
  private group: THREE.Group | null = null;

  public constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Shows the perimeter outline over `bounds` at `floorY`; `null` hides it. */
  public show(bounds: RoomBoundingBox | null, floorY = 0): void {
    if (!bounds) {
      if (this.group) this.group.visible = false;
      return;
    }
    const group = this.ensureGroup();
    const width = Math.max(0.01, bounds.maxX - bounds.minX);
    const depth = Math.max(0.01, bounds.maxZ - bounds.minZ);
    group.position.set(
      (bounds.minX + bounds.maxX) / 2,
      floorY + FLOOR_LIFT_M,
      (bounds.minZ + bounds.maxZ) / 2
    );
    group.scale.set(width, 1, depth);
    group.visible = true;
    group.updateMatrix();
    group.updateMatrixWorld(true);
  }

  public isVisible(): boolean {
    return this.group?.visible ?? false;
  }

  private ensureGroup(): THREE.Group {
    if (this.group) return this.group;
    const group = new THREE.Group();
    group.name = 'viewer.roomHighlight';
    group.userData.isAnnotationGroup = true;
    group.renderOrder = 10;

    const corners = [
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, 0.5),
      new THREE.Vector3(-0.5, 0, 0.5),
    ];
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(corners),
      new THREE.LineBasicMaterial({
        color: OUTLINE_COLOR,
        transparent: true,
        opacity: OUTLINE_OPACITY,
        depthWrite: false,
      })
    );
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.userData.isAnnotationGroup = true;
    outline.raycast = () => undefined;
    outline.renderOrder = 10;
    outline.updateMatrix();
    outline.matrixAutoUpdate = false;
    group.add(outline);

    group.matrixAutoUpdate = false;
    this.scene.add(group);
    this.group = group;
    return group;
  }
}
