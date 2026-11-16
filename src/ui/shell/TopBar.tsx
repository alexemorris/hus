import { TopBarVariationsButton } from './VariationsControl.tsx';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  devDrawerOpen,
  devMode,
  floorMode,
  guestMode,
  navigatorOpen,
  roomPanelOpen,
  settingsOpen,
  timeOfDay,
  toggleNavigator,
  toggleRoomPanel,
  tradeView,
  viewMode,
  type ShellViewMode,
} from '../../state/shell-store.ts';
import type { FloorViewMode, TimeOfDay } from '../../core/types/scene.ts';
import { TRADE_VIEW_LABELS } from '../../core/types/twin-ux.ts';
import { buildFloorPills, listFloors, propertyNameOf, type FloorPill } from './room-data.ts';
import { HusBrandMark, Icon, type IconName } from './icons.tsx';
import { useShell } from './shell-context.ts';

/** Floor pills; renders nothing when there are none (single-storey homes). */
export function FloorSwitcher(props: {
  readonly pills: readonly FloorPill[];
  readonly active: FloorViewMode;
  readonly onSelect: (id: FloorViewMode) => void;
}): JSX.Element | null {
  const { pills, active, onSelect } = props;
  if (pills.length === 0) return null;
  return (
    <div class="shell-seg" role="group" aria-label="Floor">
      {pills.map((f) => (
        <button
          key={f.id}
          type="button"
          class={`shell-seg-btn${active === f.id ? ' is-active' : ''}`}
          aria-pressed={active === f.id}
          title={f.key ? `${f.label} floor (${f.key})` : `${f.label} floor`}
          onClick={() => onSelect(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

const VIEWS: readonly {
  readonly id: ShellViewMode;
  readonly label: string;
  readonly icon: IconName;
  readonly hint: string;
}[] = [
  { id: '3d', label: '3D', icon: 'cube', hint: 'Perspective 3D view' },
  { id: 'plan', label: 'Plan', icon: 'plan', hint: 'Top-down floor plan' },
  { id: 'walk', label: 'Walk', icon: 'walk', hint: 'Walk through at eye level (W)' },
];

const TODS: readonly { readonly id: TimeOfDay; readonly label: string; readonly icon: IconName }[] = [
  { id: 'day', label: 'Day', icon: 'sun' },
  { id: 'dusk', label: 'Dusk', icon: 'sunset' },
  { id: 'night', label: 'Night', icon: 'moon' },
];

export function TopBar(): JSX.Element {
  const ctl = useShell();
  const floor = floorMode.value;
  const view = viewMode.value;
  const trade = tradeView.value;
  const tod = timeOfDay.value;
  const [muted, setMuted] = useState<boolean>(() => ctl.api.audio?.isMuted() ?? false);
  const [copied, setCopied] = useState<boolean>(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ctl.api.audio) return undefined;
    setMuted(ctl.api.audio.isMuted());
    return ctl.api.audio.onChanged(() => {
      setMuted(ctl.api.audio.isMuted());
    });
  }, [ctl]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleShare = (): void => {
    void ctl.share().then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 1800);
    });
  };

  return (
    <header class="shell-topbar" role="banner">
      <div class="shell-topbar-left">
        <button
          type="button"
          class={`shell-icon-btn${navigatorOpen.value ? ' is-active' : ''}`}
          title="Rooms"
          aria-label="Toggle room list"
          aria-pressed={navigatorOpen.value}
          onClick={() => toggleNavigator()}
        >
          <Icon name="menu" />
        </button>
        <div class="shell-brand">
          <HusBrandMark size={20} />
          <span class="shell-brand-name">{propertyNameOf(ctl.api)}</span>
          {guestMode.value && <span class="shell-badge">Shared view</span>}
        </div>
      </div>

      <div class="shell-topbar-center">
        <FloorSwitcher
          pills={buildFloorPills(listFloors(ctl.api))}
          active={floor}
          onSelect={(id) => ctl.setFloor(id)}
        />
        <div class="shell-seg" role="group" aria-label="View mode">
          {VIEWS.map((v) => {
            const isActive = view === v.id;
            const isActiveWalk = v.id === 'walk' && isActive;
            return (
              <button
                key={v.id}
                type="button"
                class={`shell-seg-btn${isActive ? ' is-active' : ''}`}
                aria-pressed={isActive}
                title={isActiveWalk ? 'Exit walkthrough (Esc)' : v.hint}
                onClick={() => ctl.setViewMode(isActiveWalk ? '3d' : v.id)}
              >
                <Icon name={v.icon} size={15} />
                <span class="shell-seg-label">{v.label}</span>
              </button>
            );
          })}
        </div>
        <div class="shell-seg shell-topbar-tod" role="group" aria-label="Time of day">
          {TODS.map((o) => (
            <button
              key={o.id}
              type="button"
              class={`shell-seg-btn${tod === o.id ? ' is-active' : ''}`}
              aria-label={o.label}
              aria-pressed={tod === o.id}
              title={`${o.label} lighting`}
              onClick={() => ctl.setTimeOfDay(o.id)}
            >
              <Icon name={o.icon} size={15} />
            </button>
          ))}
        </div>
      </div>

      <div class="shell-topbar-right">
        {trade !== 'owner' && (
          <button
            type="button"
            class="shell-role-pill"
            aria-label={`${TRADE_VIEW_LABELS[trade]} view — reset to Owner`}
            title={`Viewing as ${TRADE_VIEW_LABELS[trade]} — click to reset to Owner`}
            onClick={() => ctl.setTradeView('owner')}
          >
            <Icon name="eye" size={14} />
            <span class="shell-role-pill-label">{TRADE_VIEW_LABELS[trade]}</span>
            <Icon name="close" size={13} />
          </button>
        )}
        <TopBarVariationsButton />
        <div class="shell-topbar-actions">
          {devMode.value && (
            <button
              type="button"
              class={`shell-icon-btn${devDrawerOpen.value ? ' is-active' : ''}`}
              title="Developer tools"
              aria-label="Developer tools"
              aria-pressed={devDrawerOpen.value}
              onClick={() => {
                devDrawerOpen.value = !devDrawerOpen.value;
              }}
            >
              <Icon name="code" />
            </button>
          )}
          <button
            type="button"
            class={`shell-icon-btn${!muted ? ' is-unmuted' : ''}`}
            title={muted ? 'Unmute audio' : 'Mute audio'}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            onClick={() => {
              const next = ctl.api.audio?.toggleMuted() ?? !muted;
              setMuted(next);
            }}
          >
            <Icon name={muted ? 'volume-mute' : 'volume'} />
          </button>
          <button
            type="button"
            class={`shell-icon-btn${copied ? ' is-copied' : ''}`}
            title={copied ? 'Link copied' : 'Share view'}
            aria-label={copied ? 'Link copied' : 'Share view'}
            onClick={handleShare}
          >
            <Icon name={copied ? 'check' : 'share'} />
          </button>
          <button
            type="button"
            class={`shell-icon-btn${settingsOpen.value ? ' is-active' : ''}`}
            title="Settings"
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen.value}
            onClick={() => {
              settingsOpen.value = !settingsOpen.value;
            }}
          >
            <Icon name="gear" />
          </button>
          <button
            type="button"
            class={`shell-icon-btn${roomPanelOpen.value ? ' is-active' : ''}`}
            title="Room controls"
            aria-label="Toggle room controls"
            aria-pressed={roomPanelOpen.value}
            onClick={() => toggleRoomPanel()}
          >
            <Icon name="panel" />
          </button>
        </div>
      </div>
    </header>
  );
}
