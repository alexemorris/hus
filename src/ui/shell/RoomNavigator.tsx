import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { currentRoomId, isMobile, liveLevels, navigatorOpen, roomVariations } from '../../state/shell-store.ts';
import type { CircuitLevels } from '../../core/types/knx.ts';
import type { RoomManifestEntry } from '../../core/types/twin-ux.ts';
import type { TwinLightingZone } from '../../core/types/twin-api.ts';
import { Icon } from './icons.tsx';
import { useShell } from './shell-context.ts';

/**
 * Circuits currently on in a room. Uses the room's lighting zone (every KNX
 * circuit across all layers) when one exists, else the manifest light list.
 */
function countLightsOn(
  entry: RoomManifestEntry,
  zone: TwinLightingZone | undefined,
  levels: Readonly<CircuitLevels> | null,
): number {
  if (!levels) return 0;
  const ids: readonly string[] = zone ? zone.circuitIds : entry.lights.map((l) => l.circuitId);
  let on = 0;
  for (const id of ids) {
    const level: unknown = Reflect.get(levels, id);
    if (typeof level === 'number' && level > 0.5) on += 1;
  }
  return on;
}

export function RoomNavigator(): JSX.Element {
  const ctl = useShell();
  const tree = ctl.api.rooms.navTree();
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>({});
  const [query, setQuery] = useState('');
  const current = currentRoomId.value;
  const currentEntry = current ? ctl.api.rooms.getManifest(current) : undefined;
  const levels = liveLevels.value;
  const variations = roomVariations.value;
  const open = navigatorOpen.value;
  const q = query.trim().toLowerCase();

  return (
    <aside
      class={`shell-nav shell-glass${open ? ' is-open' : ''}${isMobile.value ? ' is-drawer' : ''}`}
      aria-label="Rooms"
      aria-hidden={!open}
    >
      <div class="shell-panel-head">
        <span class="shell-panel-title">Rooms</span>
        <button
          type="button"
          class="shell-icon-btn shell-icon-btn-sm"
          aria-label="Hide room list"
          title="Hide room list"
          onClick={() => {
            navigatorOpen.value = false;
          }}
        >
          <Icon name="chevron-left" size={16} />
        </button>
      </div>
      <div class="shell-nav-search">
        <input
          class="shell-input"
          type="search"
          placeholder="Find a room…"
          aria-label="Find a room"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      <div class="shell-nav-scroll">
        {tree.map((group) => {
          const rooms = q ? group.rooms.filter((r) => r.label.toLowerCase().includes(q)) : group.rooms;
          if (rooms.length === 0) return null;
          const isCollapsed = !q && collapsed[group.id] === true;
          return (
            <section key={group.id} class="shell-nav-group">
              <button
                type="button"
                class="shell-nav-group-btn"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed({ ...collapsed, [group.id]: !isCollapsed })}
              >
                <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={14} />
                <span>{group.label}</span>
                <span class="shell-nav-count">{group.rooms.length}</span>
              </button>
              {!isCollapsed && (
                <ul class="shell-nav-list" role="list">
                  {rooms.map((room) => {
                    const isCurrent = currentEntry?.zoneId === room.zoneId;
                    const lightsOn = countLightsOn(room, ctl.api.lighting.zones.get(room.zoneId), levels);
                    const varCount = variations.filter((g) => g.zoneId === room.zoneId).length;
                    return (
                      <li key={room.zoneId}>
                        <button
                          type="button"
                          class={`shell-nav-room${isCurrent ? ' is-current' : ''}`}
                          aria-current={isCurrent ? 'location' : undefined}
                          title={`Go to ${room.label}`}
                          onClick={() => {
                            ctl.highlightRoom(null);
                            ctl.selectRoom(room.zoneId);
                          }}
                          onPointerEnter={() => ctl.highlightRoom(room.zoneId)}
                          onPointerLeave={() => ctl.highlightRoom(null)}
                        >
                          <span class="shell-nav-room-label">{room.label}</span>
                          {varCount > 0 && (
                            <span
                              class="shell-nav-var"
                              title={`${varCount} design variation${varCount === 1 ? "" : "s"}`}
                            >
                              <Icon name="layers" size={11} />
                              {varCount > 1 ? varCount : ""}
                            </span>
                          )}
                          {lightsOn > 0 && (
                            <span class="shell-nav-lit" title={`${lightsOn} light${lightsOn === 1 ? '' : 's'} on`}>
                              <Icon name="bulb" size={12} />
                              {lightsOn}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <div class="shell-nav-foot">Tip: double-click inside the model to jump to a room.</div>
    </aside>
  );
}
