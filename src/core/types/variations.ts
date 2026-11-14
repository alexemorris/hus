/**
 * Renderer-free Room / Design Variations contract (`core` layer).
 */
import type { RoomZoneId } from './topology.ts';
export type VariationUnsubscribe = () => void;

export interface RoomVariationOptionInfo {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface RoomVariationGroupInfo {
  readonly id: string;
  readonly label: string;
  readonly zoneId?: RoomZoneId;
  readonly defaultOptionId: string;
  readonly activeOptionId: string;
  readonly options: readonly RoomVariationOptionInfo[];
}

export interface TwinVariationsApi {
  list(): readonly RoomVariationGroupInfo[];
  forRoom(zoneId: RoomZoneId): readonly RoomVariationGroupInfo[];
  getActiveOptionId(groupId: string): string | undefined;
  getSelections(includeDefaults?: boolean): Readonly<Record<string, string>>;
  selectOption(groupId: string, optionId: string): boolean;
  applySelections(selections: Readonly<Record<string, string>>): boolean;
  cycleOption(groupId: string, delta?: -1 | 1): string | undefined;
  resetDefaults(): boolean;
  onChanged(listener: (groups: readonly RoomVariationGroupInfo[]) => void): VariationUnsubscribe;
}
