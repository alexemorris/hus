import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  devMode,
  graphicsFps,
  graphicsMode,
  graphicsTierLabel,
  guestMode,
  openHelp,
  promptPwaInstall,
  pwaCanInstall,
  pwaInstalled,
  setDevMode,
  setUnits,
  settingsOpen,
  units,
} from '../../state/shell-store.ts';
import type { GraphicsMode } from '../../core/types/twin-ux.ts';
import { Icon } from './icons.tsx';
import { useShell } from './shell-context.ts';

const GRAPHICS_OPTIONS: readonly { readonly id: GraphicsMode; readonly label: string; readonly hint: string }[] = [
  { id: 'auto', label: 'Auto (recommended)', hint: 'Adapts quality to keep movement smooth on this device' },
  { id: 'low', label: 'Low', hint: 'Fastest · no post effects' },
  { id: 'medium', label: 'Medium', hint: 'Ambient occlusion · balanced' },
  { id: 'high', label: 'High', hint: 'Sharper image and shadows' },
  { id: 'ultra', label: 'Ultra', hint: 'Every effect · best on a fast GPU' },
];

export const SHORTCUTS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Drag', action: 'Orbit around the model' },
  { keys: 'Right-drag / Shift-drag', action: 'Pan' },
  { keys: 'Scroll / pinch', action: 'Zoom' },
  { keys: 'Double-click', action: 'Jump into the room you clicked' },
  { keys: 'F', action: 'Recenter on the current room' },
  { keys: '1 / 2 / 3', action: 'Ground / First / All floors' },
  { keys: 'W', action: 'Walk mode (WASD to move, Esc to leave)' },
  { keys: 'M', action: 'Measure tool' },
  { keys: 'N', action: 'Note tool' },
  { keys: '?', action: 'Help' },
  { keys: 'Esc', action: 'Close panels / back to Orbit' },
];

export function SettingsModal(): JSX.Element | null {
  const ctl = useShell();
  const open = settingsOpen.value;

  // Refresh tier / FPS while the dialog is visible.
  useEffect(() => {
    if (!open) return undefined;
    ctl.refreshGraphicsReadout();
    const timer = window.setInterval(() => ctl.refreshGraphicsReadout(), 1000);
    return () => window.clearInterval(timer);
  }, [open, ctl]);

  if (!open) return null;
  const mode = graphicsMode.value;
  const fps = graphicsFps.value;
  const [ssaoEnabled, setSsaoEnabled] = useState<boolean>(() => ctl.api.graphics.isSsaoEnabled());
  const [fxaaEnabled, setFxaaEnabled] = useState<boolean>(() => ctl.api.graphics.isFxaaEnabled());
  const [motionBlurEnabled, setMotionBlurEnabled] = useState<boolean>(() =>
    ctl.api.graphics.isMotionBlurEnabled()
  );
  const [audioMuted, setAudioMuted] = useState<boolean>(() => ctl.api.audio?.isMuted() ?? false);
  const [audioVolume, setAudioVolume] = useState<number>(() => ctl.api.audio?.getVolume() ?? 0.75);
  const [ambientEnabled, setAmbientEnabled] = useState<boolean>(
    () => ctl.api.audio?.isAmbientEnabled() ?? true
  );
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(() => ctl.api.audio?.isSfxEnabled() ?? true);

  useEffect(() => {
    setSsaoEnabled(ctl.api.graphics.isSsaoEnabled());
    setFxaaEnabled(ctl.api.graphics.isFxaaEnabled());
    setMotionBlurEnabled(ctl.api.graphics.isMotionBlurEnabled());
  }, [ctl, mode]);

  useEffect(() => {
    if (!ctl.api.audio) return undefined;
    const syncAudio = (): void => {
      setAudioMuted(ctl.api.audio.isMuted());
      setAudioVolume(ctl.api.audio.getVolume());
      setAmbientEnabled(ctl.api.audio.isAmbientEnabled());
      setSfxEnabled(ctl.api.audio.isSfxEnabled());
    };
    syncAudio();
    return ctl.api.audio.onChanged(syncAudio);
  }, [ctl]);

  const close = (): void => {
    settingsOpen.value = false;
  };

  return (
    <div class="shell-modal-backdrop" onClick={close}>
      <div
        class="shell-modal shell-glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shell-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="shell-modal-head">
          <h2 id="shell-settings-title">Settings</h2>
          <button type="button" class="shell-icon-btn" aria-label="Close settings" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div class="shell-modal-body">
          <section class="shell-settings-section">
            <h3>Graphics</h3>
            <p class="shell-muted">
              Current: <strong>{graphicsTierLabel.value || '—'}</strong>
              {fps !== null && <> · {Math.round(fps)} fps</>}
            </p>
            <div class="shell-radio-list" role="radiogroup" aria-label="Graphics quality">
              {GRAPHICS_OPTIONS.map((o) => (
                <label key={o.id} class={`shell-radio${mode === o.id ? ' is-checked' : ''}`}>
                  <input
                    type="radio"
                    name="shell-graphics"
                    value={o.id}
                    checked={mode === o.id}
                    onChange={() => ctl.setGraphicsMode(o.id)}
                  />
                  <span class="shell-radio-text">
                    <span>{o.label}</span>
                    <span class="shell-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div class="shell-toggle-row" style={{ marginTop: '12px' }}>
              <span class="shell-radio-text">
                <span>Motion Blur (Cinematic Shutter)</span>
                <span class="shell-muted">Subtle 6-tap depth-aware camera velocity shutter blur</span>
              </span>
              <button
                type="button"
                class={`shell-switch${motionBlurEnabled ? ' is-on' : ''}`}
                role="switch"
                aria-checked={motionBlurEnabled}
                aria-label="Motion Blur (Cinematic Shutter)"
                onClick={() => {
                  const next = !motionBlurEnabled;
                  ctl.api.graphics.setMotionBlurEnabled(next);
                  setMotionBlurEnabled(next);
                }}
              >
                <span class="shell-switch-knob" />
              </button>
            </div>
            <div class="shell-toggle-row" style={{ marginTop: '8px' }}>
              <span class="shell-radio-text">
                <span>SSAO (Screen-Space Ambient Occlusion)</span>
                <span class="shell-muted">8-tap bilateral depth-curvature contact shadows (+ baked 3D room AO)</span>
              </span>
              <button
                type="button"
                class={`shell-switch${ssaoEnabled ? ' is-on' : ''}`}
                role="switch"
                aria-checked={ssaoEnabled}
                aria-label="SSAO (Screen-Space Ambient Occlusion)"
                onClick={() => {
                  const next = !ssaoEnabled;
                  ctl.api.graphics.setSsaoEnabled(next);
                  setSsaoEnabled(next);
                }}
              >
                <span class="shell-switch-knob" />
              </button>
            </div>
            <div class="shell-toggle-row" style={{ marginTop: '8px' }}>
              <span class="shell-radio-text">
                <span>FXAA 3.11 (Edge Anti-Aliasing)</span>
                <span class="shell-muted">Directional luma-edge span search + sub-pixel smoothing</span>
              </span>
              <button
                type="button"
                class={`shell-switch${fxaaEnabled ? ' is-on' : ''}`}
                role="switch"
                aria-checked={fxaaEnabled}
                aria-label="FXAA 3.11 anti-aliasing"
                onClick={() => {
                  const next = !fxaaEnabled;
                  ctl.api.graphics.setFxaaEnabled(next);
                  setFxaaEnabled(next);
                }}
              >
                <span class="shell-switch-knob" />
              </button>
            </div>
          </section>

          <section class="shell-settings-section">
            <h3>Sound &amp; Acoustics</h3>
            <div class="shell-toggle-row">
              <span class="shell-radio-text">
                <span>Enable Audio</span>
                <span class="shell-muted">Procedural Web Audio 3D spatial soundscape &amp; reverb</span>
              </span>
              <button
                type="button"
                class={`shell-switch${!audioMuted ? ' is-on' : ''}`}
                role="switch"
                aria-checked={!audioMuted}
                aria-label="Enable Audio"
                onClick={() => {
                  const nextMuted = !audioMuted;
                  ctl.api.audio?.setMuted(nextMuted);
                  setAudioMuted(nextMuted);
                }}
              >
                <span class="shell-switch-knob" />
              </button>
            </div>
            <div class="shell-toggle-row" style={{ marginTop: '8px' }}>
              <span class="shell-radio-text">
                <span>Master Volume ({Math.round(audioVolume * 100)}%)</span>
                <span class="shell-muted">Overall level for spatial SFX and ambient soundscape</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(audioVolume * 100)}
                aria-label="Master Volume"
                style={{ width: '130px', accentColor: 'var(--shell-accent, #f59e0b)' }}
                onInput={(e) => {
                  const nextVol = Number(e.currentTarget.value) / 100;
                  ctl.api.audio?.setVolume(nextVol);
                  setAudioVolume(nextVol);
                }}
              />
            </div>
            <div class="shell-toggle-row" style={{ marginTop: '8px' }}>
              <span class="shell-radio-text">
                <span>Ambient Soundscape</span>
                <span class="shell-muted">Outdoor breeze, daytime birdsong &amp; evening crickets</span>
              </span>
              <button
                type="button"
                class={`shell-switch${ambientEnabled ? ' is-on' : ''}`}
                role="switch"
                aria-checked={ambientEnabled}
                aria-label="Ambient Soundscape"
                onClick={() => {
                  const next = !ambientEnabled;
                  ctl.api.audio?.setAmbientEnabled(next);
                  setAmbientEnabled(next);
                }}
              >
                <span class="shell-switch-knob" />
              </button>
            </div>
            <div class="shell-toggle-row" style={{ marginTop: '8px' }}>
              <span class="shell-radio-text">
                <span>Spatial 3D Sound Effects</span>
                <span class="shell-muted">Footsteps, doors, switches, golf bay, pool table &amp; gym</span>
              </span>
              <button
                type="button"
                class={`shell-switch${sfxEnabled ? ' is-on' : ''}`}
                role="switch"
                aria-checked={sfxEnabled}
                aria-label="Spatial 3D Sound Effects"
                onClick={() => {
                  const next = !sfxEnabled;
                  ctl.api.audio?.setSfxEnabled(next);
                  setSfxEnabled(next);
                }}
              >
                <span class="shell-switch-knob" />
              </button>
            </div>
          </section>

          <section class="shell-settings-section">
            <h3>Units</h3>
            <div class="shell-seg" role="group" aria-label="Units">
              <button
                type="button"
                class={`shell-seg-btn${units.value === 'm' ? ' is-active' : ''}`}
                onClick={() => setUnits('m')}
              >
                Metres
              </button>
              <button
                type="button"
                class={`shell-seg-btn${units.value === 'ftin' ? ' is-active' : ''}`}
                onClick={() => setUnits('ftin')}
              >
                Feet &amp; inches
              </button>
            </div>
          </section>

          <section class="shell-settings-section">
            <h3>Controls</h3>
            <dl class="shell-shortcuts">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} class="shell-shortcut">
                  <dt>
                    <kbd>{s.keys}</kbd>
                  </dt>
                  <dd>{s.action}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section class="shell-settings-section">
            <h3>App &amp; tutorial</h3>
            <div class="shell-toggle-row" style={{ marginBottom: '10px' }}>
              <span class="shell-radio-text">
                <span>Hus.js Digital Twin Web App (PWA)</span>
                <span class="shell-muted">
                  {pwaInstalled.value
                    ? 'Installed — running as a standalone app with offline caching'
                    : pwaCanInstall.value
                      ? 'Install to your home screen or desktop dock for full-screen access'
                      : 'Add to Home Screen / Install from your browser menu for full-screen app mode'}
                </span>
              </span>
              {pwaCanInstall.value && !pwaInstalled.value && (
                <button
                  type="button"
                  class="shell-btn shell-btn-primary"
                  onClick={() => {
                    void promptPwaInstall();
                  }}
                >
                  Install app
                </button>
              )}
            </div>
            <div class="shell-toggle-row">
              <span class="shell-radio-text">
                <span>Interactive walkthrough guide</span>
                <span class="shell-muted">Reopen the 3-step introduction to navigation, rooms &amp; notes</span>
              </span>
              <button
                type="button"
                class="shell-btn"
                onClick={() => {
                  settingsOpen.value = false;
                  openHelp(0);
                }}
              >
                Open tutorial
              </button>
            </div>
          </section>

          <section class="shell-settings-section">
            <h3>Developer mode</h3>
            {guestMode.value ? (
              <p class="shell-muted">Not available in shared (read-only) views.</p>
            ) : (
              <label class="shell-toggle-row">
                <span class="shell-radio-text">
                  <span>Show developer tools</span>
                  <span class="shell-muted">KNX bus log &amp; parameters, simulators, diagnostics</span>
                </span>
                <button
                  type="button"
                  class={`shell-switch${devMode.value ? ' is-on' : ''}`}
                  role="switch"
                  aria-checked={devMode.value}
                  aria-label="Developer mode"
                  onClick={() => setDevMode(!devMode.value)}
                >
                  <span class="shell-switch-knob" />
                </button>
              </label>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
