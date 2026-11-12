import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { devDrawerOpen, devMode } from '../../state/shell-store.ts';

let cachedPanel: ComponentType | null = null;

/**
 * Thin lazy wrapper around the Developer drawer so everyday sessions never
 * download or mount the developer drawer UI until `devMode` is enabled.
 */
export function DevDrawer(): JSX.Element | null {
  const enabled = devMode.value;
  const [Panel, setPanel] = useState<ComponentType | null>(() => cachedPanel);

  useEffect(() => {
    if (!enabled) {
      devDrawerOpen.value = false;
      return;
    }
    if (cachedPanel) {
      if (!Panel) setPanel(() => cachedPanel);
      return;
    }
    let cancelled = false;
    void import('./DevDrawerPanel.tsx').then((m) => {
      cachedPanel = m.DevDrawerPanel;
      if (!cancelled) setPanel(() => m.DevDrawerPanel);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, Panel]);

  if (!enabled || !Panel) return null;
  return <Panel />;
}
