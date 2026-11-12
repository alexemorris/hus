import { effect } from '@preact/signals';
import { render, type ComponentType } from 'preact';
import type { TwinApi } from '../../core/types/twin-api.ts';
import {
  devMode,
  guestMode,
  isMobile,
  navigatorOpen,
  roomPanelOpen,
  setDevMode,
} from '../../state/shell-store.ts';
import { readShareStateFromLocation } from '../../state/url-state.ts';
import { AnnotatorController } from '../notes/annotator-controller.ts';
import { HusShell } from './HusShell.tsx';
import { bindShellKeyboard } from './keyboard.ts';
import { ShellController } from './shell-controller.ts';

export interface MountShellOptions {
  readonly api: TwinApi;
  /** Optional explicit house identifier for per-house scoped annotations & exports. */
  readonly houseId?: string;
  /** Optional explicit house display name for per-house scoped exports. */
  readonly houseName?: string;
  /** Developer drawer component (provided by the composition root). */
  readonly devDrawer?: ComponentType;
  /** When false, skips binding global window keyboard shortcuts (useful in isolated tests). */
  readonly bindKeyboard?: boolean;
}

let bodyClassesBound = false;

/** Reflects shell state as body classes so CSS can gate responsive/developer UI. */
function bindBodyClasses(): void {
  if (bodyClassesBound || typeof document === 'undefined' || !document.body) return;
  bodyClassesBound = true;
  const body = document.body;
  effect(() => {
    body.classList.toggle('is-dev-mode', devMode.value);
  });
  effect(() => {
    body.classList.toggle('is-guest', guestMode.value);
  });
  effect(() => {
    body.classList.toggle('is-mobile', isMobile.value);
  });
  effect(() => {
    body.classList.toggle('has-nav', navigatorOpen.value && !isMobile.value);
  });
  effect(() => {
    body.classList.toggle('has-panel', roomPanelOpen.value && !isMobile.value);
  });
}

/**
 * Mounts the self-contained Preact `<HusShell />` (top bar, room navigator, room panel,
 * Preact annotator & 60 Hz screen pins, terrain sculpt brush, tool dock, settings,
 * developer drawer, help) and applies URL state (`?dev=`, `?v=`).
 */
export function mountAppShell(options: MountShellOptions, root: HTMLElement): ShellController {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const devParam = params.get('dev');
    if (devParam === '1') setDevMode(true);
    else if (devParam === '0') setDevMode(false);
  }

  const annotator = new AnnotatorController(options.api, {
    houseId: options.houseId,
    houseName: options.houseName,
  });
  const ctl = new ShellController({ api: annotator.getScopedApi(), notes: annotator });
  ctl.init();

  const share = typeof window !== 'undefined' ? readShareStateFromLocation() : null;
  if (share) guestMode.value = share.guest;

  bindBodyClasses();
  if (options.bindKeyboard !== false) {
    bindShellKeyboard(ctl);
  }
  render(<HusShell ctl={ctl} annotator={annotator} devDrawer={options.devDrawer} />, root);

  if (share) ctl.applyShareState(share);
  return ctl;
}

export const mountHusShell = mountAppShell;
