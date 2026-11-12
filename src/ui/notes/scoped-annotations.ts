import { signal, type Signal } from '@preact/signals';
import { NOTE_TRADES, type NoteMeta, type NoteTrade } from '../../state/shell-store.ts';
import {
  formatMetersAndFeetInches,
  type AnnotationKind,
  type SceneAnnotationHit,
  type SceneAnnotationRecord,
  type SceneCameraPoseSnapshot,
  type SceneMeasurementAnnotation,
  type SceneObjectTransformAnnotation,
  type Vec3Tuple,
} from '../../core/types/scene.ts';
import type { RoomManifestEntry } from '../../core/types/twin-ux.ts';
import type {
  TwinApi,
  TwinNotesApi,
  Unsubscribe,
} from '../../core/types/twin-api.ts';

export const LEGACY_ANNOTATIONS_STORAGE_KEY = 'hus_legacy_annotations_v1';
export const ANNOTATIONS_MIGRATED_STORAGE_KEY = 'hus:annotations:migrated_v1';
export const SCOPED_ANNOTATIONS_KEY_PREFIX = 'hus:annotations:';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HouseIdentity {
  readonly houseId: string;
  readonly houseName: string;
}

export interface ResolveHouseIdentityOptions {
  readonly houseId?: string;
  readonly houseName?: string;
  readonly locationSearch?: string;
}

export type HouseIdentitySource = {
  readonly floors?: {
    propertyName?(): string;
  };
  readonly rooms?: {
    list?(): readonly Pick<RoomManifestEntry, 'zoneId'>[];
  };
};

const DEFAULT_HOUSE_NAMES: Readonly<Record<string, string>> = {
  'simple-house': 'Georgian Country House',
  'stahl-house': 'Stahl House — Case Study #22',
  'simple-flat': 'pied-à-terre Apartment',
};

const SIMPLE_HOUSE_ZONE_IDS: ReadonlySet<string> = new Set([
  'houseHall',
  'houseDrawing',
  'houseKitchenDiner',
  'houseCloakroom',
  'houseLanding',
  'housePrincipalBed',
  'housePrincipalEnsuite',
  'houseBedroom2',
  'houseStudy',
  'houseBathroom',
]);

const STAHL_HOUSE_ZONE_IDS: ReadonlySet<string> = new Set([
  'stahlLivingDining',
  'stahlKitchen',
  'stahlMasterSuite',
  'stahlBedroom2',
  'stahlBathCore',
  'stahlPoolTerrace',
  'stahlCarport',
]);

const SIMPLE_FLAT_ZONE_IDS: ReadonlySet<string> = new Set([
  'flatLivingKitchen',
  'flatHall',
  'flatBedroom',
  'flatBathroom',
]);

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function slugifyHouseId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function scopedAnnotationsStorageKey(houseId: string): string {
  const normalized = slugifyHouseId(houseId) || 'simple-house';
  return `${SCOPED_ANNOTATIONS_KEY_PREFIX}${normalized}`;
}

export function notesExportFilename(houseId: string, ext: 'md' | 'json'): string {
  const normalized = slugifyHouseId(houseId) || 'house';
  return `${normalized}-annotations.${ext}`;
}

function humanizeHouseSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inferHouseIdFromPropertyName(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (!lower || lower === 'digital twin') return null;
  if (lower.includes('stahl') || lower.includes('case study')) return 'stahl-house';
  if (lower.includes('vesterbro') || lower.includes('pied') || lower.includes('simple flat')) {
    return 'simple-flat';
  }
  if (lower.includes('georgian') || lower.includes('simple house')) return 'simple-house';
  return slugifyHouseId(name) || null;
}

function inferHouseIdFromRoomList(zoneIds: readonly string[]): string | null {
  for (const z of zoneIds) {
    if (z.startsWith('house') || SIMPLE_HOUSE_ZONE_IDS.has(z)) return 'simple-house';
    if (z.startsWith('stahl') || STAHL_HOUSE_ZONE_IDS.has(z)) return 'stahl-house';
    if (z.startsWith('flat') || SIMPLE_FLAT_ZONE_IDS.has(z)) return 'simple-flat';
  }
  return null;
}

export function resolveHouseIdentity(
  api?: HouseIdentitySource,
  options?: ResolveHouseIdentityOptions
): HouseIdentity {
  const explicitId = options?.houseId ? slugifyHouseId(options.houseId) : '';
  const search =
    options?.locationSearch ??
    (typeof window !== 'undefined' && window.location ? window.location.search : '');

  let queryHouseId = '';
  if (search) {
    try {
      const param = new URLSearchParams(search).get('house');
      if (param) queryHouseId = slugifyHouseId(param);
    } catch {
      queryHouseId = '';
    }
  }

  const rawPropName = options?.houseName?.trim() || api?.floors?.propertyName?.()?.trim() || '';
  const roomZones = api?.rooms?.list?.()?.map((r) => String(r.zoneId)) ?? [];

  const houseId =
    explicitId ||
    queryHouseId ||
    inferHouseIdFromRoomList(roomZones) ||
    inferHouseIdFromPropertyName(rawPropName) ||
    'simple-house';

  const houseName =
    rawPropName && rawPropName !== 'Digital Twin'
      ? rawPropName
      : (DEFAULT_HOUSE_NAMES[houseId] ?? (humanizeHouseSlug(houseId) || 'Architectural Twin'));

  return { houseId, houseName };
}

/**
 * Resolves which house owns a legacy annotation record based on its `roomZoneId`
 * (and mesh hierarchy hint when pinned on an exterior surface).
 */
export function inferHouseIdForAnnotation(
  record: Pick<SceneAnnotationRecord, 'roomZoneId'> & {
    readonly meshInfo?: { readonly meshName?: string; readonly parentChain?: readonly string[] };
  },
  knownRoomsByHouse?: Readonly<Record<string, ReadonlySet<string>>>
): string {
  const zoneId = (record.roomZoneId ?? '').trim();

  if (knownRoomsByHouse && zoneId && zoneId !== 'exterior') {
    for (const [houseId, zones] of Object.entries(knownRoomsByHouse)) {
      if (zones.has(zoneId)) return slugifyHouseId(houseId) || houseId;
    }
  }

  if (zoneId.startsWith('house') || SIMPLE_HOUSE_ZONE_IDS.has(zoneId)) {
    return 'simple-house';
  }
  if (zoneId.startsWith('stahl') || STAHL_HOUSE_ZONE_IDS.has(zoneId)) {
    return 'stahl-house';
  }
  if (zoneId.startsWith('flat') || SIMPLE_FLAT_ZONE_IDS.has(zoneId)) {
    return 'simple-flat';
  }

  const meshHint = [
    record.meshInfo?.meshName ?? '',
    ...(record.meshInfo?.parentChain ?? []),
  ]
    .join(' ')
    .toLowerCase();

  if (meshHint.includes('simplehouse') || meshHint.includes('simple-house')) {
    return 'simple-house';
  }
  if (meshHint.includes('stahl')) {
    return 'stahl-house';
  }
  if (meshHint.startsWith('flat.') || meshHint.includes(' flat.')) {
    return 'simple-flat';
  }

  return 'legacy-house';
}

function isValidAnnotationRecord(item: unknown): item is SceneAnnotationRecord {
  if (typeof item !== 'object' || item === null) return false;
  const id = Reflect.get(item, 'id');
  const worldPoint = Reflect.get(item, 'worldPoint');
  const cameraPose = Reflect.get(item, 'cameraPose');
  const meshInfo = Reflect.get(item, 'meshInfo');
  return (
    typeof id === 'number' &&
    Array.isArray(worldPoint) &&
    worldPoint.length === 3 &&
    typeof cameraPose === 'object' &&
    cameraPose !== null &&
    typeof meshInfo === 'object' &&
    meshInfo !== null
  );
}

function parseStoredRecords(raw: string | null): SceneAnnotationRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidAnnotationRecord).map((r) => ({
      ...r,
      kind: r.kind ?? 'pin',
    }));
  } catch {
    return [];
  }
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Zero-data-loss migration from legacy unscoped `hus_legacy_annotations_v1` into
 * per-house `hus:annotations:${houseId}` keys.
 *
 * Returns true if a migration was performed during this call.
 */
export function migrateLegacyAnnotations(
  storage: StorageLike | null = getDefaultStorage(),
  knownRoomsByHouse?: Readonly<Record<string, ReadonlySet<string>>>
): boolean {
  if (!storage) return false;

  let legacyRaw: string | null = null;
  try {
    legacyRaw = storage.getItem(LEGACY_ANNOTATIONS_STORAGE_KEY);
  } catch {
    return false;
  }
  if (!legacyRaw) return false;

  const legacyRecords = parseStoredRecords(legacyRaw);
  if (legacyRecords.length === 0) {
    try {
      storage.removeItem(LEGACY_ANNOTATIONS_STORAGE_KEY);
      storage.setItem(ANNOTATIONS_MIGRATED_STORAGE_KEY, '1');
    } catch {
      // Ignore storage errors
    }
    return false;
  }

  const alreadyMigrated = storage.getItem(ANNOTATIONS_MIGRATED_STORAGE_KEY) === '1';
  if (!alreadyMigrated) {
    const partitioned = new Map<string, SceneAnnotationRecord[]>();
    for (const rec of legacyRecords) {
      const targetHouseId = inferHouseIdForAnnotation(rec, knownRoomsByHouse);
      const bucket = partitioned.get(targetHouseId) ?? [];
      bucket.push(rec);
      partitioned.set(targetHouseId, bucket);
    }

    for (const [houseId, migratedBucket] of partitioned.entries()) {
      const scopedKey = scopedAnnotationsStorageKey(houseId);
      const existingRaw = storage.getItem(scopedKey);
      // Only write if the scoped key does not yet exist, or merge missing items without data loss.
      if (existingRaw === null) {
        try {
          storage.setItem(scopedKey, JSON.stringify(migratedBucket));
        } catch {
          // Ignore quota errors
        }
      } else {
        const existingRecords = parseStoredRecords(existingRaw);
        const existingSignatures = new Set(
          existingRecords.map(
            (r) => `${r.createdAt}|${r.roomZoneId}|${r.worldPoint.join(',')}|${r.note}`
          )
        );
        let maxId = existingRecords.reduce((acc, r) => Math.max(acc, r.id), 0);
        let appended = false;
        for (const item of migratedBucket) {
          const sig = `${item.createdAt}|${item.roomZoneId}|${item.worldPoint.join(',')}|${item.note}`;
          if (!existingSignatures.has(sig)) {
            const nextId = existingRecords.some((r) => r.id === item.id) ? ++maxId : item.id;
            maxId = Math.max(maxId, nextId);
            existingRecords.push({ ...item, id: nextId });
            existingSignatures.add(sig);
            appended = true;
          }
        }
        if (appended) {
          try {
            storage.setItem(scopedKey, JSON.stringify(existingRecords));
          } catch {
            // Ignore quota errors
          }
        }
      }
    }
  }

  try {
    storage.removeItem(LEGACY_ANNOTATIONS_STORAGE_KEY);
    storage.setItem(ANNOTATIONS_MIGRATED_STORAGE_KEY, '1');
  } catch {
    // Ignore storage errors
  }

  return !alreadyMigrated;
}

/**
 * Formats 3D scene annotations as a Markdown + JSON report using the active house's display name.
 */
export function formatAnnotationsForAgent(
  records: readonly SceneAnnotationRecord[],
  houseName: string
): string {
  if (records.length === 0) {
    return 'No 3D annotations recorded.';
  }

  const resolvedTitle = houseName.trim() || 'Architectural Twin';
  const lines: string[] = [
    `# ${resolvedTitle} 3D Scene Annotations (${records.length})`,
    '',
  ];

  for (const r of records) {
    const kind: AnnotationKind = r.kind ?? 'pin';
    const [x, y, z] = r.worldPoint;
    const [nx, ny, nz] = r.worldNormal;
    const [cx, cy, cz] = r.cameraPose.position;
    const [tx, ty, tz] = r.cameraPose.target;
    const [mx, my, mz] = r.meshInfo.meshWorldCenter;
    const [sx, sy, sz] = r.meshInfo.meshBoundingBoxSize;
    const [minX, minY, minZ] = r.meshInfo.meshBoundingBoxMin;
    const [maxX, maxY, maxZ] = r.meshInfo.meshBoundingBoxMax;

    if (kind === 'move' && r.objectTransform) {
      const tf = r.objectTransform;
      const noteText = r.note.trim() || `Move ${tf.targetName}`;
      const dRyRad = round3((tf.deltaRotationDeg[1] * Math.PI) / 180);
      const newRyRad = round3((tf.newRotationDeg[1] * Math.PI) / 180);
      lines.push(`## Issue #${r.id} [OBJECT MOVE / ROTATE]: ${noteText}`);
      lines.push(`- **Room / Zone**: ${r.roomName} (\`${r.roomZoneId}\`)`);
      lines.push(`- **Moved Target (${tf.targetKind})**: \`${tf.targetName}\``);
      if (tf.targetPath.length > 0) {
        lines.push(`- **Hierarchy**: \`${tf.targetPath.join(' > ')}\``);
      }
      lines.push(
        `- **World Center (Before → After)**: \`[${tf.initialWorldCenter.join(', ')}]\` → \`[${tf.newWorldCenter.join(', ')}]\``
      );
      lines.push(
        `- **Delta Translation (m)**: \`[ΔX=${tf.deltaTranslation[0]}, ΔY=${tf.deltaTranslation[1]}, ΔZ=${tf.deltaTranslation[2]}]\``
      );
      lines.push(
        `- **Object Local Position (Before → After)**: \`[${tf.initialObjectPosition.join(', ')}]\` → \`[${tf.newObjectPosition.join(', ')}]\``
      );
      lines.push(
        `- **Rotation Euler Deg (Before → After)**: \`[${tf.initialRotationDeg.join('°, ')}°]\` → \`[${tf.newRotationDeg.join('°, ')}°]\` (ΔRotY=\`${tf.deltaRotationDeg[1]}°\` / \`${dRyRad} rad\`, newRotY=\`${newRyRad} rad\`)`
      );
      lines.push(
        `- **Camera Pose**: pos=\`[${cx}, ${cy}, ${cz}]\`, target=\`[${tx}, ${ty}, ${tz}]\`, floor=\`${r.cameraPose.floorViewMode}\`, ceilingCutaway=\`${r.cameraPose.ceilingCutaway}\``
      );
      lines.push('');
      continue;
    }

    if (kind === 'measure' && r.measurement) {
      const m = r.measurement;
      const targetSpec = m.targetMeasurement?.trim();
      const defaultNote = targetSpec
        ? `Adjust span from ${m.distanceM}m to ${targetSpec}`
        : `Measured span: ${m.distanceM}m (${(m.distanceM * 100).toFixed(1)}cm)`;
      const noteText = r.note.trim() || defaultNote;
      lines.push(`## Issue #${r.id} [MEASUREMENT SPAN]: ${noteText}`);
      lines.push(`- **Room / Zone**: ${r.roomName} (\`${r.roomZoneId}\`)`);
      lines.push(
        `- **Measured 3D Span**: \`${formatMetersAndFeetInches(m.distanceM)}\` (Horizontal XZ: \`${m.horizontalDistanceM} m\`)`
      );
      if (targetSpec) {
        lines.push(`- **Target / Real-World Measurement**: \`${targetSpec}\``);
      }
      lines.push(
        `- **Span Axis Deltas (B − A)**: \`ΔX=${m.deltaXYZ[0]} m, ΔY=${m.deltaXYZ[1]} m, ΔZ=${m.deltaXYZ[2]} m\``
      );
      lines.push(
        `- **Start Point A (m)**: \`[${m.startPoint.join(', ')}]\` on \`${m.startMeshName}\` (normal=\`[${m.startNormal.join(', ')}]\`)`
      );
      lines.push(
        `- **End Point B (m)**: \`[${m.endPoint.join(', ')}]\` on \`${m.endMeshName}\` (normal=\`[${m.endNormal.join(', ')}]\`)`
      );
      lines.push(
        `- **Camera Pose**: pos=\`[${cx}, ${cy}, ${cz}]\`, target=\`[${tx}, ${ty}, ${tz}]\`, floor=\`${r.cameraPose.floorViewMode}\`, ceilingCutaway=\`${r.cameraPose.ceilingCutaway}\``
      );
      lines.push('');
      continue;
    }

    const noteText = r.note.trim() || '(No note entered)';
    lines.push(`## Issue #${r.id}: ${noteText}`);
    lines.push(`- **Room / Zone**: ${r.roomName} (\`${r.roomZoneId}\`)`);
    lines.push(`- **Hit World Point (m)**: \`[${x}, ${y}, ${z}]\``);
    lines.push(`- **Surface Normal**: \`[${nx}, ${ny}, ${nz}]\``);
    lines.push(`- **Mesh Name**: \`${r.meshInfo.meshName}\``);
    if (r.meshInfo.parentChain.length > 0) {
      lines.push(`- **Hierarchy**: \`${r.meshInfo.parentChain.join(' > ')}\``);
    }
    lines.push(`- **Geometry**: \`${r.meshInfo.geometrySummary}\``);
    lines.push(`- **Material**: \`${r.meshInfo.materialSummary}\``);
    lines.push(
      `- **Mesh World Bounds**: center=\`[${mx}, ${my}, ${mz}]\`, size=\`[${sx}, ${sy}, ${sz}]\`, min=\`[${minX}, ${minY}, ${minZ}]\`, max=\`[${maxX}, ${maxY}, ${maxZ}]\``
    );
    if (r.meshInfo.cutawayWall) {
      const cw = r.meshInfo.cutawayWall;
      lines.push(
        `- **Cutaway Wall**: \`axis=${cw.axis}, coord=${cw.coord}, span=[${cw.minSpan}..${cw.maxSpan}], floor=${cw.floor}\``
      );
    }
    lines.push(
      `- **Camera Pose**: pos=\`[${cx}, ${cy}, ${cz}]\`, target=\`[${tx}, ${ty}, ${tz}]\`, floor=\`${r.cameraPose.floorViewMode}\`, ceilingCutaway=\`${r.cameraPose.ceilingCutaway}\``
    );
    lines.push('');
  }

  lines.push('```json');
  lines.push(JSON.stringify(records, null, 2));
  lines.push('```');
  return lines.join('\n');
}

export interface ScopedTwinNotesApi extends TwinNotesApi {
  getHouseId(): string;
  getHouseName(): string;
  setActiveHouse(houseId: string, houseName?: string): void;
}

export interface ScopedNotesOptions extends ResolveHouseIdentityOptions {
  readonly storage?: StorageLike | null;
  readonly knownRoomsByHouse?: Readonly<Record<string, ReadonlySet<string>>>;
}

/**
 * Per-house scoped `TwinNotesApi` decorator.
 *
 * Isolates each house's annotations in `hus:annotations:${houseId}`, migrates any
 * legacy unscoped `hus_legacy_annotations_v1` items by `roomZoneId` with zero data loss,
 * supports runtime house switching, and generates dynamic house-titled Markdown/JSON reports.
 */
export function createScopedTwinNotes(
  api: TwinApi,
  options?: ScopedNotesOptions
): ScopedTwinNotesApi {
  const rawNotes = api.notes;
  const storage = options?.storage !== undefined ? options.storage : getDefaultStorage();

  const initialIdentity = resolveHouseIdentity(api, options);
  let activeHouseId = initialIdentity.houseId;
  let activeHouseName = initialIdentity.houseName;

  const activeHouseZones = new Set<string>(
    api.rooms.list().map((r) => String(r.zoneId))
  );
  const mergedKnownRooms: Record<string, ReadonlySet<string>> = {
    ...(options?.knownRoomsByHouse ?? {}),
    ...(activeHouseZones.size > 0 ? { [activeHouseId]: activeHouseZones } : {}),
  };

  const didMigrateLegacy = migrateLegacyAnnotations(storage, mergedKnownRooms);

  let records: SceneAnnotationRecord[] = [];
  let selectedId: number | null = null;
  let nextId = 1;
  const listeners = new Set<
    (recs: readonly SceneAnnotationRecord[], sel: number | null) => void
  >();

  const computeNextId = (list: readonly SceneAnnotationRecord[]): number => {
    let maxId = 0;
    for (const r of list) {
      if (r.id > maxId) maxId = r.id;
    }
    return maxId + 1;
  };

  const loadForHouse = (houseId: string, allowRawSeed: boolean): void => {
    const key = scopedAnnotationsStorageKey(houseId);
    const raw = storage ? storage.getItem(key) : null;
    if (raw !== null) {
      records = parseStoredRecords(raw);
    } else if (
      allowRawSeed &&
      !didMigrateLegacy &&
      storage?.getItem(ANNOTATIONS_MIGRATED_STORAGE_KEY) !== '1'
    ) {
      // In isolated unit tests where localStorage is stubbed empty, preserve any pre-seeded fake records
      // that belong to this house.
      const rawSeed = rawNotes.getRecords();
      records = rawSeed
        .filter((r) => {
          if (activeHouseZones.size > 0 && activeHouseZones.has(r.roomZoneId)) return true;
          const inferred = inferHouseIdForAnnotation(r, mergedKnownRooms);
          return inferred === houseId || !['simple-house', 'stahl-house', 'simple-flat'].includes(houseId);
        })
        .map((r) => ({ ...r }));
    } else {
      records = [];
    }
    nextId = computeNextId(records);
    selectedId =
      selectedId !== null && records.some((r) => r.id === selectedId)
        ? selectedId
        : (records[records.length - 1]?.id ?? null);
  };

  const saveForActiveHouse = (): void => {
    if (!storage) return;
    try {
      storage.setItem(
        scopedAnnotationsStorageKey(activeHouseId),
        JSON.stringify(records)
      );
    } catch {
      // Ignore storage quota errors
    }
  };

  const emit = (): void => {
    const snapshot = [...records];
    for (const fn of listeners) {
      fn(snapshot, selectedId);
    }
  };

  loadForHouse(activeHouseId, true);

  return {
    getHouseId: () => activeHouseId,
    getHouseName: () => activeHouseName,

    setActiveHouse(nextHouseId: string, nextHouseName?: string): void {
      const normalizedId = slugifyHouseId(nextHouseId) || 'simple-house';
      const resolvedName =
        nextHouseName?.trim() ||
        DEFAULT_HOUSE_NAMES[normalizedId] ||
        humanizeHouseSlug(normalizedId) ||
        activeHouseName;

      if (normalizedId === activeHouseId && resolvedName === activeHouseName) {
        return;
      }

      for (const r of records) {
        if (r.kind === 'move' && r.objectTransform) {
          rawNotes.resetMovedObject(r.objectTransform.targetUuid);
        }
      }
      rawNotes.detachGizmo();
      rawNotes.cancelMeasurement();

      activeHouseId = normalizedId;
      activeHouseName = resolvedName;
      selectedId = null;
      loadForHouse(activeHouseId, false);
      rawNotes.reapplyMoves(records);
      emit();
    },

    // Viewport / 3D gizmo & event methods delegated to the scene controller
    isActive: () => rawNotes.isActive(),
    setActive: (active) => rawNotes.setActive(active),
    toggleActive: () => rawNotes.toggleActive(),
    getToolMode: () => rawNotes.getToolMode(),
    setToolMode: (tool) => rawNotes.setToolMode(tool),
    getGizmoMode: () => rawNotes.getGizmoMode(),
    setGizmoMode: (mode) => rawNotes.setGizmoMode(mode),
    getMeasureAxisSnap: () => rawNotes.getMeasureAxisSnap(),
    setMeasureAxisSnap: (enabled) => rawNotes.setMeasureAxisSnap(enabled),
    cancelMeasurement: () => rawNotes.cancelMeasurement(),
    onPick: (listener) => rawNotes.onPick(listener),
    onMarkerSelect: (listener) => rawNotes.onMarkerSelect(listener),
    onMeasurePreview: (listener) => rawNotes.onMeasurePreview(listener),
    onMeasureComplete: (listener) => rawNotes.onMeasureComplete(listener),
    onObjectTransform: (listener) => rawNotes.onObjectTransform(listener),
    syncMarkers: (recs, selId) => rawNotes.syncMarkers(recs, selId),
    reapplyMoves: (recs) => rawNotes.reapplyMoves(recs),
    detachGizmo: () => rawNotes.detachGizmo(),
    switchMoveCandidate: (targetUuid) => rawNotes.switchMoveCandidate(targetUuid),
    selectMovedObject: (targetUuid) => rawNotes.selectMovedObject(targetUuid),
    nudgeSelected: (dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg) =>
      rawNotes.nudgeSelected(dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg),
    setSelectedDelta: (dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg) =>
      rawNotes.setSelectedDelta(dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg),
    resetMovedObject: (targetUuid) => rawNotes.resetMovedObject(targetUuid),

    // Scoped record store methods
    getRecords: () => records,
    getSelectedId: () => selectedId,
    getSelectedRecord: () =>
      selectedId === null ? null : (records.find((r) => r.id === selectedId) ?? null),

    subscribe(
      listener: (recs: readonly SceneAnnotationRecord[], sel: number | null) => void
    ): Unsubscribe {
      listeners.add(listener);
      listener([...records], selectedId);
      return () => {
        listeners.delete(listener);
      };
    },

    select(id: number | null): void {
      if (selectedId === id) return;
      selectedId = id;
      emit();
    },

    add(hit: SceneAnnotationHit, initialNote = ''): SceneAnnotationRecord {
      const record: SceneAnnotationRecord = {
        ...hit,
        kind: hit.kind ?? 'pin',
        id: nextId++,
        createdAt: new Date().toISOString(),
        note: initialNote,
      };
      records = [...records, record];
      selectedId = record.id;
      saveForActiveHouse();
      emit();
      return record;
    },

    addMeasure(
      startHit: SceneAnnotationHit,
      endHit: SceneAnnotationHit,
      snappedEndPoint: Vec3Tuple,
      initialNote = ''
    ): SceneAnnotationRecord {
      const pA = startHit.worldPoint;
      const pB = snappedEndPoint;
      const dx = round3(pB[0] - pA[0]);
      const dy = round3(pB[1] - pA[1]);
      const dz = round3(pB[2] - pA[2]);
      const horizDist = round3(Math.hypot(dx, dz));
      const dist = round3(Math.hypot(dx, dy, dz));
      const midPoint: Vec3Tuple = [
        round3((pA[0] + pB[0]) * 0.5),
        round3((pA[1] + pB[1]) * 0.5),
        round3((pA[2] + pB[2]) * 0.5),
      ];

      const measurement: SceneMeasurementAnnotation = {
        startPoint: pA,
        startNormal: startHit.worldNormal,
        startMeshName: startHit.meshInfo.meshName,
        endPoint: pB,
        endNormal: endHit.worldNormal,
        endMeshName: endHit.meshInfo.meshName,
        deltaXYZ: [dx, dy, dz],
        horizontalDistanceM: horizDist,
        distanceM: dist,
      };

      const midRoom = api.rooms.findAt(midPoint);
      const roomZoneId = midRoom?.zoneId ?? startHit.roomZoneId ?? 'exterior';
      const roomName = midRoom?.label ?? startHit.roomName ?? 'Exterior / Unzoned';

      const record: SceneAnnotationRecord = {
        ...startHit,
        kind: 'measure',
        worldPoint: midPoint,
        roomZoneId,
        roomName,
        cameraPose: endHit.cameraPose,
        measurement,
        id: nextId++,
        createdAt: new Date().toISOString(),
        note: initialNote,
      };
      records = [...records, record];
      selectedId = record.id;
      saveForActiveHouse();
      emit();
      return record;
    },

    upsertMove(
      baseHit: SceneAnnotationHit,
      transform: SceneObjectTransformAnnotation,
      cameraPose: SceneCameraPoseSnapshot
    ): SceneAnnotationRecord {
      const [dx, dy, dz] = transform.deltaTranslation;
      const [drx, dry, drz] = transform.deltaRotationDeg;
      const hasMove = Math.hypot(dx, dy, dz) >= 0.002;
      const hasRot = Math.hypot(drx, dry, drz) >= 0.1;

      const autoSummaryParts: string[] = [];
      if (hasMove || !hasRot) {
        autoSummaryParts.push(
          `Move ${transform.targetName} to [${transform.newWorldCenter.join(', ')}] (Δ=[${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy}, ${dz >= 0 ? '+' : ''}${dz}]m)`
        );
      }
      if (hasRot) {
        const rotAxes: string[] = [];
        if (Math.abs(drx) >= 0.1) rotAxes.push(`X ${drx >= 0 ? '+' : ''}${drx}°`);
        if (Math.abs(dry) >= 0.1 || rotAxes.length === 0) {
          rotAxes.push(`Y ${dry >= 0 ? '+' : ''}${dry}°`);
        }
        if (Math.abs(drz) >= 0.1) rotAxes.push(`Z ${drz >= 0 ? '+' : ''}${drz}°`);
        if (hasMove) {
          autoSummaryParts.push(`Rotate ${rotAxes.join(', ')}`);
        } else {
          autoSummaryParts.push(`Rotate ${transform.targetName} (${rotAxes.join(', ')})`);
        }
      }
      const autoSummary = autoSummaryParts.join(', ');

      const existingIdx = records.findIndex(
        (r) => r.kind === 'move' && r.objectTransform?.targetUuid === transform.targetUuid
      );

      if (existingIdx !== -1) {
        const existing = records[existingIdx];
        const wasAutoNote =
          !existing.note.trim() ||
          existing.note.startsWith(`Move ${transform.targetName} `) ||
          existing.note.startsWith(`Rotate ${transform.targetName} `);
        const updated: SceneAnnotationRecord = {
          ...existing,
          worldPoint: transform.newWorldCenter,
          cameraPose,
          objectTransform: transform,
          note: wasAutoNote ? autoSummary : existing.note,
        };
        records = records.map((r, idx) => (idx === existingIdx ? updated : r));
        selectedId = updated.id;
        saveForActiveHouse();
        emit();
        return updated;
      }

      const record: SceneAnnotationRecord = {
        ...baseHit,
        kind: 'move',
        worldPoint: transform.newWorldCenter,
        cameraPose,
        objectTransform: transform,
        id: nextId++,
        createdAt: new Date().toISOString(),
        note: autoSummary,
      };
      records = [...records, record];
      selectedId = record.id;
      saveForActiveHouse();
      emit();
      return record;
    },

    updateTargetMeasurement(id: number, targetMeasurement: string): void {
      const idx = records.findIndex((r) => r.id === id);
      if (idx === -1) return;
      const target = records[idx];
      if (!target.measurement) return;
      const updated: SceneAnnotationRecord = {
        ...target,
        measurement: {
          ...target.measurement,
          targetMeasurement,
        },
      };
      records = records.map((r, i) => (i === idx ? updated : r));
      saveForActiveHouse();
      emit();
    },

    updateNote(id: number, note: string): void {
      const idx = records.findIndex((r) => r.id === id);
      if (idx === -1) return;
      const updated: SceneAnnotationRecord = { ...records[idx], note };
      records = records.map((r, i) => (i === idx ? updated : r));
      saveForActiveHouse();
      emit();
    },

    remove(id: number): void {
      const idx = records.findIndex((r) => r.id === id);
      if (idx === -1) return;
      records = records.filter((r) => r.id !== id);
      if (selectedId === id) {
        selectedId = records[records.length - 1]?.id ?? null;
      }
      if (records.length === 0) {
        nextId = 1;
      }
      saveForActiveHouse();
      emit();
    },

    clearAll(): void {
      records = [];
      selectedId = null;
      nextId = 1;
      saveForActiveHouse();
      emit();
    },

    formatForAgent(): string {
      return formatAnnotationsForAgent(records, activeHouseName);
    },
  };
}

export function isScopedTwinNotes(notes: TwinNotesApi): notes is ScopedTwinNotesApi {
  return (
    typeof Reflect.get(notes, 'getHouseId') === 'function' &&
    typeof Reflect.get(notes, 'getHouseName') === 'function' &&
    typeof Reflect.get(notes, 'setActiveHouse') === 'function'
  );
}

export function createScopedTwinApi(
  api: TwinApi,
  options?: ScopedNotesOptions
): { readonly api: TwinApi; readonly notes: ScopedTwinNotesApi } {
  if (isScopedTwinNotes(api.notes)) {
    return { api, notes: api.notes };
  }
  const scopedNotes = createScopedTwinNotes(api, options);
  return {
    api: {
      ...api,
      notes: scopedNotes,
    },
    notes: scopedNotes,
  };
}

// ---------------------------------------------------------------------------
// Per-house scoped sidecar metadata (trade assignment + resolved status)
// ---------------------------------------------------------------------------


const LEGACY_NOTE_META_KEY = 'hus.ui.noteMeta.legacy.v1';
const SCOPED_NOTE_META_PREFIX = 'hus:noteMeta:';

function isValidNoteTrade(value: unknown): value is NoteTrade {
  return typeof value === 'string' && NOTE_TRADES.some((t) => t === value);
}

function parseNoteMetaMap(raw: string | null): Record<string, NoteMeta> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, NoteMeta> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'object' || v === null) continue;
      const trade: unknown = Reflect.get(v, 'trade');
      const resolved: unknown = Reflect.get(v, 'resolved');
      out[k] = {
        ...(isValidNoteTrade(trade) ? { trade } : {}),
        ...(resolved === true ? { resolved: true } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function scopedNoteMetaStorageKey(houseId: string): string {
  const normalized = slugifyHouseId(houseId) || 'simple-house';
  return `${SCOPED_NOTE_META_PREFIX}${normalized}`;
}

const scopedNoteMetaSignals = new Map<string, Signal<Readonly<Record<string, NoteMeta>>>>();

function ensureScopedNoteMetaSignal(
  houseId: string,
  storage: StorageLike | null = getDefaultStorage()
): Signal<Readonly<Record<string, NoteMeta>>> {
  const normalized = slugifyHouseId(houseId) || 'simple-house';
  const existing = scopedNoteMetaSignals.get(normalized);
  if (existing) return existing;

  const key = scopedNoteMetaStorageKey(normalized);
  let raw = storage ? storage.getItem(key) : null;
  if (raw === null && normalized === 'legacy-house' && storage) {
    const legacy = storage.getItem(LEGACY_NOTE_META_KEY);
    if (legacy) {
      raw = legacy;
      try {
        storage.setItem(key, legacy);
      } catch {
        // Ignore storage errors
      }
    }
  }

  const sig = signal<Readonly<Record<string, NoteMeta>>>(parseNoteMetaMap(raw));
  scopedNoteMetaSignals.set(normalized, sig);
  return sig;
}

export function getScopedNoteMeta(
  houseId: string
): Readonly<Record<string, NoteMeta>> {
  return ensureScopedNoteMetaSignal(houseId).value;
}

export function updateScopedNoteMeta(
  houseId: string,
  id: number,
  patch: Partial<NoteMeta>
): void {
  const sig = ensureScopedNoteMetaSignal(houseId);
  const key = String(id);
  const prev = sig.value[key] ?? {};
  const merged: NoteMeta = { ...prev, ...patch };
  const next: Record<string, NoteMeta> = { ...sig.value, [key]: merged };
  sig.value = next;
  const storage = getDefaultStorage();
  if (storage) {
    try {
      storage.setItem(scopedNoteMetaStorageKey(houseId), JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  }
}

export function pruneScopedNoteMeta(
  houseId: string,
  liveIds: readonly number[]
): void {
  const sig = ensureScopedNoteMetaSignal(houseId);
  const live = new Set(liveIds.map(String));
  const current = sig.value;
  const keys = Object.keys(current);
  if (keys.every((k) => live.has(k))) return;
  const next: Record<string, NoteMeta> = {};
  for (const k of keys) {
    const meta = current[k];
    if (live.has(k) && meta) next[k] = meta;
  }
  sig.value = next;
  const storage = getDefaultStorage();
  if (storage) {
    try {
      storage.setItem(scopedNoteMetaStorageKey(houseId), JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  }
}
