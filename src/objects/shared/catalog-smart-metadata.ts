/**
 * Shared Smart-Asset Metadata, Zero-`ctx` Interaction & Audio Helpers for `husjs/catalog/*`.
 */
import type * as THREE from 'three';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import {
  attachAssetInteraction,
  attachAssetMetadata,
  markAssetInteractionBound,
  type AssetHingeInteractionSpec,
  type AssetInteractionAudio,
  type AssetInteractionSpec,
  type AssetSlideInteractionSpec,
} from '../../engine/assets/smart-asset.ts';
import {
  registerHingedDoor,
  registerSlidingDrawer,
} from '../../engine/geometry/mesh-traits.ts';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import type { BrasswareFinishCode, FixtureMetalFinish } from '../sanitaryware/bathroom-spec-types.ts';

const BRASSWARE_FINISH_LABELS: Readonly<Record<BrasswareFinishCode, string>> = {
  CP: 'Chrome (CP)',
  NI: 'Polished Nickel (NI)',
  PF: 'Pewter (PF)',
  BN: 'Silver Nickel (BN)',
  BR: 'Polished Brass (BR)',
  SB: 'Satin Brass (SB)',
  AB: 'Aged Brass (AB)',
  BZ: 'English Bronze (BZ)',
  IG: 'English Gold (IG)',
};

export function formatBrasswareFinishLabel(
  finish: FixtureMetalFinish | undefined,
  fallback: BrasswareFinishCode = 'AB'
): string {
  if (!finish) return BRASSWARE_FINISH_LABELS[fallback];
  if (finish === 'antiqueBrass') return 'Antique Brass (AB)';
  if (finish === 'polishedNickel') return 'Polished Nickel (NI)';
  if (finish === 'bronze') return 'Bronze (BZ)';
  return BRASSWARE_FINISH_LABELS[finish] ?? finish;
}

export function resolveBrasswareCode(
  finish: FixtureMetalFinish | undefined,
  fallback: BrasswareFinishCode = 'AB'
): BrasswareFinishCode {
  if (!finish) return fallback;
  if (finish === 'antiqueBrass') return 'AB';
  if (finish === 'polishedNickel') return 'NI';
  if (finish === 'bronze') return 'BZ';
  return finish;
}

export function mmFromMetres(
  wM: number,
  dM: number,
  hM: number
): readonly [number, number, number] {
  return [Math.round(wM * 1000), Math.round(dM * 1000), Math.round(hM * 1000)];
}

/**
 * Attaches a zero-`ctx` hinge interaction spec to `door` (so `scene.add(asset)` auto-discovers it),
 * AND if an explicit `registry` was passed, registers the legacy hinged door for 100% backwards
 * compatibility while marking the smart spec already bound + applying any audio override.
 */
export function wireCatalogHingedDoor(
  registry: InteractionRegistry | null | undefined,
  opts: {
    readonly parent: THREE.Object3D;
    readonly door: THREE.Object3D;
    readonly hingeOffset: readonly [number, number, number];
    readonly axis: 'x' | 'y' | 'z';
    readonly openAngle: number;
    readonly label: string;
    readonly linkGroup?: string;
    readonly audio?: AssetInteractionAudio;
  }
): THREE.Object3D | null {
  const spec: AssetHingeInteractionSpec = {
    kind: 'hinge',
    label: opts.label,
    pivotOffset: opts.hingeOffset,
    axis: opts.axis,
    openAngle: opts.openAngle,
    ...(opts.linkGroup ? { linkGroup: opts.linkGroup } : {}),
    ...(opts.audio ? { audio: opts.audio } : {}),
  };
  attachAssetInteraction(opts.door, spec);
  if (!registry) return null;
  const pivot = registerHingedDoor(registry, {
    parent: opts.parent,
    door: opts.door,
    hingeOffset: opts.hingeOffset,
    axis: opts.axis,
    openAngle: opts.openAngle,
  });
  const doorId = (pivot.children[0]?.userData as { interactableId?: string } | undefined)?.interactableId;
  markAssetInteractionBound(registry, spec, doorId);
  if (opts.audio && doorId) {
    registry.setInteractableAudioOverride(doorId, opts.audio);
  }
  return pivot;
}

/**
 * Attaches a zero-`ctx` sliding drawer interaction spec to `drawer` (so `scene.add(asset)` auto-discovers it),
 * AND if an explicit `registry` was passed, registers the legacy sliding drawer while marking the smart spec bound.
 */
export function wireCatalogSlidingDrawer(
  registry: InteractionRegistry | null | undefined,
  opts: {
    readonly drawer: THREE.Group;
    readonly slideDelta: readonly [number, number, number];
    readonly label?: string;
    readonly audio?: AssetInteractionAudio;
  }
): void {
  const spec: AssetSlideInteractionSpec = {
    kind: 'slide',
    label: opts.label ?? 'Open Drawer',
    slideDelta: opts.slideDelta,
    audio: opts.audio ?? { openPreset: 'drawerSlide', closePreset: 'drawerSlide' },
  };
  attachAssetInteraction(opts.drawer, spec);
  if (!registry) return;
  registerSlidingDrawer(registry, {
    drawer: opts.drawer,
    slideDelta: opts.slideDelta,
  });
  let drawerId: string | undefined;
  opts.drawer.traverse((c) => {
    const cid = (c.userData as { interactableId?: string } | undefined)?.interactableId;
    if (!drawerId && cid) drawerId = cid;
  });
  markAssetInteractionBound(registry, spec, drawerId);
  if (opts.audio && drawerId) {
    registry.setInteractableAudioOverride(drawerId, opts.audio);
  }
}

export {
  attachAssetInteraction,
  attachAssetMetadata,
  markAssetInteractionBound,
  type AssetInteractionSpec,
  type AssetMetadata,
};
