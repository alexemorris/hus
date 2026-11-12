import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import {
  currentRoomId,
  cycleRoomSheetSnap,
  deviceRevision,
  isCompactPhone,
  isMobile,
  liveLevels,
  roomPanelOpen,
  roomSheetSnap,
  timeOfDay,
  tradeView,
} from '../../state/shell-store.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type { RoomManifestEntry, TradeView } from '../../core/types/twin-ux.ts';
import { TRADE_VIEW_LABELS } from '../../core/types/twin-ux.ts';
import { Icon, type IconName } from './icons.tsx';
import { FinishesSection } from './FinishesSection.tsx';
import { LightingSection, LightRow, levelOf } from './LightingSection.tsx';
import { NotesSection } from './NotesSection.tsx';
import { floorEyebrowLabel, listFloors, propertyNameOf } from './room-data.ts';
import { useShell } from './shell-context.ts';

interface TradeSections {
  readonly lights: boolean;
  readonly scenes: boolean;
  readonly heating: boolean;
  readonly devices: boolean;
  readonly wholeHouseLights: boolean;
}

/** Which panel sections each trade view shows (same model, different emphasis). */
const TRADE_SECTIONS: Readonly<Record<TradeView, TradeSections>> = {
  owner: { lights: true, scenes: true, heating: true, devices: true, wholeHouseLights: true },
  architect: { lights: true, scenes: false, heating: true, devices: true, wholeHouseLights: true },
  builder: { lights: false, scenes: false, heating: true, devices: false, wholeHouseLights: false },
  electrician: { lights: true, scenes: true, heating: false, devices: true, wholeHouseLights: true },
  plumber: { lights: false, scenes: false, heating: true, devices: false, wholeHouseLights: false },
};

function RoomSections({ entry, sections }: { readonly entry: RoomManifestEntry; readonly sections: TradeSections }): JSX.Element {
  const ctl = useShell();
  const levels = liveLevels.value;
  // Re-render on device/UFH changes.
  void deviceRevision.value;

  const levelScenes = entry.scenes.length === 0 ? ctl.roomLevelScenes(entry.zoneId) : [];
  const ufhZone = ctl.ufhZoneForRoom(entry.zoneId);
  const anyOn = entry.lights.some((l) => levelOf(levels, l.circuitId) > 0.5);
  const zone = ctl.api.lighting.zones.get(entry.zoneId);

  return (
    <>
      {sections.lights && zone && <LightingSection zone={zone} levels={levels} showScenes={sections.scenes} />}

      {sections.lights && !zone && entry.lights.length > 0 && (
        <section class="shell-card">
          <div class="shell-card-head">
            <span class="shell-card-title">
              <Icon name="bulb" size={15} /> Lights
            </span>
            <button
              type="button"
              class="shell-chip"
              disabled={!anyOn}
              onClick={() => {
                for (const l of entry.lights) ctl.setLightLevel(l.circuitId, 0);
              }}
            >
              Room off
            </button>
          </div>
          <ul class="shell-lights" role="list">
            {entry.lights.map((l) => (
              <LightRow key={l.circuitId} light={l} level={levelOf(levels, l.circuitId)} />
            ))}
          </ul>
        </section>
      )}

      {sections.scenes && !zone && (entry.scenes.length > 0 || levelScenes.length > 0) && (
        <section class="shell-card">
          <div class="shell-card-head">
            <span class="shell-card-title">
              <Icon name="sparkle" size={15} /> Scenes
            </span>
          </div>
          <div class="shell-chips">
            {entry.scenes.map((s) => (
              <button key={s.id} type="button" class="shell-chip shell-chip-lg" onClick={() => ctl.recallScene(s)}>
                {s.label}
              </button>
            ))}
            {levelScenes.map((s) => (
              <button
                key={s.id}
                type="button"
                class="shell-chip shell-chip-lg"
                onClick={() => ctl.applyLevels(s.levels, `${s.label.replace(/^S\d+\s*/, '')} scene`)}
              >
                {s.label.replace(/^S\d+\s*/, '')}
              </button>
            ))}
          </div>
        </section>
      )}

      {sections.heating && ufhZone && (
        <section class="shell-card">
          <div class="shell-card-head">
            <span class="shell-card-title">
              <Icon name="flame" size={15} /> Heating
            </span>
            <span class={`shell-temp${ufhZone.heatingOn ? ' is-on' : ''}`}>{ufhZone.targetTempC}°C</span>
          </div>
          <div class="shell-row">
            <div class="shell-row-text">
              <span>{ufhZone.shortName || ufhZone.name}</span>
              <span class="shell-muted">{ufhZone.manifoldLabel}</span>
            </div>
            <button
              type="button"
              class={`shell-switch${ufhZone.heatingOn ? ' is-on is-warm' : ''}`}
              role="switch"
              aria-checked={ufhZone.heatingOn}
              aria-label={`Underfloor heating ${ufhZone.heatingOn ? 'on' : 'off'}`}
              onClick={() => ctl.toggleUfhZoneForRoom(entry.zoneId)}
            >
              <span class="shell-switch-knob" />
            </button>
          </div>
        </section>
      )}

      <FinishesSection entry={entry} />

      {sections.devices && entry.devices.length > 0 && (
        <section class="shell-card">
          <div class="shell-card-head">
            <span class="shell-card-title">
              <Icon name="device" size={15} /> Devices
            </span>
          </div>
          <div class="shell-chips">
            {entry.devices.map((d) => (
              <button
                key={d.interactableId}
                type="button"
                class="shell-chip shell-chip-lg"
                onClick={() => ctl.activateDevice(d.interactableId, d.label)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const TOD_OPTIONS: readonly { readonly id: TimeOfDay; readonly label: string; readonly icon: IconName }[] = [
  { id: 'day', label: 'Day', icon: 'sun' },
  { id: 'dusk', label: 'Dusk', icon: 'sunset' },
  { id: 'night', label: 'Night', icon: 'moon' },
];

function WholeHouse({ sections }: { readonly sections: TradeSections }): JSX.Element {
  const ctl = useShell();
  void deviceRevision.value;
  const gatesOpen = ctl.isGateOpenOrOpening();
  const tod = timeOfDay.value;
  return (
    <section class="shell-card shell-card-house">
      <div class="shell-card-head">
        <span class="shell-card-title">
          <Icon name="house" size={15} /> Whole house
        </span>
      </div>
      {sections.wholeHouseLights && (
        <div class="shell-house-actions">
          <button type="button" class="shell-action" onClick={() => ctl.allLightsOff()}>
            <Icon name="power" size={18} />
            <span>All off</span>
          </button>
          <button type="button" class="shell-action" onClick={() => ctl.eveningScene()}>
            <Icon name="sparkle" size={18} />
            <span>Evening</span>
          </button>
          <button
            type="button"
            class={`shell-action${gatesOpen ? ' is-active' : ''}`}
            onClick={() => ctl.toggleGates()}
          >
            <Icon name="gate" size={18} />
            <span>{gatesOpen ? 'Close gates' : 'Open gates'}</span>
          </button>
        </div>
      )}
      <div class="shell-row">
        <span class="shell-muted">Time of day</span>
        <div class="shell-seg shell-seg-sm" role="group" aria-label="Time of day">
          {TOD_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              class={`shell-seg-btn${tod === o.id ? ' is-active' : ''}`}
              aria-pressed={tod === o.id}
              title={o.label}
              onClick={() => ctl.setTimeOfDay(o.id)}
            >
              <Icon name={o.icon} size={14} />
              <span class="shell-seg-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function RoomPanel(): JSX.Element {
  const ctl = useShell();
  const roomId = currentRoomId.value;
  const entry = roomId ? ctl.api.rooms.getManifest(roomId) : undefined;
  const titleRoomId = entry?.zoneId ?? roomId;
  const trade = tradeView.value;
  const sections = TRADE_SECTIONS[trade];
  const open = roomPanelOpen.value;
  const compactSheet = isCompactPhone.value;
  const snap = roomSheetSnap.value;
  const dragStartY = useRef<number | null>(null);

  return (
    <aside
      class={`shell-panel shell-glass${open ? ' is-open' : ''}${isMobile.value ? ' is-drawer' : ''}${
        compactSheet ? ` is-bottom-sheet snap-${snap}` : ''
      }`}
      aria-label="Room controls"
      aria-hidden={!open}
    >
      {compactSheet && (
        <button
          type="button"
          class="shell-sheet-grabber"
          aria-label={`Resize room sheet (${snap})`}
          title="Tap or drag to resize sheet"
          onClick={() => cycleRoomSheetSnap()}
          onPointerDown={(e) => {
            dragStartY.current = e.clientY;
          }}
          onPointerUp={(e) => {
            if (dragStartY.current === null) return;
            const dy = e.clientY - dragStartY.current;
            dragStartY.current = null;
            if (Math.abs(dy) < 22) return;
            if (dy < -22) {
              roomSheetSnap.value = snap === 'peek' ? 'half' : 'full';
            } else if (dy > 22) {
              if (snap === 'full') roomSheetSnap.value = 'half';
              else if (snap === 'half') roomSheetSnap.value = 'peek';
              else roomPanelOpen.value = false;
            }
          }}
        >
          <span class="shell-sheet-pill" />
        </button>
      )}
      <div class="shell-panel-head">
        <div class="shell-panel-heading">
          <span class="shell-panel-eyebrow">
            {entry ? floorEyebrowLabel(listFloors(ctl.api), entry.floor) : 'Property'}
            {trade !== 'owner' && ` · ${TRADE_VIEW_LABELS[trade]} view`}
          </span>
          <span class="shell-panel-title shell-panel-title-lg">
            {titleRoomId ? ctl.roomLabel(titleRoomId) : propertyNameOf(ctl.api)}
          </span>
        </div>
        <button
          type="button"
          class="shell-icon-btn shell-icon-btn-sm"
          aria-label="Hide room controls"
          title="Hide room controls"
          onClick={() => {
            roomPanelOpen.value = false;
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div class="shell-panel-scroll" key={entry?.zoneId ?? 'none'}>
        {entry ? (
          <RoomSections entry={entry} sections={sections} />
        ) : (
          <p class="shell-empty shell-empty-lg">
            Pick a room from the list, or double-click inside the model, to see its lights, heating and notes.
          </p>
        )}
        <NotesSection roomId={entry?.zoneId ?? null} />
        <WholeHouse sections={sections} />
      </div>
    </aside>
  );
}
