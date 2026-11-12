import { describe, expect, it, vi } from 'vitest';
import type { SceneAnnotationHit, SceneAnnotationRecord } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { RoomManifestEntry } from '../../core/types/twin-ux.ts';
import type { TwinApi } from '../../core/types/twin-api.ts';
import { AnnotatorController } from './annotator-controller.ts';
import { buildNotesJsonPayload, notesExportFilename } from './notes-export.ts';
import {
  ANNOTATIONS_MIGRATED_STORAGE_KEY,
  createScopedTwinNotes,
  formatAnnotationsForAgent,
  inferHouseIdForAnnotation,
  LEGACY_ANNOTATIONS_STORAGE_KEY,
  migrateLegacyAnnotations,
  scopedAnnotationsStorageKey,
  type StorageLike,
} from './scoped-annotations.ts';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & {
  dump(): Record<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

function makeHit(
  roomZoneId: string,
  roomName: string,
  meshName = 'wall.mesh',
  point: [number, number, number] = [1.25, 1.4, -2.1]
): SceneAnnotationHit {
  return {
    worldPoint: point,
    worldNormal: [0, 1, 0],
    roomZoneId: roomZoneId as RoomZoneId,
    roomName,
    meshInfo: {
      meshName,
      materialSummary: 'MeshStandardMaterial',
      geometrySummary: 'BoxGeometry',
      parentChain: ['scene', roomZoneId, meshName],
      meshWorldCenter: point,
      meshBoundingBoxMin: [0, 0, -3],
      meshBoundingBoxMax: [2, 3, -1],
      meshBoundingBoxSize: [2, 3, 2],
    },
    cameraPose: {
      position: [4, 2.2, 5],
      target: point,
      floorViewMode: 'all',
      ceilingCutaway: true,
      isOrthographic: false,
    },
  };
}

function makeRecord(
  id: number,
  roomZoneId: string,
  roomName: string,
  note: string,
  meshName = 'wall.mesh'
): SceneAnnotationRecord {
  return {
    ...makeHit(roomZoneId, roomName, meshName),
    id,
    createdAt: `2026-06-21T12:00:0${id}Z`,
    kind: 'pin',
    note,
  };
}

function createStubTwinApi(options: {
  propertyName: string;
  roomZones: readonly string[];
}): {
  api: TwinApi;
  syncedMarkerCounts: number[];
} {
  const syncedMarkerCounts: number[] = [];
  const manifest: RoomManifestEntry[] = options.roomZones.map((z) => ({
    zoneId: z as RoomZoneId,
    label: z,
    group: 'ground',
    floor: 'ground',
    lights: [],
    scenes: [],
    devices: [],
  }));

  const api = {
    floors: {
      propertyName: () => options.propertyName,
    },
    rooms: {
      list: () => manifest,
      findAt: () => null,
    },
    camera: {
      getPose: () => makeHit('exterior', 'Exterior').cameraPose,
      flyToCameraPose: vi.fn(),
      projectWorldToViewport: () => ({ x: 100, y: 100, inFront: true }),
      onViewChanged: () => () => {},
    },
    walkthrough: {
      isActive: () => false,
    },
    notes: {
      isActive: () => false,
      setActive: vi.fn(),
      toggleActive: () => true,
      getToolMode: () => 'pin' as const,
      setToolMode: vi.fn(),
      getGizmoMode: () => 'translate' as const,
      setGizmoMode: vi.fn(),
      getMeasureAxisSnap: () => false,
      setMeasureAxisSnap: vi.fn(),
      cancelMeasurement: vi.fn(),
      onPick: () => () => {},
      onMarkerSelect: () => () => {},
      onMeasurePreview: () => () => {},
      onMeasureComplete: () => () => {},
      onObjectTransform: () => () => {},
      syncMarkers: (records: readonly SceneAnnotationRecord[]) => {
        syncedMarkerCounts.push(records.length);
      },
      reapplyMoves: vi.fn(),
      detachGizmo: vi.fn(),
      switchMoveCandidate: vi.fn(),
      selectMovedObject: () => false,
      nudgeSelected: vi.fn(),
      setSelectedDelta: vi.fn(),
      resetMovedObject: () => false,
      getRecords: () => [],
      getSelectedId: () => null,
      getSelectedRecord: () => null,
      subscribe: () => () => {},
      select: vi.fn(),
      add: vi.fn(),
      addMeasure: vi.fn(),
      upsertMove: vi.fn(),
      updateTargetMeasurement: vi.fn(),
      updateNote: vi.fn(),
      remove: vi.fn(),
      clearAll: vi.fn(),
      formatForAgent: () => '',
    },
  } as unknown as TwinApi;

  return { api, syncedMarkerCounts };
}

describe('Per-house scoped annotations & legacy migration', () => {
  it('isolates annotations per houseId so pins in Manor House never bleed into Georgian Country House', () => {
    const storage = createMemoryStorage();

    const manor = createStubTwinApi({
      propertyName: 'Manor House',
      roomZones: ['kitchen', 'familyRoom', 'entranceHall'],
    });
    const manorNotes = createScopedTwinNotes(manor.api, {
      houseId: 'legacy-house',
      houseName: 'Manor House',
      storage,
    });
    manorNotes.add(makeHit('kitchen', 'Kitchen'), 'Align oak island pendant');
    manorNotes.add(makeHit('familyRoom', 'Family Room'), 'Check hearth plinth');
    expect(manorNotes.getRecords()).toHaveLength(2);

    const georgian = createStubTwinApi({
      propertyName: 'Georgian Double-Fronted Country House',
      roomZones: ['houseHall', 'houseDrawing', 'houseKitchenDiner'],
    });
    const georgianNotes = createScopedTwinNotes(georgian.api, {
      houseId: 'simple-house',
      houseName: 'Georgian Country House',
      storage,
    });
    expect(georgianNotes.getRecords()).toHaveLength(0);

    georgianNotes.add(makeHit('houseDrawing', 'Drawing Room'), 'Adjust brass rotary dimmer height');
    expect(georgianNotes.getRecords()).toHaveLength(1);
    expect(georgianNotes.getRecords()[0]?.roomZoneId).toBe('houseDrawing');

    // Manor House store remains untouched with its 2 records
    const manorReloaded = JSON.parse(
      storage.getItem(scopedAnnotationsStorageKey('legacy-house')) ?? '[]'
    ) as SceneAnnotationRecord[];
    const georgianReloaded = JSON.parse(
      storage.getItem(scopedAnnotationsStorageKey('simple-house')) ?? '[]'
    ) as SceneAnnotationRecord[];
    expect(manorReloaded).toHaveLength(2);
    expect(georgianReloaded).toHaveLength(1);
  });

  it('migrates legacy hus_legacy_annotations_v1 records by roomZoneId with zero data loss and removes legacy key', () => {
    const legacyItems: SceneAnnotationRecord[] = [
      makeRecord(1, 'kitchen', 'Kitchen', 'Manor kitchen island note'),
      makeRecord(2, 'houseDrawing', 'Drawing Room', 'Georgian drawing room chandelier'),
      makeRecord(3, 'stahlPoolTerrace', 'Pool Terrace', 'Stahl cantilever soffit wash'),
      makeRecord(4, 'flatLivingKitchen', 'Living & Kitchen', 'Apartment courtyard mullion'),
      makeRecord(5, 'bootLobby', 'Boot Lobby', 'Manor boot bench joinery'),
    ];

    const storage = createMemoryStorage({
      [LEGACY_ANNOTATIONS_STORAGE_KEY]: JSON.stringify(legacyItems),
    });

    expect(inferHouseIdForAnnotation(legacyItems[0])).toBe('legacy-house');
    expect(inferHouseIdForAnnotation(legacyItems[1])).toBe('simple-house');
    expect(inferHouseIdForAnnotation(legacyItems[2])).toBe('stahl-house');
    expect(inferHouseIdForAnnotation(legacyItems[3])).toBe('simple-flat');

    const migrated = migrateLegacyAnnotations(storage);
    expect(migrated).toBe(true);
    expect(storage.getItem(LEGACY_ANNOTATIONS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(ANNOTATIONS_MIGRATED_STORAGE_KEY)).toBe('1');

    const manorRecords = JSON.parse(
      storage.getItem(scopedAnnotationsStorageKey('legacy-house')) ?? '[]'
    ) as SceneAnnotationRecord[];
    const simpleRecords = JSON.parse(
      storage.getItem(scopedAnnotationsStorageKey('simple-house')) ?? '[]'
    ) as SceneAnnotationRecord[];
    const stahlRecords = JSON.parse(
      storage.getItem(scopedAnnotationsStorageKey('stahl-house')) ?? '[]'
    ) as SceneAnnotationRecord[];
    const flatRecords = JSON.parse(
      storage.getItem(scopedAnnotationsStorageKey('simple-flat')) ?? '[]'
    ) as SceneAnnotationRecord[];

    expect(manorRecords.map((r) => r.note)).toEqual([
      'Manor kitchen island note',
      'Manor boot bench joinery',
    ]);
    expect(simpleRecords.map((r) => r.note)).toEqual(['Georgian drawing room chandelier']);
    expect(stahlRecords.map((r) => r.note)).toEqual(['Stahl cantilever soffit wash']);
    expect(flatRecords.map((r) => r.note)).toEqual(['Apartment courtyard mullion']);
  });

  it('reloads scoped annotations and re-syncs 3D markers when switching active house at runtime', () => {
    const storage = createMemoryStorage({
      [scopedAnnotationsStorageKey('legacy-house')]: JSON.stringify([
        makeRecord(1, 'kitchen', 'Kitchen', 'Manor note A'),
        makeRecord(2, 'entranceHall', 'Entrance Hall', 'Manor note B'),
      ]),
      [scopedAnnotationsStorageKey('stahl-house')]: JSON.stringify([
        makeRecord(1, 'stahlLivingDining', 'Living Pavilion', 'Stahl glass corner'),
      ]),
    });

    const { api, syncedMarkerCounts } = createStubTwinApi({
      propertyName: 'Manor House',
      roomZones: ['kitchen', 'entranceHall'],
    });

    const controller = new AnnotatorController(api, {
      houseId: 'legacy-house',
      houseName: 'Manor House',
      storage,
    });
    expect(controller.getHouseId()).toBe('legacy-house');
    expect(controller.getScopedApi().notes.getRecords()).toHaveLength(2);
    expect(syncedMarkerCounts[syncedMarkerCounts.length - 1]).toBe(2);

    controller.setActiveHouse('stahl-house', 'Stahl House — Case Study #22');
    expect(controller.getHouseId()).toBe('stahl-house');
    expect(controller.getScopedApi().notes.getRecords()).toHaveLength(1);
    expect(controller.getScopedApi().notes.getRecords()[0]?.note).toBe('Stahl glass corner');
    expect(syncedMarkerCounts[syncedMarkerCounts.length - 1]).toBe(1);

    controller.setActiveHouse('simple-house', 'Georgian Country House');
    expect(controller.getScopedApi().notes.getRecords()).toHaveLength(0);
    expect(syncedMarkerCounts[syncedMarkerCounts.length - 1]).toBe(0);

    controller.dispose();
  });

  it('uses dynamic houseName and houseId in Markdown and JSON exports instead of hardcoded Manor House', () => {
    const storage = createMemoryStorage();
    const { api } = createStubTwinApi({
      propertyName: 'Georgian Country House',
      roomZones: ['houseHall', 'houseDrawing'],
    });

    const notes = createScopedTwinNotes(api, {
      houseId: 'simple-house',
      houseName: 'Georgian Country House',
      storage,
    });
    notes.add(makeHit('houseHall', 'Entrance Hall'), 'Centre bell-jar lantern');

    const md = notes.formatForAgent();
    expect(md).toContain('# Georgian Country House 3D Scene Annotations (1)');
    expect(md).not.toContain('Manor House');

    const stahlReport = formatAnnotationsForAgent(
      [makeRecord(1, 'stahlPoolTerrace', 'Pool Terrace', 'Check deck joint')],
      'Stahl House — Case Study #22'
    );
    expect(stahlReport).toContain('# Stahl House — Case Study #22 3D Scene Annotations (1)');
    expect(stahlReport).not.toContain('Manor House');

    const payload = buildNotesJsonPayload(notes);
    expect(payload.houseId).toBe('simple-house');
    expect(payload.houseName).toBe('Georgian Country House');
    expect(payload.markdownReport).toContain('# Georgian Country House 3D Scene Annotations (1)');
    expect(notesExportFilename('simple-house', 'md')).toBe('simple-house-annotations.md');
    expect(notesExportFilename('stahl-house', 'json')).toBe('stahl-house-annotations.json');
  });
});
