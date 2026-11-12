import type {
  CctvCameraEntityState,
  SmartDetectionType,
  SmartHomeBusEvent,
} from '../../../core/entities.ts';

export type UniFiProtectListener = (
  cameras: readonly CctvCameraEntityState[],
  busEvent?: SmartHomeBusEvent
) => void;

/**
 * UniFi Protect CCTV Protocol Adapter.
 *
 * Manages 3D camera entities, field-of-view (FOV) frustum visualization, and Smart Detections
 * (`person`, `vehicle`) that can trigger cross-protocol KNX automations via `SmartHomeHub`.
 */
export class UniFiProtectController {
  private readonly cameras: CctvCameraEntityState[];
  private readonly listeners = new Set<UniFiProtectListener>();
  private showFrustums = false;
  private nextEventId = 5000;

  public constructor(initialCameras: readonly CctvCameraEntityState[] = []) {
    this.cameras = initialCameras.map((c) => ({ ...c }));
  }

  public subscribe(fn: UniFiProtectListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(busEvent?: SmartHomeBusEvent): void {
    for (const fn of this.listeners) {
      fn(this.cameras, busEvent);
    }
  }

  public getCameras(): readonly CctvCameraEntityState[] {
    return this.cameras;
  }

  public areFrustumsVisible(): boolean {
    return this.showFrustums;
  }

  public toggleAllFrustums(): boolean {
    this.showFrustums = !this.showFrustums;
    for (let i = 0; i < this.cameras.length; i++) {
      const cam = this.cameras[i];
      if (!cam) continue;
      this.cameras[i] = {
        ...cam,
        showFrustum3D: this.showFrustums,
      };
    }
    this.notify();
    return this.showFrustums;
  }

  public triggerSmartDetection(
    entityId: string,
    detection: SmartDetectionType
  ): CctvCameraEntityState | undefined {
    const idx = this.cameras.findIndex((c) => c.entityId === entityId);
    if (idx < 0) return undefined;
    const cam = this.cameras[idx];
    if (!cam) return undefined;

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] ?? '00:00:00';
    const summary =
      detection === 'vehicle'
        ? `Smart Detection: Vehicle (LPR Match) at ${cam.shortName}`
        : detection === 'person'
          ? `Smart Detection: Person in ${cam.shortName} Zone`
          : `${cam.shortName}: Motion Cleared`;

    const updated: CctvCameraEntityState = {
      ...cam,
      activeDetection: detection,
      showFrustum3D: this.showFrustums,
      lastDetectionSummary: summary,
    };
    this.cameras[idx] = updated;

    const busEvent: SmartHomeBusEvent = {
      id: this.nextEventId++,
      timestamp: timeStr,
      protocol: 'unifi-protect',
      sourceAddress: cam.hardwareAddress,
      targetAddress: cam.entityId,
      eventType: detection === 'none' ? 'SmartDetect.End' : `SmartDetect.${detection}`,
      summary,
    };

    this.notify(busEvent);
    return updated;
  }
}
