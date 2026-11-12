import type { JSX } from 'preact';
import {
  activeTool,
  isCoarsePointer,
  isMobile,
  sectionCut,
  viewMode,
  type ShellTool,
} from '../../state/shell-store.ts';
import { terrainSculptAvailable } from '../../state/terrain-sculpt-store.ts';
import { Icon, type IconName } from './icons.tsx';
import { useShell } from './shell-context.ts';

interface DockTool {
  readonly id: ShellTool;
  readonly label: string;
  readonly icon: IconName;
  readonly key: string;
  readonly hint: string;
  readonly requiresTerrain?: boolean;
}

const TOOLS: readonly DockTool[] = [
  { id: 'orbit', label: 'Orbit', icon: 'hand', key: 'Esc', hint: 'Drag to orbit · right-click or Alt+click to inspect asset' },
  { id: 'inspect', label: 'Inspect', icon: 'inspect', key: 'I', hint: 'Click any fixture, sanitaryware, appliance, or joinery to inspect specs' },
  { id: 'measure', label: 'Measure', icon: 'ruler', key: 'M', hint: 'Click two points to measure' },
  { id: 'note', label: 'Note', icon: 'pin', key: 'N', hint: 'Click any surface to pin a note' },
  { id: 'sculpt', label: 'Sculpt', icon: 'sculpt', key: 'T', hint: 'Drag across site ground to sculpt · right-drag to pan', requiresTerrain: true },
];

export function ToolDock(): JSX.Element | null {
  const ctl = useShell();
  const tool = activeTool.value;
  const hasTerrain = terrainSculptAvailable.value;
  const isTouch = isCoarsePointer.value || isMobile.value;
  if (viewMode.value === 'walk') return null;

  const visibleTools = TOOLS.filter((t) => !t.requiresTerrain || hasTerrain);
  const activeHint =
    tool === 'orbit' && isTouch
      ? '1-finger orbit · 2-finger pan & pinch zoom · double-tap room'
      : (visibleTools.find((t) => t.id === tool)?.hint ?? '');

  return (
    <div class="shell-dock-wrap">
      <div class="shell-dock-hint" aria-live="polite">
        {activeHint}
      </div>
      <nav class="shell-dock" aria-label="Tools">
        {visibleTools.map((t) => (
          <button
            key={t.id}
            type="button"
            class={`shell-dock-btn${tool === t.id ? ' is-active' : ''}`}
            aria-pressed={tool === t.id}
            title={`${t.label} (${t.key})`}
            onClick={() => (t.id === 'orbit' ? ctl.setTool('orbit') : ctl.toggleTool(t.id))}
          >
            <Icon name={t.icon} size={18} />
            <span>{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          class={`shell-dock-btn${sectionCut.value ? ' is-active' : ''}`}
          aria-pressed={sectionCut.value}
          title="Section: cut away ceilings to see inside"
          onClick={() => ctl.toggleSection()}
        >
          <Icon name="section" size={18} />
          <span>Section</span>
        </button>
        <span class="shell-dock-sep" aria-hidden="true" />
        <button
          type="button"
          class="shell-dock-btn"
          title="Recenter on the current room (F)"
          onClick={() => ctl.recenter()}
        >
          <Icon name="target" size={18} />
          <span>Recenter</span>
        </button>
      </nav>
    </div>
  );
}
