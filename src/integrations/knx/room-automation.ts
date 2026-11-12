import type { CircuitId, RoomMotionSensorId } from '../../core/types/knx.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';

/**
 * Night-walk behaviour for a room circuit: when the room switch is off and it is dark
 * (below the lux threshold), the circuit idles at `nightLevel` instead of 0%. If a motion
 * sensor is given, the room must also be occupied (same as the kitchen night-walk dim).
 */
export interface RoomNightWalkRule {
  readonly circuitId: CircuitId;
  readonly nightLevel: number;
  readonly motionSensorId?: RoomMotionSensorId;
}

/** A circuit driven purely by a room PIR: `onLevel` while occupied, 0% when vacant. */
export interface MotionCircuitRule {
  readonly circuitId: CircuitId;
  readonly sensorId: RoomMotionSensorId;
  readonly onLevel: number;
}

export interface RoomMotionSensorConfig {
  readonly id: RoomMotionSensorId;
  readonly pa: string;
  readonly ga: string;
  readonly name: string;
  /** Room the sensor is mounted in; drives the room-focused HUD controls. */
  readonly zoneId: RoomZoneId;
}

export interface RoomAutomationConfig {
  readonly nightWalkRules: readonly RoomNightWalkRule[];
  readonly motionCircuitRules: readonly MotionCircuitRule[];
  readonly motionSensors: readonly RoomMotionSensorConfig[];
}

/**
 * State and level rules for room-level KNX automation (night-walk dim and PIR-driven
 * circuits) outside the kitchen/utility logic. Pure state: the bus controller owns the
 * target levels and telegrams and asks this class what the automatic levels should be.
 */
export class RoomAutomation {
  private readonly config: RoomAutomationConfig;
  private readonly switchOn = new Map<CircuitId, boolean>();
  private readonly motion = new Map<RoomMotionSensorId, boolean>();

  public constructor(config: RoomAutomationConfig) {
    this.config = config;
    for (const rule of config.nightWalkRules) {
      this.switchOn.set(rule.circuitId, true);
    }
    for (const sensor of config.motionSensors) {
      this.motion.set(sensor.id, true);
    }
  }

  public getNightWalkRule(circuitId: CircuitId): RoomNightWalkRule | undefined {
    return this.config.nightWalkRules.find((r) => r.circuitId === circuitId);
  }

  public getMotionCircuitRules(sensorId?: RoomMotionSensorId): readonly MotionCircuitRule[] {
    return sensorId
      ? this.config.motionCircuitRules.filter((r) => r.sensorId === sensorId)
      : this.config.motionCircuitRules;
  }

  public getMotionSensors(): readonly RoomMotionSensorConfig[] {
    return this.config.motionSensors;
  }

  public getMotionSensorByGa(ga: string): RoomMotionSensorConfig | undefined {
    return this.config.motionSensors.find((s) => s.ga === ga);
  }

  public getMotionSensor(id: RoomMotionSensorId): RoomMotionSensorConfig | undefined {
    return this.config.motionSensors.find((s) => s.id === id);
  }

  public isMotionDetected(sensorId: RoomMotionSensorId): boolean {
    return this.motion.get(sensorId) ?? false;
  }

  public setMotionDetected(sensorId: RoomMotionSensorId, detected: boolean): void {
    this.motion.set(sensorId, detected);
  }

  /** Whether the wall switch for a night-walk circuit is on (true for other circuits). */
  public isSwitchOn(circuitId: CircuitId): boolean {
    return this.switchOn.get(circuitId) ?? true;
  }

  /**
   * Records a manual level for a circuit. For night-walk circuits, anything at or below the
   * night level counts as "switched off".
   */
  public noteManualLevel(circuitId: CircuitId, pct: number): void {
    const rule = this.getNightWalkRule(circuitId);
    if (rule) {
      this.switchOn.set(circuitId, pct > rule.nightLevel);
    }
  }

  /** Automatic level for a switched-off night-walk circuit. */
  public offStateLevel(rule: RoomNightWalkRule, isDark: boolean): number {
    const occupied = rule.motionSensorId ? this.isMotionDetected(rule.motionSensorId) : true;
    return isDark && occupied ? rule.nightLevel : 0;
  }

  public isNightDimActive(circuitId: CircuitId, isDark: boolean): boolean {
    const rule = this.getNightWalkRule(circuitId);
    return (
      rule !== undefined && !this.isSwitchOn(circuitId) && this.offStateLevel(rule, isDark) > 0
    );
  }

  /** Night-walk levels for every switched-off night-walk circuit. */
  public computeNightWalkLevels(isDark: boolean): Partial<Record<CircuitId, number>> {
    const levels: Partial<Record<CircuitId, number>> = {};
    for (const rule of this.config.nightWalkRules) {
      if (!this.isSwitchOn(rule.circuitId)) {
        levels[rule.circuitId] = this.offStateLevel(rule, isDark);
      }
    }
    return levels;
  }

  /** Levels of the PIR-driven circuits attached to one sensor, from its current state. */
  public computeMotionCircuitLevels(sensorId: RoomMotionSensorId): Partial<Record<CircuitId, number>> {
    const levels: Partial<Record<CircuitId, number>> = {};
    for (const rule of this.getMotionCircuitRules(sensorId)) {
      levels[rule.circuitId] = this.isMotionDetected(sensorId) ? rule.onLevel : 0;
    }
    return levels;
  }
}
