import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type {
  PaintSheen,
  RoomFinishSpec,
  RoomManifestEntry,
  RoomPaintSurfaceSpec,
} from '../../core/types/twin-ux.ts';
import { Icon } from './icons.tsx';

const SHEEN_LABELS: Readonly<Record<PaintSheen, string>> = {
  limewash: 'Limewash',
  'dead-flat': 'Dead Flat',
  'estate-emulsion': 'Estate Emulsion',
  'modern-emulsion': 'Modern Emulsion',
  'estate-eggshell': 'Estate Eggshell',
  'exterior-eggshell': 'Exterior Eggshell',
  satinwood: 'Satinwood',
  'modern-eggshell': 'Modern Eggshell',
  'full-gloss': 'Full Gloss',
};

export function formatPaintSheenLabel(sheen: string | undefined): string | undefined {
  if (!sheen) return undefined;
  const known = (SHEEN_LABELS as Readonly<Record<string, string>>)[sheen];
  if (known) return known;
  return sheen
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function normalizeWallSpecs(
  walls: RoomFinishSpec['walls']
): readonly RoomPaintSurfaceSpec[] {
  if (!walls) return [];
  if (Array.isArray(walls)) return walls;
  return [walls as RoomPaintSurfaceSpec];
}

interface PaintRowItem {
  readonly surface: string;
  readonly spec: RoomPaintSurfaceSpec;
}

function collectPaintRows(finishes: RoomFinishSpec | undefined): readonly PaintRowItem[] {
  if (!finishes) return [];
  const rows: PaintRowItem[] = [];
  const wallSpecs = normalizeWallSpecs(finishes.walls);
  wallSpecs.forEach((spec, idx) => {
    rows.push({
      surface: wallSpecs.length > 1 && idx > 0 ? 'Feature / Secondary' : 'Walls',
      spec,
    });
  });
  if (finishes.ceiling) {
    rows.push({ surface: 'Ceiling', spec: finishes.ceiling });
  }
  if (finishes.trim) {
    rows.push({ surface: 'Trim & Woodwork', spec: finishes.trim });
  }
  return rows;
}

function collectSpecRows(
  finishes: RoomFinishSpec | undefined
): readonly { readonly label: string; readonly value: string }[] {
  if (!finishes) return [];
  const out: { label: string; value: string }[] = [];
  if (finishes.flooring) out.push({ label: 'Flooring', value: finishes.flooring });
  if (finishes.tilingOrWallpaper) {
    out.push({ label: 'Tiling / Wallpaper', value: finishes.tilingOrWallpaper });
  }
  if (finishes.joinery) out.push({ label: 'Joinery', value: finishes.joinery });
  if (finishes.doors) out.push({ label: 'Doors', value: finishes.doors });
  if (finishes.windows) out.push({ label: 'Windows', value: finishes.windows });
  return out;
}

function collectDesignNotes(entry: RoomManifestEntry): readonly string[] {
  const raw = [...(entry.finishes?.notes ?? []), ...(entry.notes ?? [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export interface FinishesSectionProps {
  readonly entry: RoomManifestEntry;
}

export function FinishesSection({ entry }: FinishesSectionProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(true);
  const paintRows = collectPaintRows(entry.finishes);
  const specRows = collectSpecRows(entry.finishes);
  const designNotes = collectDesignNotes(entry);

  if (paintRows.length === 0 && specRows.length === 0 && designNotes.length === 0) {
    return null;
  }

  return (
    <section class="shell-card shell-finishes-card" aria-label="Finishes and architectural notes">
      <button
        type="button"
        class="shell-card-head shell-finishes-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span class="shell-card-title">
          <Icon name="palette" size={15} /> Finishes &amp; Notes
        </span>
        <span class="shell-finishes-head-right">
          {paintRows.length > 0 && (
            <span class="shell-finishes-preview-dots" aria-hidden="true">
              {paintRows.slice(0, 4).map((row, idx) => (
                <span
                  key={`${row.surface}-${row.spec.hex}-${idx}`}
                  class="shell-swatch-dot shell-swatch-dot-sm"
                  style={{ backgroundColor: row.spec.hex }}
                  title={`${row.surface}: ${row.spec.name} (${row.spec.hex})`}
                />
              ))}
            </span>
          )}
          <Icon
            name="chevron-down"
            size={15}
            className={`shell-finishes-chevron${expanded ? ' is-open' : ''}`}
          />
        </span>
      </button>

      {expanded && (
        <div class="shell-finishes-body">
          {paintRows.length > 0 && (
            <ul class="shell-finishes-swatches" role="list">
              {paintRows.map((row, idx) => {
                const { spec } = row;
                const sheenLabel = formatPaintSheenLabel(spec.sheen);
                const titleLine = spec.code ? `${spec.name} · ${spec.code}` : spec.name;
                const metaParts: string[] = [];
                if (spec.brand) metaParts.push(spec.brand);
                if (sheenLabel) metaParts.push(sheenLabel);
                return (
                  <li key={`${row.surface}-${spec.name}-${idx}`} class="shell-finish-swatch-row">
                    <span
                      class="shell-swatch-dot"
                      style={{ backgroundColor: spec.hex }}
                      aria-hidden="true"
                    />
                    <div class="shell-finish-swatch-info">
                      <div class="shell-finish-swatch-top">
                        <span class="shell-finish-surface">{row.surface}</span>
                        <span class="shell-finish-hex">{spec.hex.toUpperCase()}</span>
                      </div>
                      <div class="shell-finish-name">{titleLine}</div>
                      {metaParts.length > 0 && (
                        <div class="shell-finish-meta">{metaParts.join(' · ')}</div>
                      )}
                      {spec.notes && <div class="shell-finish-note">{spec.notes}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {specRows.length > 0 && (
            <dl class="shell-finishes-specs">
              {specRows.map((s) => (
                <div key={s.label} class="shell-finishes-spec-row">
                  <dt class="shell-finishes-spec-label">{s.label}</dt>
                  <dd class="shell-finishes-spec-val">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {designNotes.length > 0 && (
            <div class="shell-finishes-notes-wrap">
              <div class="shell-finishes-subhead">Specification &amp; Renovation Notes</div>
              <ul class="shell-finishes-notes">
                {designNotes.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
