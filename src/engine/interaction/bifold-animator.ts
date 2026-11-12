import * as THREE from 'three';
import type { AcousticPortalState } from '../../core/types/acoustics.ts';
import type { BifoldTrackConfig } from '../viewer/property-scene-profile.ts';
import type { BifoldPanelRef } from '../viewer/scene-types.ts';
import { playBifoldSound } from './handlers/bifold-cupboards.ts';

const tmpBifoldBounds = new THREE.Box3();
const tmpPanelBounds = new THREE.Box3();

/**
 * Animates a concertina bifold door set between closed (0) and open (1).
 */
export class BifoldDoorAnimator {
  private readonly panels: readonly BifoldPanelRef[];
  private readonly track: BifoldTrackConfig;
  private open = false;
  private currentOpen = 0;
  private cachedPortalGeometry: {
    readonly position: readonly [number, number, number];
    readonly areaM2: number;
  } | null = null;

  public constructor(panels: readonly BifoldPanelRef[], track: BifoldTrackConfig) {
    this.panels = panels;
    this.track = track;
  }

  public getPanels(): readonly BifoldPanelRef[] {
    return this.panels;
  }

  public getTrack(): BifoldTrackConfig {
    return this.track;
  }

  public isOpen(): boolean {
    return this.open;
  }

  public getOpenProgress(): number {
    return this.currentOpen;
  }

  public getAcousticPortalState(id = 'bifolds'): AcousticPortalState | null {
    if (this.panels.length === 0) return null;
    if (!this.cachedPortalGeometry) {
      tmpBifoldBounds.makeEmpty();
      for (const panel of this.panels) {
        panel.group.updateWorldMatrix(true, true);
        tmpPanelBounds.setFromObject(panel.group);
        if (!tmpPanelBounds.isEmpty()) {
          tmpBifoldBounds.union(tmpPanelBounds);
        }
      }
      if (tmpBifoldBounds.isEmpty()) {
        const width = Math.max(0.5, this.panels.length * this.track.leafWidth);
        this.cachedPortalGeometry = {
          position: [this.track.anchorRightX - width * 0.5, 1.1, this.track.trackZ],
          areaM2: width * 2.1,
        };
      } else {
        const cx = (tmpBifoldBounds.min.x + tmpBifoldBounds.max.x) * 0.5;
        const cy = (tmpBifoldBounds.min.y + tmpBifoldBounds.max.y) * 0.5;
        const cz = (tmpBifoldBounds.min.z + tmpBifoldBounds.max.z) * 0.5;
        const height = Math.max(0.5, tmpBifoldBounds.max.y - tmpBifoldBounds.min.y);
        const spanXZ = Math.max(
          tmpBifoldBounds.max.x - tmpBifoldBounds.min.x,
          tmpBifoldBounds.max.z - tmpBifoldBounds.min.z,
          this.panels.length * this.track.leafWidth
        );
        this.cachedPortalGeometry = {
          position: [cx, cy, cz],
          areaM2: Math.max(0.5, spanXZ * height),
        };
      }
    }
    return {
      id,
      position: this.cachedPortalGeometry.position,
      areaM2: this.cachedPortalGeometry.areaM2,
      openness: this.currentOpen,
    };
  }

  public toggle(): boolean {
    this.open = !this.open;
    playBifoldSound(this.panels[0]?.group, this.open);
    return this.open;
  }

  /** Advances the fold animation. Returns true if any leaf moved. */
  public update(dtSeconds: number): boolean {
    const targetOpen = this.open ? 1 : 0;
    if (this.currentOpen === targetOpen) return false;

    const step = dtSeconds * 2.2;
    if (this.currentOpen < targetOpen) {
      this.currentOpen = Math.min(1, this.currentOpen + step);
    } else {
      this.currentOpen = Math.max(0, this.currentOpen - step);
    }
    // Smooth cubic ease-in-out for natural bifold track glide
    const t = this.currentOpen;
    const smoothT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const theta = smoothT * this.track.maxFoldAngle;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const { anchorRightX, trackZ, leafWidth } = this.track;

    for (const leaf of this.panels) {
      const k = leaf.openX; // index from right post (0..n-1)
      leaf.group.position.x = anchorRightX - (k + 0.5) * leafWidth * cosTheta;
      leaf.group.position.z = trackZ + 0.5 * leafWidth * sinTheta;
      leaf.group.rotation.y = leaf.dir * theta;
      leaf.group.updateMatrixWorld(true);
    }
    return true;
  }
}
