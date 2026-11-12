import { render, type JSX } from 'preact';
import { devStore } from '../dev-store.ts';

export function TwinStatusBadge(): JSX.Element {
  const isWalk = devStore.walkthroughActive.value;
  const floorLabel = devStore.floorModeLabel.value;
  const onCount = devStore.activeCircuitsCount.value;
  const totalCount = devStore.totalCircuitsCount.value;
  const tgCount = devStore.telegramCount.value;
  const sunClock = devStore.formattedSunTime.value;
  const fps = devStore.fpsCount.value;
  const roomId = devStore.activeRoomId.value;

  return (
    <div
      className="twin-status-badge"
      role="status"
      aria-live="polite"
      title={`Room: ${roomId} · Sun: ${sunClock}`}
    >
      <div className="twin-status-badge-group">
        <span className={`twin-status-pill${isWalk ? ' is-active' : ''}`}>
          {isWalk ? `1P · ${fps} FPS` : floorLabel}
        </span>
        <span className="twin-status-pill">
          {onCount}/{totalCount} CH
        </span>
      </div>
      <div className="twin-status-badge-group">
        <span className="twin-status-pill">{sunClock}</span>
        <span className="twin-status-pill">{tgCount} TG</span>
      </div>
    </div>
  );
}

export function mountTwinStatusBadge(container: HTMLElement): void {
  render(<TwinStatusBadge />, container);
}
