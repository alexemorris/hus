import * as THREE from 'three';
import { getRoomZoneRegistrations } from '../rooms/room-zone-registry.ts';
import {
  formatMetersAndFeetInches,
  type AnnotationKind,
  CutawayWallDescriptor,
  SceneAnnotationHit,
  SceneAnnotationRecord,
  SceneCameraPoseSnapshot,
  SceneMeasurementAnnotation,
  SceneMeshDiagnosticInfo,
  SceneObjectTransformAnnotation,
  Vec3Tuple,
} from '../../core/types/scene.ts';

const STORAGE_KEY = 'hus_annotations_v1';

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function toTuple3(v: THREE.Vector3): Vec3Tuple {
  return [round3(v.x), round3(v.y), round3(v.z)];
}

export { formatMetersAndFeetInches };

export interface SceneGroupNameMap {
  readonly firstFloorMeshGroup: THREE.Object3D;
  readonly groundFloorCeilingGroup: THREE.Object3D;
  readonly ceilingMeshGroup: THREE.Object3D;
  readonly southWestWallGroup: THREE.Object3D;
  readonly westWallGroup: THREE.Object3D;
  readonly northWallGroup: THREE.Object3D;
  readonly eastWallGroup: THREE.Object3D;
}

export function resolveRoomForPoint(x: number, y: number, z: number): {
  readonly roomZoneId: string;
  readonly roomName: string;
} {
  for (const reg of getRoomZoneRegistrations()) {
    const b = reg.bounds;
    if (
      x >= b.minX - 0.35 &&
      x <= b.maxX + 0.35 &&
      y >= b.minY - 0.35 &&
      y <= b.maxY + 0.45 &&
      z >= b.minZ - 0.35 &&
      z <= b.maxZ + 0.35
    ) {
      return { roomZoneId: reg.zoneId, roomName: reg.shortName };
    }
  }

  let bestZoneId = 'exterior';
  let bestName = 'Exterior / Grounds';
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const reg of getRoomZoneRegistrations()) {
    const b = reg.bounds;
    const cx = (b.minX + b.maxX) * 0.5;
    const cy = (b.minY + b.maxY) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;
    const dSq = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestZoneId = reg.zoneId;
      bestName = `${reg.shortName} (Near)`;
    }
  }
  return { roomZoneId: bestZoneId, roomName: bestName };
}

function describeGeometry(geo: THREE.BufferGeometry): string {
  if (geo instanceof THREE.BoxGeometry) {
    const p = geo.parameters;
    return `BoxGeometry(${round3(p.width)} × ${round3(p.height)} × ${round3(p.depth)})`;
  }
  if (geo instanceof THREE.CylinderGeometry) {
    const p = geo.parameters;
    return `CylinderGeometry(rTop=${round3(p.radiusTop)}, rBot=${round3(p.radiusBottom)}, h=${round3(p.height)})`;
  }
  if (geo instanceof THREE.PlaneGeometry) {
    const p = geo.parameters;
    return `PlaneGeometry(${round3(p.width)} × ${round3(p.height)})`;
  }
  if (geo instanceof THREE.SphereGeometry) {
    const p = geo.parameters;
    return `SphereGeometry(r=${round3(p.radius)})`;
  }
  const posAttr = geo.getAttribute('position');
  const vertCount = posAttr ? posAttr.count : 0;
  return `${geo.type}(verts=${vertCount})`;
}

function describeMaterial(matOrArray: THREE.Material | THREE.Material[]): string {
  const mat = Array.isArray(matOrArray) ? matOrArray[0] : matOrArray;
  if (!mat) return 'UnknownMaterial';

  const parts: string[] = [mat.type];
  if ('color' in mat && mat.color instanceof THREE.Color) {
    parts.push(`#${mat.color.getHexString()}`);
  }
  if ('roughness' in mat && typeof mat.roughness === 'number') {
    parts.push(`r=${round3(mat.roughness)}`);
  }
  if ('metalness' in mat && typeof mat.metalness === 'number') {
    parts.push(`m=${round3(mat.metalness)}`);
  }
  if (mat.transparent && mat.opacity < 1) {
    parts.push(`alpha=${round3(mat.opacity)}`);
  }
  const sideLabel =
    mat.side === THREE.DoubleSide
      ? 'DoubleSide'
      : mat.side === THREE.BackSide
        ? 'BackSide'
        : 'FrontSide';
  parts.push(sideLabel);
  return parts.join(' · ');
}

export function extractSceneAnnotationHit(
  hit: THREE.Intersection,
  mesh: THREE.Mesh,
  sceneRoot: THREE.Scene,
  groupMap: SceneGroupNameMap,
  cameraPose: SceneCameraPoseSnapshot
): SceneAnnotationHit {
  const worldPoint = toTuple3(hit.point);

  const normalMatrixSource = hit.object instanceof THREE.Mesh ? hit.object : mesh;
  const rawNormal = hit.face
    ? hit.face.normal.clone().transformDirection(normalMatrixSource.matrixWorld).normalize()
    : new THREE.Vector3(0, 1, 0);
  const worldNormal = toTuple3(rawNormal);

  const worldCenterVec = new THREE.Vector3();
  const worldBox = new THREE.Box3();
  if (mesh.parent) {
    worldBox.setFromObject(mesh);
  } else {
    // When `mesh` is a constituent sub-mesh of a merged static batch (`mesh.parent === null`),
    // `Box3.setFromObject` would call `mesh.updateWorldMatrix` and overwrite `mesh.matrixWorld`
    // with `mesh.matrix`. Transforming `mesh.geometry.boundingBox` by `mesh.matrixWorld` is O(1)
    // and preserves `mesh.matrixWorld`.
    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox();
    }
    if (mesh.geometry.boundingBox) {
      worldBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    }
  }
  worldBox.getCenter(worldCenterVec);
  const worldSizeVec = new THREE.Vector3();
  worldBox.getSize(worldSizeVec);

  const parentChain: string[] = [];
  let foundCutaway: CutawayWallDescriptor | undefined;

  let cur: THREE.Object3D | null = mesh;
  while (cur && cur !== sceneRoot) {
    if (!foundCutaway && cur.userData?.cutawayWall) {
      foundCutaway = cur.userData.cutawayWall as CutawayWallDescriptor;
    }
    const labelParts: string[] = [];
    if (cur.name) {
      labelParts.push(cur.name);
    } else if (cur === groupMap.firstFloorMeshGroup) {
      labelParts.push('firstFloorMeshGroup');
    } else if (cur === groupMap.groundFloorCeilingGroup) {
      labelParts.push('groundFloorCeilingGroup');
    } else if (cur === groupMap.ceilingMeshGroup) {
      labelParts.push('ceilingMeshGroup');
    } else if (cur === groupMap.southWestWallGroup) {
      labelParts.push('cutawayWall.southWest');
    } else if (cur === groupMap.westWallGroup) {
      labelParts.push('cutawayWall.west');
    } else if (cur === groupMap.northWallGroup) {
      labelParts.push('cutawayWall.north');
    } else if (cur === groupMap.eastWallGroup) {
      labelParts.push('cutawayWall.east');
    }

    if (typeof cur.userData?.interactableId === 'string') {
      labelParts.push(`interactable:${cur.userData.interactableId}`);
    }
    if (typeof cur.userData?.zoneId === 'string') {
      labelParts.push(`zone:${cur.userData.zoneId}`);
    }
    if (labelParts.length > 0) {
      parentChain.unshift(labelParts.join(' '));
    }
    cur =
      cur.parent ??
      ((cur.userData?.__batchOriginalParent as THREE.Object3D | undefined) ?? null);
  }

  const meshInfo: SceneMeshDiagnosticInfo = {
    meshName: mesh.name || '(unnamed mesh)',
    parentChain,
    geometrySummary: describeGeometry(mesh.geometry),
    materialSummary: describeMaterial(mesh.material),
    meshWorldCenter: toTuple3(worldCenterVec),
    meshBoundingBoxMin: toTuple3(worldBox.min),
    meshBoundingBoxMax: toTuple3(worldBox.max),
    meshBoundingBoxSize: toTuple3(worldSizeVec),
    ...(foundCutaway ? { cutawayWall: foundCutaway } : {}),
  };

  const { roomZoneId, roomName } = resolveRoomForPoint(
    hit.point.x,
    hit.point.y,
    hit.point.z
  );

  return {
    kind: 'pin',
    worldPoint,
    worldNormal,
    roomZoneId,
    roomName,
    meshInfo,
    cameraPose,
  };
}

export function buildAnnotationMarker3D(
  record: SceneAnnotationRecord,
  isSelected: boolean
): THREE.Group {
  const kind: AnnotationKind = record.kind ?? 'pin';

  if (kind === 'measure' && record.measurement) {
    const m = record.measurement;
    const markerGroup = new THREE.Group();
    markerGroup.name = `annotationMarker.measure.${record.id}`;
    markerGroup.userData.annotationId = record.id;

    const pA = new THREE.Vector3(m.startPoint[0], m.startPoint[1], m.startPoint[2]);
    const pB = new THREE.Vector3(m.endPoint[0], m.endPoint[1], m.endPoint[2]);
    const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);

    const spanColor = isSelected ? 0xffc44d : 0x38bdf8;

    // Endpoint spheres & perpendicular architectural tick rings at A and B
    const endGeo = new THREE.SphereGeometry(isSelected ? 0.032 : 0.024, 14, 14);
    const endMat = new THREE.MeshBasicMaterial({
      color: spanColor,
      depthTest: false,
    });
    for (const pt of [pA, pB]) {
      const s = new THREE.Mesh(endGeo, endMat);
      s.position.copy(pt);
      s.renderOrder = 998;
      s.userData.annotationId = record.id;
      markerGroup.add(s);
    }

    // Solid 3D cylinder dimension line between Point A and Point B
    const spanVec = new THREE.Vector3().subVectors(pB, pA);
    const spanLen = spanVec.length();
    if (spanLen > 0.002) {
      const spanDir = spanVec.clone().normalize();
      const lineGeo = new THREE.CylinderGeometry(
        isSelected ? 0.0085 : 0.0065,
        isSelected ? 0.0085 : 0.0065,
        spanLen,
        10
      );
      const lineMat = new THREE.MeshBasicMaterial({
        color: spanColor,
        depthTest: false,
        transparent: true,
        opacity: isSelected ? 0.98 : 0.88,
      });
      const lineMesh = new THREE.Mesh(lineGeo, lineMat);
      lineMesh.position.copy(mid);
      lineMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spanDir);
      lineMesh.renderOrder = 997;
      lineMesh.userData.annotationId = record.id;
      markerGroup.add(lineMesh);

      // Perpendicular architectural dimension end-ticks at A and B
      const tickUp =
        Math.abs(spanDir.y) < 0.92
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
      const tickPerp = new THREE.Vector3().crossVectors(spanDir, tickUp).normalize();
      const tickGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.12, 8);
      for (const pt of [pA, pB]) {
        const tickMesh = new THREE.Mesh(tickGeo, lineMat);
        tickMesh.position.copy(pt);
        tickMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tickPerp);
        tickMesh.renderOrder = 998;
        tickMesh.userData.annotationId = record.id;
        markerGroup.add(tickMesh);
      }
    }

    // When selected, show subtle X/Y/Z axis component projection lines
    if (isSelected && spanLen > 0.02) {
      const cornerX = new THREE.Vector3(pB.x, pA.y, pA.z);
      const cornerXZ = new THREE.Vector3(pB.x, pA.y, pB.z);
      const projPoints = [pA, cornerX, cornerXZ, pB];
      const projGeo = new THREE.BufferGeometry().setFromPoints(projPoints);
      const projMat = new THREE.LineBasicMaterial({
        color: 0x9ec6e8,
        depthTest: false,
        transparent: true,
        opacity: 0.65,
      });
      const projLine = new THREE.Line(projGeo, projMat);
      projLine.renderOrder = 996;
      markerGroup.add(projLine);
    }

    return markerGroup;
  }

  if (kind === 'move' && record.objectTransform) {
    const tf = record.objectTransform;
    const markerGroup = new THREE.Group();
    markerGroup.name = `annotationMarker.move.${record.id}`;
    markerGroup.userData.annotationId = record.id;

    const pStart = new THREE.Vector3(
      tf.initialWorldCenter[0],
      tf.initialWorldCenter[1],
      tf.initialWorldCenter[2]
    );
    const pEnd = new THREE.Vector3(
      tf.newWorldCenter[0],
      tf.newWorldCenter[1],
      tf.newWorldCenter[2]
    );
    const moveColor = isSelected ? 0xffc44d : 0xa855f7;

    // Origin ghost ring/sphere at initial position
    const originSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xc084fc,
        depthTest: false,
        transparent: true,
        opacity: 0.7,
      })
    );
    originSphere.position.copy(pStart);
    originSphere.renderOrder = 997;
    originSphere.userData.annotationId = record.id;
    markerGroup.add(originSphere);

    // Vector line + cone arrowhead from initialWorldCenter to newWorldCenter
    const moveVec = new THREE.Vector3().subVectors(pEnd, pStart);
    const moveDist = moveVec.length();
    if (moveDist > 0.005) {
      const moveDir = moveVec.clone().normalize();
      const mid = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);
      const shaftMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.007, 0.007, moveDist, 10),
        new THREE.MeshBasicMaterial({
          color: moveColor,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        })
      );
      shaftMesh.position.copy(mid);
      shaftMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), moveDir);
      shaftMesh.renderOrder = 998;
      shaftMesh.userData.annotationId = record.id;
      markerGroup.add(shaftMesh);

      const coneMesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.024, 0.065, 12),
        new THREE.MeshBasicMaterial({
          color: moveColor,
          depthTest: false,
        })
      );
      coneMesh.position.copy(pEnd).addScaledVector(moveDir, -0.032);
      coneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), moveDir);
      coneMesh.renderOrder = 998;
      coneMesh.userData.annotationId = record.id;
      markerGroup.add(coneMesh);
    }

    // 3D circular rotation arc ring around pEnd when the object has been rotated
    const [drx, dry, drz] = tf.deltaRotationDeg;
    const hasRot = Math.hypot(drx, dry, drz) >= 0.5;

    if (hasRot) {
      const rotRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.007, 10, 36, Math.PI * 1.65),
        new THREE.MeshBasicMaterial({
          color: moveColor,
          depthTest: false,
          transparent: true,
          opacity: 0.92,
        })
      );
      rotRing.rotation.x = Math.PI / 2;
      rotRing.position.copy(pEnd);
      rotRing.renderOrder = 998;
      rotRing.userData.annotationId = record.id;
      markerGroup.add(rotRing);
    }

    return markerGroup;
  }

  const markerGroup = new THREE.Group();
  markerGroup.name = `annotationMarker.${record.id}`;
  markerGroup.userData.annotationId = record.id;

  const hitPos = new THREE.Vector3(
    record.worldPoint[0],
    record.worldPoint[1],
    record.worldPoint[2]
  );
  const normalVec = new THREE.Vector3(
    record.worldNormal[0],
    record.worldNormal[1],
    record.worldNormal[2]
  );
  if (normalVec.lengthSq() < 0.01) {
    normalVec.set(0, 1, 0);
  } else {
    normalVec.normalize();
  }

  markerGroup.position.copy(hitPos);

  const pinColor = isSelected ? 0xffc44d : 0xeb4d3d;

  // Compact contact sphere right at the exact clicked 3D point
  const tipGeo = new THREE.SphereGeometry(isSelected ? 0.026 : 0.02, 14, 14);
  const tipMat = new THREE.MeshBasicMaterial({
    color: pinColor,
  });
  const tipMesh = new THREE.Mesh(tipGeo, tipMat);
  tipMesh.userData.annotationId = record.id;
  markerGroup.add(tipMesh);

  // Subtle surface ring around the contact point
  const ringGeo = new THREE.RingGeometry(0.034, 0.048, 20);
  const ringMat = new THREE.MeshBasicMaterial({
    color: pinColor,
    side: THREE.DoubleSide,
    depthTest: false,
    transparent: true,
    opacity: isSelected ? 0.92 : 0.72,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  const targetQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    normalVec
  );
  ringMesh.quaternion.copy(targetQuat);
  ringMesh.position.copy(normalVec).multiplyScalar(0.004);
  ringMesh.renderOrder = 998;
  ringMesh.userData.annotationId = record.id;
  markerGroup.add(ringMesh);

  return markerGroup;
}

/**
 * Builds the live rubber-band 3D measurement preview group while the user is moving
 * the cursor between Point A (`startPoint`) and Point B (`endPoint`) in Measure Mode.
 */
export function buildLiveMeasurePreview3D(
  startPoint: Vec3Tuple,
  endPoint: Vec3Tuple | null,
  axisSnapLocked: boolean
): THREE.Group {
  const previewGroup = new THREE.Group();
  previewGroup.name = 'liveMeasurePreviewGroup';
  previewGroup.userData.isAnnotationGroup = true;

  const pA = new THREE.Vector3(startPoint[0], startPoint[1], startPoint[2]);
  const accentColor = axisSnapLocked ? 0x4ade80 : 0x38bdf8;

  const startSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 14, 14),
    new THREE.MeshBasicMaterial({
      color: accentColor,
      depthTest: false,
    })
  );
  startSphere.position.copy(pA);
  startSphere.renderOrder = 999;
  previewGroup.add(startSphere);

  if (!endPoint) return previewGroup;

  const pB = new THREE.Vector3(endPoint[0], endPoint[1], endPoint[2]);
  const endSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 14, 14),
    new THREE.MeshBasicMaterial({
      color: 0xffc44d,
      depthTest: false,
    })
  );
  endSphere.position.copy(pB);
  endSphere.renderOrder = 999;
  previewGroup.add(endSphere);

  const spanVec = new THREE.Vector3().subVectors(pB, pA);
  const spanLen = spanVec.length();
  if (spanLen > 0.002) {
    const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
    const spanDir = spanVec.clone().normalize();

    const lineMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, spanLen, 10),
      new THREE.MeshBasicMaterial({
        color: accentColor,
        depthTest: false,
      })
    );
    lineMesh.position.copy(mid);
    lineMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spanDir);
    lineMesh.renderOrder = 998;
    previewGroup.add(lineMesh);

    // X / Y / Z component right-triangle guide lines
    const cornerX = new THREE.Vector3(pB.x, pA.y, pA.z);
    const cornerXZ = new THREE.Vector3(pB.x, pA.y, pB.z);
    const projGeo = new THREE.BufferGeometry().setFromPoints([pA, cornerX, cornerXZ, pB]);
    const projLine = new THREE.Line(
      projGeo,
      new THREE.LineBasicMaterial({
        color: 0xffc44d,
        depthTest: false,
        transparent: true,
        opacity: 0.72,
      })
    );
    projLine.renderOrder = 997;
    previewGroup.add(projLine);
  }

  return previewGroup;
}

export type AnnotationStoreListener = (
  records: readonly SceneAnnotationRecord[],
  selectedId: number | null
) => void;

export class SceneAnnotationStore {
  private records: SceneAnnotationRecord[] = [];
  private selectedId: number | null = null;
  private nextId = 1;
  private readonly listeners = new Set<AnnotationStoreListener>();

  public constructor() {
    this.loadFromStorage();
  }

  public subscribe(listener: AnnotationStoreListener): () => void {
    this.listeners.add(listener);
    listener(this.records, this.selectedId);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getRecords(): readonly SceneAnnotationRecord[] {
    return this.records;
  }

  public getSelectedId(): number | null {
    return this.selectedId;
  }

  public getSelectedRecord(): SceneAnnotationRecord | null {
    if (this.selectedId === null) return null;
    return this.records.find((r) => r.id === this.selectedId) ?? null;
  }

  public selectAnnotation(id: number | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit();
  }

  public addAnnotation(hit: SceneAnnotationHit, initialNote = ''): SceneAnnotationRecord {
    const record: SceneAnnotationRecord = {
      ...hit,
      kind: hit.kind ?? 'pin',
      id: this.nextId++,
      createdAt: new Date().toISOString(),
      note: initialNote,
    };
    this.records.push(record);
    this.selectedId = record.id;
    this.saveToStorage();
    this.emit();
    return record;
  }

  /**
   * Creates or updates a manual object Move / Rotate annotation (`kind === 'move'`).
   * If an annotation already exists for the same `targetUuid`, it updates that annotation in place
   * so dragging an object continuously updates a single clean Move record instead of spamming duplicates.
   */
  public upsertMoveAnnotation(
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
      if (Math.abs(dry) >= 0.1 || rotAxes.length === 0)
        rotAxes.push(`Y ${dry >= 0 ? '+' : ''}${dry}°`);
      if (Math.abs(drz) >= 0.1) rotAxes.push(`Z ${drz >= 0 ? '+' : ''}${drz}°`);
      if (hasMove) {
        autoSummaryParts.push(`Rotate ${rotAxes.join(', ')}`);
      } else {
        autoSummaryParts.push(
          `Rotate ${transform.targetName} (${rotAxes.join(', ')})`
        );
      }
    }
    const autoSummary = autoSummaryParts.join(', ');

    const existing = this.records.find(
      (r) => r.kind === 'move' && r.objectTransform?.targetUuid === transform.targetUuid
    );

    if (existing) {
      const wasAutoNote =
        !existing.note.trim() ||
        existing.note.startsWith(`Move ${transform.targetName} `) ||
        existing.note.startsWith(`Rotate ${transform.targetName} `);
      const mutableExisting = existing as {
        worldPoint: Vec3Tuple;
        cameraPose: SceneCameraPoseSnapshot;
        objectTransform?: SceneObjectTransformAnnotation;
        note: string;
      };
      mutableExisting.worldPoint = transform.newWorldCenter;
      mutableExisting.cameraPose = cameraPose;
      mutableExisting.objectTransform = transform;
      if (wasAutoNote) {
        mutableExisting.note = autoSummary;
      }
      this.selectedId = existing.id;
      this.saveToStorage();
      this.emit();
      return existing;
    }

    const record: SceneAnnotationRecord = {
      ...baseHit,
      kind: 'move',
      worldPoint: transform.newWorldCenter,
      cameraPose,
      objectTransform: transform,
      id: this.nextId++,
      createdAt: new Date().toISOString(),
      note: autoSummary,
    };
    this.records.push(record);
    this.selectedId = record.id;
    this.saveToStorage();
    this.emit();
    return record;
  }

  /**
   * Adds a 3D Measurement Span annotation (`kind === 'measure'`) between `startHit` and `endHit`.
   */
  public addMeasureAnnotation(
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

    const { roomZoneId, roomName } = resolveRoomForPoint(
      midPoint[0],
      midPoint[1],
      midPoint[2]
    );

    const record: SceneAnnotationRecord = {
      ...startHit,
      kind: 'measure',
      worldPoint: midPoint,
      roomZoneId,
      roomName,
      cameraPose: endHit.cameraPose,
      measurement,
      id: this.nextId++,
      createdAt: new Date().toISOString(),
      note: initialNote,
    };
    this.records.push(record);
    this.selectedId = record.id;
    this.saveToStorage();
    this.emit();
    return record;
  }

  public updateNote(id: number, note: string): void {
    const rec = this.records.find((r) => r.id === id);
    if (!rec) return;
    rec.note = note;
    this.saveToStorage();
    this.emit();
  }

  public updateTargetMeasurement(id: number, targetMeasurement: string): void {
    const rec = this.records.find((r) => r.id === id);
    if (!rec || !rec.measurement) return;
    rec.measurement.targetMeasurement = targetMeasurement;
    this.saveToStorage();
    this.emit();
  }

  public removeAnnotation(id: number): void {
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx === -1) return;
    this.records.splice(idx, 1);
    if (this.selectedId === id) {
      this.selectedId = this.records[this.records.length - 1]?.id ?? null;
    }
    if (this.records.length === 0) {
      this.nextId = 1;
    }
    this.saveToStorage();
    this.emit();
  }

  public clearAll(): void {
    this.records = [];
    this.selectedId = null;
    this.nextId = 1;
    this.saveToStorage();
    this.emit();
  }

  public formatForAgent(): string {
    if (this.records.length === 0) {
      return 'No 3D annotations recorded.';
    }

    const lines: string[] = [
      `# Hus 3D Scene Annotations (${this.records.length})`,
      '',
    ];

    for (const r of this.records) {
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
    lines.push(JSON.stringify(this.records, null, 2));
    lines.push('```');
    return lines.join('\n');
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.records, this.selectedId);
    }
  }

  private saveToStorage(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // Ignore storage quota errors
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      const valid: SceneAnnotationRecord[] = [];
      let maxId = 0;
      for (const item of parsed) {
        if (
          typeof item === 'object' &&
          item !== null &&
          'id' in item &&
          typeof item.id === 'number' &&
          'worldPoint' in item &&
          Array.isArray(item.worldPoint) &&
          item.worldPoint.length === 3
        ) {
          const rec = item as SceneAnnotationRecord;
          valid.push(rec);
          if (rec.id > maxId) maxId = rec.id;
        }
      }
      this.records = valid;
      this.nextId = maxId + 1;
      this.selectedId = valid[valid.length - 1]?.id ?? null;
    } catch {
      // Ignore malformed localStorage data
    }
  }
}

