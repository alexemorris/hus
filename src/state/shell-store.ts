import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { CircuitLevels } from '../core/types/knx.ts';
import type { FloorViewMode, TimeOfDay } from '../core/types/scene.ts';
import type { RoomZoneId } from '../core/types/topology.ts';
import type { GraphicsMode, TradeView } from '../core/types/twin-ux.ts';
import { inspectedAssetSnapshot } from './asset-inspector-store.ts';
import {
  DEFAULT_HUS_PLUS_X_BEARING_DEG,
  type SkyWeatherSnapshot,
} from '../core/types/solar-weather.ts';

/**
 * UI-shell state (top bar, side panels, tool dock, modals, toasts).
 * Scene/KNX state is mirrored in here by the shell bindings so Preact
 * components never poll the engine.
 */

export type DisplayUnits = 'm' | 'ftin';
export type ShellViewMode = '3d' | 'plan' | 'walk';
export type ShellTool = 'orbit' | 'inspect' | 'measure' | 'note' | 'sculpt';
export type TouchNavMode = 'orbit' | 'pan';
export type RoomSheetSnap = 'peek' | 'half' | 'full';
export type NoteTrade = 'architect' | 'builder' | 'electrician' | 'plumber';
export type DevTab = 'smart-home' | 'diagnostics';
export type SkyHudPopover = 'none' | 'sun' | 'weather';

export const NOTE_TRADES: readonly NoteTrade[] = ['architect', 'builder', 'electrician', 'plumber'];

const LS_DEV_MODE = 'hus.ui.devMode';
const LS_UNITS = 'hus.ui.units';
const LS_HELP_SEEN = 'hus.ui.helpSeen.v1';
const LS_NOTE_META = 'hus.ui.noteMeta.v1';

/**
 * Below 1040 px (tablets in portrait/square, Pixel Fold unfolded ~760-840 px, phones),
 * side panels behave as mutually-exclusive drawers/sheets instead of docking both sides.
 */
export const MOBILE_BREAKPOINT_PX = 1040;
/**
 * Below 640 px (phones and Pixel Fold cover display ~384-412 px),
 * RoomPanel renders as a bottom sheet so the 3D viewport stays visible above it.
 */
export const COMPACT_PHONE_BREAKPOINT_PX = 640;

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode / quota); the UI still works for the session.
  }
}

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX;
}

function isCompactPhoneViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= COMPACT_PHONE_BREAKPOINT_PX;
}

function detectCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(pointer: coarse)').matches === true ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && window.innerWidth < 1280)
  );
}

const devModePref: Signal<boolean> = signal(readLocal(LS_DEV_MODE) === '1');
export const guestMode: Signal<boolean> = signal(false);
/** Developer mode is never available to read-only guests. */
export const devMode: ReadonlySignal<boolean> = computed(() => devModePref.value && !guestMode.value);

export function setDevMode(enabled: boolean): void {
  devModePref.value = enabled;
  writeLocal(LS_DEV_MODE, enabled ? '1' : '0');
}

export const units: Signal<DisplayUnits> = signal(readLocal(LS_UNITS) === 'ftin' ? 'ftin' : 'm');
export function setUnits(next: DisplayUnits): void {
  units.value = next;
  writeLocal(LS_UNITS, next);
}

export function hasSeenHelp(): boolean {
  return readLocal(LS_HELP_SEEN) === '1';
}
export function markHelpSeen(): void {
  writeLocal(LS_HELP_SEEN, '1');
}

export const isMobile: Signal<boolean> = signal(isMobileViewport());
export const isCompactPhone: Signal<boolean> = signal(isCompactPhoneViewport());
export const isCoarsePointer: Signal<boolean> = signal(detectCoarsePointer());
export const touchNavMode: Signal<TouchNavMode> = signal<TouchNavMode>('orbit');
export const roomSheetSnap: Signal<RoomSheetSnap> = signal<RoomSheetSnap>('half');
export const navigatorOpen: Signal<boolean> = signal(!isMobileViewport());
export const roomPanelOpen: Signal<boolean> = signal(!isMobileViewport());
export const settingsOpen: Signal<boolean> = signal(false);
export const helpOpen: Signal<boolean> = signal(false);
export const helpStep: Signal<number> = signal(0);
export const devDrawerOpen: Signal<boolean> = signal(false);
export const devTab: Signal<DevTab> = signal<DevTab>('smart-home');
export const skyHudPopover: Signal<SkyHudPopover> = signal<SkyHudPopover>('none');
export const skyWeatherSnapshot: Signal<SkyWeatherSnapshot | null> = signal<SkyWeatherSnapshot | null>(null);
export const cameraCompassBearingDeg: Signal<number> = signal<number>(DEFAULT_HUS_PLUS_X_BEARING_DEG);

export function toggleNavigator(): void {
  const next = !navigatorOpen.value;
  navigatorOpen.value = next;
  if (next && isMobile.value) {
    roomPanelOpen.value = false;
  }
}

export function toggleRoomPanel(): void {
  const next = !roomPanelOpen.value;
  roomPanelOpen.value = next;
  if (next && isMobile.value) {
    navigatorOpen.value = false;
    if (roomSheetSnap.value === 'peek') roomSheetSnap.value = 'half';
  }
}

export function cycleRoomSheetSnap(): void {
  const cur = roomSheetSnap.value;
  roomSheetSnap.value = cur === 'peek' ? 'half' : cur === 'half' ? 'full' : 'peek';
}

if (typeof window !== 'undefined') {
  const syncViewportFlags = (): void => {
    const mobile = isMobileViewport();
    const compact = isCompactPhoneViewport();
    const coarse = detectCoarsePointer();
    if (compact !== isCompactPhone.value) isCompactPhone.value = compact;
    if (coarse !== isCoarsePointer.value) isCoarsePointer.value = coarse;
    if (mobile !== isMobile.value) {
      isMobile.value = mobile;
      // Desktop shows both panels docked; mobile/foldable starts with drawers closed or mutually exclusive.
      navigatorOpen.value = !mobile;
      roomPanelOpen.value = !mobile;
    } else if (mobile && navigatorOpen.value && roomPanelOpen.value) {
      // Enforce mutual exclusion when folding from desktop-like width into tablet/foldable width.
      navigatorOpen.value = false;
    }
  };
  window.addEventListener('resize', syncViewportFlags);
  window.addEventListener('orientationchange', syncViewportFlags);
  window.visualViewport?.addEventListener('resize', syncViewportFlags);
}

/** Closes the top-most overlay. Returns true if something was closed. */
export function closeTopOverlay(): boolean {
  if (skyHudPopover.value !== 'none') {
    skyHudPopover.value = 'none';
    return true;
  }
  if (inspectedAssetSnapshot.value !== null && activeTool.value === 'orbit') {
    inspectedAssetSnapshot.value = null;
    return true;
  }
  if (helpOpen.value) {
    helpOpen.value = false;
    markHelpSeen();
    return true;
  }
  if (settingsOpen.value) {
    settingsOpen.value = false;
    return true;
  }
  if (devDrawerOpen.value) {
    devDrawerOpen.value = false;
    return true;
  }
  if (isMobile.value && (navigatorOpen.value || roomPanelOpen.value)) {
    navigatorOpen.value = false;
    roomPanelOpen.value = false;
    return true;
  }
  return false;
}

export function openHelp(step = 0): void {
  helpStep.value = step;
  helpOpen.value = true;
}

export const currentRoomId: Signal<RoomZoneId | null> = signal<RoomZoneId | null>(null);
export const tradeView: Signal<TradeView> = signal<TradeView>('owner');
export const floorMode: Signal<FloorViewMode> = signal<FloorViewMode>('ground');
export const viewMode: Signal<ShellViewMode> = signal<ShellViewMode>('3d');

/** Bumped to re-show the walk-mode key hints (they auto-hide; `?` re-shows them). */
export const walkHintNonce: Signal<number> = signal(0);
export function showWalkHints(): void {
  walkHintNonce.value += 1;
}
export const activeTool: Signal<ShellTool> = signal<ShellTool>('orbit');
export const sectionCut: Signal<boolean> = signal(true);
export const timeOfDay: Signal<TimeOfDay> = signal<TimeOfDay>('dusk');
export const graphicsMode: Signal<GraphicsMode> = signal<GraphicsMode>('auto');
export const graphicsTierLabel: Signal<string> = signal('');
export const graphicsFps: Signal<number | null> = signal<number | null>(null);
export const liveLevels: Signal<Readonly<CircuitLevels> | null> = signal<Readonly<CircuitLevels> | null>(null);
/** Bumped whenever non-level KNX/scene state changes (gates, UFH, motion…). */
export const deviceRevision: Signal<number> = signal(0);

export interface ToastMessage {
  readonly id: number;
  readonly text: string;
}

export const toast: Signal<ToastMessage | null> = signal<ToastMessage | null>(null);
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(text: string, durationMs = 2600): void {
  toastSeq += 1;
  const id = toastSeq;
  toast.value = { id, text };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toast.value?.id === id) toast.value = null;
  }, durationMs);
}

// Note sidecar metadata (trade tag + resolved flag), keyed by annotation id.
// Stored separately so the engine annotation store types stay unchanged.

export interface NoteMeta {
  readonly trade?: NoteTrade;
  readonly resolved?: boolean;
}

function isNoteTrade(value: unknown): value is NoteTrade {
  return typeof value === 'string' && NOTE_TRADES.some((t) => t === value);
}

function loadNoteMeta(): Readonly<Record<string, NoteMeta>> {
  const raw = readLocal(LS_NOTE_META);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, NoteMeta> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'object' || value === null) continue;
      const trade: unknown = Reflect.get(value, 'trade');
      const resolved: unknown = Reflect.get(value, 'resolved');
      out[key] = {
        ...(isNoteTrade(trade) ? { trade } : {}),
        ...(resolved === true ? { resolved: true } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export const noteMeta: Signal<Readonly<Record<string, NoteMeta>>> = signal(loadNoteMeta());

export function updateNoteMeta(id: number, patch: Partial<NoteMeta>): void {
  const key = String(id);
  const prev = noteMeta.value[key] ?? {};
  const merged: NoteMeta = { ...prev, ...patch };
  const next: Record<string, NoteMeta> = { ...noteMeta.value, [key]: merged };
  noteMeta.value = next;
  writeLocal(LS_NOTE_META, JSON.stringify(next));
}

export function pruneNoteMeta(liveIds: readonly number[]): void {
  const live = new Set(liveIds.map(String));
  const current = noteMeta.value;
  const keys = Object.keys(current);
  if (keys.every((k) => live.has(k))) return;
  const next: Record<string, NoteMeta> = {};
  for (const k of keys) {
    const meta = current[k];
    if (live.has(k) && meta) next[k] = meta;
  }
  noteMeta.value = next;
  writeLocal(LS_NOTE_META, JSON.stringify(next));
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed'; readonly platform: string }>;
}

let deferredPwaPrompt: BeforeInstallPromptEvent | null = null;

function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches === true ||
    nav.standalone === true
  );
}

export const pwaCanInstall: Signal<boolean> = signal(false);
export const pwaInstalled: Signal<boolean> = signal(detectStandaloneMode());

export async function promptPwaInstall(appName?: string): Promise<boolean> {
  if (!deferredPwaPrompt) return false;
  const promptEvent = deferredPwaPrompt;
  deferredPwaPrompt = null;
  pwaCanInstall.value = false;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      pwaInstalled.value = true;
      showToast(appName ? `${appName} installed as an app` : 'Installed as an app');
      return true;
    }
  } catch {
    // Ignore user cancellation
  }
  return false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPwaPrompt = e as BeforeInstallPromptEvent;
    pwaCanInstall.value = true;
  });

  window.addEventListener('appinstalled', () => {
    deferredPwaPrompt = null;
    pwaCanInstall.value = false;
    pwaInstalled.value = true;
  });

  if ('serviceWorker' in navigator && import.meta.env?.PROD) {
    window.addEventListener('load', () => {
      const swUrl = `${import.meta.env.BASE_URL ?? './'}sw.js`;
      void navigator.serviceWorker.register(swUrl).catch(() => undefined);
    });
  }
}
