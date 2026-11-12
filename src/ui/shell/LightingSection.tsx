import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { CircuitLevels } from '../../core/types/knx.ts';
import type { KnxZoneState } from '../../core/types/knx-zones.ts';
import type { RoomLightControl } from '../../core/types/twin-ux.ts';
import type { TwinLightingLayer, TwinLightingZone, TwinZoneCircuit } from '../../core/types/twin-api.ts';
import { Icon } from './icons.tsx';
import { useShell } from './shell-context.ts';

export function levelOf(levels: Readonly<CircuitLevels> | null, circuitId: string): number {
  if (!levels) return 0;
  const v: unknown = Reflect.get(levels, circuitId);
  return typeof v === 'number' ? v : 0;
}

interface LightRowProps {
  readonly light: RoomLightControl;
  readonly level: number;
}

/** One circuit: switch + (when dimmable) live dimmer. */
export function LightRow({ light, level }: LightRowProps): JSX.Element {
  const ctl = useShell();
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = Math.round(dragValue ?? level);
  const on = shown > 0;
  return (
    <li class={`shell-light${on ? ' is-on' : ''}`}>
      <button
        type="button"
        class={`shell-switch${on ? ' is-on' : ''}`}
        role="switch"
        aria-checked={on}
        aria-label={`${light.label}: ${on ? 'on' : 'off'}`}
        onClick={() => ctl.toggleLight(light.circuitId)}
      >
        <span class="shell-switch-knob" />
      </button>
      <div class="shell-light-body">
        <div class="shell-light-label">
          <span>{light.label}</span>
          {light.dimmable ? <span class="shell-light-pct">{shown}%</span> : <span class="shell-light-pct">{on ? 'On' : 'Off'}</span>}
        </div>
        {light.dimmable && (
          <input
            class="shell-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={shown}
            aria-label={`${light.label} brightness`}
            style={{ '--fill': `${shown}%` }}
            onInput={(e) => {
              const v = Number(e.currentTarget.value);
              setDragValue(v);
              ctl.setLightLevel(light.circuitId, v);
            }}
            onChange={() => setDragValue(null)}
            onPointerUp={() => setDragValue(null)}
          />
        )}
      </div>
    </li>
  );
}

function toLightControl(c: TwinZoneCircuit): RoomLightControl {
  return { circuitId: c.id, label: c.label, dimmable: c.dimmable };
}

function modeLabel(zone: TwinLightingZone, state: KnxZoneState): string {
  switch (state.mode) {
    case 'scene':
      return state.sceneIndex !== null ? (zone.scenes[state.sceneIndex]?.label ?? 'Scene') : 'Scene';
    case 'full':
      return 'Full';
    case 'night':
      return 'Night';
    case 'manual':
      return 'Custom';
    case 'off':
      return 'Off';
  }
}

function LayerGroup({
  layer,
  levels,
  showHeading,
}: {
  readonly layer: TwinLightingLayer;
  readonly levels: Readonly<CircuitLevels> | null;
  readonly showHeading: boolean;
}): JSX.Element {
  const ctl = useShell();
  const anyOn = layer.circuits.some((c) => levelOf(levels, c.id) > 0.5);
  return (
    <div class="shell-layer" data-layer={layer.kind}>
      {showHeading && (
        <div class="shell-layer-head">
          <span class="shell-layer-title">{layer.label}</span>
          <button
            type="button"
            class={`shell-switch shell-switch-sm${anyOn ? ' is-on' : ''}`}
            role="switch"
            aria-checked={anyOn}
            aria-label={`${layer.label}: ${anyOn ? 'on' : 'off'}`}
            onClick={() => {
              for (const c of layer.circuits) ctl.setLightLevel(c.id, anyOn ? 0 : 100);
            }}
          >
            <span class="shell-switch-knob" />
          </button>
        </div>
      )}
      <ul class="shell-lights" role="list">
        {layer.circuits.map((c) => (
          <LightRow key={c.id} light={toLightControl(c)} level={levelOf(levels, c.id)} />
        ))}
      </ul>
    </div>
  );
}

const ZONE_ACTIONS: readonly { readonly id: 'full' | 'night' | 'off'; readonly label: string }[] = [
  { id: 'full', label: 'Full' },
  { id: 'night', label: 'Night' },
  { id: 'off', label: 'Off' },
];

/**
 * Room lighting as a KNX zone: mode readout, Full / Night / Off, stored zone
 * scenes, then circuits grouped by fitting layer with live dimmers. Presence
 * detectors and wall-switch LEDs are shown when the zone has them.
 */
export function LightingSection({
  zone,
  levels,
  showScenes,
}: {
  readonly zone: TwinLightingZone;
  readonly levels: Readonly<CircuitLevels> | null;
  readonly showScenes: boolean;
}): JSX.Element {
  const ctl = useShell();
  const zones = ctl.api.lighting.zones;
  const state = zones.getState(zone.id);
  const presence = zones.presenceDetectors(zone.id);
  const switches = zones.switches(zone.id);
  const singleLayer = zone.layers.length === 1;

  const runAction = (id: 'full' | 'night' | 'off'): void => {
    if (id === 'full') zones.setFull(zone.id);
    else if (id === 'night') zones.setNight(zone.id);
    else zones.setOff(zone.id);
  };

  return (
    <section class="shell-card shell-lighting" aria-label={`${zone.name} lighting`}>
      <div class="shell-card-head">
        <span class="shell-card-title">
          <Icon name="bulb" size={15} /> Lighting
        </span>
        <span class={`shell-mode-badge is-${state.mode}`} aria-live="polite">
          {modeLabel(zone, state)}
        </span>
      </div>

      <div class="shell-seg shell-seg-sm shell-zone-actions" role="group" aria-label="Zone lighting mode">
        {ZONE_ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            class={`shell-seg-btn${state.mode === a.id ? ' is-active' : ''}`}
            aria-pressed={state.mode === a.id}
            onClick={() => runAction(a.id)}
          >
            <Icon name={a.id === 'full' ? 'sun' : a.id === 'night' ? 'moon' : 'power'} size={14} />
            <span class="shell-seg-label">{a.label}</span>
          </button>
        ))}
      </div>

      {showScenes && zone.scenes.length > 0 && (
        <div class="shell-chips shell-zone-scenes" role="group" aria-label="Scenes">
          {zone.scenes.map((s) => {
            const active = state.mode === 'scene' && state.sceneIndex === s.index;
            return (
              <button
                key={s.id}
                type="button"
                class={`shell-chip shell-chip-lg${active ? ' is-active' : ''}`}
                aria-pressed={active}
                onClick={() => zones.recallScene(zone.id, s.index)}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {zone.layers.map((layer) => (
        <LayerGroup key={layer.kind} layer={layer} levels={levels} showHeading={!singleLayer} />
      ))}

      {(presence.length > 0 || switches.length > 0) && (
        <div class="shell-zone-devices">
          {presence.map((p) => (
            <span key={p.pa} class={`shell-zone-device${p.detected ? ' is-active' : ''}`} title={`${p.name} (${p.pa})`}>
              <span class="shell-zone-dot" aria-hidden="true" />
              {p.detected ? 'Presence' : 'No presence'}
            </span>
          ))}
          {switches.map((sw) =>
            sw.gangs.map((g) => (
              <span
                key={`${sw.pa}-${g.gang}`}
                class={`shell-zone-device${g.ledOn ? ' is-active' : ''}`}
                title={`${sw.name} · ${sw.location} (${sw.pa}) gang ${g.gang}`}
              >
                <span class="shell-zone-dot" aria-hidden="true" />
                {g.label}
              </span>
            ))
          )}
        </div>
      )}
    </section>
  );
}
