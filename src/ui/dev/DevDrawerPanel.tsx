import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { devDrawerOpen, devMode, devTab, type DevTab } from '../../state/shell-store.ts';
import { TwinStatusBadge } from './components/TwinStatusBadge.tsx';
import { DevSmartHomePanel } from './DevSmartHomePanel.tsx';
import { devToolsDeps } from './mount-dev-tools.ts';
import { Icon } from '../shell/icons.tsx';
import { useShell } from '../shell/shell-context.ts';

const TABS: readonly { readonly id: DevTab; readonly label: string }[] = [
  { id: 'smart-home', label: 'Smart home & KNX' },
  { id: 'diagnostics', label: 'Tools' },
];

/**
 * Developer drawer: the Smart home & KNX panel (rendered from the injected dev
 * deps) plus object / rendering tools. Kept out of the everyday UI.
 */
export function DevDrawerPanel(): JSX.Element {
  const ctl = useShell();
  const enabled = devMode.value;
  const open = enabled && devDrawerOpen.value;
  const tab = devTab.value;
  const deps = devToolsDeps.value;
  const [blurOn, setBlurOn] = useState(() => ctl.api.dev.isMotionBlurEnabled());

  // Leaving developer mode leaves any developer-only tool too.
  useEffect(() => {
    if (!enabled) devDrawerOpen.value = false;
  }, [enabled]);

  return (
    <aside class={`shell-dev shell-glass${open ? ' is-open' : ''}`} aria-label="Developer tools" hidden={!open}>
      <div class="shell-panel-head">
        <span class="shell-panel-title">
          <Icon name="code" size={15} /> Developer
        </span>
        <button
          type="button"
          class="shell-icon-btn shell-icon-btn-sm"
          aria-label="Close developer tools"
          onClick={() => {
            devDrawerOpen.value = false;
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div class="shell-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            class={`shell-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => {
              devTab.value = t.id;
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div class="shell-dev-scroll">
        {open && tab === 'smart-home' && (
          <div class="shell-dev-host shell-dev-tools">
            <TwinStatusBadge />
            {deps ? (
              <DevSmartHomePanel deps={deps} />
            ) : (
              <p class="shell-muted">Smart home tools are unavailable: this viewer was started without developer tools.</p>
            )}
          </div>
        )}
        <div class="shell-dev-host shell-dev-tools" hidden={tab !== 'diagnostics'}>
          <section class="shell-card">
            <div class="shell-card-head">
              <span class="shell-card-title">Object tools</span>
            </div>
            <p class="shell-muted">Move or rotate furniture and fittings; changes are saved as notes.</p>
            <div class="shell-chips">
              <button type="button" class="shell-chip shell-chip-lg" onClick={() => ctl.activateObjectTool('move')}>
                Move object
              </button>
              <button type="button" class="shell-chip shell-chip-lg" onClick={() => ctl.activateObjectTool('rotate')}>
                Rotate object
              </button>
            </div>
          </section>
          <section class="shell-card">
            <div class="shell-card-head">
              <span class="shell-card-title">Rendering</span>
            </div>
            <div class="shell-row">
              <span>Camera motion blur</span>
              <button
                type="button"
                class={`shell-switch${blurOn ? ' is-on' : ''}`}
                role="switch"
                aria-checked={blurOn}
                aria-label="Camera motion blur"
                onClick={() => setBlurOn(ctl.api.dev.toggleMotionBlur())}
              >
                <span class="shell-switch-knob" />
              </button>
            </div>
            <p class="shell-muted">LOD policy and the UFH layer live under Smart home &amp; KNX.</p>
          </section>
        </div>
      </div>
    </aside>
  );
}
