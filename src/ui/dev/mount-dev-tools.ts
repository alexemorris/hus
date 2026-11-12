import { effect, signal } from '@preact/signals';
import type { TwinApi } from '../../core/types/twin-api.ts';
import type { PropertyScene } from '../../engine/viewer/property-scene.ts';
import type { KNXPropertyBusController } from '../../integrations/knx/index.ts';
import type { SmartHomeHub } from '../../integrations/smart-home-hub.ts';
import { devMode } from '../../state/shell-store.ts';

export { DevDrawer } from './DevDrawer.tsx';

export interface DevToolsDeps {
  readonly scene: PropertyScene;
  readonly knx: KNXPropertyBusController;
  readonly hub: SmartHomeHub;
  readonly api: TwinApi;
}

export const devToolsMounted = signal(false);

/** Engine / integration handles for the developer drawer (null until `mountDevTools` runs). */
export const devToolsDeps = signal<DevToolsDeps | null>(null);

let stopActiveMount: (() => void) | null = null;

/**
 * Publishes the developer-tool dependencies and lazily starts the dev runtime
 * (devStore sync + dev-only keyboard shortcuts) via dynamic `import()` the first
 * time Developer Mode is enabled. Calling it again replaces the previous mount.
 */
export function mountDevTools(deps: DevToolsDeps): void {
  stopActiveMount?.();
  devToolsMounted.value = false;
  devToolsDeps.value = deps;

  let stopped = false;
  let requested = false;
  let disposeRuntime: (() => void) | null = null;

  const stopModeEffect = effect(() => {
    if (!devMode.value || requested) return;
    requested = true;
    void import('./dev-tools-runtime.ts').then(({ mountDevToolsRuntime }) => {
      if (stopped) return;
      disposeRuntime = mountDevToolsRuntime(deps);
      devToolsMounted.value = true;
    });
  });

  stopActiveMount = () => {
    stopped = true;
    stopModeEffect();
    disposeRuntime?.();
    disposeRuntime = null;
  };
}
