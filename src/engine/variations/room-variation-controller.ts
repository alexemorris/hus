/**
 * First-class Room / Design Variations system for `husjs`.
 *
 * Allows any house or zone module to register 2..N alternative `THREE.Object3D` subtrees
 * (joinery, furniture layouts, wall configurations, fixtures, lighting) and switch between
 * them live in the 3D viewer while preserving cutaway, LOD, batching, raycasting, walkthrough
 * collision/elevation, lighting/shadows, and URL query persistence.
 */
import * as THREE from 'three';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type {
  RoomVariationGroupInfo,
  RoomVariationOptionInfo,
  TwinVariationsApi,
} from '../../core/types/variations.ts';
import {
  applyVariationsToUrl,
  parseVariationSearchParams,
} from '../../core/variations-url.ts';

export interface RoomVariationOption {
  id: string;
  label: string;
  description?: string;
  /** Scene graph node(s) belonging exclusively to this option. */
  objects: THREE.Object3D[];
}

export interface RoomVariationGroup {
  id: string;
  label: string;
  zoneId?: RoomZoneId;
  defaultOptionId: string;
  options: RoomVariationOption[];
}

export interface RoomVariationGroupInput {
  readonly id: string;
  readonly label: string;
  readonly zoneId?: RoomZoneId;
  /** Defaults to `options[0].id` when omitted. */
  readonly defaultOptionId?: string;
  readonly options: readonly RoomVariationOption[];
}

/**
 * Stamps variation metadata onto option root objects and applies initial `defaultOptionId`
 * visibility immediately so inactive alternatives are hidden from frame 0.
 */
export function createRoomVariationGroup(input: RoomVariationGroupInput): RoomVariationGroup {
  if (!input.id || !input.id.trim()) {
    throw new Error('createRoomVariationGroup: group "id" must be a non-empty string.');
  }
  if (!input.options || input.options.length === 0) {
    throw new Error(`createRoomVariationGroup("${input.id}"): "options" must contain at least one option.`);
  }
  const fallbackDefault = input.options[0]!.id;
  const defaultOptionId =
    input.defaultOptionId && input.options.some((o) => o.id === input.defaultOptionId)
      ? input.defaultOptionId
      : fallbackDefault;

  const normalizedOptions: RoomVariationOption[] = input.options.map((opt) => {
    const isDefault = opt.id === defaultOptionId;
    const objs = [...opt.objects];
    for (const obj of objs) {
      stampVariationOptionRoot(obj, input.id, opt.id, !isDefault);
    }
    return {
      id: opt.id,
      label: opt.label,
      ...(opt.description !== undefined ? { description: opt.description } : {}),
      objects: objs,
    };
  });

  return {
    id: input.id,
    label: input.label,
    ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {}),
    defaultOptionId,
    options: normalizedOptions,
  };
}

function stampVariationOptionRoot(
  obj: THREE.Object3D,
  groupId: string,
  optionId: string,
  hidden: boolean
): void {
  obj.userData = {
    ...obj.userData,
    isVariationOptionRoot: true,
    variationGroupId: groupId,
    variationOptionId: optionId,
    variationHidden: hidden,
    // Ensure THREE.Group option roots batch cleanly inside their own container rather than
    // merging into an ancestor floor/scene batch.
    ...(obj instanceof THREE.Group ? { isBatchSubContainer: true } : {}),
  };
  obj.visible = !hidden;
}

/**
 * Builder-time registry exposed on `SceneBuilderContext.variations` so individual zone modules
 * can register variation groups inline right where their `THREE.Group` alternatives are built.
 */
export class VariationRegistry {
  private readonly groups: RoomVariationGroup[] = [];
  private readonly byId = new Map<string, number>();

  public register(group: RoomVariationGroupInput | RoomVariationGroup): RoomVariationGroup {
    const normalized = createRoomVariationGroup(group);
    const existingIdx = this.byId.get(normalized.id);
    if (existingIdx !== undefined) {
      this.groups[existingIdx] = normalized;
    } else {
      this.byId.set(normalized.id, this.groups.length);
      this.groups.push(normalized);
    }
    return normalized;
  }

  public createGroup(input: RoomVariationGroupInput): RoomVariationGroup {
    return this.register(input);
  }

  public registerAll(groups: readonly (RoomVariationGroupInput | RoomVariationGroup)[]): void {
    for (const g of groups) {
      this.register(g);
    }
  }

  public getGroups(): readonly RoomVariationGroup[] {
    return this.groups;
  }

  public clear(): void {
    this.groups.length = 0;
    this.byId.clear();
  }
}

interface ManagedLightState {
  readonly light: THREE.Light;
  readonly baseVisible: boolean;
}

interface ManagedVariationGroup {
  readonly group: RoomVariationGroup;
  activeOptionId: string;
  readonly optionLights: ReadonlyMap<string, readonly ManagedLightState[]>;
}

export interface RoomVariationControllerOptions {
  /** Initial variation groups to manage. */
  readonly groups?: readonly (RoomVariationGroup | RoomVariationGroupInput)[];
  /**
   * Automatically reads initial selections from `window.location.search` (`?vars=` / `?var.<id>=`)
   * and keeps the browser URL updated via `history.replaceState` on selection changes.
   * Defaults to `true` when `window` is available.
   */
  readonly syncUrl?: boolean;
  /** Optional explicit initial URL search string override (useful in unit tests / SSR). */
  readonly initialSearch?: string;
  /** Optional custom URL writer override (defaults to `window.history.replaceState`). */
  readonly replaceUrlState?: (nextUrl: string) => void;
  /** Hook invoked immediately after a variation visibility change so cutaway/walkthrough/shadows refresh. */
  readonly onAfterVariationChange?: (changedGroupIds: readonly string[]) => void;
}

export type RoomVariationChangeListener = (
  groups: readonly RoomVariationGroupInfo[],
  changedGroupIds: readonly string[]
) => void;

export class RoomVariationController implements TwinVariationsApi {
  private readonly entries = new Map<string, ManagedVariationGroup>();
  private readonly orderedIds: string[] = [];
  private readonly listeners = new Set<RoomVariationChangeListener>();
  private readonly syncUrl: boolean;
  private readonly replaceUrlState?: (nextUrl: string) => void;
  private onAfterVariationChange?: (changedGroupIds: readonly string[]) => void;
  private cachedSnapshot: readonly RoomVariationGroupInfo[] | null = null;

  public constructor(options: RoomVariationControllerOptions = {}) {
    this.syncUrl = options.syncUrl ?? (typeof window !== 'undefined' && Boolean(window.location));
    this.replaceUrlState = options.replaceUrlState;
    this.onAfterVariationChange = options.onAfterVariationChange;

    if (options.groups && options.groups.length > 0) {
      this.setGroups(options.groups, { notify: false, syncUrl: false });
    }

    const search =
      options.initialSearch ??
      (this.syncUrl && typeof window !== 'undefined' ? window.location.search : '');
    if (search) {
      const parsed = parseVariationSearchParams(search);
      if (Object.keys(parsed).length > 0) {
        this.applySelectionsInternal(parsed, { notify: false, syncUrl: false });
      }
    }
  }

  public setAfterVariationChangeHandler(
    handler: ((changedGroupIds: readonly string[]) => void) | undefined
  ): void {
    this.onAfterVariationChange = handler;
  }

  /** Replaces or registers variation groups onto this controller. */
  public setGroups(
    groups: readonly (RoomVariationGroup | RoomVariationGroupInput)[],
    opts?: { readonly notify?: boolean; readonly syncUrl?: boolean }
  ): void {
    const prevSelections = this.getSelections(true);
    this.entries.clear();
    this.orderedIds.length = 0;
    this.cachedSnapshot = null;

    for (const raw of groups) {
      const group = createRoomVariationGroup(raw);
      const preserved = prevSelections[group.id];
      const activeOptionId =
        preserved && group.options.some((o) => o.id === preserved)
          ? preserved
          : group.defaultOptionId;

      const optionLights = new Map<string, readonly ManagedLightState[]>();
      for (const opt of group.options) {
        const lights: ManagedLightState[] = [];
        for (const root of opt.objects) {
          root.traverse((node) => {
            if (node instanceof THREE.Light && !node.userData?.isCarrierPointLight) {
              lights.push({ light: node, baseVisible: node.visible });
            }
          });
        }
        optionLights.set(opt.id, lights);
      }

      const entry: ManagedVariationGroup = {
        group,
        activeOptionId,
        optionLights,
      };
      this.entries.set(group.id, entry);
      this.orderedIds.push(group.id);
      this.applyEntryVisibility(entry);
    }

    // Re-apply URL params if any newly registered group matches current location search
    if (this.syncUrl && typeof window !== 'undefined' && window.location?.search) {
      const urlSelections = parseVariationSearchParams(window.location.search);
      for (const [groupId, optionId] of Object.entries(urlSelections)) {
        if (prevSelections[groupId] === undefined) {
          const entry = this.entries.get(groupId);
          if (entry && entry.group.options.some((o) => o.id === optionId)) {
            entry.activeOptionId = optionId;
            this.applyEntryVisibility(entry);
          }
        }
      }
    }

    if (opts?.syncUrl !== false) {
      this.pushUrlState();
    }
    if (opts?.notify !== false) {
      this.emitChange(this.orderedIds);
    }
  }

  public registerGroup(input: RoomVariationGroup | RoomVariationGroupInput): RoomVariationGroup {
    const current = this.getGroups().filter((g) => g.id !== input.id);
    const normalized = createRoomVariationGroup(input);
    this.setGroups([...current, normalized]);
    return normalized;
  }

  public getGroups(): readonly RoomVariationGroup[] {
    return this.orderedIds.map((id) => this.entries.get(id)!.group);
  }

  public hasVariations(): boolean {
    return this.orderedIds.length > 0;
  }

  public list(): readonly RoomVariationGroupInfo[] {
    if (this.cachedSnapshot) return this.cachedSnapshot;
    const list: RoomVariationGroupInfo[] = this.orderedIds.map((id) => {
      const entry = this.entries.get(id)!;
      const { group, activeOptionId } = entry;
      const options: readonly RoomVariationOptionInfo[] = group.options.map((o) => ({
        id: o.id,
        label: o.label,
        ...(o.description !== undefined ? { description: o.description } : {}),
      }));
      return {
        id: group.id,
        label: group.label,
        ...(group.zoneId !== undefined ? { zoneId: group.zoneId } : {}),
        defaultOptionId: group.defaultOptionId,
        activeOptionId,
        options,
      };
    });
    this.cachedSnapshot = list;
    return list;
  }

  public forRoom(zoneId: RoomZoneId): readonly RoomVariationGroupInfo[] {
    if (!zoneId) return [];
    return this.list().filter((g) => g.zoneId === zoneId);
  }

  public getActiveOptionId(groupId: string): string | undefined {
    return this.entries.get(groupId)?.activeOptionId;
  }

  public getSelections(includeDefaults = false): Readonly<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const id of this.orderedIds) {
      const entry = this.entries.get(id)!;
      if (includeDefaults || entry.activeOptionId !== entry.group.defaultOptionId) {
        out[id] = entry.activeOptionId;
      }
    }
    return out;
  }

  public selectOption(groupId: string, optionId: string): boolean {
    const entry = this.entries.get(groupId);
    if (!entry) return false;
    if (!entry.group.options.some((o) => o.id === optionId)) return false;
    if (entry.activeOptionId === optionId) {
      // Still ensure scene-graph visibility invariant holds in case external code touched .visible
      this.applyEntryVisibility(entry);
      return false;
    }
    entry.activeOptionId = optionId;
    this.cachedSnapshot = null;
    this.applyEntryVisibility(entry);
    this.pushUrlState();
    this.onAfterVariationChange?.([groupId]);
    this.emitChange([groupId]);
    return true;
  }

  public applySelections(selections: Readonly<Record<string, string>>): boolean {
    return this.applySelectionsInternal(selections, { notify: true, syncUrl: true });
  }

  private applySelectionsInternal(
    selections: Readonly<Record<string, string>>,
    opts: { readonly notify: boolean; readonly syncUrl: boolean }
  ): boolean {
    const changed: string[] = [];
    for (const [groupId, optionId] of Object.entries(selections)) {
      const entry = this.entries.get(groupId);
      if (!entry) continue;
      if (!entry.group.options.some((o) => o.id === optionId)) continue;
      if (entry.activeOptionId !== optionId) {
        entry.activeOptionId = optionId;
        this.applyEntryVisibility(entry);
        changed.push(groupId);
      }
    }
    if (changed.length === 0) return false;
    this.cachedSnapshot = null;
    if (opts.syncUrl) this.pushUrlState();
    if (opts.notify) {
      this.onAfterVariationChange?.(changed);
      this.emitChange(changed);
    }
    return true;
  }

  public cycleOption(groupId: string, delta: -1 | 1 = 1): string | undefined {
    const entry = this.entries.get(groupId);
    if (!entry || entry.group.options.length === 0) return undefined;
    const opts = entry.group.options;
    const curIdx = Math.max(
      0,
      opts.findIndex((o) => o.id === entry.activeOptionId)
    );
    const step = delta < 0 ? -1 : 1;
    const nextIdx = (curIdx + step + opts.length) % opts.length;
    const nextId = opts[nextIdx]!.id;
    this.selectOption(groupId, nextId);
    return nextId;
  }

  public resetDefaults(): boolean {
    const changed: string[] = [];
    for (const id of this.orderedIds) {
      const entry = this.entries.get(id)!;
      if (entry.activeOptionId !== entry.group.defaultOptionId) {
        entry.activeOptionId = entry.group.defaultOptionId;
        this.applyEntryVisibility(entry);
        changed.push(id);
      }
    }
    if (changed.length === 0) return false;
    this.cachedSnapshot = null;
    this.pushUrlState();
    this.onAfterVariationChange?.(changed);
    this.emitChange(changed);
    return true;
  }

  /** Re-enforces `.visible` and `userData.variationHidden` across all registered groups. */
  public enforceVisibility(): void {
    for (const entry of this.entries.values()) {
      this.applyEntryVisibility(entry);
    }
  }

  public onChanged(listener: (groups: readonly RoomVariationGroupInfo[]) => void): () => void {
    const wrapped: RoomVariationChangeListener = (groups) => listener(groups);
    this.listeners.add(wrapped);
    return () => {
      this.listeners.delete(wrapped);
    };
  }

  public onChange(listener: RoomVariationChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private applyEntryVisibility(entry: ManagedVariationGroup): void {
    for (const opt of entry.group.options) {
      const isActive = opt.id === entry.activeOptionId;
      const hidden = !isActive;
      for (const obj of opt.objects) {
        stampVariationOptionRoot(obj, entry.group.id, opt.id, hidden);
        // Clear WebGPU static render-object cache flag so toggled subtrees update cleanly.
        obj.traverse((node) => {
          (node as unknown as { static?: boolean }).static = false;
        });
      }
      const lights = entry.optionLights.get(opt.id) ?? [];
      for (const { light, baseVisible } of lights) {
        // PointLights carried by PointLightBudgetController stay invisible on scene (carrier pool handles them),
        // while standalone SpotLights / DirectionalLights / unmanaged lights toggle cleanly with their option.
        if (light.userData?.carriedByPool === true) continue;
        light.visible = isActive ? baseVisible : false;
      }
    }
  }

  private pushUrlState(): void {
    if (!this.syncUrl) return;
    const nonDefault = this.getSelections(false);
    if (this.replaceUrlState) {
      const base =
        typeof window !== 'undefined' && window.location?.href
          ? window.location.href
          : 'https://hus.local/';
      this.replaceUrlState(applyVariationsToUrl(base, nonDefault));
      return;
    }
    if (
      typeof window !== 'undefined' &&
      window.location?.href &&
      typeof window.history?.replaceState === 'function'
    ) {
      try {
        const nextUrl = applyVariationsToUrl(window.location.href, nonDefault);
        if (nextUrl !== window.location.href) {
          window.history.replaceState(window.history.state, '', nextUrl);
        }
      } catch {
        // Ignore SecurityError in sandboxed/opaque origins
      }
    }
  }

  private emitChange(changedGroupIds: readonly string[]): void {
    const snap = this.list();
    for (const listener of this.listeners) {
      listener(snap, changedGroupIds);
    }
  }
}
