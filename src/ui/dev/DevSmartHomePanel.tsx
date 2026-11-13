import type { ReadonlySignal } from '@preact/signals';
import type { ComponentChildren, JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { LodPolicyMode } from '../../core/entities.ts';
import type { ScenePreset } from '../../core/types/knx.ts';
import type { FloorViewMode } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import { devStore } from './dev-store.ts';
import { devLodDiagnostics, devSmartHomeEvents } from './dev-tools-runtime.ts';
import type { DevToolsDeps } from './mount-dev-tools.ts';

const LOD_MODES: readonly { readonly id: LodPolicyMode; readonly label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'lod0', label: 'LOD0' },
  { id: 'lod1', label: 'LOD1' },
  { id: 'lod2', label: 'LOD2' },
];

const EEPROM_BASE_ADDRESS = 0x4000;
const EEPROM_ROW_BYTES = 16;
const SCROLL_LIST_STYLE = { maxHeight: '260px', overflowY: 'auto' } as const;

interface PanelProps {
  readonly deps: DevToolsDeps;
  /** Re-reads engine / bus state after an action that may not emit its own change event. */
  readonly refresh: () => void;
}

/** Calls `onChange` on every change of `source` after the initial value. */
function onSignalChange(source: ReadonlySignal<unknown>, onChange: () => void): () => void {
  let primed = false;
  return source.subscribe(() => {
    if (primed) onChange();
    primed = true;
  });
}

/**
 * Calls `onChange` whenever the KNX bus state, the smart-home hub, a device or the
 * viewport changes (telegram traffic alone is tracked through `devStore`).
 * Returns an unsubscribe function.
 */
export function subscribeLiveDeps({ knx, hub, api }: DevToolsDeps, onChange: () => void): () => void {
  const unsubscribers = [
    knx.subscribe((event) => {
      if (event.type !== 'telegram') onChange();
    }),
    hub.subscribe((event) => {
      if (event.type === 'entityChanged') onChange();
    }),
    api.devices.onChanged(onChange),
    api.walkthrough.onChanged(onChange),
    onSignalChange(devStore.floorViewMode, onChange),
    onSignalChange(devStore.ceilingCutaway, onChange),
    onSignalChange(devLodDiagnostics, onChange),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

/** Re-renders on live changes; returns a manual refresh for actions without a change event. */
function useLiveDeps(deps: DevToolsDeps): () => void {
  const [, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => subscribeLiveDeps(deps, refresh), [deps, refresh]);
  return refresh;
}

function Card(props: {
  readonly title: string;
  readonly meta?: string;
  readonly children: ComponentChildren;
}): JSX.Element {
  return (
    <section class="shell-card">
      <div class="shell-card-head">
        <span class="shell-card-title">{props.title}</span>
        {props.meta !== undefined && <span class="shell-muted">{props.meta}</span>}
      </div>
      {props.children}
    </section>
  );
}

function SwitchRow(props: { readonly label: string; readonly on: boolean; readonly onToggle: () => void }): JSX.Element {
  return (
    <div class="shell-row">
      <span>{props.label}</span>
      <button
        type="button"
        class={`shell-switch shell-switch-sm${props.on ? ' is-on' : ''}`}
        role="switch"
        aria-checked={props.on}
        aria-label={props.label}
        onClick={props.onToggle}
      >
        <span class="shell-switch-knob" />
      </button>
    </div>
  );
}

function ActionRow(props: {
  readonly label: string;
  readonly status: string;
  readonly action: string;
  readonly onAction: () => void;
}): JSX.Element {
  return (
    <div class="shell-row">
      <span class="shell-row-text">
        <span>{props.label}</span>
        <span class="shell-muted">{props.status}</span>
      </span>
      <button type="button" class="shell-chip" aria-label={`${props.label}: ${props.action}`} onClick={props.onAction}>
        {props.action}
      </button>
    </div>
  );
}

function chipClass(active: boolean): string {
  return `shell-chip${active ? ' is-active' : ''}`;
}

function TransportStatus({ deps: { api } }: { readonly deps: DevToolsDeps }): JSX.Element {
  const transport = api.lighting.getTransport();
  const live = transport.mode !== 'simulation';
  return (
    <div class="shell-row" role="status">
      <span class="shell-muted">KNX transport</span>
      <span class={`twin-status-pill${live ? ' is-active' : ''}`} title={`Transport ${transport.status}`}>
        {live ? 'Live Gateway' : 'Simulation'} · {transport.status}
      </span>
    </div>
  );
}

/** One entry per zone that has a wall push-button gang (first gang label wins). */
function switchZones(deps: DevToolsDeps): readonly { readonly zoneId: RoomZoneId; readonly label: string }[] {
  const byZone = new Map<RoomZoneId, string>();
  for (const button of deps.knx.getPushButtons()) {
    for (const gang of button.gangs) {
      if (!byZone.has(gang.zoneId)) byZone.set(gang.zoneId, gang.label);
    }
  }
  return [...byZone].map(([zoneId, label]) => ({ zoneId, label }));
}

function ScenesAndSwitchesCard({ deps, refresh }: PanelProps): JSX.Element {
  const { knx, api } = deps;
  const scenes = knx.getScenes();
  const activeScene = knx.getActiveSceneIndex();
  const zones = switchZones(deps);
  const sensors = api.lighting.roomMotionSensors();
  const lux = api.lighting.getAmbientLux();
  const act = (fn: () => void) => (): void => {
    fn();
    refresh();
  };
  const recall = (scene: ScenePreset): void => {
    if (scene.isSwitchScene) knx.recallScene(scene.index);
    else knx.recallScene(scene.index, knx.getProject().centralPa.aiBridge, 'AI / UI');
  };

  return (
    <Card title="Scenes & switches" meta={`${lux} lx · ${knx.isBelowLuxThreshold() ? 'night dim' : 'daylight'}`}>
      <div class="shell-chips" role="group" aria-label="Scene recall">
        {scenes.map((scene) => (
          <button
            key={scene.index}
            type="button"
            class={chipClass(scene.index === activeScene)}
            aria-pressed={scene.index === activeScene}
            title={`${scene.code} · ${scene.name}`}
            onClick={act(() => recall(scene))}
          >
            {scene.shortLabel}
          </button>
        ))}
        <button type="button" class="shell-chip" onClick={act(() => api.lighting.allOff())}>
          All Off
        </button>
      </div>

      {zones.length > 0 && (
        <details open={zones.length <= 6}>
          <summary class="shell-muted">Wall switches · {zones.length} zones</summary>
          <div style={SCROLL_LIST_STYLE}>
            {zones.map(({ zoneId, label }) => (
              <div key={zoneId} class="shell-row">
                <span class="shell-row-text">
                  <span>{label}</span>
                  <span class="shell-muted">{knx.getZoneSceneLabel(zoneId)}</span>
                </span>
                <div class="shell-chips">
                  <button
                    type="button"
                    class="shell-chip"
                    aria-label={`${label} switch: short press up`}
                    onClick={act(() => api.lighting.pressZoneSwitch(zoneId, 'up'))}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    class="shell-chip"
                    aria-label={`${label} switch: short press down`}
                    onClick={act(() => api.lighting.pressZoneSwitch(zoneId, 'down'))}
                  >
                    ▼
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {knx.getZone('courtyard') && (
        <ActionRow
          label="Courtyard switch"
          status={api.devices.getCourtyardModeLabel()}
          action="Press"
          onAction={act(() => api.devices.pressCourtyardSwitch())}
        />
      )}
      <ActionRow
        label="Front gates"
        status={api.devices.getGatesStatusLabel()}
        action={api.devices.isGatesOpen() ? 'Close' : 'Open'}
        onAction={act(() => api.devices.toggleGates())}
      />
      <ActionRow
        label="Bifolds"
        status={api.devices.isBifoldsOpen() ? 'Open' : 'Closed'}
        action={api.devices.isBifoldsOpen() ? 'Close' : 'Open'}
        onAction={act(() => api.devices.toggleBifolds())}
      />
      <ActionRow
        label="Frame TV art"
        status={api.devices.isTvArtMode() ? api.devices.getTvArtTitle() : 'Off (no presence)'}
        action="Next art"
        onAction={act(() => api.devices.cycleTvArt())}
      />

      {sensors.length > 0 && (
        <div class="shell-chips" role="group" aria-label="Room motion sensors">
          {sensors.map((sensor) => (
            <button
              key={sensor.id}
              type="button"
              class={chipClass(sensor.occupied)}
              aria-pressed={sensor.occupied}
              onClick={act(() => api.lighting.toggleRoomMotion(sensor.id))}
            >
              {sensor.label}: {sensor.occupied ? 'Motion' : 'Clear'}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function CircuitsCard({ deps: { knx } }: PanelProps): JSX.Element {
  const circuits = knx.getCircuits();
  const levels = knx.getTargetLevels();
  const onCount = circuits.filter((c) => (levels[c.id] ?? 0) > 0).length;

  return (
    <Card title="Live circuits & dimmers" meta={`${onCount}/${circuits.length} on`}>
      <div style={SCROLL_LIST_STYLE}>
        {circuits.map((circuit) => {
          const pct = Math.round(levels[circuit.id] ?? 0);
          return (
            <div key={circuit.id} class={`hud-channel-row${pct > 0 ? ' is-on' : ''}`}>
              <button
                type="button"
                class="hud-ch-power"
                title={`Toggle ${circuit.name} (${circuit.gaSwitch})`}
                aria-label={`Toggle ${circuit.shortName}`}
                aria-pressed={pct > 0}
                onClick={() => knx.toggleCircuit(circuit.id)}
              />
              <span class="hud-ch-name" title={circuit.location}>
                {circuit.shortName}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={pct}
                class="hud-ch-slider"
                aria-label={`${circuit.shortName} dimmer`}
                onInput={(e) => knx.setCircuitLevel(circuit.id, Number(e.currentTarget.value), false)}
                onChange={(e) => knx.setCircuitLevel(circuit.id, Number(e.currentTarget.value), true)}
              />
              <span class="hud-ch-val">{pct}%</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ViewportCard({ deps: { api }, refresh }: PanelProps): JSX.Element {
  const floorMode = api.floors.getMode();
  const floors: readonly { readonly id: FloorViewMode; readonly label: string }[] = [
    ...api.floors.list(),
    { id: 'all', label: 'All' },
  ];
  const lodMode = api.dev.getLodPolicyMode();
  const diag = api.dev.getLodDiagnostics();
  const focusedRoom = diag.rooms.find((r) => r.zoneId === diag.focusedZoneId)?.shortName ?? diag.focusedZoneId;
  const detailedRooms = diag.rooms.filter((r) => r.tier > 0).length;
  const hasUfh = api.devices.hasUfh();

  const syncFloors = (): void => {
    devStore.syncViewportState({
      floorViewMode: api.floors.getMode(),
      ceilingCutaway: api.floors.isCeilingCutaway(),
    });
    refresh();
  };
  const showUfhLayer = (): void => {
    if (api.floors.getMode() === 'first') api.floors.setMode('ground');
    syncFloors();
  };

  return (
    <Card title="Viewport, LOD & UFH">
      <div class="shell-chips" role="group" aria-label="Floor">
        {floors.map((floor) => (
          <button
            key={floor.id}
            type="button"
            class={chipClass(floor.id === floorMode)}
            aria-pressed={floor.id === floorMode}
            onClick={() => {
              api.floors.setMode(floor.id);
              syncFloors();
            }}
          >
            {floor.label}
          </button>
        ))}
      </div>
      <SwitchRow
        label="Ceiling cutaway"
        on={api.floors.isCeilingCutaway()}
        onToggle={() => {
          api.floors.toggleCeilingCutaway();
          syncFloors();
        }}
      />
      <SwitchRow
        label="Walkthrough"
        on={api.walkthrough.isActive()}
        onToggle={() => {
          api.walkthrough.toggle();
          refresh();
        }}
      />

      <div class="shell-chips" role="group" aria-label="LOD policy">
        {LOD_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            class={chipClass(mode.id === lodMode)}
            aria-pressed={mode.id === lodMode}
            onClick={() => {
              api.dev.setLodPolicyMode(mode.id);
              refresh();
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <p class="shell-muted" role="status">
        Focus {focusedRoom} · LOD{diag.focusedZoneTier} · {detailedRooms} rooms detailed ·{' '}
        {diag.rooms.length - detailedRooms} culled to shell
      </p>

      {hasUfh && (
        <SwitchRow
          label="UFH X-ray pipes"
          on={api.devices.isUfhLayerVisible()}
          onToggle={() => {
            if (api.devices.toggleUfhLayer()) showUfhLayer();
            else refresh();
          }}
        />
      )}
      {hasUfh && (
        <div class="shell-chips" role="group" aria-label="UFH zones">
          {api.devices.ufhZones().map((zone) => (
            <button
              key={zone.id}
              type="button"
              class={chipClass(zone.heatingOn)}
              aria-pressed={zone.heatingOn}
              title={zone.name}
              onClick={() => {
                if (!api.devices.isUfhLayerVisible()) {
                  api.devices.setUfhLayerVisible(true);
                  showUfhLayer();
                }
                api.devices.toggleUfhZone(zone.id);
                refresh();
              }}
            >
              {zone.shortName} · {zone.heatingOn ? 'On' : 'Off'}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function UnifiCard({ deps: { hub }, refresh }: PanelProps): JSX.Element | null {
  const cameras = hub.protect.getCameras();
  const accessPoints = hub.access.getAccessPoints();
  if (cameras.length === 0 && accessPoints.length === 0) return null;
  const events = devSmartHomeEvents.value;
  const act = (fn: () => void) => (): void => {
    fn();
    refresh();
  };

  return (
    <Card title="UniFi Protect & Access" meta={`${cameras.length} cameras · ${accessPoints.length} access points`}>
      {cameras.length > 0 && (
        <SwitchRow
          label="3D CCTV frustums"
          on={hub.protect.areFrustumsVisible()}
          onToggle={act(() => hub.protect.toggleAllFrustums())}
        />
      )}
      {accessPoints.map((point) => (
        <ActionRow
          key={point.entityId}
          label={point.shortName}
          status={point.isLocked ? 'Locked' : `Unlocked · ${point.lastCredentialMethod}`}
          action={point.isLocked ? 'NFC unlock' : 'NFC lock'}
          onAction={act(() => hub.triggerAccessUnlock(point.entityId, 'NFC Card'))}
        />
      ))}
      {cameras.map((camera) => (
        <div key={camera.entityId} class="shell-row">
          <span class="shell-row-text">
            <span>{camera.shortName}</span>
            <span class="shell-muted">{camera.activeDetection === 'none' ? 'Idle' : camera.activeDetection}</span>
          </span>
          <div class="shell-chips">
            <button
              type="button"
              class="shell-chip"
              aria-label={`${camera.shortName}: simulate LPR vehicle`}
              onClick={act(() => hub.triggerCameraSmartDetection(camera.entityId, 'vehicle'))}
            >
              LPR
            </button>
            <button
              type="button"
              class="shell-chip"
              aria-label={`${camera.shortName}: simulate motion`}
              onClick={act(() => hub.triggerCameraSmartDetection(camera.entityId, 'person'))}
            >
              Motion
            </button>
            {camera.activeDetection !== 'none' && (
              <button
                type="button"
                class="shell-chip"
                aria-label={`${camera.shortName}: clear detection`}
                onClick={act(() => hub.triggerCameraSmartDetection(camera.entityId, 'none'))}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      ))}
      {events.length > 0 && (
        <div class="hud-bus-list" aria-label="Recent UniFi events">
          {events.map((ev) => (
            <div key={ev.id} class="telegram-row" title={`${ev.sourceAddress} → ${ev.targetAddress}`}>
              {ev.timestamp} {ev.eventType} {ev.summary}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function hexCellClass(index: number): string | undefined {
  if (index >= 24 && index <= 31) return 'hex-param';
  if (index >= 32 && index <= 51) return 'hex-scene';
  return undefined;
}

function toHex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function EepromHex({ bytes }: { readonly bytes: Uint8Array }): JSX.Element {
  const rows: JSX.Element[] = [];
  for (let offset = 0; offset < bytes.length; offset += EEPROM_ROW_BYTES) {
    rows.push(
      <div key={offset}>
        <span class="hex-addr">0x{toHex(EEPROM_BASE_ADDRESS + offset, 4)}: </span>
        {Array.from(bytes.subarray(offset, offset + EEPROM_ROW_BYTES), (byte, col) => (
          <span key={col} class={hexCellClass(offset + col)}>
            {toHex(byte, 2)}{' '}
          </span>
        ))}
      </div>
    );
  }
  return (
    <pre class="hud-hex-view" aria-label="EEPROM image">
      {rows}
    </pre>
  );
}

function BusInspector({ deps: { knx } }: PanelProps): JSX.Element {
  const telegrams = devStore.recentTelegrams.value;
  const telegramCount = devStore.telegramCount.value;
  const eeprom = knx.compileEEPROMImage(true);

  return (
    <section class="shell-card">
      <details>
        <summary class="shell-card-title">
          KNX bus & EEPROM inspector <span class="hud-count">{telegramCount}</span>
        </summary>
        <div class="shell-row">
          <span class="shell-muted">Recent telegrams</span>
          <button
            type="button"
            class="shell-chip"
            onClick={() => {
              knx.clearTelegrams();
              devStore.syncKnxState({ telegramCount: 0, recentTelegrams: [] });
            }}
          >
            Clear
          </button>
        </div>
        <div class="hud-bus-list" style={SCROLL_LIST_STYLE} aria-label="KNX telegram log">
          {telegrams.length === 0 && <div class="telegram-row">No telegrams yet</div>}
          {telegrams.map((tg) => (
            <div key={tg.id} class="telegram-row" title={tg.hex}>
              <span class="hex-addr">{tg.timestamp}</span> {tg.src} → {tg.dst}{' '}
              <span class="hud-status-apci">{tg.apci}</span> {tg.summary}
            </div>
          ))}
        </div>
        {eeprom.length > 0 && (
          <div class="shell-row">
            <span class="shell-muted">EEPROM image · {eeprom.length} bytes</span>
            {knx.getIsDirty() && <span class="hud-dirty-tag">UNFLASHED</span>}
          </div>
        )}
        {eeprom.length > 0 && <EepromHex bytes={eeprom} />}
      </details>
    </section>
  );
}

/**
 * Smart home & KNX developer panel: scenes, wall switches, live circuits,
 * viewport / LOD / UFH toggles, UniFi simulation and the KNX bus inspector.
 * Renders entirely from the injected deps; no static DOM is required.
 */
export function DevSmartHomePanel({ deps }: { readonly deps: DevToolsDeps }): JSX.Element {
  const refresh = useLiveDeps(deps);
  return (
    <div class="shell-dev-tools">
      <TransportStatus deps={deps} />
      <ScenesAndSwitchesCard deps={deps} refresh={refresh} />
      <CircuitsCard deps={deps} refresh={refresh} />
      <ViewportCard deps={deps} refresh={refresh} />
      <UnifiCard deps={deps} refresh={refresh} />
      <BusInspector deps={deps} refresh={refresh} />
    </div>
  );
}
