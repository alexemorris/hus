import * as THREE from 'three';
import type { TradeView } from '../../core/types/twin-ux.ts';
import {
  classifyObject,
  isRenderableObject,
  splitNameSegments,
  tokenizeSegment,
  type TradeCategory,
} from './trade-classifier.ts';
import { TRADE_CATEGORY_LABELS } from './trade-view-profiles.ts';

/** A device / fitting / outlet position for trade schedules. */
export interface ServicePoint {
  /** Full object name of the device root (e.g. `kitchen.island.sink.tap`). */
  readonly name: string;
  /** Short human label derived from the name. */
  readonly label: string;
  readonly category: TradeCategory;
  /** World-space reference position (bbox centre; sanitaryware uses rim, pendants use underside). */
  readonly position: THREE.Vector3;
  /** Height of the reference point above the floor surface directly below it. */
  readonly heightAboveFloorM?: number;
  /** Zone id from `userData.zoneId` / `userData.zone`, or the leading name segment. */
  readonly room: string;
  /** KNX circuit / switch / UFH metadata if present on the device chain. */
  readonly circuitId?: string;
  readonly knxAddress?: string;
  readonly ufhZoneId?: string;
}

/** Categories included in each view's schedule. */
export const SERVICE_SCHEDULE_CATEGORIES: Readonly<Record<TradeView, readonly TradeCategory[]>> = {
  owner: [],
  architect: ['sanitary', 'lighting'],
  builder: [],
  electrician: ['electrical', 'lighting', 'smart'],
  plumber: ['plumbing', 'heating', 'sanitary'],
};

const SERVICE_CATEGORY_SET: ReadonlySet<TradeCategory> = new Set<TradeCategory>([
  'electrical',
  'lighting',
  'smart',
  'plumbing',
  'heating',
  'sanitary',
]);

/** Devices larger than this (bbox diagonal, m) are treated as assemblies, not single points. */
const MAX_DEVICE_DIAGONAL_M = 3.0;
const FLOOR_RAY_MAX_DROP_M = 4.0;

const FLOOR_NAME_TOKENS: ReadonlySet<string> = new Set<string>([
  'floor', 'floors', 'slab', 'screed', 'carpet', 'flooring', 'floorboard', 'floorboards', 'deck',
  'decking', 'turf', 'tile', 'tiles', 'paving', 'cobble', 'cobbles', 'parquet', 'landing', 'tread',
  'lawn', 'patio', 'flagstone', 'flagstones', 'rug',
]);
const NON_FLOOR_TOKENS: ReadonlySet<string> = new Set<string>(['ceiling', 'roof', 'soffit', 'lid', 'top']);

function nameTokens(name: string): string[] {
  const out: string[] = [];
  for (const seg of splitNameSegments(name)) out.push(...tokenizeSegment(seg));
  return out;
}

function readString(u: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = u?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function findInChain(obj: THREE.Object3D, keys: readonly string[]): string | undefined {
  let p: THREE.Object3D | null = obj;
  while (p) {
    const u = p.userData as Record<string, unknown> | undefined;
    for (const k of keys) {
      const v = readString(u, k);
      if (v) return v;
    }
    p = p.parent;
  }
  return undefined;
}

function labelFor(name: string): string {
  const segs = splitNameSegments(name).filter((s) => !/^\d+$/.test(s));
  const tail = segs.slice(-2).join(' ');
  return tail.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim() || name;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Caches device-level service points. Capture on the UNBATCHED scene graph (before
 * `SceneBatchOptimizer.optimize()`), because batching merges the small parts of sockets, switches
 * and taps into shared draw calls and their individual positions are lost.
 */
export class ServiceScheduleIndex {
  private points: ServicePoint[] | null = null;

  public hasCapture(): boolean {
    return this.points !== null;
  }

  public capture(roots: readonly THREE.Object3D[]): void {
    this.points = collectAllServicePoints(roots);
  }

  public collect(view: TradeView): ServicePoint[] {
    const cats = new Set(SERVICE_SCHEDULE_CATEGORIES[view]);
    return (this.points ?? []).filter((p) => cats.has(p.category));
  }

  public exportCsv(view: TradeView): string {
    return formatServiceScheduleCsv(this.collect(view));
  }
}

/** Live (non-cached) service-point collection for a view. Prefer {@link ServiceScheduleIndex}. */
export function collectServicePoints(roots: readonly THREE.Object3D[], view: TradeView): ServicePoint[] {
  const cats = new Set(SERVICE_SCHEDULE_CATEGORIES[view]);
  return collectAllServicePoints(roots).filter((p) => cats.has(p.category));
}

export function exportServiceScheduleCsv(roots: readonly THREE.Object3D[], view: TradeView): string {
  return formatServiceScheduleCsv(collectServicePoints(roots, view));
}

/** Per-room CSV: room, category, item, name, x, y, z, height above floor, circuit, KNX PA, UFH zone. */
export function formatServiceScheduleCsv(points: readonly ServicePoint[]): string {
  const sorted = [...points].sort(
    (a, b) =>
      a.room.localeCompare(b.room) ||
      a.category.localeCompare(b.category) ||
      a.label.localeCompare(b.label) ||
      a.name.localeCompare(b.name)
  );
  const rows: string[] = [
    'room,category,item,object_name,x_m,y_m,z_m,height_above_floor_m,circuit_id,knx_address,ufh_zone',
  ];
  for (const p of sorted) {
    rows.push(
      [
        p.room,
        TRADE_CATEGORY_LABELS[p.category],
        p.label,
        p.name,
        p.position.x.toFixed(3),
        p.position.y.toFixed(3),
        p.position.z.toFixed(3),
        p.heightAboveFloorM !== undefined ? p.heightAboveFloorM.toFixed(3) : '',
        p.circuitId ?? '',
        p.knxAddress ?? '',
        p.ufhZoneId ?? '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return rows.join('\n') + '\n';
}

function collectAllServicePoints(roots: readonly THREE.Object3D[]): ServicePoint[] {
  for (const r of roots) r.updateMatrixWorld(true);
  const rootSet = new Set<THREE.Object3D>(roots);
  const categoryCache = new Map<THREE.Object3D, TradeCategory>();
  const boxCache = new Map<THREE.Object3D, THREE.Box3>();
  const categoryOf = (o: THREE.Object3D): TradeCategory => {
    let c = categoryCache.get(o);
    if (c === undefined) {
      c = classifyObject(o);
      categoryCache.set(o, c);
    }
    return c;
  };
  const boxOf = (o: THREE.Object3D): THREE.Box3 => {
    let b = boxCache.get(o);
    if (!b) {
      b = new THREE.Box3().setFromObject(o);
      boxCache.set(o, b);
    }
    return b;
  };

  const deviceRoots = new Map<THREE.Object3D, TradeCategory>();
  const floorCandidates: THREE.Object3D[] = [];
  const tmpSize = new THREE.Vector3();

  const visit = (node: THREE.Object3D): void => {
    const u = node.userData as Record<string, unknown> | undefined;
    if (u && (u['isAnnotationGroup'] || u['isSecurityFovCone'] || u['isBatchedStaticMesh'])) return;
    if (isRenderableObject(node) && node instanceof THREE.Mesh) {
      const cat = categoryOf(node);
      if (SERVICE_CATEGORY_SET.has(cat)) {
        let rootObj: THREE.Object3D = node;
        let p = node.parent;
        while (p && !rootSet.has(p)) {
          const pu = p.userData as Record<string, unknown> | undefined;
          if (pu?.['isRoomContainer']) break;
          boxOf(p).getSize(tmpSize);
          if (tmpSize.length() > MAX_DEVICE_DIAGONAL_M) break;
          // Unnamed wrapper groups (pivots, offsets) are transparent; named ones must match.
          if (p.name && categoryOf(p) !== cat) break;
          if (p.name) rootObj = p;
          p = p.parent;
        }
        if (!deviceRoots.has(rootObj)) deviceRoots.set(rootObj, cat);
      } else if (cat === 'finishes' || cat === 'structure' || cat === 'external' || cat === 'joinery') {
        const tokens = nameTokens(node.name);
        if (tokens.some((t) => FLOOR_NAME_TOKENS.has(t)) && !tokens.some((t) => NON_FLOOR_TOKENS.has(t))) {
          floorCandidates.push(node);
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  for (const r of roots) visit(r);

  // Drop device roots nested inside another device root of the same category.
  const finalRoots: Array<[THREE.Object3D, TradeCategory]> = [];
  for (const [obj, cat] of deviceRoots) {
    let p = obj.parent;
    let nested = false;
    while (p) {
      if (deviceRoots.get(p) === cat) {
        nested = true;
        break;
      }
      p = p.parent;
    }
    if (!nested) finalRoots.push([obj, cat]);
  }

  // Several sibling roots can share one name (e.g. an LED strip built from segments): merge them.
  const byName = new Map<string, { readonly cat: TradeCategory; readonly objs: THREE.Object3D[] }>();
  for (const [obj, cat] of finalRoots) {
    const key = `${cat}|${obj.name || obj.uuid}`;
    const entry = byName.get(key);
    if (entry) entry.objs.push(obj);
    else byName.set(key, { cat, objs: [obj] });
  }

  const raycaster = new THREE.Raycaster();
  raycaster.far = FLOOR_RAY_MAX_DROP_M;
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();

  const points: ServicePoint[] = [];
  for (const { cat, objs } of byName.values()) {
    const obj = objs[0]!;
    const box = boxOf(obj).clone();
    for (let i = 1; i < objs.length; i++) box.union(boxOf(objs[i]!));
    if (box.isEmpty()) continue;
    const position = box.getCenter(new THREE.Vector3());
    if (cat === 'sanitary') position.y = box.max.y;
    else if (cat === 'lighting' && box.max.y - box.min.y > 0.25) position.y = box.min.y;

    origin.set(position.x, box.min.y + 0.01, position.z);
    raycaster.set(origin, down);
    const hits = raycaster.intersectObjects(floorCandidates, false);
    const floorY = hits.length > 0 ? hits[0]!.point.y : undefined;

    const name = obj.name || obj.parent?.name || '(unnamed)';
    const room =
      findInChain(obj, ['zoneId', 'zone']) ?? splitNameSegments(name)[0] ?? 'unknown';
    const circuitId = findInChain(obj, ['circuitId']);
    const knxAddress = findInChain(obj, ['switchPa', 'knxPa']);
    const ufhZoneId = findInChain(obj, ['ufhZoneId']);
    points.push({
      name,
      label: labelFor(name),
      category: cat,
      position,
      ...(floorY !== undefined ? { heightAboveFloorM: position.y - floorY } : {}),
      room,
      ...(circuitId !== undefined ? { circuitId } : {}),
      ...(knxAddress !== undefined ? { knxAddress } : {}),
      ...(ufhZoneId !== undefined ? { ufhZoneId } : {}),
    });
  }
  return points;
}
