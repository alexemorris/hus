import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  TERRAIN_SCULPT_MAX_RADIUS_M,
  TERRAIN_SCULPT_MAX_STRENGTH_M,
  TERRAIN_SCULPT_MIN_RADIUS_M,
  TERRAIN_SCULPT_MIN_STRENGTH_M,
  type TerrainSculptMode,
} from '../../core/geo/terrain-sculpt.ts';
import {
  terrainSculptAvailable,
  terrainSculptSnapshot,
} from '../../state/terrain-sculpt-store.ts';
import { Icon } from './icons.tsx';
import { useShell } from './shell-context.ts';

const SCULPT_MODES: readonly {
  readonly id: TerrainSculptMode;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'raise', label: 'Raise', hint: 'Lift terrain mound along brush stroke' },
  { id: 'lower', label: 'Lower', hint: 'Carve hollow / swale along brush stroke' },
  { id: 'smooth', label: 'Smooth', hint: 'Relax terrain toward surrounding ring average' },
  { id: 'flatten', label: 'Flatten', hint: 'Level terrain toward initial stroke elevation' },
];

export function TerrainSculptPanel(): JSX.Element | null {
  const ctl = useShell();
  const available = terrainSculptAvailable.value;
  const snap = terrainSculptSnapshot.value;
  const [copyFeedback, setCopyFeedback] = useState<'json' | 'ts' | null>(null);

  if (!available) return null;

  return (
    <aside
      class={`shell-inspector shell-glass terrain-sculpt-panel${snap.active ? ' is-open' : ''}`}
      aria-label="Terrain sculpt inspector"
    >
      <header class="shell-inspector-head is-static">
        <span class="shell-inspector-title">Terrain Sculpt</span>
        <span class="shell-pill" title="Accumulated TerrainStamp count">
          {snap.stampCount} stamps
        </span>
        <button
          class="shell-icon-btn shell-icon-btn-sm"
          type="button"
          title="Close Terrain Sculpt (Esc)"
          aria-label="Close Terrain Sculpt"
          onClick={() => ctl.setTool('orbit')}
        >
          <Icon name="close" size={16} />
        </button>
      </header>

      <div class="hud-body terrain-sculpt-body">
        <section class="hud-section hud-section-last">
          <div class="terrain-sculpt-modes" role="group" aria-label="Sculpt brush mode">
            {SCULPT_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                class={`annotator-tool-btn terrain-sculpt-mode-btn mode-${m.id}${snap.mode === m.id ? ' is-active' : ''}`}
                aria-pressed={snap.mode === m.id}
                title={m.hint}
                onClick={() => ctl.setTerrainSculptMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div class="terrain-sculpt-sliders">
            <label class="terrain-sculpt-slider-row">
              <span class="annotator-field-label">Radius</span>
              <input
                class="annotator-rot-slider"
                type="range"
                min={String(TERRAIN_SCULPT_MIN_RADIUS_M)}
                max={String(TERRAIN_SCULPT_MAX_RADIUS_M)}
                step="0.5"
                aria-label="Brush radius in metres"
                value={String(snap.radiusM)}
                onInput={(e) =>
                  ctl.setTerrainSculptRadius(Number.parseFloat(e.currentTarget.value))
                }
              />
              <span class="annotator-rot-readout">{`${snap.radiusM.toFixed(1)} m`}</span>
            </label>

            <label class="terrain-sculpt-slider-row">
              <span class="annotator-field-label">Strength</span>
              <input
                class="annotator-rot-slider"
                type="range"
                min={String(TERRAIN_SCULPT_MIN_STRENGTH_M)}
                max={String(TERRAIN_SCULPT_MAX_STRENGTH_M)}
                step="0.05"
                aria-label="Brush strength in metres"
                value={String(snap.strength)}
                onInput={(e) =>
                  ctl.setTerrainSculptStrength(Number.parseFloat(e.currentTarget.value))
                }
              />
              <span class="annotator-rot-readout">{`${snap.strength.toFixed(2)} m`}</span>
            </label>
          </div>

          <div class="terrain-sculpt-actions">
            <button
              type="button"
              class="hud-inline-btn"
              disabled={!snap.canUndo}
              title="Undo last brush stroke"
              onClick={() => ctl.undoTerrainSculpt()}
            >
              {`Undo (${snap.strokeCount})`}
            </button>
            <button
              type="button"
              class="hud-inline-btn annotator-reset-btn"
              disabled={snap.stampCount === 0}
              title="Reset all sculpted terrain strokes"
              onClick={() => ctl.resetTerrainSculpt()}
            >
              Reset
            </button>
          </div>

          <div class="terrain-sculpt-export-row">
            <button
              type="button"
              class="hud-action-btn annotator-copy-btn"
              title="Copy { kind: 'sculptStamps', ... } TerrainModifier JSON to paste into defineHouse({ terrain: { modifiers: [...] } })"
              onClick={() => {
                void ctl.copyTerrainSculptModifier('json').then((ok) => {
                  if (ok) {
                    setCopyFeedback('json');
                    window.setTimeout(() => setCopyFeedback(null), 1800);
                  }
                });
              }}
            >
              {copyFeedback === 'json' ? 'Copied JSON!' : 'Copy TerrainModifier JSON'}
            </button>
            <button
              type="button"
              class="hud-inline-btn"
              title="Copy sculptStamps(...) TypeScript helper snippet"
              onClick={() => {
                void ctl.copyTerrainSculptModifier('ts').then((ok) => {
                  if (ok) {
                    setCopyFeedback('ts');
                    window.setTimeout(() => setCopyFeedback(null), 1800);
                  }
                });
              }}
            >
              {copyFeedback === 'ts' ? 'Copied TS!' : 'Copy TS'}
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
