import { TopBarVariationsButton } from './VariationsControl.tsx';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  devDrawerOpen,
  devMode,
  floorMode,
  guestMode,
  navigatorOpen,
  openHelp,
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
import { TRADE_VIEW_LABELS, type TradeView } from '../../core/types/twin-ux.ts';

const TRADE_VIEWS: readonly TradeView[] = ['owner', 'architect', 'builder', 'electrician', 'plumber'];
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

function isTradeView(value: string): value is TradeView {
  return TRADE_VIEWS.some((v) => v === value);
}

export function TopBar(): JSX.Element {
  const ctl = useShell();
  const floor = floorMode.value;
  const view = viewMode.value;
  const trade = tradeView.value;
  const tod = timeOfDay.value;
  const [muted, setMuted] = useState<boolean>(() => ctl.api.audio?.isMuted() ?? false);

  useEffect(() => {
    if (!ctl.api.audio) return undefined;
    setMuted(ctl.api.audio.isMuted());
    return ctl.api.audio.onChanged(() => {
      setMuted(ctl.api.audio.isMuted());
    });
  }, [ctl]);

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
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              class={`shell-seg-btn${view === v.id ? ' is-active' : ''}`}
              aria-pressed={view === v.id}
              title={v.hint}
              onClick={() => ctl.setViewMode(v.id)}
            >
              <Icon name={v.icon} size={15} />
              <span class="shell-seg-label">{v.label}</span>
            </button>
          ))}
        </div>
        <div class="shell-seg shell-topbar-tod" role="group" aria-label="Time of day">
          {TODS.map((o) => (
            <button
              key={o.id}
              type="button"
              class={`shell-seg-btn${tod === o.id ? ' is-active' : ''}`}
              aria-pressed={tod === o.id}
              title={`${o.label} lighting`}
              onClick={() => ctl.setTimeOfDay(o.id)}
            >
              <Icon name={o.icon} size={14} />
              <span class="shell-seg-label">{o.label}</span>
            </button>
          ))}
        </div>
        {view === 'walk' && (
          <button
            type="button"
            class="shell-btn shell-walk-exit"
            title="Leave the walkthrough (Esc)"
            onClick={() => ctl.setViewMode('3d')}
          >
            <Icon name="close" size={15} />
            <span class="shell-btn-label">Exit walk</span>
          </button>
        )}
      </div>

      <div class="shell-topbar-right">
        <TopBarVariationsButton />
        <label class="shell-viewas" title="Show the model as a particular trade sees it">
          <Icon name="eye" size={15} />
          <span class="shell-viewas-label">View as</span>
          <select
            class="shell-select"
            value={trade}
            aria-label="View as"
            onChange={(e) => {
              const next = e.currentTarget.value;
              if (isTradeView(next)) ctl.setTradeView(next);
            }}
          >
            {TRADE_VIEWS.map((v) => (
              <option key={v} value={v}>
                {TRADE_VIEW_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          class="shell-btn shell-btn-primary"
          title="Copy a link to this exact view"
          onClick={() => {
            void ctl.share();
          }}
        >
          <Icon name="share" size={16} />
          <span class="shell-btn-label">Share</span>
        </button>
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
          class={`shell-icon-btn${!muted ? ' is-active' : ''}`}
          title={muted ? 'Unmute audio' : 'Mute audio'}
          aria-label={muted ? 'Unmute audio' : 'Mute audio'}
          aria-pressed={!muted}
          onClick={() => {
            const next = ctl.api.audio?.toggleMuted() ?? !muted;
            setMuted(next);
          }}
        >
          <Icon name={muted ? 'volume-mute' : 'volume'} />
        </button>
        <button
          type="button"
          class="shell-icon-btn"
          title="Help (?)"
          aria-label="Help"
          onClick={() => openHelp(0)}
        >
          <Icon name="help" />
        </button>
        <button
          type="button"
          class={`shell-icon-btn${settingsOpen.value ? ' is-active' : ''}`}
          title="Settings"
          aria-label="Settings"
          onClick={() => {
            settingsOpen.value = true;
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
    </header>
  );
}

