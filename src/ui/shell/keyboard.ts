import { inspectedAssetSnapshot } from '../../state/asset-inspector-store.ts';
import {
  activeTool,
  closeTopOverlay,
  helpOpen,
  helpStep,
  openHelp,
  settingsOpen,
  showWalkHints,
} from '../../state/shell-store.ts';
import { floorModeForDigit, listFloors } from './room-data.ts';
import type { ShellController } from './shell-controller.ts';

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Global keyboard shortcuts for the shell:
 * F recenter · 1..N floors (N+1 = all; none for single-storey homes) · W walk · M measure · N note · ? help · Esc close/back.
 * Walk-mode movement keys are left to the walkthrough controller.
 */
export function bindShellKeyboard(ctl: ShellController): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(document.activeElement)) {
      if (e.key === 'Escape' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return;
    }
    const walking = ctl.isWalking();

    if (e.key === 'Escape') {
      if (inspectedAssetSnapshot.value !== null && activeTool.value === 'orbit') {
        e.preventDefault();
        ctl.closeAssetInspector();
        return;
      }
      if (closeTopOverlay()) {
        e.preventDefault();
        return;
      }
      if (walking && !ctl.api.walkthrough.getState().pointerLocked) {
        e.preventDefault();
        ctl.setViewMode('3d');
        return;
      }
      if (activeTool.value !== 'orbit') {
        ctl.setTool('orbit');
      }
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      if (walking && !helpOpen.value) {
        showWalkHints();
        return;
      }
      if (helpOpen.value) closeTopOverlay();
      else openHelp(0);
      return;
    }

    if (helpOpen.value && !e.repeat) {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (helpStep.value < 2) {
          helpStep.value += 1;
        } else {
          closeTopOverlay();
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (helpStep.value > 0) {
          helpStep.value -= 1;
        }
        return;
      }
      return;
    }

    // Modal dialogs swallow the remaining shortcuts.
    if (helpOpen.value || settingsOpen.value || e.repeat) return;

    // In walk mode WASD/F/C/Space belong to the walkthrough controller.
    if (walking) return;

    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const mode = floorModeForDigit(listFloors(ctl.api), Number(digit[1]));
      if (mode !== null) ctl.setFloor(mode);
      return;
    }

    switch (e.code) {
      case 'KeyF':
        e.preventDefault();
        ctl.recenter();
        break;
      case 'KeyW':
        e.preventDefault();
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
        ctl.setViewMode('walk');
        break;
      case 'KeyI':
        e.preventDefault();
        ctl.toggleTool('inspect');
        break;
      case 'KeyM':
        e.preventDefault();
        ctl.toggleTool('measure');
        break;
      case 'KeyN':
      case 'KeyA':
        e.preventDefault();
        ctl.toggleTool('note');
        break;
      case 'KeyT':
        if (ctl.isTerrainSculptAvailable()) {
          e.preventDefault();
          ctl.toggleTool('sculpt');
        }
        break;
      default:
        break;
    }
  });
}
