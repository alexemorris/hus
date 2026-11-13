import { mountHouse, type HouseDefinition, type InboundKNXFrame, type TwinApi } from 'husjs';
import type { KNXPropertyBusController, SmartHomeHub } from 'husjs/knx';
import { getLoadingScreen } from 'husjs/ui';
import type { PropertyScene, SceneAnnotationStore } from 'husjs/viewer';

export type ExampleHouseId = 'simple-house' | 'stahl-house' | 'simple-flat';

export const HOUSE_BOOT_TITLES: Readonly<Record<ExampleHouseId, string>> = {
  'simple-house': 'Georgian Country House',
  'stahl-house': 'Stahl House (Case Study #22)',
  'simple-flat': 'Pied-à-terre Apartment',
};

export function resolveSelectedHouseId(search?: string): ExampleHouseId {
  const effectiveSearch =
    search !== undefined
      ? search
      : typeof window !== 'undefined' && window.location
        ? window.location.search
        : '';
  const raw = new URLSearchParams(effectiveSearch).get('house')?.trim().toLowerCase();
  if (raw === 'simple-flat' || raw === 'simple-house' || raw === 'stahl-house') {
    return raw;
  }
  return 'simple-house';
}

export function applyInitialHouseBootTitle(
  houseId: ExampleHouseId,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined
): string {
  const initialTitle = HOUSE_BOOT_TITLES[houseId];
  if (doc) {
    if (typeof doc.title === 'string') {
      doc.title = `${initialTitle} · Hus`;
    }
    getLoadingScreen(doc, initialTitle);
  }
  return initialTitle;
}

async function loadExampleHouse(id: ExampleHouseId): Promise<HouseDefinition> {
  switch (id) {
    case 'simple-flat':
      return (await import('../examples/simple-flat/index.ts')).simpleFlat;
    case 'simple-house':
      return (await import('../examples/simple-house/index.ts')).simpleHouse;
    case 'stahl-house':
      return (await import('../examples/stahl-house/index.ts')).stahlHouse;
  }
}

async function main(): Promise<void> {
  const houseId = resolveSelectedHouseId();
  applyInitialHouseBootTitle(houseId);
  const house = await loadExampleHouse(houseId);
  const mounted = await mountHouse(house, document);
  (
    window as unknown as {
      husTwin?: {
        readonly hub: SmartHomeHub;
        readonly knx: KNXPropertyBusController;
        readonly scene: PropertyScene;
        readonly annotations: SceneAnnotationStore;
        readonly api: TwinApi;
        connectToGateway(wsEndpointUrl: string): Promise<void>;
        useSimulation(): void;
        injectTelegram(frameOrHex: string | InboundKNXFrame): void;
      };
    }
  ).husTwin = {
    hub: mounted.hub,
    knx: mounted.knx,
    scene: mounted.scene,
    annotations: mounted.annotations,
    api: mounted.api,
    connectToGateway: (url) => mounted.connectToGateway(url),
    useSimulation: () => mounted.useSimulation(),
    injectTelegram: (frameOrHex) => mounted.injectTelegram(frameOrHex),
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    getLoadingScreen().fail(`Something went wrong while loading: ${message}`);
    console.error(err);
  });
}
