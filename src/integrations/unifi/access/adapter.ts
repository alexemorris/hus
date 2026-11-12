import type {
  AccessCredentialMethod,
  AccessPointEntityState,
  SmartHomeBusEvent,
} from '../../../core/entities.ts';

export type UniFiAccessListener = (
  accessPoints: readonly AccessPointEntityState[],
  busEvent?: SmartHomeBusEvent,
  unlockedEntry?: AccessPointEntityState
) => void;

/**
 * UniFi Access Protocol Adapter.
 *
 * Models UniFi Access Gate Hub / G2 Reader Pro & Door Hub state and credential events,
 * bridging with the KNX TP1 bus (`GA 1/5/1`) via `SmartHomeHub`.
 */
export class UniFiAccessController {
  private readonly accessPoints: AccessPointEntityState[];
  private readonly listeners = new Set<UniFiAccessListener>();
  private nextEventId = 7000;

  public constructor(initialPoints: readonly AccessPointEntityState[] = []) {
    this.accessPoints = initialPoints.map((p) => ({ ...p }));
  }

  public subscribe(fn: UniFiAccessListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(
    busEvent?: SmartHomeBusEvent,
    unlockedEntry?: AccessPointEntityState
  ): void {
    for (const fn of this.listeners) {
      fn(this.accessPoints, busEvent, unlockedEntry);
    }
  }

  public getAccessPoints(): readonly AccessPointEntityState[] {
    return this.accessPoints;
  }

  public syncGateStateFromKnx(isOpen: boolean, isMoving: boolean): void {
    const idx = this.accessPoints.findIndex((p) => p.targetEntry === 'carGates');
    if (idx < 0) return;
    const current = this.accessPoints[idx];
    if (!current) return;

    const doorPosition: AccessPointEntityState['doorPosition'] = isMoving
      ? 'moving'
      : isOpen
        ? 'open'
        : 'closed';
    const isLocked = !isOpen && !isMoving;

    if (current.doorPosition !== doorPosition || current.isLocked !== isLocked) {
      this.accessPoints[idx] = {
        ...current,
        isLocked,
        doorPosition,
      };
      this.notify();
    }
  }

  public triggerUnlockEvent(
    entityId: string,
    credentialMethod: AccessCredentialMethod = 'NFC Card'
  ): AccessPointEntityState | undefined {
    const idx = this.accessPoints.findIndex((p) => p.entityId === entityId);
    if (idx < 0) return undefined;
    const point = this.accessPoints[idx];
    if (!point) return undefined;

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] ?? '00:00:00';
    const nextLocked = !point.isLocked;
    const updated: AccessPointEntityState = {
      ...point,
      isLocked: nextLocked,
      doorPosition: nextLocked ? 'closed' : 'open',
      lastCredentialMethod: credentialMethod,
      lastEventTimestamp: timeStr,
    };
    this.accessPoints[idx] = updated;

    const busEvent: SmartHomeBusEvent = {
      id: this.nextEventId++,
      timestamp: timeStr,
      protocol: 'unifi-access',
      sourceAddress: point.hardwareAddress,
      targetAddress: point.entityId,
      eventType: nextLocked ? 'Access.Lock' : 'Access.Grant',
      summary: nextLocked
        ? `${point.shortName} → Locked (${credentialMethod})`
        : `${point.shortName} → Access Granted via ${credentialMethod}`,
    };

    this.notify(busEvent, updated);
    return updated;
  }
}
