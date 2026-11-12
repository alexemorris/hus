import * as THREE from 'three';
import type { RoomZoneLodRegistration } from '../../../core/entities.ts';
import type { RoomZoneId } from '../../../core/types/topology.ts';
import {
  buildRoomBoundsBoxes,
  toRoomLocalX,
  toRoomLocalZ,
  type DaylightPortalEmitter,
  type RoomBoundsBox,
} from './light-volume-state.ts';

const PORTAL_OPENING_CONTEXT_RE =
  /window|bifold|velux|skylight|rooflight|fanlight|glazed|glazing|casement|sash|frenchdoor|patiodoor|courtyarddoor|stabledoor|glassdoor|slidingdoor|hayloftdoor|garagedoor|doorglass|(?:north|south|east|west)wall\.glass/i;
const PORTAL_GLASS_LEAF_RE = /glass|pane|glazing|velux|skylight|rooflight|fanlight/i;
const PORTAL_FRAME_HARDWARE_RE =
  /frame|mullion|transom|cill|sill|reveal|lintel|handle|hinge|latch|lock|stay|track|seal|bead|shutter|blind|curtain/i;
const PORTAL_EXCLUDE_PROP_RE =
  /shower|mirror|cabinet|display|fridge|oven|aga|wine|picture|table|lamp|pendant|bulb|filament|halo|cone|pool|tv|monitor|bottle|glassware|tumbler|goblet|clock|gauge|dial|balustrade|shelf|bookcase|wardrobe|vanity|sink|toilet/i;
const ROOFLIGHT_RE = /velux|skylight|rooflight/i;

export interface DiscoveredExteriorGlazedPortal {
  readonly roomZoneId: RoomZoneId;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly outwardNx: number;
  readonly outwardNy: number;
  readonly outwardNz: number;
  readonly isRooflight: boolean;
}

interface GlazedOpeningCandidate {
  readonly mesh: THREE.Mesh;
  readonly geom: THREE.BufferGeometry;
  readonly fullPath: string;
}

function classifyGlazedOpeningMesh(
  obj: THREE.Object3D,
  sceneRoot: THREE.Object3D,
  maxGlassOpacity: number,
  extraPortalNamePatterns?: readonly RegExp[]
): GlazedOpeningCandidate | null {
  if (!(obj instanceof THREE.Mesh)) return null;
  const geom = obj.geometry;
  if (!(geom instanceof THREE.BufferGeometry)) return null;

  const meshName = obj.name || '';
  if (PORTAL_FRAME_HARDWARE_RE.test(meshName)) return null;

  const pathParts: string[] = [];
  let cur: THREE.Object3D | null = obj;
  let portalTagged = false;
  let portalExcluded = false;
  while (cur && cur !== sceneRoot) {
    if (cur.name) pathParts.push(cur.name);
    if (cur.userData?.isExteriorGlazedPortal) portalTagged = true;
    if (cur.userData?.excludeExteriorPortalDiscovery) portalExcluded = true;
    cur = cur.parent;
  }
  const fullPath = pathParts.reverse().join('.');
  if (portalExcluded || PORTAL_EXCLUDE_PROP_RE.test(fullPath)) return null;
  if (
    !portalTagged &&
    !PORTAL_OPENING_CONTEXT_RE.test(fullPath) &&
    !(extraPortalNamePatterns && extraPortalNamePatterns.some((re) => re.test(fullPath)))
  ) {
    return null;
  }

  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  let hasGlassMat = false;
  for (const m of mats) {
    if (!m) continue;
    const phys = m as THREE.MeshPhysicalMaterial;
    if (
      (m.transparent && m.opacity < maxGlassOpacity && m.opacity > 0.01) ||
      (typeof phys.transmission === 'number' && phys.transmission > 0.2)
    ) {
      hasGlassMat = true;
      break;
    }
  }
  if (!hasGlassMat && !PORTAL_GLASS_LEAF_RE.test(meshName)) return null;

  return { mesh: obj, geom, fullPath };
}

function findNearestHostRoom(
  wx: number,
  wy: number,
  wz: number,
  interiorRooms: readonly RoomBoundsBox[],
  padXZ: number,
  padMinY: number,
  padMaxY: number
): RoomBoundsBox | null {
  let best: RoomBoundsBox | null = null;
  let bestOutDist = Infinity;
  for (const r of interiorRooms) {
    const lx = toRoomLocalX(wx, wz, r);
    const ly = wy - r.oy;
    const lz = toRoomLocalZ(wx, wz, r);
    if (
      lx < r.minX - padXZ ||
      lx > r.maxX + padXZ ||
      ly < r.minY - padMinY ||
      ly > r.maxY + padMaxY ||
      lz < r.minZ - padXZ ||
      lz > r.maxZ + padXZ
    ) {
      continue;
    }
    const dxOut = Math.max(0, r.minX - lx, lx - r.maxX);
    const dyOut = Math.max(0, r.minY - ly, ly - r.maxY);
    const dzOut = Math.max(0, r.minZ - lz, lz - r.maxZ);
    const outDist = Math.hypot(dxOut, dyOut * 0.8, dzOut);
    if (
      outDist < bestOutDist - 0.05 ||
      (Math.abs(outDist - bestOutDist) <= 0.05 && (!best || r.volume < best.volume))
    ) {
      bestOutDist = outDist;
      best = r;
    }
  }
  return best;
}

export function findContainingInteriorRoomStrict(
  wx: number,
  wy: number,
  wz: number,
  interiorRooms: readonly RoomBoundsBox[],
  insetXZ = 0.05,
  minYOffset = -0.06,
  maxYOffset = 0.16
): RoomBoundsBox | null {
  let best: RoomBoundsBox | null = null;
  for (const r of interiorRooms) {
    const lx = toRoomLocalX(wx, wz, r);
    const ly = wy - r.oy;
    const lz = toRoomLocalZ(wx, wz, r);
    if (
      lx >= r.minX + insetXZ &&
      lx <= r.maxX - insetXZ &&
      ly >= r.minY + minYOffset &&
      ly <= r.maxY + maxYOffset &&
      lz >= r.minZ + insetXZ &&
      lz <= r.maxZ - insetXZ
    ) {
      if (!best || r.volume < best.volume) {
        best = r;
      }
    }
  }
  return best;
}

function isOpeningRooflight(
  fullPath: string,
  ly: number,
  hostRoom: RoomBoundsBox,
  sizeX: number,
  sizeY: number,
  sizeZ: number
): boolean {
  return (
    ROOFLIGHT_RE.test(fullPath) ||
    (ly > hostRoom.maxY - 0.55 && sizeY <= Math.min(sizeX, sizeZ) * 0.9)
  );
}

function computeWallOutwardNormal(
  lx: number,
  lz: number,
  hostRoom: RoomBoundsBox
): { readonly outNx: number; readonly outNz: number } {
  const dMinX = Math.abs(lx - hostRoom.minX);
  const dMaxX = Math.abs(hostRoom.maxX - lx);
  const dMinZ = Math.abs(lz - hostRoom.minZ);
  const dMaxZ = Math.abs(hostRoom.maxZ - lz);
  const minD = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);
  let lOutX = 0;
  let lOutZ = 0;
  if (minD === dMinX) lOutX = -1;
  else if (minD === dMaxX) lOutX = 1;
  else if (minD === dMinZ) lOutZ = -1;
  else lOutZ = 1;

  return {
    outNx: lOutX * hostRoom.cosY + lOutZ * hostRoom.sinY,
    outNz: -lOutX * hostRoom.sinY + lOutZ * hostRoom.cosY,
  };
}

/**
 * Discovers interior daylight sky-portal emitters for 3D daylight GI baking.
 */
export function discoverDaylightPortals(
  sceneRoot: THREE.Object3D,
  interiorRooms: readonly RoomBoundsBox[]
): DaylightPortalEmitter[] {
  sceneRoot.updateMatrixWorld(true);
  const portals: DaylightPortalEmitter[] = [];
  const worldCenter = new THREE.Vector3();
  const worldScale = new THREE.Vector3();

  sceneRoot.traverse((obj) => {
    const candidate = classifyGlazedOpeningMesh(obj, sceneRoot, 0.82);
    if (!candidate) return;
    const { mesh, geom, fullPath } = candidate;

    if (!geom.boundingBox) geom.computeBoundingBox();
    const bb = geom.boundingBox;
    if (!bb || bb.isEmpty()) return;

    bb.getCenter(worldCenter).applyMatrix4(mesh.matrixWorld);
    worldScale.setFromMatrixScale(mesh.matrixWorld);
    const sx = (bb.max.x - bb.min.x) * Math.abs(worldScale.x);
    const sy = (bb.max.y - bb.min.y) * Math.abs(worldScale.y);
    const sz = (bb.max.z - bb.min.z) * Math.abs(worldScale.z);
    const dims = [sx, sy, sz].sort((a, b) => a - b);
    // Opening pane must be planar/thin on one axis and have meaningful glazed area
    if (dims[0]! > 0.42) return;
    const area = dims[1]! * dims[2]!;
    if (area < 0.045 || !Number.isFinite(area)) return;

    const px = worldCenter.x;
    const py = worldCenter.y;
    const pz = worldCenter.z;

    // Deduplicate double-glazed inner/outer panes at the same opening center
    for (let i = 0; i < portals.length; i++) {
      const ex = portals[i]!;
      const dSq = (ex.x - px) * (ex.x - px) + (ex.y - py) * (ex.y - py) + (ex.z - pz) * (ex.z - pz);
      if (dSq < 0.035) {
        ex.area = Math.max(ex.area, area);
        return;
      }
    }

    const hostRoom = findNearestHostRoom(px, py, pz, interiorRooms, 0.72, 0.35, 0.85);
    if (!hostRoom) return;

    const lx = toRoomLocalX(px, pz, hostRoom);
    const ly = py - hostRoom.oy;
    const lz = toRoomLocalZ(px, pz, hostRoom);

    const isRooflight = isOpeningRooflight(fullPath, ly, hostRoom, sx, sy, sz);

    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (isRooflight) {
      const toCenterX = hostRoom.worldCenterX - px;
      const toCenterZ = hostRoom.worldCenterZ - pz;
      const hLen = Math.hypot(toCenterX, toCenterZ) || 1;
      nx = (toCenterX / hLen) * 0.25;
      ny = -0.935;
      nz = (toCenterZ / hLen) * 0.25;
    } else {
      const { outNx, outNz } = computeWallOutwardNormal(lx, lz, hostRoom);
      nx = -outNx;
      ny = 0;
      nz = -outNz;
    }

    // Check whether the outer side of the glazing faces open exterior sky vs an adjacent interior room
    const outerX = px - nx * 0.85;
    const outerY = py - ny * 0.85;
    const outerZ = pz - nz * 0.85;
    const otherInterior = findContainingInteriorRoomStrict(
      outerX,
      outerY,
      outerZ,
      interiorRooms
    );
    const exposure = otherInterior && otherInterior !== hostRoom ? 0.22 : 1.0;

    portals.push({
      x: px,
      y: py,
      z: pz,
      nx,
      ny,
      nz,
      area,
      exposure,
      hostRoom,
    });
  });

  return portals;
}

/**
 * Shared glazed-opening discovery used by both Daylight GI and PortalVisibilitySolver.
 * Scans the built scene for all exterior windows, bays, glazed screens, bifolds, glazed doors,
 * fanlights, and Velux rooflights, returning world AABBs padded by `padM` (+0.35m default)
 * and outward-facing unit normals.
 */
export function discoverExteriorGlazedPortals(
  sceneRoot: THREE.Object3D,
  lodRegistrations: readonly RoomZoneLodRegistration[],
  padM = 0.35
): DiscoveredExteriorGlazedPortal[] {
  sceneRoot.updateMatrixWorld(true);
  const extraPortalNamePatterns: RegExp[] = [];
  for (const reg of lodRegistrations) {
    if (reg.exteriorPortalNamePattern) extraPortalNamePatterns.push(reg.exteriorPortalNamePattern);
  }
  const interiorRooms = buildRoomBoundsBoxes(lodRegistrations, {
    useObb: true,
    interiorOnly: true,
  });
  if (interiorRooms.length === 0) return [];

  const results: Array<{
    roomZoneId: RoomZoneId;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    centerX: number;
    centerY: number;
    centerZ: number;
    outwardNx: number;
    outwardNy: number;
    outwardNz: number;
    isRooflight: boolean;
  }> = [];

  const worldBox = new THREE.Box3();
  const worldCenter = new THREE.Vector3();
  const worldSize = new THREE.Vector3();

  sceneRoot.traverse((obj) => {
    const candidate = classifyGlazedOpeningMesh(obj, sceneRoot, 0.88, extraPortalNamePatterns);
    if (!candidate) return;
    const { mesh, fullPath } = candidate;

    worldBox.setFromObject(mesh);
    if (worldBox.isEmpty()) return;
    worldBox.getCenter(worldCenter);
    worldBox.getSize(worldSize);
    const dims = [worldSize.x, worldSize.y, worldSize.z].sort((a, b) => a - b);
    if (dims[0]! > 0.55) return;
    const area = dims[1]! * dims[2]!;
    if (area < 0.035 || !Number.isFinite(area)) return;

    const px = worldCenter.x;
    const py = worldCenter.y;
    const pz = worldCenter.z;

    const hostRoom = findNearestHostRoom(px, py, pz, interiorRooms, 0.85, 0.45, 0.95);
    if (!hostRoom) return;

    // Merge double-glazed inner/outer panes at the same opening center
    for (let i = 0; i < results.length; i++) {
      const ex = results[i]!;
      if (ex.roomZoneId !== (hostRoom.zoneId as RoomZoneId)) continue;
      const dSq =
        (ex.centerX - px) * (ex.centerX - px) +
        (ex.centerY - py) * (ex.centerY - py) +
        (ex.centerZ - pz) * (ex.centerZ - pz);
      if (dSq < 0.06) {
        ex.minX = Math.min(ex.minX, worldBox.min.x - padM);
        ex.maxX = Math.max(ex.maxX, worldBox.max.x + padM);
        ex.minY = Math.min(ex.minY, worldBox.min.y - padM);
        ex.maxY = Math.max(ex.maxY, worldBox.max.y + padM);
        ex.minZ = Math.min(ex.minZ, worldBox.min.z - padM);
        ex.maxZ = Math.max(ex.maxZ, worldBox.max.z + padM);
        return;
      }
    }

    const lx = toRoomLocalX(px, pz, hostRoom);
    const ly = py - hostRoom.oy;
    const lz = toRoomLocalZ(px, pz, hostRoom);

    const isRooflight = isOpeningRooflight(
      fullPath,
      ly,
      hostRoom,
      worldSize.x,
      worldSize.y,
      worldSize.z
    );

    let outNx = 0;
    let outNy = 0;
    let outNz = 0;
    if (isRooflight) {
      const awayX = px - hostRoom.worldCenterX;
      const awayZ = pz - hostRoom.worldCenterZ;
      const hLen = Math.hypot(awayX, awayZ) || 1;
      outNx = (awayX / hLen) * 0.25;
      outNy = 0.935;
      outNz = (awayZ / hLen) * 0.25;
      const nLen = Math.hypot(outNx, outNy, outNz) || 1;
      outNx /= nLen;
      outNy /= nLen;
      outNz /= nLen;
    } else {
      const wallNormal = computeWallOutwardNormal(lx, lz, hostRoom);
      outNx = wallNormal.outNx;
      outNy = 0;
      outNz = wallNormal.outNz;
    }

    // Skip purely interior glazed partitions where the outward probe lands deep inside another interior room
    const outerX = px + outNx * 0.85;
    const outerY = py + outNy * 0.85;
    const outerZ = pz + outNz * 0.85;
    const otherInterior = findContainingInteriorRoomStrict(
      outerX,
      outerY,
      outerZ,
      interiorRooms,
      0.12,
      0.05,
      -0.05
    );
    if (otherInterior && otherInterior !== hostRoom) {
      return;
    }

    results.push({
      roomZoneId: hostRoom.zoneId as RoomZoneId,
      minX: worldBox.min.x - padM,
      maxX: worldBox.max.x + padM,
      minY: worldBox.min.y - padM,
      maxY: worldBox.max.y + padM,
      minZ: worldBox.min.z - padM,
      maxZ: worldBox.max.z + padM,
      centerX: px,
      centerY: py,
      centerZ: pz,
      outwardNx: outNx,
      outwardNy: outNy,
      outwardNz: outNz,
      isRooflight,
    });
  });

  return results;
}
