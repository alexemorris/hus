import { signal, type Signal } from '@preact/signals';
import type { InspectedAssetSnapshot } from '../core/assets/asset-metadata.ts';

export const assetInspectMode: Signal<boolean> = signal<boolean>(false);
export const inspectedAssetSnapshot: Signal<InspectedAssetSnapshot | null> =
  signal<InspectedAssetSnapshot | null>(null);
