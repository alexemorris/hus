import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  NOTE_TRADES,
  tradeView,
  units,
  type NoteTrade,
} from '../../state/shell-store.ts';
import {
  getScopedNoteMeta,
  updateScopedNoteMeta,
} from '../notes/scoped-annotations.ts';
import { annotationsList, selectedAnnotationId } from '../../state/notes-store.ts';
import { isRoomZoneId } from '../../state/url-state.ts';
import type { SceneAnnotationRecord } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import { TRADE_VIEW_LABELS } from '../../core/types/twin-ux.ts';
import { formatLength } from './format.ts';
import { Icon, type IconName } from './icons.tsx';
import { useShell } from './shell-context.ts';

type TradeFilter = 'all' | 'unassigned' | NoteTrade;

function isNoteTrade(value: string): value is NoteTrade {
  return NOTE_TRADES.some((t) => t === value);
}

function kindIcon(r: SceneAnnotationRecord): IconName {
  if (r.kind === 'measure') return 'ruler';
  if (r.kind === 'move') return 'hand';
  return 'pin';
}

type ManifestLookup = (zoneId: RoomZoneId) => { readonly zoneId: RoomZoneId } | undefined;

function canonicalRoom(zoneId: string, lookup: ManifestLookup): string | undefined {
  return isRoomZoneId(zoneId) ? lookup(zoneId)?.zoneId ?? zoneId : undefined;
}

function sameRoom(r: SceneAnnotationRecord, zoneId: RoomZoneId | null, lookup: ManifestLookup): boolean {
  if (!zoneId) return true;
  if (r.roomZoneId === zoneId) return true;
  // Notes may carry legacy zone ids; compare via the manifest's canonical room.
  const a = canonicalRoom(zoneId, lookup);
  return a !== undefined && a === canonicalRoom(r.roomZoneId, lookup);
}

export interface NotesSectionProps {
  readonly roomId: RoomZoneId | null;
}

export function NotesSection({ roomId }: NotesSectionProps): JSX.Element {
  const ctl = useShell();
  const records = annotationsList.value;
  const selectedId = selectedAnnotationId.value;
  const houseId = ctl.getHouseId();
  const meta = getScopedNoteMeta(houseId);
  const trade = tradeView.value;
  const [scope, setScope] = useState<'room' | 'all'>('room');
  const [tradeFilterState, setTradeFilter] = useState<TradeFilter | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // In a trade view, default the filter to that trade until the user picks one.
  const tradeFilter: TradeFilter = tradeFilterState ?? (trade !== 'owner' && isNoteTrade(trade) ? trade : 'all');

  const inScope = records.filter((r) => scope === 'all' || sameRoom(r, roomId, (z) => ctl.api.rooms.getManifest(z)));
  const visible = inScope.filter((r) => {
    const t = meta[String(r.id)]?.trade;
    if (tradeFilter === 'all') return true;
    if (tradeFilter === 'unassigned') return !t;
    return t === tradeFilter;
  });

  return (
    <section class="shell-card">
      <div class="shell-card-head">
        <span class="shell-card-title">
          <Icon name="pin" size={15} /> Notes
          <span class="shell-pill">{inScope.length}</span>
        </span>
        <div class="shell-card-actions">
          <button
            type="button"
            class="shell-chip"
            title="Pin a new note (N)"
            onClick={() => ctl.setTool('note')}
          >
            + Note
          </button>
          <div class="shell-menu-anchor">
            <button
              type="button"
              class={`shell-icon-btn shell-icon-btn-sm${exportOpen ? ' is-active' : ''}`}
              title="Export notes"
              aria-label="Export notes"
              aria-expanded={exportOpen}
              disabled={records.length === 0}
              onClick={() => setExportOpen(!exportOpen)}
            >
              <Icon name="download" size={15} />
            </button>
            {exportOpen && (
              <div class="shell-menu" role="menu" onClick={() => setExportOpen(false)}>
                <button type="button" role="menuitem" onClick={() => void ctl.copyNotesMarkdown()}>
                  <Icon name="copy" size={14} /> Copy as Markdown
                </button>
                <button type="button" role="menuitem" onClick={() => ctl.downloadNotesMarkdown()}>
                  <Icon name="download" size={14} /> Download Markdown
                </button>
                <button type="button" role="menuitem" onClick={() => ctl.downloadNotesJson()}>
                  <Icon name="download" size={14} /> Download JSON
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div class="shell-notes-filters">
        <div class="shell-seg shell-seg-sm" role="group" aria-label="Notes scope">
          <button
            type="button"
            class={`shell-seg-btn${scope === 'room' ? ' is-active' : ''}`}
            onClick={() => setScope('room')}
            disabled={!roomId}
          >
            This room
          </button>
          <button
            type="button"
            class={`shell-seg-btn${scope === 'all' || !roomId ? ' is-active' : ''}`}
            onClick={() => setScope('all')}
          >
            All
          </button>
        </div>
        <select
          class="shell-select shell-select-sm"
          aria-label="Filter notes by trade"
          value={tradeFilter}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === 'all' || v === 'unassigned' || isNoteTrade(v)) setTradeFilter(v);
          }}
        >
          <option value="all">All trades</option>
          <option value="unassigned">Unassigned</option>
          {NOTE_TRADES.map((t) => (
            <option key={t} value={t}>
              {TRADE_VIEW_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <p class="shell-empty">
          {records.length === 0
            ? 'No notes yet. Choose Note in the toolbar and click any surface.'
            : 'No notes match this filter.'}
        </p>
      ) : (
        <ul class="shell-notes" role="list">
          {visible.map((r) => {
            const m = meta[String(r.id)] ?? {};
            const isSelected = selectedId === r.id;
            const distance = r.measurement ? formatLength(r.measurement.distanceM, units.value) : null;
            return (
              <li key={r.id} class={`shell-note${isSelected ? ' is-selected' : ''}${m.resolved ? ' is-resolved' : ''}`}>
                <div class="shell-note-head">
                  <button
                    type="button"
                    class="shell-note-jump"
                    title="Show in model"
                    onClick={() => ctl.focusNote(r.id)}
                  >
                    <Icon name={kindIcon(r)} size={14} />
                    <span class="shell-note-id">#{r.id}</span>
                    {scope === 'all' && <span class="shell-note-room">{r.roomName}</span>}
                    {distance && <span class="shell-note-dist">{distance}</span>}
                  </button>
                  <select
                    class="shell-select shell-select-xs"
                    aria-label="Assign to trade"
                    value={m.trade ?? ''}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      updateScopedNoteMeta(houseId, r.id, { trade: isNoteTrade(v) ? v : undefined });
                    }}
                  >
                    <option value="">Anyone</option>
                    {NOTE_TRADES.map((t) => (
                      <option key={t} value={t}>
                        {TRADE_VIEW_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    class={`shell-icon-btn shell-icon-btn-xs${m.resolved ? ' is-active' : ''}`}
                    title={m.resolved ? 'Mark as open' : 'Mark as resolved'}
                    aria-label={m.resolved ? 'Mark as open' : 'Mark as resolved'}
                    aria-pressed={m.resolved === true}
                    onClick={() => updateScopedNoteMeta(houseId, r.id, { resolved: !m.resolved })}
                  >
                    <Icon name="check" size={13} />
                  </button>
                  <button
                    type="button"
                    class="shell-icon-btn shell-icon-btn-xs"
                    title="Delete note"
                    aria-label="Delete note"
                    onClick={() => ctl.deleteNote(r.id)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
                <textarea
                  class="shell-note-text"
                  rows={r.note.length > 60 ? 3 : 2}
                  placeholder="Describe the issue or instruction…"
                  value={r.note}
                  onInput={(e) => ctl.updateNoteText(r.id, e.currentTarget.value)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
