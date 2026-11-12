import { batch, computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { CircuitId, CircuitLevels, KNXTelegram } from '../../core/types/knx.ts';
import type { FloorViewMode, TimeOfDay } from '../../core/types/scene.ts';

/**
 * Signals backing the legacy developer HUD (KNX bus log, status badge).
 * Developer tooling only — the everyday shell uses
 * src/state/shell-store.ts and src/state/notes-store.ts.
 */

function createInitialDeviceStates(): Readonly<Record<CircuitId, number>> {
  // Filled by the first syncKnxState() with every circuit the running KNX project drives.
  const initial: Partial<Record<CircuitId, number>> = {};
  return initial as Record<CircuitId, number>;
}

export function timeOfDayToSunMinutes(tod: TimeOfDay): number {
  if (tod === 'day') return 13 * 60 + 30;
  if (tod === 'dusk') return 19 * 60 + 45;
  return 22 * 60 + 30;
}

export function formatMinutesAsClock(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Viewport
const floorViewMode: Signal<FloorViewMode> = signal<FloorViewMode>('ground');
const ceilingCutaway: Signal<boolean> = signal<boolean>(true);
const activeRoomId: Signal<string> = signal<string>('kitchen');
const walkthroughActive: Signal<boolean> = signal<boolean>(false);
const walkthroughFloorLabel: Signal<string> = signal<string>('KITCHEN · +0.00m');
const sunMinutes: Signal<number> = signal<number>(timeOfDayToSunMinutes('dusk'));
const fpsCount: Signal<number> = signal<number>(60);

// KNX bus telemetry
const telegramCount: Signal<number> = signal<number>(0);
const recentTelegrams: Signal<readonly KNXTelegram[]> = signal<readonly KNXTelegram[]>([]);
const activeScenePreset: Signal<number> = signal<number>(0);
const knxDeviceStates: Signal<Readonly<Record<CircuitId, number>>> =
  signal<Readonly<Record<CircuitId, number>>>(createInitialDeviceStates());

const floorModeLabel: ReadonlySignal<string> = computed(() => {
  const mode = floorViewMode.value;
  if (mode === 'ground') return 'GROUND FLOOR';
  if (mode === 'first') return '1ST FLOOR';
  return 'FULL HOUSE + ROOF';
});

const formattedSunTime: ReadonlySignal<string> = computed(() => formatMinutesAsClock(sunMinutes.value));

const activeCircuitsCount: ReadonlySignal<number> = computed(() => {
  const levels = knxDeviceStates.value;
  let on = 0;
  for (const level of Object.values(levels)) {
    if (level > 0) on += 1;
  }
  return on;
});

const totalCircuitsCount: ReadonlySignal<number> = computed(
  () => Object.keys(knxDeviceStates.value).length
);

export interface DevStore {
  readonly floorViewMode: Signal<FloorViewMode>;
  readonly ceilingCutaway: Signal<boolean>;
  readonly activeRoomId: Signal<string>;
  readonly walkthroughActive: Signal<boolean>;
  readonly walkthroughFloorLabel: Signal<string>;
  readonly sunMinutes: Signal<number>;
  readonly fpsCount: Signal<number>;

  readonly telegramCount: Signal<number>;
  readonly recentTelegrams: Signal<readonly KNXTelegram[]>;
  readonly activeScenePreset: Signal<number>;
  readonly knxDeviceStates: Signal<Readonly<Record<CircuitId, number>>>;

  readonly floorModeLabel: ReadonlySignal<string>;
  readonly formattedSunTime: ReadonlySignal<string>;
  readonly activeCircuitsCount: ReadonlySignal<number>;
  readonly totalCircuitsCount: ReadonlySignal<number>;

  syncViewportState(update: {
    readonly floorViewMode?: FloorViewMode;
    readonly ceilingCutaway?: boolean;
    readonly activeRoomId?: string;
    readonly walkthroughActive?: boolean;
    readonly walkthroughFloorLabel?: string;
    readonly sunMinutes?: number;
    readonly fpsCount?: number;
  }): void;

  syncKnxState(update: {
    readonly telegramCount?: number;
    readonly recentTelegrams?: readonly KNXTelegram[];
    readonly activeScenePreset?: number;
    readonly knxDeviceStates?: Readonly<CircuitLevels>;
  }): void;
}

export const devStore: DevStore = {
  floorViewMode,
  ceilingCutaway,
  activeRoomId,
  walkthroughActive,
  walkthroughFloorLabel,
  sunMinutes,
  fpsCount,

  telegramCount,
  recentTelegrams,
  activeScenePreset,
  knxDeviceStates,

  floorModeLabel,
  formattedSunTime,
  activeCircuitsCount,
  totalCircuitsCount,

  syncViewportState(update): void {
    batch(() => {
      if (update.floorViewMode !== undefined) floorViewMode.value = update.floorViewMode;
      if (update.ceilingCutaway !== undefined) ceilingCutaway.value = update.ceilingCutaway;
      if (update.activeRoomId !== undefined) activeRoomId.value = update.activeRoomId;
      if (update.walkthroughActive !== undefined) walkthroughActive.value = update.walkthroughActive;
      if (update.walkthroughFloorLabel !== undefined) {
        walkthroughFloorLabel.value = update.walkthroughFloorLabel;
      }
      if (update.sunMinutes !== undefined) sunMinutes.value = update.sunMinutes;
      if (update.fpsCount !== undefined) fpsCount.value = update.fpsCount;
    });
  },

  syncKnxState(update): void {
    batch(() => {
      if (update.telegramCount !== undefined) telegramCount.value = update.telegramCount;
      if (update.recentTelegrams !== undefined) recentTelegrams.value = update.recentTelegrams;
      if (update.activeScenePreset !== undefined) activeScenePreset.value = update.activeScenePreset;
      if (update.knxDeviceStates !== undefined) knxDeviceStates.value = { ...update.knxDeviceStates };
    });
  },
};
