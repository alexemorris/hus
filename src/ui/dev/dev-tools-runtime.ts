import { signal } from '@preact/signals';
import type { RoomLodDiagnostics, SmartHomeBusEvent } from '../../core/entities.ts';
import type { TwinApi } from '../../core/types/twin-api.ts';
import type { SwitchDirection } from '../../integrations/knx/zone-lighting.ts';
import { devMode } from '../../state/shell-store.ts';
import { devStore, timeOfDayToSunMinutes } from './dev-store.ts';
import type { DevToolsDeps } from './mount-dev-tools.ts';

const RECENT_TELEGRAM_LIMIT = 20;
const RECENT_HUB_EVENT_LIMIT = 8;

/** Latest LOD diagnostics pushed by the engine (null until the dev runtime is mounted). */
export const devLodDiagnostics = signal<RoomLodDiagnostics | null>(null);

/** Most recent non-KNX smart-home bus events (UniFi Protect / Access), newest first. */
export const devSmartHomeEvents = signal<readonly SmartHomeBusEvent[]>([]);

let disposeActiveRuntime: (() => void) | null = null;

function readSunMinutes(api: TwinApi): number {
  const solar = api.sky?.getSnapshot().solar;
  return solar ? Math.round(solar.civilHour * 60) : timeOfDayToSunMinutes(api.lighting.getTimeOfDay());
}

function focusedTagName(): string {
  return typeof document === 'undefined' ? '' : (document.activeElement?.tagName ?? '');
}

/**
 * Developer-mode keyboard shortcuts: B toggles camera motion blur, V toggles the
 * walkthrough, Space / ↑ / ↓ operate the first wall push-button (tap = step scene,
 * hold = full / night). Returns an unbind function.
 */
function bindDevKeyboard({ api, knx }: DevToolsDeps): () => void {
  if (typeof window === 'undefined') return () => {};

  let press: { held: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
  let pressDirection: SwitchDirection = 'up';

  const primarySwitch = () => {
    const button = knx.getPushButtons().find((b) => b.gangs.length > 0);
    const gang = button?.gangs[0];
    return button && gang ? { button, zoneId: gang.zoneId } : null;
  };

  const startPress = (direction: SwitchDirection): void => {
    const target = primarySwitch();
    if (press || !target) return;
    pressDirection = direction;
    const current = {
      held: false,
      timer: setTimeout(() => {
        current.held = true;
        knx.handleZoneSwitchLongPressHold(target.zoneId, direction, target.button.pa, target.button.location);
      }, target.button.params.longPressMs),
    };
    press = current;
  };

  const endPress = (): void => {
    const target = primarySwitch();
    if (!press) return;
    clearTimeout(press.timer);
    const wasHold = press.held;
    press = null;
    if (!wasHold && target) {
      knx.handleZoneSwitchShortPress(target.zoneId, pressDirection, target.button.pa, target.button.location);
    }
  };

  const rockerDirection = (code: string): SwitchDirection | null =>
    code === 'Space' || code === 'ArrowUp' ? 'up' : code === 'ArrowDown' ? 'down' : null;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!devMode.value || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = focusedTagName();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'KeyB' || e.code === 'KeyV') {
      e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyB') api.dev.toggleMotionBlur();
      else api.walkthrough.toggle();
      return;
    }

    const direction = rockerDirection(e.code);
    if (!direction || tag === 'BUTTON' || api.walkthrough.isActive()) return;
    e.preventDefault();
    if (!e.repeat) startPress(direction);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (press && rockerDirection(e.code)) {
      e.preventDefault();
      endPress();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    if (press) clearTimeout(press.timer);
    press = null;
  };
}

/**
 * Starts the developer runtime: keeps `devStore` in sync with the scene, KNX bus,
 * smart-home hub and twin API, and binds the dev-only keyboard shortcuts. No DOM
 * nodes are required. Mounting again disposes the previous runtime first; the
 * returned function tears everything down.
 */
export function mountDevToolsRuntime(deps: DevToolsDeps): () => void {
  disposeActiveRuntime?.();
  const { scene, knx, hub, api } = deps;

  const syncTelegrams = (): void => {
    const telegrams = knx.getTelegrams();
    devStore.syncKnxState({
      telegramCount: telegrams.length,
      recentTelegrams: telegrams.slice(0, RECENT_TELEGRAM_LIMIT),
    });
  };
  const syncCircuits = (): void => {
    devStore.syncKnxState({
      knxDeviceStates: knx.getTargetLevels(),
      activeScenePreset: knx.getActiveSceneIndex(),
    });
  };
  const syncFloors = (): void => {
    devStore.syncViewportState({
      floorViewMode: api.floors.getMode(),
      ceilingCutaway: api.floors.isCeilingCutaway(),
    });
  };
  const syncSun = (): void => {
    devStore.syncViewportState({ sunMinutes: readSunMinutes(api) });
  };
  const syncLod = (diag: RoomLodDiagnostics): void => {
    devLodDiagnostics.value = diag;
    devStore.syncViewportState({ activeRoomId: diag.focusedZoneId });
  };
  const syncHubEvents = (): void => {
    devSmartHomeEvents.value = hub
      .getUnifiedEvents()
      .filter((ev) => ev.protocol !== 'knx')
      .slice(0, RECENT_HUB_EVENT_LIMIT);
  };

  const unsubscribers: (() => void)[] = [
    knx.subscribe((event) => {
      if (event.type === 'telegram') {
        syncTelegrams();
      } else if (event.type === 'stateChange') {
        syncCircuits();
        syncSun();
      }
    }),
    hub.subscribe((event) => {
      if (event.type === 'busEvent' && event.busEvent?.protocol !== 'knx') syncHubEvents();
    }),
    api.camera.onViewChanged(syncFloors),
    api.walkthrough.onChanged((active) => {
      devStore.syncViewportState({ walkthroughActive: active });
      syncFloors();
    }),
    api.walkthrough.onFootPositionChanged((pos, zoneId) => {
      const fps = Math.round(api.graphics.getStats().fps);
      const height = pos[1];
      const room = api.dev.getFocusedRoomShortName().toUpperCase();
      devStore.syncViewportState({
        walkthroughFloorLabel: `${room} · ${height >= 0 ? '+' : ''}${height.toFixed(2)}m · ${fps} FPS`,
        fpsCount: fps,
        ...(zoneId ? { activeRoomId: zoneId } : {}),
      });
    }),
    bindDevKeyboard(deps),
  ];
  if (api.sky) unsubscribers.push(api.sky.onChanged(syncSun));
  scene.getLodController().setOnLodChanged(syncLod);

  syncTelegrams();
  syncCircuits();
  syncFloors();
  syncSun();
  syncLod(api.dev.getLodDiagnostics());
  syncHubEvents();
  devStore.syncViewportState({ walkthroughActive: api.walkthrough.isActive() });

  const dispose = (): void => {
    if (disposeActiveRuntime !== dispose) return;
    disposeActiveRuntime = null;
    for (const unsubscribe of unsubscribers) unsubscribe();
    scene.getLodController().setOnLodChanged(() => {});
    devLodDiagnostics.value = null;
    devSmartHomeEvents.value = [];
  };
  disposeActiveRuntime = dispose;
  return dispose;
}
