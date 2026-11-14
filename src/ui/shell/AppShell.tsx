import { FloatingRoomVariationHud, VariationsPopover } from './VariationsControl.tsx';
import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  helpOpen,
  isMobile,
  navigatorOpen,
  roomPanelOpen,
  settingsOpen,
  toast,
  viewMode,
} from '../../state/shell-store.ts';
import type { AnnotatorController } from '../notes/annotator-controller.ts';
import { AnnotatorPanel, AnnotatorPinsOverlay } from './AnnotatorPanel.tsx';
import { RoomNavigator } from './RoomNavigator.tsx';
import { RoomPanel } from './RoomPanel.tsx';
import { ShellContext } from './shell-context.ts';
import type { ShellController } from './shell-controller.ts';
import { SkyWeatherHud } from './SkyWeatherHud.tsx';
import { AssetInspectorPopover } from './AssetInspectorPopover.tsx';
import { TerrainSculptPanel } from './TerrainSculptPanel.tsx';
import { ToolDock } from './ToolDock.tsx';
import { TopBar } from './TopBar.tsx';

function useLazyOverlay(
  active: boolean,
  loader: () => Promise<ComponentType>
): ComponentType | null {
  const [Comp, setComp] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!active || Comp) return;
    let cancelled = false;
    void loader().then((loaded) => {
      if (!cancelled) setComp(() => loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [active, Comp, loader]);
  return Comp;
}

const loadWalkOverlay = (): Promise<ComponentType> =>
  import('./WalkOverlay.tsx').then((m) => m.WalkOverlay);
const loadSettingsModal = (): Promise<ComponentType> =>
  import('./SettingsModal.tsx').then((m) => m.SettingsModal);
const loadHelpOverlay = (): Promise<ComponentType> =>
  import('./HelpOverlay.tsx').then((m) => m.HelpOverlay);

function LazyWalkOverlay(): JSX.Element | null {
  const Comp = useLazyOverlay(viewMode.value === 'walk', loadWalkOverlay);
  return Comp ? <Comp /> : null;
}

function LazySettingsModal(): JSX.Element | null {
  const Comp = useLazyOverlay(settingsOpen.value, loadSettingsModal);
  return Comp ? <Comp /> : null;
}

function LazyHelpOverlay(): JSX.Element | null {
  const Comp = useLazyOverlay(helpOpen.value, loadHelpOverlay);
  return Comp ? <Comp /> : null;
}

function Toast(): JSX.Element | null {
  const t = toast.value;
  if (!t) return null;
  return (
    <div class="shell-toast" role="status" aria-live="polite" key={t.id}>
      {t.text}
    </div>
  );
}

function MobileScrim(): JSX.Element | null {
  if (!isMobile.value || !(navigatorOpen.value || roomPanelOpen.value)) return null;
  return (
    <div
      class="shell-scrim"
      onClick={() => {
        navigatorOpen.value = false;
        roomPanelOpen.value = false;
      }}
    />
  );
}

export interface HusShellProps {
  readonly ctl: ShellController;
  readonly annotator?: AnnotatorController;
  /** Developer drawer, injected by the composition root (keeps src/ui/dev out of the shell). */
  readonly devDrawer?: ComponentType;
}

export type AppShellProps = HusShellProps;

export function HusShell({ ctl, annotator, devDrawer: DevDrawer }: HusShellProps): JSX.Element {
  return (
    <ShellContext.Provider value={ctl}>
      <TopBar />
      <VariationsPopover />
      <FloatingRoomVariationHud />
      <SkyWeatherHud />
      <MobileScrim />
      <RoomNavigator />
      <RoomPanel />
      {annotator && <AnnotatorPinsOverlay annotator={annotator} />}
      {annotator && <AnnotatorPanel annotator={annotator} />}
      <TerrainSculptPanel />
      <AssetInspectorPopover />
      <ToolDock />
      <LazyWalkOverlay />
      {DevDrawer && <DevDrawer />}
      <Toast />
      <LazySettingsModal />
      <LazyHelpOverlay />
    </ShellContext.Provider>
  );
}

export const AppShell = HusShell;
