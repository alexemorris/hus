import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { TwinWalkthroughState } from '../../core/types/twin-api.ts';
import {
  currentRoomId,
  isCoarsePointer,
  isMobile,
  navigatorOpen,
  viewMode,
  walkHintNonce,
} from '../../state/shell-store.ts';
import { Icon } from './icons.tsx';
import { floorEyebrowLabel, listFloors, propertyNameOf } from './room-data.ts';
import { useShell } from './shell-context.ts';

const HINT_AUTO_HIDE_MS = 6000;
const JOYSTICK_RADIUS_PX = 48;
const JOYSTICK_DEADZONE_PX = 5;
const JOYSTICK_FOLLOW_SLACK_PX = 14;
const JOYSTICK_EDGE_PAD_PX = 64;

const HINTS: readonly { readonly keys: readonly string[]; readonly label: string }[] = [
  { keys: ['W', 'A', 'S', 'D'], label: 'Walk' },
  { keys: ['Shift'], label: 'Run' },
  { keys: ['Space'], label: 'Jump' },
  { keys: ['C'], label: 'Crouch' },
  { keys: ['F'], label: 'Use' },
  { keys: ['Esc'], label: 'Exit' },
];

function useWalkState(): TwinWalkthroughState {
  const ctl = useShell();
  const [state, setState] = useState<TwinWalkthroughState>(() => ctl.api.walkthrough.getState());
  useEffect(() => {
    setState(ctl.api.walkthrough.getState());
    return ctl.api.walkthrough.onStateChanged(setState);
  }, [ctl]);
  return state;
}

/** Top-left room indicator + teleport dropdown + quick Exit button on touch. */
function WalkRoomChip({ showTouchControls }: { readonly showTouchControls: boolean }): JSX.Element {
  const ctl = useShell();
  const [open, setOpen] = useState(false);
  const roomId = currentRoomId.value;
  const entry = roomId ? ctl.api.rooms.getManifest(roomId) : undefined;
  const floorLabel = entry ? floorEyebrowLabel(listFloors(ctl.api), entry.floor) : 'Outside';
  const spawns = ctl.api.walkthrough.spawns();
  return (
    <div class={`shell-walk-room${navigatorOpen.value ? ' is-shifted' : ''}`}>
      <div class="shell-walk-room-bar">
        <button
          type="button"
          class="shell-walk-chip shell-glass"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Jump to another room"
          onClick={() => setOpen(!open)}
        >
          <span class="shell-walk-chip-eyebrow">{floorLabel}</span>
          <span class="shell-walk-chip-title">
            {roomId ? ctl.roomLabel(roomId) : propertyNameOf(ctl.api)}
          </span>
          <Icon name="chevron-down" size={14} />
        </button>
        {showTouchControls && (
          <button
            type="button"
            class="shell-walk-chip shell-walk-exit shell-glass"
            aria-label="Exit walkthrough back to 3D orbit view"
            title="Exit walk (3D view)"
            onClick={() => ctl.setViewMode('3d')}
          >
            <Icon name="cube" size={15} />
            <span>Exit walk</span>
          </button>
        )}
      </div>
      {open && (
        <div class="shell-walk-menu shell-glass" role="menu" aria-label="Go to room">
          {spawns.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              class={`shell-walk-menu-item${s.zoneId === roomId ? ' is-active' : ''}`}
              onClick={() => {
                ctl.api.walkthrough.teleport(s.id);
                setOpen(false);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface FloatingJoystickState {
  readonly active: boolean;
  /** Floating base center inside the half-screen touch zone (px), or null when resting at home. */
  readonly baseX: number | null;
  readonly baseY: number | null;
  readonly knobX: number;
  readonly knobY: number;
  readonly sprinting: boolean;
}

/**
 * Floating-origin virtual thumbstick for mobile and tablet touchscreens.
 * Used as a dual-stick pair:
 *  - `side="left"`  → Move / Strafe / Sprint (`ctl.api.walkthrough.setTouchMove`)
 *  - `side="right"` → Look / Turn / Pitch (`ctl.api.walkthrough.setTouchLook`)
 * Touching anywhere inside the half-screen zone teleports the floating stick
 * base directly under the thumb and follows the thumb if dragged past the rim.
 */
function WalkFloatingJoystick({
  side,
  hasPrompt,
}: {
  readonly side: 'left' | 'right';
  readonly hasPrompt?: boolean;
}): JSX.Element {
  const ctl = useShell();
  const zoneRef = useRef<HTMLDivElement>(null);
  const activePointerId = useRef<number | null>(null);
  const originClientRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const downStartRef = useRef<{ x: number; y: number; timeMs: number; maxDist: number }>({
    x: 0,
    y: 0,
    timeMs: 0,
    maxDist: 0,
  });
  const [stick, setStick] = useState<FloatingJoystickState>({
    active: false,
    baseX: null,
    baseY: null,
    knobX: 0,
    knobY: 0,
    sprinting: false,
  });

  useEffect(() => {
    return () => {
      if (side === 'left') {
        ctl.api.walkthrough.setTouchMove(0, 0, false);
      } else {
        ctl.api.walkthrough.setTouchLook(0, 0);
      }
    };
  }, [ctl, side]);

  const clampBaseToZone = (clientX: number, clientY: number): { baseX: number; baseY: number } => {
    const zone = zoneRef.current;
    if (!zone) return { baseX: 80, baseY: 80 };
    const rect = zone.getBoundingClientRect();
    const minX = Math.min(JOYSTICK_EDGE_PAD_PX, rect.width * 0.5);
    const maxX = Math.max(minX, rect.width - JOYSTICK_EDGE_PAD_PX);
    const minY = Math.min(JOYSTICK_EDGE_PAD_PX, rect.height * 0.5);
    const maxY = Math.max(minY, rect.height - JOYSTICK_EDGE_PAD_PX);
    const baseX = Math.max(minX, Math.min(maxX, clientX - rect.left));
    const baseY = Math.max(minY, Math.min(maxY, clientY - rect.top));
    return { baseX, baseY };
  };

  const updateFromMove = (clientX: number, clientY: number): void => {
    let originX = originClientRef.current.x;
    let originY = originClientRef.current.y;
    let rawDx = clientX - originX;
    let rawDy = clientY - originY;
    let dist = Math.hypot(rawDx, rawDy);

    const travelFromInitial = Math.hypot(
      clientX - downStartRef.current.x,
      clientY - downStartRef.current.y
    );
    if (travelFromInitial > downStartRef.current.maxDist) {
      downStartRef.current.maxDist = travelFromInitial;
    }

    // Dynamic floating base follow when dragged beyond the outer rim + slack
    const maxReach = JOYSTICK_RADIUS_PX + JOYSTICK_FOLLOW_SLACK_PX;
    if (dist > maxReach && dist > 1e-4) {
      const pull = dist - maxReach;
      originX += (rawDx / dist) * pull;
      originY += (rawDy / dist) * pull;
      originClientRef.current = { x: originX, y: originY };
      rawDx = clientX - originX;
      rawDy = clientY - originY;
      dist = Math.hypot(rawDx, rawDy);
    }

    const { baseX, baseY } = clampBaseToZone(originX, originY);

    if (dist <= JOYSTICK_DEADZONE_PX) {
      setStick({
        active: true,
        baseX,
        baseY,
        knobX: 0,
        knobY: 0,
        sprinting: false,
      });
      if (side === 'left') {
        ctl.api.walkthrough.setTouchMove(0, 0, false);
      } else {
        ctl.api.walkthrough.setTouchLook(0, 0);
      }
      return;
    }

    const clampedDist = Math.min(JOYSTICK_RADIUS_PX, dist);
    const dirX = rawDx / dist;
    const dirY = rawDy / dist;
    const knobX = dirX * clampedDist;
    const knobY = dirY * clampedDist;
    const effectiveMag =
      (clampedDist - JOYSTICK_DEADZONE_PX) / (JOYSTICK_RADIUS_PX - JOYSTICK_DEADZONE_PX);
    const normX = dirX * effectiveMag;
    const normY = -dirY * effectiveMag;
    const sprinting = side === 'left' && effectiveMag > 0.78;

    setStick({
      active: true,
      baseX,
      baseY,
      knobX,
      knobY,
      sprinting,
    });

    if (side === 'left') {
      ctl.api.walkthrough.setTouchMove(normX, normY, sprinting);
    } else {
      ctl.api.walkthrough.setTouchLook(normX, normY);
    }
  };

  const resetStick = (): void => {
    activePointerId.current = null;
    setStick({
      active: false,
      baseX: null,
      baseY: null,
      knobX: 0,
      knobY: 0,
      sprinting: false,
    });
    if (side === 'left') {
      ctl.api.walkthrough.setTouchMove(0, 0, false);
    } else {
      ctl.api.walkthrough.setTouchLook(0, 0);
    }
  };

  useEffect(() => {
    const onGlobalPointerEnd = (e: PointerEvent): void => {
      if (activePointerId.current !== null && e.pointerId === activePointerId.current) {
        resetStick();
      }
    };
    const onGlobalTouchEnd = (e: TouchEvent): void => {
      if (activePointerId.current !== null && e.touches.length === 0) {
        resetStick();
      }
    };
    const onWindowBlur = (): void => {
      if (activePointerId.current !== null) {
        resetStick();
      }
    };
    window.addEventListener('pointerup', onGlobalPointerEnd, true);
    window.addEventListener('pointercancel', onGlobalPointerEnd, true);
    window.addEventListener('touchend', onGlobalTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onGlobalTouchEnd, { passive: true });
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('pointerup', onGlobalPointerEnd, true);
      window.removeEventListener('pointercancel', onGlobalPointerEnd, true);
      window.removeEventListener('touchend', onGlobalTouchEnd);
      window.removeEventListener('touchcancel', onGlobalTouchEnd);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [ctl, side]);

  const label =
    side === 'left' ? (stick.sprinting ? 'RUN' : 'MOVE') : 'LOOK';
  const ariaLabel =
    side === 'left' ? 'Left floating movement joystick' : 'Right floating look joystick';
  const ariaValue =
    side === 'left'
      ? stick.sprinting
        ? 'Running'
        : stick.active
          ? 'Walking'
          : 'Idle'
      : stick.active
        ? 'Looking'
        : 'Idle';

  const floatingStyle =
    stick.active && stick.baseX !== null && stick.baseY !== null
      ? {
          left: `${(stick.baseX - 58).toFixed(1)}px`,
          top: `${(stick.baseY - 58).toFixed(1)}px`,
          right: 'auto',
          bottom: 'auto',
        }
      : undefined;

  return (
    <div
      ref={zoneRef}
      class={`shell-walk-joystick-zone is-${side}`}
      role="slider"
      aria-label={ariaLabel}
      aria-valuetext={ariaValue}
      onPointerDown={(e) => {
        if (activePointerId.current !== null) return;
        e.stopPropagation();
        const zone = zoneRef.current;
        if (!zone) return;
        const { baseX, baseY } = clampBaseToZone(e.clientX, e.clientY);
        const rect = zone.getBoundingClientRect();
        originClientRef.current = { x: rect.left + baseX, y: rect.top + baseY };
        downStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          timeMs: performance.now(),
          maxDist: 0,
        };
        activePointerId.current = e.pointerId;
        try {
          zone.setPointerCapture(e.pointerId);
        } catch {
          // Ignore synthetic pointer capture errors
        }
        setStick({
          active: true,
          baseX,
          baseY,
          knobX: 0,
          knobY: 0,
          sprinting: false,
        });
        if (side === 'left') {
          ctl.api.walkthrough.setTouchMove(0, 0, false);
        } else {
          ctl.api.walkthrough.setTouchLook(0, 0);
        }
      }}
      onPointerMove={(e) => {
        if (activePointerId.current !== e.pointerId) return;
        e.stopPropagation();
        updateFromMove(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (activePointerId.current !== e.pointerId) return;
        e.stopPropagation();
        const wasQuickTap =
          side === 'right' &&
          Boolean(hasPrompt) &&
          downStartRef.current.maxDist < 10 &&
          performance.now() - downStartRef.current.timeMs < 250;
        resetStick();
        if (wasQuickTap) {
          ctl.api.walkthrough.interact();
        }
      }}
      onPointerCancel={(e) => {
        if (activePointerId.current !== e.pointerId) return;
        e.stopPropagation();
        resetStick();
      }}
      onLostPointerCapture={(e) => {
        if (activePointerId.current !== e.pointerId) return;
        resetStick();
      }}
    >
      <div
        class={`shell-walk-joystick is-${side} shell-glass${stick.active ? ' is-active' : ''}${stick.sprinting ? ' is-sprint' : ''}`}
        style={floatingStyle}
      >
        <div class="shell-walk-joystick-ring" aria-hidden="true" />
        <div
          class="shell-walk-joystick-knob"
          style={{
            transform: `translate3d(${stick.knobX.toFixed(1)}px, ${stick.knobY.toFixed(1)}px, 0)`,
          }}
          aria-hidden="true"
        />
        <span class="shell-walk-joystick-label">{label}</span>
      </div>
    </div>
  );
}

/** Right-side touch action buttons (Jump, Crouch, Use/Interact) positioned above the right joystick. */
function WalkTouchActions({ state }: { readonly state: TwinWalkthroughState }): JSX.Element {
  const ctl = useShell();
  return (
    <div
      class="shell-walk-touch-actions"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {state.prompt && (
        <button
          type="button"
          class="shell-walk-touch-btn is-primary shell-glass"
          aria-label={state.prompt}
          onClick={() => ctl.api.walkthrough.interact()}
        >
          <Icon name="sparkle" size={18} />
          <span>{state.prompt}</span>
        </button>
      )}
      <div class="shell-walk-touch-row">
        <button
          type="button"
          class={`shell-walk-touch-circle shell-glass${state.crouched ? ' is-active' : ''}`}
          aria-pressed={state.crouched}
          aria-label="Toggle crouch"
          title="Crouch"
          onClick={() => ctl.api.walkthrough.toggleCrouch()}
        >
          <Icon name="crouch" size={18} />
          <span>{state.crouched ? 'Stand' : 'Crouch'}</span>
        </button>
        <button
          type="button"
          class="shell-walk-touch-circle shell-glass"
          aria-label="Jump or climb"
          title="Jump"
          onClick={() => ctl.api.walkthrough.jump()}
        >
          <Icon name="jump" size={18} />
          <span>Jump</span>
        </button>
        <button
          type="button"
          class={`shell-walk-touch-circle shell-glass${state.prompt ? ' is-target' : ''}`}
          aria-label={state.prompt ?? 'Use object under crosshair'}
          title={state.prompt ?? 'Use / Interact'}
          onClick={() => ctl.api.walkthrough.interact()}
        >
          <Icon name="target" size={18} />
          <span>Use</span>
        </button>
      </div>
    </div>
  );
}

/** Compact bottom-centre key hints; auto-hides, `?` re-shows. */
function WalkHints(): JSX.Element {
  const nonce = walkHintNonce.value;
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), HINT_AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [nonce]);
  return (
    <div class={`shell-walk-hints shell-glass${visible ? '' : ' is-hidden'}`} aria-hidden={!visible} role="note">
      {HINTS.map((h) => (
        <span key={h.label} class="shell-walk-hint">
          {h.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
          <span>{h.label}</span>
        </span>
      ))}
      <span class="shell-walk-hint shell-walk-hint-faint">
        <kbd>?</kbd>
        <span>Show again</span>
      </span>
    </div>
  );
}

/**
 * First-person walkthrough overlay: minimal crosshair, interaction pill next
 * to it, room chip top-left, dual floating-origin virtual thumbsticks (Left = Move,
 * Right = Look) + action pad on touch/mobile/foldable devices, and an auto-hiding
 * desktop hint bar.
 */
export function WalkOverlay(): JSX.Element | null {
  const ctl = useShell();
  const state = useWalkState();
  const showTouchControls = isCoarsePointer.value || isMobile.value;
  if (viewMode.value !== 'walk' || !state.active) return null;
  return (
    <div class="shell-walk" aria-label="Walkthrough">
      <div class={`shell-walk-crosshair${state.prompt ? ' is-target' : ''}`} aria-hidden="true" />
      {state.prompt && (
        <button
          type="button"
          class="shell-walk-prompt"
          aria-live="polite"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            ctl.api.walkthrough.interact();
          }}
        >
          <kbd>{showTouchControls ? 'TAP' : 'F'}</kbd>
          <span>{state.prompt}</span>
        </button>
      )}
      <WalkRoomChip showTouchControls={showTouchControls} />
      {showTouchControls && <WalkFloatingJoystick side="left" />}
      {showTouchControls && <WalkFloatingJoystick side="right" hasPrompt={Boolean(state.prompt)} />}
      {showTouchControls && <WalkTouchActions state={state} />}
      {!showTouchControls && <WalkHints />}
      {state.crouched && !showTouchControls && <span class="shell-walk-status shell-glass">Crouching</span>}
    </div>
  );
}
