import * as THREE from 'three';
import type { SceneInteractionManager } from '../interaction/interaction-manager.ts';
import { addCasedArchitravePortal, buildMitredWallSkirtingGeometry } from './swept-moulding.ts';

/**
 * 2D world coordinate `[x, z]` in meters.
 */
export type Point2D = readonly [number, number];

/**
 * Declarative specification for a doorway, cased opening, or window along an
 * arbitrary angled `WallSegment2D`.
 *
 * Coordinates `uCenter` and `width` are measured in meters along the wall's
 * tangent direction from `start` (`u = 0`) to `end` (`u = length`).
 */
export interface WallPortalOpening {
  readonly id?: string;
  readonly kind: 'cased-opening' | 'hinged-door';
  /** Distance in meters from the wall `start` endpoint to the center of the opening. */
  readonly uCenter: number;
  /** Clear opening width in meters along the wall tangent. */
  readonly width: number;
  /** Clear opening height in meters above `thresholdFloorY`. */
  readonly doorHeight: number;
  /** Floor elevation (`Y`) on the lower/entry side of the opening. */
  readonly lowerFloorY: number;
  /** Floor elevation (`Y`) on the upper/destination side of the opening (defaults to `lowerFloorY`). */
  readonly upperFloorY?: number;
  /** Material for the step riser and bullnose nosing when `upperFloorY > lowerFloorY`. */
  readonly stepMaterial?: THREE.Material;
  /** Architrave / casing material. */
  readonly architraveMaterial: THREE.Material;
  /** Optional +normal (`front`) architrave & reveal override material. */
  readonly frontArchitraveMaterial?: THREE.Material;
  /** Optional -normal (`back`) architrave & reveal override material. */
  readonly backArchitraveMaterial?: THREE.Material;
  /** Whether to emit 3-sided reveal lining + architraves (defaults to `true`). */
  readonly includeArchitrave?: boolean;
  /** Optional architrave moulding width (defaults to `0.092`). */
  readonly architraveWidth?: number;
  /** Optional ripped/scribed architrave width on the -u (`left`) leg. */
  readonly leftArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the +u (`right`) leg. */
  readonly rightArchitraveWidth?: number;
  /** Optional ripped/scribed top head architrave width on the +normal (`front`) face. */
  readonly frontTopArchitraveWidth?: number;
  /** Optional ripped/scribed top head architrave width on the -normal (`back`) face. */
  readonly backTopArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the +normal (`front`) -u (`left`) leg. */
  readonly frontLeftArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the +normal (`front`) +u (`right`) leg. */
  readonly frontRightArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the -normal (`back`) -u (`left`) leg. */
  readonly backLeftArchitraveWidth?: number;
  /** Optional ripped/scribed architrave width on the -normal (`back`) +u (`right`) leg. */
  readonly backRightArchitraveWidth?: number;
  /** Optional cast-iron/brass pull handle mounted inside the right or left reveal of a cased opening. */
  readonly revealPullHandleSide?: 'left' | 'right';
  readonly hardwareMaterial?: THREE.Material;
  /** Door leaf properties (when `kind === 'hinged-door'`). */
  readonly doorLeafMaterial?: THREE.Material;
  /** Optional +normal (`front`) door leaf face override material. */
  readonly frontDoorLeafMaterial?: THREE.Material;
  /** Optional -normal (`back`) door leaf face override material. */
  readonly backDoorLeafMaterial?: THREE.Material;
  /** Which jamb the door is hinged on when looking toward `+normal` (`left` = `-u`, `right` = `+u`). */
  readonly hingeSide?: 'left' | 'right';
  /**
   * Signed swing angle in radians when open.
   * With `hingeSide: 'right'`, a negative angle swings toward `-normal` (North/inward for an East-running wall),
   * and a positive angle swings toward `+normal` (South/outward).
   */
  readonly openAngle?: number;
  /** Initial open state (`0` = closed, `1` = fully open). */
  readonly initialOpenProgress?: number;
}

export interface AngledWallSegmentConfig {
  readonly start: Point2D;
  readonly end: Point2D;
  readonly thickness: number;
  /** Top of the wall in world `Y` (e.g. `3.00m`). */
  readonly topY: number;
  /** Floor elevation on the `+normal` side (South/East side for West-to-East wall). */
  readonly frontFloorY: number;
  /** Floor elevation on the `-normal` side (North/West side for West-to-East wall). */
  readonly backFloorY: number;
  /** Primary wall core/plaster material. */
  readonly wallMaterial: THREE.Material;
  /** Optional `+normal` (`+Z_local`) core wall face material (BoxGeometry face index `4`). */
  readonly frontWallMaterial?: THREE.Material;
  /** Optional `-normal` (`-Z_local`) core wall face material (BoxGeometry face index `5`). */
  readonly backWallMaterial?: THREE.Material;
  /** Optional distinct cladding material on the `-normal` (back) face (e.g. dark slate-blue in Front Room). */
  readonly backFaceMaterial?: THREE.Material;
  /** Optional distinct cladding material on the `+normal` (front) face. */
  readonly frontFaceMaterial?: THREE.Material;
  /** Cutaway top cap material (`wallCapMat`). */
  readonly capMaterial: THREE.Material;
  /** Omit horizontal top cap at `topY` when a vaulted upper gable extension sits directly on top of the wall. */
  readonly skipCap?: boolean;
  /** Omit solid rectangular wall piers and lintels when a single one-piece full-height vaulted wall mesh is built separately. */
  readonly skipWallBody?: boolean;
  /** Optional u-intervals `[u0, u1]` where the horizontal top cap at `topY` is omitted (e.g. under a partial upper gable wall). */
  readonly skipCapRanges?: readonly (readonly [number, number])[];
  /** Skirting board material (`skirtingMat`). */
  readonly skirtingMaterial?: THREE.Material;
  readonly addFrontSkirting?: boolean;
  readonly addBackSkirting?: boolean;
  /** Optional u-intervals `[u0, u1]` where front (`+normal`) skirting is suppressed (e.g. behind chimney breasts/wardrobes or at corners). */
  readonly frontSkirtingExclusions?: readonly (readonly [number, number])[];
  /** Optional u-intervals `[u0, u1]` where back (`-normal`) skirting is suppressed (e.g. behind chimney breasts/wardrobes or at corners). */
  readonly backSkirtingExclusions?: readonly (readonly [number, number])[];
  readonly openings?: readonly WallPortalOpening[];
}

/**
 * Local coordinate frame for an angled wall segment or non-square room wall.
 */
export interface WallLocalFrame {
  readonly start: Point2D;
  readonly end: Point2D;
  readonly length: number;
  /** Unit tangent vector `[tx, tz]` from `start` to `end`. */
  readonly tangent: Point2D;
  /** Unit normal vector `[nx, nz]` rotated 90° clockwise in `(X, Z)` (`[-tz, tx]`, pointing `+Z` for a `+X` wall). */
  readonly normal: Point2D;
  /** Three.js Y-rotation angle (`rotation.y`) aligning local `+X` with `tangent` and local `+Z` with `normal`. */
  readonly rotationY: number;
  /** Converts wall-local `(uAlongWall, yWorld, nAlongNormal)` into a `THREE.Vector3`. */
  toWorld(u: number, yWorld: number, n?: number): THREE.Vector3;
  /**
   * Creates a child `THREE.Group` parented to `parent` whose local origin sits at `(u, yWorld, n)`
   * on the wall and whose local axes are aligned with the wall (`+X` = along wall toward `end`,
   * `+Y` = world up, `+Z` = outward normal + optional `localRotationY`).
   */
  createGroup(
    parent: THREE.Object3D,
    name: string,
    u?: number,
    yWorld?: number,
    n?: number,
    localRotationY?: number
  ): THREE.Group;
  /**
   * Places an existing `THREE.Object3D` at `(u, yWorld, n)` in the wall's local frame,
   * sets its `rotation.y = rotationY + localRotationY`, and adds it to `parent`.
   */
  placeObject<T extends THREE.Object3D>(
    parent: THREE.Object3D,
    obj: T,
    u: number,
    yWorld: number,
    n?: number,
    localRotationY?: number
  ): T;
  /** Returns a new `WallLocalFrame` translated by `(dx, dz)` in the horizontal plane. */
  translate(dx: number, dz: number): WallLocalFrame;
  /** Returns a new `WallLocalFrame` transformed by a container `(offset, rotationY)` in the horizontal plane. */
  transform(offset: readonly [number, number, number], containerRotationY?: number): WallLocalFrame;
}

/**
 * Computes the `WallLocalFrame` for an arbitrary 2D wall segment from `start` to `end`.
 */
export function createWallLocalFrame(start: Point2D, end: Point2D): WallLocalFrame {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  const tx = length > 1e-6 ? dx / length : 1;
  const tz = length > 1e-6 ? dz / length : 0;
  // In Three.js right-handed (X right, Y up, Z toward viewer):
  // Rotating local +X by `rotationY` around +Y maps:
  //   local +X -> (cos(rotationY), 0, -sin(rotationY)) = (tx, 0, tz)
  //   local +Z -> (sin(rotationY), 0,  cos(rotationY)) = (-tz, 0, tx) = normal
  const rotationY = Math.atan2(-tz, tx);
  const nx = -tz;
  const nz = tx;

  const toWorld = (u: number, yWorld: number, n = 0): THREE.Vector3 =>
    new THREE.Vector3(
      start[0] + tx * u + nx * n,
      yWorld,
      start[1] + tz * u + nz * n
    );

  return {
    start,
    end,
    length,
    tangent: [tx, tz],
    normal: [nx, nz],
    rotationY,
    toWorld,
    createGroup(
      parent: THREE.Object3D,
      name: string,
      u = 0,
      yWorld = 0,
      n = 0,
      localRotationY = 0
    ): THREE.Group {
      const group = new THREE.Group();
      group.name = name;
      group.position.copy(toWorld(u, yWorld, n));
      group.rotation.y = rotationY + localRotationY;
      group.userData = {
        ...group.userData,
        isRoomContainer: true,
      };
      parent.add(group);
      return group;
    },
    placeObject<T extends THREE.Object3D>(
      parent: THREE.Object3D,
      obj: T,
      u: number,
      yWorld: number,
      n = 0,
      localRotationY = 0
    ): T {
      obj.position.copy(toWorld(u, yWorld, n));
      obj.rotation.y = rotationY + localRotationY;
      parent.add(obj);
      return obj;
    },
    translate(offsetX: number, offsetZ: number): WallLocalFrame {
      return createWallLocalFrame(
        [start[0] + offsetX, start[1] + offsetZ],
        [end[0] + offsetX, end[1] + offsetZ]
      );
    },
    transform(
      offset: readonly [number, number, number],
      containerRotationY = 0
    ): WallLocalFrame {
      const cosR = Math.cos(containerRotationY);
      const sinR = Math.sin(containerRotationY);
      const [ox, , oz] = offset;
      return createWallLocalFrame(
        [
          start[0] * cosR + start[1] * sinR + ox,
          -start[0] * sinR + start[1] * cosR + oz,
        ],
        [
          end[0] * cosR + end[1] * sinR + ox,
          -end[0] * sinR + end[1] * cosR + oz,
        ]
      );
    },
  };
}

/**
 * Builds an arbitrary polygonal floor slab (`[x, z][]` vertices in counter-clockwise or clockwise order)
 * at elevation `floorY` with thickness `thickness` and world-space planar UV coordinates so stone/slate/carpet
 * textures align seamlessly across non-square rooms.
 */
export function buildPolygonalFloorSlab(
  scene: THREE.Object3D,
  polygonXZ: readonly Point2D[],
  floorY: number,
  thickness: number,
  material: THREE.Material,
  uvScale: number | readonly [number, number] = 0.5
): THREE.Mesh {
  const shape = new THREE.Shape();
  for (let i = 0; i < polygonXZ.length; i++) {
    const [x, z] = polygonXZ[i];
    // Shape in (X, -Z) so extruding along local +Z and rotating X by -PI/2 maps (x, z) to world (x, z)
    if (i === 0) {
      shape.moveTo(x, -z);
    } else {
      shape.lineTo(x, -z);
    }
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, floorY - thickness, 0);

  geo.computeVertexNormals();
  // World-space triplanar UVs so both horizontal top/bottom planes and vertical perimeter rim faces tile cleanly
  const scaleX = typeof uvScale === 'number' ? uvScale : uvScale[0];
  const scaleZ = typeof uvScale === 'number' ? uvScale : uvScale[1];
  const scaleY = (scaleX + scaleZ) * 0.5;
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (pos && uv) {
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wy = pos.getY(i);
      const wz = pos.getZ(i);
      const ny = norm ? Math.abs(norm.getY(i)) : 1;
      if (ny >= 0.5) {
        uv.setXY(i, wx * scaleX, wz * scaleZ);
      } else {
        const nx = norm ? Math.abs(norm.getX(i)) : 0;
        const nz = norm ? Math.abs(norm.getZ(i)) : 1;
        const tangentCoord = nx > nz ? wz * scaleZ : wx * scaleX;
        uv.setXY(i, tangentCoord, wy * scaleY);
      }
    }
    uv.needsUpdate = true;
  }

  const mesh = new THREE.Mesh(geo, material);
  if (!mesh.name) mesh.name = 'architecture.primitive.mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

/**
 * Builds a potentially angled/non-orthogonal wall segment with arbitrary portals
 * (hinged doors or open cased architraves with step-up thresholds), per-side floor datums,
 * per-side wall finishes, and skirting boards.
 */
export function buildAngledWallSegment(
  scene: THREE.Object3D,
  interactions: SceneInteractionManager,
  config: AngledWallSegmentConfig
): WallLocalFrame {
  const frame = createWallLocalFrame(config.start, config.end);
  const group = new THREE.Group();
  group.userData.isArchitecturalShell = true;
  group.position.set(config.start[0], 0, config.start[1]);
  group.rotation.y = frame.rotationY;
  scene.add(group);

  const minFloorY = Math.min(config.frontFloorY, config.backFloorY);
  const fullWallH = config.topY - minFloorY;
  const fullWallMidY = (minFloorY + config.topY) / 2;

  // Sort openings along `u`
  const sortedOpenings = [...(config.openings ?? [])].sort((a, b) => a.uCenter - b.uCenter);

  const brickTileW = 1.35;
  const brickTileH = 1.2;
  const applyLocalWallBrickUVs = (
    geo: THREE.BoxGeometry,
    uCenter: number,
    yCenter: number
  ): THREE.BoxGeometry => {
    const posAttr = geo.attributes.position;
    const normAttr = geo.attributes.normal;
    const uvAttr = geo.attributes.uv;
    if (!posAttr || !normAttr || !uvAttr) return geo;

    for (let i = 0; i < posAttr.count; i++) {
      const u = uCenter + posAttr.getX(i);
      const y = yCenter + posAttr.getY(i);
      const w = posAttr.getZ(i);
      const nu = Math.abs(normAttr.getX(i));
      const ny = Math.abs(normAttr.getY(i));
      const nw = Math.abs(normAttr.getZ(i));

      if (nw >= nu && nw >= ny) {
        uvAttr.setXY(i, u / brickTileW, y / brickTileH);
      } else if (nu >= nw && nu >= ny) {
        uvAttr.setXY(i, w / brickTileW, y / brickTileH);
      } else {
        uvAttr.setXY(i, u / brickTileW, w / brickTileH);
      }
    }
    uvAttr.needsUpdate = true;
    return geo;
  };

  const emitSkirtingSegments = (
    uStart: number,
    uEnd: number,
    exclusions: readonly (readonly [number, number])[] | undefined,
    floorY: number,
    zSign: 1 | -1
  ): void => {
    if (!config.skirtingMaterial || uEnd - uStart <= 0.01) return;
    let intervals: Array<[number, number]> = [[uStart, uEnd]];
    if (exclusions && exclusions.length > 0) {
      for (const [ex0, ex1] of exclusions) {
        const next: Array<[number, number]> = [];
        for (const [a, b] of intervals) {
          if (ex1 <= a || ex0 >= b) {
            next.push([a, b]);
          } else {
            if (ex0 > a + 0.01) next.push([a, ex0]);
            if (ex1 < b - 0.01) next.push([ex1, b]);
          }
        }
        intervals = next;
      }
    }
    const cladOffset =
      (zSign > 0 ? Boolean(config.frontFaceMaterial) : Boolean(config.backFaceMaterial))
        ? 0.014
        : 0;
    const wallFaceZ = config.thickness / 2 + cladOffset;
    for (const [segA, segB] of intervals) {
      const segW = segB - segA;
      if (segW <= 0.01) continue;
      const skirtPath: ReadonlyArray<readonly [number, number]> =
        zSign > 0
          ? [
              [segA, wallFaceZ],
              [segB, wallFaceZ],
            ]
          : [
              [segB, -wallFaceZ],
              [segA, -wallFaceZ],
            ];
      const skirtGeo = buildMitredWallSkirtingGeometry(skirtPath, floorY);
      const skirt = new THREE.Mesh(skirtGeo, config.skirtingMaterial);
      skirt.name = 'architecture.primitive.skirt';
      skirt.castShadow = true;
      skirt.receiveShadow = true;
      skirt.userData.isArchitecturalShell = true;
      group.add(skirt);
    }
  };

  const useInlineTopCap =
    !config.skipCap &&
    !config.skipWallBody &&
    (!config.skipCapRanges || config.skipCapRanges.length === 0);
  const withTopCapMaterial = (
    baseMat: THREE.Material
  ): THREE.Material | THREE.Material[] =>
    useInlineTopCap && config.capMaterial !== baseMat
      ? [baseMat, baseMat, config.capMaterial, baseMat, baseMat, baseMat]
      : baseMat;
  const resolveCoreWallMaterial = (
    baseMat: THREE.Material
  ): THREE.Material | THREE.Material[] => {
    const topMat = useInlineTopCap ? config.capMaterial : baseMat;
    const frontMat = config.frontWallMaterial ?? baseMat;
    const backMat = config.backWallMaterial ?? baseMat;
    return topMat !== baseMat || frontMat !== baseMat || backMat !== baseMat
      ? [baseMat, baseMat, topMat, baseMat, frontMat, backMat]
      : baseMat;
  };

  const emitCapSegments = (uStart: number, uEnd: number): void => {
    if (config.skipCap || useInlineTopCap || uEnd - uStart <= 0.005) return;
    let intervals: Array<[number, number]> = [[uStart, uEnd]];
    if (config.skipCapRanges && config.skipCapRanges.length > 0) {
      for (const [ex0, ex1] of config.skipCapRanges) {
        const next: Array<[number, number]> = [];
        for (const [a, b] of intervals) {
          if (ex1 <= a || ex0 >= b) {
            next.push([a, b]);
          } else {
            if (ex0 > a + 0.005) next.push([a, ex0]);
            if (ex1 < b - 0.005) next.push([ex1, b]);
          }
        }
        intervals = next;
      }
    }
    for (const [segA, segB] of intervals) {
      const segW = segB - segA;
      if (segW <= 0.015) continue;
      const segMid = (segA + segB) / 2;
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(
          Math.max(0.01, segW - 0.012),
          0.016,
          Math.max(0.01, config.thickness - 0.012)
        ),
        config.capMaterial
      );
      if (!cap.name) cap.name = 'architecture.primitive.cap';
      cap.position.set(segMid, config.topY - 0.008, 0);
      group.add(cap);
    }
  };

  // When an angled exterior wall starts at the West facade outer plane (X = -22.47m),
  // shear its u = 0 end cap flush to world X = -22.47m and inset its interior (+normal)
  // cladding & skirting by 0.285m so they start at the inner West wall face (X = -22.19m)
  // and never poke through the West exterior brick wall (Issues #1 & #2).
  const isNorthWestExteriorCorner =
    Math.abs(config.start[0] - -22.47) < 0.01 && Math.abs(frame.tangent[0]) > 0.5;
  const nwShearDuPerZ = isNorthWestExteriorCorner
    ? -frame.normal[0] / frame.tangent[0]
    : 0;
  const frontInsetStartU = isNorthWestExteriorCorner ? 0.285 : 0;

  // Helper to add a solid wall pier from u0 to u1
  const addWallPier = (
    u0: number,
    u1: number,
    frontLeftTrim = 0,
    frontRightTrim = 0,
    backLeftTrim = 0,
    backRightTrim = 0
  ): void => {
    const segW = u1 - u0;
    if (segW <= 0.005) return;
    const uMid = (u0 + u1) / 2;

    if (!config.skipWallBody) {
      const pierGeo = new THREE.BoxGeometry(segW, fullWallH, config.thickness);
      if (isNorthWestExteriorCorner && u0 < 0.005) {
        const posAttr = pierGeo.attributes.position;
        if (posAttr) {
          for (let i = 0; i < posAttr.count; i++) {
            if (posAttr.getX(i) < 0) {
              const zLocal = posAttr.getZ(i);
              posAttr.setX(i, -segW / 2 + zLocal * nwShearDuPerZ);
            }
          }
          posAttr.needsUpdate = true;
          pierGeo.computeVertexNormals();
          pierGeo.userData.isSheared = true;
        }
      }
      const pier = new THREE.Mesh(
        applyLocalWallBrickUVs(pierGeo, uMid, fullWallMidY),
        resolveCoreWallMaterial(config.wallMaterial)
      );
      if (!pier.name) pier.name = 'architecture.primitive.pier';
      pier.position.set(uMid, fullWallMidY, 0);
      pier.castShadow = true;
      pier.receiveShadow = true;
      group.add(pier);
    }

    emitCapSegments(u0, u1);

    if (config.backFaceMaterial) {
      const backBotY = config.backFloorY + 0.004;
      const backH = Math.max(0.02, config.topY - backBotY);
      const backMidY = (backBotY + config.topY) / 2;
      const backClad = new THREE.Mesh(
        applyLocalWallBrickUVs(new THREE.BoxGeometry(segW, backH, 0.012), uMid, backMidY),
        withTopCapMaterial(config.backFaceMaterial)
      );
      if (!backClad.name) backClad.name = 'architecture.primitive.backClad';
      backClad.position.set(
        uMid,
        backMidY,
        -config.thickness / 2 - 0.008
      );
      backClad.receiveShadow = true;
      group.add(backClad);
    }

    if (config.frontFaceMaterial) {
      const cladU0 = Math.max(u0, frontInsetStartU);
      const cladW = u1 - cladU0;
      if (cladW > 0.005) {
        const cladMidU = (cladU0 + u1) / 2;
        const frontBotY = config.frontFloorY + 0.004;
        const frontH = Math.max(0.02, config.topY - frontBotY);
        const frontMidY = (frontBotY + config.topY) / 2;
        const frontClad = new THREE.Mesh(
          applyLocalWallBrickUVs(new THREE.BoxGeometry(cladW, frontH, 0.012), cladMidU, frontMidY),
          withTopCapMaterial(config.frontFaceMaterial)
        );
        if (!frontClad.name) frontClad.name = 'architecture.primitive.frontClad';
        frontClad.position.set(
          cladMidU,
          frontMidY,
          config.thickness / 2 + 0.008
        );
        frontClad.receiveShadow = true;
        group.add(frontClad);
      }
    }

    if (config.skirtingMaterial && config.addFrontSkirting) {
      emitSkirtingSegments(
        Math.max(u0 + frontLeftTrim, frontInsetStartU),
        u1 - frontRightTrim,
        config.frontSkirtingExclusions,
        config.frontFloorY,
        1
      );
    }

    if (config.skirtingMaterial && config.addBackSkirting) {
      emitSkirtingSegments(
        u0 + backLeftTrim,
        u1 - backRightTrim,
        config.backSkirtingExclusions,
        config.backFloorY,
        -1
      );
    }
  };

  const computePlinthTrim = (legW: number, fullW: number): number => {
    const outerMargin = legW < fullW - 1e-4 ? 0 : 0.003;
    // uClear = opEdge +/- 0.008, uArch = uClear -/+ 0.005 = opEdge +/- 0.003, plinthOuter = uArch -/+ (legW + outerMargin)
    return Math.max(0, legW + outerMargin - 0.003);
  };

  let cursorU = 0;
  let prevFrontRightTrim = 0;
  let prevBackRightTrim = 0;
  for (const op of sortedOpenings) {
    const opLeft = op.uCenter - op.width / 2;
    const opRight = op.uCenter + op.width / 2;
    const hasArchitrave = op.includeArchitrave !== false;
    const fullArchW = op.architraveWidth ?? 0.092;
    const fLeftW = op.frontLeftArchitraveWidth ?? op.leftArchitraveWidth ?? fullArchW;
    const fRightW = op.frontRightArchitraveWidth ?? op.rightArchitraveWidth ?? fullArchW;
    const bLeftW = op.backLeftArchitraveWidth ?? op.leftArchitraveWidth ?? fullArchW;
    const bRightW = op.backRightArchitraveWidth ?? op.rightArchitraveWidth ?? fullArchW;
    const curFrontLeftTrim = hasArchitrave ? computePlinthTrim(fLeftW, fullArchW) : 0;
    const curBackLeftTrim = hasArchitrave ? computePlinthTrim(bLeftW, fullArchW) : 0;
    if (opLeft > cursorU) {
      addWallPier(
        cursorU,
        opLeft,
        prevFrontRightTrim,
        curFrontLeftTrim,
        prevBackRightTrim,
        curBackLeftTrim
      );
    }

    const highFloorY = op.upperFloorY ?? op.lowerFloorY;
    const headBottomY = highFloorY + op.doorHeight;
    const lintelH = config.topY - headBottomY;
    if (lintelH > 0.01 && !config.skipWallBody) {
      const lintelMidY = headBottomY + lintelH / 2;
      const lintel = new THREE.Mesh(
        applyLocalWallBrickUVs(
          new THREE.BoxGeometry(op.width, lintelH, config.thickness),
          op.uCenter,
          lintelMidY
        ),
        resolveCoreWallMaterial(config.wallMaterial)
      );
      if (!lintel.name) lintel.name = 'architecture.primitive.lintel';
      lintel.position.set(op.uCenter, lintelMidY, 0);
      lintel.castShadow = true;
      lintel.receiveShadow = true;
      group.add(lintel);

      emitCapSegments(opLeft, opRight);

      if (config.backFaceMaterial) {
        const backLintelClad = new THREE.Mesh(
          applyLocalWallBrickUVs(
            new THREE.BoxGeometry(op.width, lintelH, 0.012),
            op.uCenter,
            lintelMidY
          ),
          withTopCapMaterial(config.backFaceMaterial)
        );
        if (!backLintelClad.name) backLintelClad.name = 'architecture.primitive.backLintelClad';
        backLintelClad.position.set(
          op.uCenter,
          lintelMidY,
          -config.thickness / 2 - 0.008
        );
        backLintelClad.receiveShadow = true;
        group.add(backLintelClad);
      }

      if (config.frontFaceMaterial) {
        const frontLintelClad = new THREE.Mesh(
          applyLocalWallBrickUVs(
            new THREE.BoxGeometry(op.width, lintelH, 0.012),
            op.uCenter,
            lintelMidY
          ),
          withTopCapMaterial(config.frontFaceMaterial)
        );
        if (!frontLintelClad.name) frontLintelClad.name = 'architecture.primitive.frontLintelClad';
        frontLintelClad.position.set(
          op.uCenter,
          lintelMidY,
          config.thickness / 2 + 0.008
        );
        frontLintelClad.receiveShadow = true;
        group.add(frontLintelClad);
      }
    }

    if (hasArchitrave) {
      const hingeSideForStop = op.hingeSide ?? 'left';
      const openAngForStop = op.openAngle ?? -Math.PI * 0.44;
      const swingsFront =
        hingeSideForStop === 'right' ? openAngForStop > 0 : openAngForStop < 0;
      addCasedArchitravePortal(group, {
        axis: 'x',
        wallCoord: 0,
        wallThickness: config.thickness,
        openingCenter: op.uCenter,
        openingWidth: op.width,
        frontFloorY: config.frontFloorY,
        backFloorY: config.backFloorY,
        headY: headBottomY,
        material: op.architraveMaterial,
        architraveWidth: op.architraveWidth,
        leftArchitraveWidth: op.leftArchitraveWidth,
        rightArchitraveWidth: op.rightArchitraveWidth,
        frontLeftArchitraveWidth: op.frontLeftArchitraveWidth,
        frontRightArchitraveWidth: op.frontRightArchitraveWidth,
        backLeftArchitraveWidth: op.backLeftArchitraveWidth,
        backRightArchitraveWidth: op.backRightArchitraveWidth,
        frontTopArchitraveWidth: op.frontTopArchitraveWidth,
        backTopArchitraveWidth: op.backTopArchitraveWidth,
        includeDoorStop: op.kind === 'hinged-door',
        doorStopHingeFace: swingsFront ? 'front' : 'back',
        frontArchitraveMaterial: op.frontArchitraveMaterial,
        backArchitraveMaterial: op.backArchitraveMaterial,
        frontFaceOffset: config.frontFaceMaterial ? 0.014 : 0,
        backFaceOffset: config.backFaceMaterial ? 0.014 : 0,
        namePrefix: `${op.id ?? 'portal'}.architrave`,
      });
    }

    // Step riser & bullnose tread if upperFloorY > lowerFloorY (single-board
    // solid oak bullnose step tread flush with upperFloorY + recessed one-piece vertical riser,
    // with continuous lengthwise oak grain UVs mapped inside a single knot-free plank course!)
    if (highFloorY > op.lowerFloorY + 0.01 && op.stepMaterial) {
      const applyCarpenterSingleBoardUVs = (
        geo: THREE.BufferGeometry,
        boardSpanX: number,
        uOffset: number,
        vMin: number,
        vMax: number
      ): THREE.BufferGeometry => {
        const pos = geo.attributes.position;
        const uv = geo.attributes.uv;
        if (!pos || !uv) return geo;
        for (let i = 0; i < pos.count; i++) {
          const lx = pos.getX(i);
          const ly = pos.getY(i);
          const lz = pos.getZ(i);
          const uNorm = Math.max(0, Math.min(1, (lx + boardSpanX * 0.5) / Math.max(0.01, boardSpanX)));
          // Stay strictly within the first 2200mm knot-free plank segment (u in [0.04..0.44])
          const u = uOffset + uNorm * Math.min(0.38, boardSpanX / 2.2);
          // Map cross-grain coordinate smoothly inside a single plank course (v in [vMin..vMax])
          const crossT = Math.max(0, Math.min(1, (ly + lz + 0.25) / 0.5));
          const v = vMin + crossT * (vMax - vMin);
          uv.setXY(i, u, v);
        }
        uv.needsUpdate = true;
        return geo;
      };

      const stepW = op.width + 0.02;
      const stepRise = highFloorY - op.lowerFloorY;
      const stepFacingSign: 1 | -1 = config.frontFloorY <= config.backFloorY ? 1 : -1;
      const nosingH = 0.032; // 32mm solid oak bullnose nosing bar thickness, top flush with highFloorY
      const nosingDepth = 0.056; // 56mm solid oak bullnose nosing bar meeting the upper floorboards at localZ = ±0.112m
      const nosingCenterZ = stepFacingSign * (config.thickness * 0.5);
      const riserDepth = 0.028; // 28mm solid oak vertical riser board tucked cleanly beneath the bullnose overhang

      const riserH = Math.max(0.02, stepRise - nosingH);
      const stepRiser = new THREE.Mesh(
        applyCarpenterSingleBoardUVs(
          new THREE.BoxGeometry(stepW, riserH, riserDepth),
          stepW,
          0.05,
          0.155,
          0.225
        ),
        op.stepMaterial
      );
      stepRiser.name = `${op.id}.stepRiser`;
      stepRiser.position.set(
        op.uCenter,
        op.lowerFloorY + riserH * 0.5,
        nosingCenterZ - stepFacingSign * 0.002
      );
      stepRiser.castShadow = true;
      stepRiser.receiveShadow = true;
      group.add(stepRiser);

      const stepNosing = new THREE.Mesh(
        applyCarpenterSingleBoardUVs(
          new THREE.BoxGeometry(stepW, nosingH, nosingDepth),
          stepW,
          0.04,
          0.03,
          0.1
        ),
        op.stepMaterial
      );
      stepNosing.name = `${op.id}.stepNosing`;
      // Top surface at highFloorY, abutting the doorway floorboards at localZ = stepFacingSign * (config.thickness * 0.5 - nosingDepth * 0.5)
      stepNosing.position.set(
        op.uCenter,
        highFloorY - nosingH * 0.5,
        nosingCenterZ
      );
      stepNosing.castShadow = true;
      stepNosing.receiveShadow = true;
      group.add(stepNosing);

      // Rounded half-cylinder carpenter bullnose front edge along the overhanging lip (±Z face)
      const bullnoseGeo = new THREE.CylinderGeometry(
        nosingH * 0.5,
        nosingH * 0.5,
        stepW,
        16,
        1,
        false,
        0,
        Math.PI
      );
      bullnoseGeo.rotateZ(Math.PI / 2);
      if (stepFacingSign === -1) {
        bullnoseGeo.rotateY(Math.PI);
      }
      applyCarpenterSingleBoardUVs(bullnoseGeo, stepW, 0.04, 0.04, 0.09);
      const bullnoseLip = new THREE.Mesh(bullnoseGeo, op.stepMaterial);
      bullnoseLip.name = `${op.id}.stepBullnoseLip`;
      bullnoseLip.position.set(
        op.uCenter,
        highFloorY - nosingH * 0.5,
        nosingCenterZ + stepFacingSign * (nosingDepth * 0.5)
      );
      bullnoseLip.castShadow = true;
      bullnoseLip.receiveShadow = true;
      group.add(bullnoseLip);
    }

    // Optional cast-iron pull handle inside the cased opening reveal (e.g. Hall step-up opening)
    if (op.revealPullHandleSide && op.hardwareMaterial) {
      const sideSign = op.revealPullHandleSide === 'right' ? 1 : -1;
      const revealX = op.uCenter + sideSign * (op.width / 2 - 0.012);
      const handleBackplate = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.24, 0.042),
        op.hardwareMaterial
      );
      if (!handleBackplate.name) handleBackplate.name = 'architecture.primitive.handleBackplate';
      handleBackplate.position.set(revealX, highFloorY + 1.02, -0.01);
      group.add(handleBackplate);

      const handleGrip = new THREE.Mesh(
        new THREE.BoxGeometry(0.034, 0.15, 0.014),
        op.hardwareMaterial
      );
      if (!handleGrip.name) handleGrip.name = 'architecture.primitive.handleGrip';
      handleGrip.position.set(revealX - sideSign * 0.018, highFloorY + 1.02, -0.01);
      group.add(handleGrip);
    }

    // Hinged traditional 4-panel period door leaf + hardware (parented to wall group with closedAngle = 0 so it closes flush)
    if (op.kind === 'hinged-door' && op.doorLeafMaterial) {
      const leafW = op.width - 0.022;
      const leafH = op.doorHeight - 0.02;

      const doorObj = new THREE.Group();
      doorObj.position.set(op.uCenter, highFloorY + op.doorHeight / 2, 0);
      doorObj.rotation.y = 0;

      // Traditional 4-panel stiles, rails & central muntin (full 0.046m thickness)
      const stileW = Math.min(0.105, leafW * 0.14);
      const topRailH = 0.125;
      const lockRailH = 0.165;
      const bottomRailH = 0.195;
      const muntinW = 0.088;
      const lockRailY = -leafH * 0.07;

      const frontLeafMat = op.frontDoorLeafMaterial ?? op.doorLeafMaterial;
      const backLeafMat = op.backDoorLeafMaterial ?? op.doorLeafMaterial;
      const addAngledLeafBox = (
        baseName: string,
        w: number,
        h: number,
        d: number,
        px: number,
        py: number,
        castShad = true
      ): void => {
        if (frontLeafMat === backLeafMat) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frontLeafMat);
          m.name = baseName;
          m.position.set(px, py, 0);
          m.castShadow = castShad;
          m.receiveShadow = true;
          doorObj.add(m);
          return;
        }
        const halfD = d * 0.5;
        for (const [zSign, mat, suffix] of [
          [1, frontLeafMat, '.front'],
          [-1, backLeafMat, '.back'],
        ] as const) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, halfD), mat);
          m.name = `${baseName}${suffix}`;
          m.position.set(px, py, zSign * halfD * 0.5);
          m.castShadow = castShad;
          m.receiveShadow = true;
          doorObj.add(m);
        }
      };

      // Central recessed core slab (tucked inside outer stiles & rails so outer edges never Z-fight)
      const coreW = Math.max(0.08, leafW - stileW);
      const coreH = Math.max(0.12, leafH - (topRailH + bottomRailH) * 0.5);
      addAngledLeafBox('architecture.primitive.leafCore', coreW, coreH, 0.028, 0, (bottomRailH - topRailH) * 0.25);

      for (const side of [-1, 1] as const) {
        addAngledLeafBox('architecture.primitive.stile', stileW, leafH, 0.046, side * (leafW / 2 - stileW / 2), 0);
      }

      const innerW = Math.max(0.1, leafW - stileW * 2 + 0.004);
      for (const [railY, railH] of [
        [leafH / 2 - topRailH / 2, topRailH],
        [lockRailY, lockRailH],
        [-leafH / 2 + bottomRailH / 2, bottomRailH]
      ] as const) {
        addAngledLeafBox('architecture.primitive.rail', innerW, railH, 0.046, 0, railY);
      }

      const upperPanelTop = leafH / 2 - topRailH;
      const upperPanelBot = lockRailY + lockRailH / 2;
      const lowerPanelTop = lockRailY - lockRailH / 2;
      const lowerPanelBot = -leafH / 2 + bottomRailH;

      for (const [pBot, pTop] of [
        [upperPanelBot, upperPanelTop],
        [lowerPanelBot, lowerPanelTop]
      ] as const) {
        const pH = Math.max(0.12, pTop - pBot);
        const pMidY = (pBot + pTop) / 2;
        addAngledLeafBox('architecture.primitive.muntin', muntinW, pH + 0.004, 0.046, 0, pMidY, false);

        // Raised bevelled fielding panel inside each of the 4 panels
        const panelClearW = (innerW - muntinW) / 2;
        const raisedW = Math.max(0.06, panelClearW - 0.036);
        const raisedH = Math.max(0.08, pH - 0.042);
        for (const col of [-1, 1] as const) {
          addAngledLeafBox(
            'architecture.primitive.raisedPanel',
            raisedW,
            raisedH,
            0.038,
            col * (muntinW / 2 + panelClearW / 2),
            pMidY,
            false
          );
        }
      }

      const hingeSide = op.hingeSide ?? 'left';
      const handleOffsetU =
        hingeSide === 'right' ? -leafW / 2 + stileW * 0.52 : leafW / 2 - stileW * 0.52;

      if (op.hardwareMaterial) {
        for (const zSide of [-1, 1] as const) {
          const rose = new THREE.Mesh(
            new THREE.CylinderGeometry(0.026, 0.026, 0.008, 12),
            op.hardwareMaterial
          );
          if (!rose.name) rose.name = 'architecture.primitive.rose';
          rose.rotation.x = Math.PI / 2;
          rose.position.set(handleOffsetU, lockRailY, zSide * 0.026);
          doorObj.add(rose);

          const knob = new THREE.Mesh(
            new THREE.SphereGeometry(0.023, 10, 10),
            op.hardwareMaterial
          );
          if (!knob.name) knob.name = 'architecture.primitive.knob';
          knob.scale.set(1, 1, 0.78);
          knob.position.set(handleOffsetU, lockRailY, zSide * 0.048);
          doorObj.add(knob);
        }
      }

      group.add(doorObj);
      const pivotU = hingeSide === 'right' ? leafW / 2 : -leafW / 2;
      interactions.registerHingedDoor(
        group,
        doorObj,
        new THREE.Vector3(pivotU, 0, 0),
        'y',
        op.openAngle ?? -Math.PI * 0.44,
        0
      );
    }

    cursorU = opRight;
    prevFrontRightTrim = hasArchitrave ? computePlinthTrim(fRightW, fullArchW) : 0;
    prevBackRightTrim = hasArchitrave ? computePlinthTrim(bRightW, fullArchW) : 0;
  }

  if (cursorU < frame.length) {
    addWallPier(cursorU, frame.length, prevFrontRightTrim, 0, prevBackRightTrim, 0);
  }

  return frame;
}

/**
 * Builds a chain of 100% vertex-mitered 3D quadprisms along a 2D polyline `points` (`[x, z][]`).
 *
 * For a polyline directed from North to South (`+Z`), the unit normal `N = (tz, -tx)` points
 * East (`+X`, inward into the room) and `-N` points West (`-X`, outward toward the exterior):
 * - `dOut` and `dIn` (`dOut < dIn`) are signed offsets in meters along `N` from the reference
 *   polyline `points`. At every interior vertex `P_k`, both `dOut` and `dIn` are offset along
 *   the exact angle bisector `M_k = (N_{k-1} + N_k) / (1 + N_{k-1} · N_k)`, guaranteeing
 *   watertight, gap-free, non-overlapping miter joins at any angle.
 * - Supports either a single `THREE.Material` or a 3-material tuple
 *   `[innerMaterial (+N), outerMaterial (-N, arc-length brick UVs), capMaterial]`.
 */
export function buildMiteredPolylineStrip(
  parent: THREE.Object3D,
  points: readonly Point2D[],
  dOut: number,
  dIn: number,
  yBottom: number,
  yTop: number,
  materials: THREE.Material | readonly [THREE.Material, THREE.Material, THREE.Material],
  castShadow = true,
  receiveShadow = true,
  segmentRange?: readonly [number, number]
): THREE.Group {
  const stripGroup = new THREE.Group();
  const segCount = points.length - 1;
  if (segCount < 1) {
    parent.add(stripGroup);
    return stripGroup;
  }

  const normals: [number, number][] = [];
  for (let i = 0; i < segCount; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dz = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len;
    const tz = dz / len;
    normals.push([tz, -tx]);
  }

  const miters: [number, number][] = [];
  for (let k = 0; k <= segCount; k++) {
    if (k === 0) {
      // At the NW corner of the Front Room ([-22.19, -3.18]), miter the start cap along the
      // 7.62° angled North exterior brick wall so the outer face (X = -22.47m) extends to Z = -3.2177m
      // and meets the North wall with zero gap and zero overlap (Issues #1 & #2).
      if (
        Math.abs(points[0][0] - -22.19) < 0.01 &&
        Math.abs(points[0][1] - -3.18) < 0.05 &&
        Math.abs(normals[0][0] - 1) < 0.01
      ) {
        miters.push([1, 0.133771]);
      } else {
        miters.push(normals[0]);
      }
    } else if (k === segCount) {
      miters.push(normals[segCount - 1]);
    } else {
      const [n0x, n0z] = normals[k - 1];
      const [n1x, n1z] = normals[k];
      const denom = Math.max(0.15, 1 + n0x * n1x + n0z * n1z);
      miters.push([(n0x + n1x) / denom, (n0z + n1z) / denom]);
    }
  }

  const tileW = 1.35;
  const tileH = 1.2;
  let outerArcU = points[0] ? points[0][1] : 0;
  const startSeg = segmentRange ? Math.max(0, segmentRange[0]) : 0;
  const endSeg = segmentRange ? Math.min(segCount, segmentRange[1]) : segCount;

  for (let i = 0; i < segCount; i++) {
    const [p0x, p0z] = points[i];
    const [p1x, p1z] = points[i + 1];
    const [m0x, m0z] = miters[i];
    const [m1x, m1z] = miters[i + 1];

    const ax = p0x + dOut * m0x;
    const az = p0z + dOut * m0z;
    const bx = p1x + dOut * m1x;
    const bz = p1z + dOut * m1z;
    const cx = p1x + dIn * m1x;
    const cz = p1z + dIn * m1z;
    const dx = p0x + dIn * m0x;
    const dz = p0z + dIn * m0z;

    const outerLen = Math.hypot(bx - ax, bz - az);
    const innerLen = Math.hypot(cx - dx, cz - dz);
    const isStraightAlongZ = Math.abs(ax - bx) < 1e-4;
    const u0 = isStraightAlongZ ? az / tileW : outerArcU / tileW;
    const u1 = isStraightAlongZ ? bz / tileW : (outerArcU + outerLen) / tileW;
    outerArcU = isStraightAlongZ ? bz : outerArcU + outerLen;

    if (i < startSeg || i >= endSeg) continue;

    const v0 = yBottom / tileH;
    const v1 = yTop / tileH;

    if (Array.isArray(materials) && materials[0] !== materials[1]) {
      // Emit separate single-material meshes for the interior face (+N) and the exterior/cap faces (-N, ±Y, ±T)
      // so raycast inspection and static batching bind the exact exterior brick material (Issues #2 & #3).
      const innerPositions = new Float32Array([
        dx, yBottom, dz,
        dx, yTop, dz,
        cx, yTop, cz,
        cx, yBottom, cz,
      ]);
      const innerUvs = new Float32Array([
        0, v0,
        0, v1,
        innerLen / tileW, v1,
        innerLen / tileW, v0,
      ]);
      const innerGeo = new THREE.BufferGeometry();
      innerGeo.setAttribute('position', new THREE.BufferAttribute(innerPositions, 3));
      innerGeo.setAttribute('uv', new THREE.BufferAttribute(innerUvs, 2));
      innerGeo.setIndex([0, 1, 2, 0, 2, 3]);
      innerGeo.computeVertexNormals();
      const innerMesh = new THREE.Mesh(innerGeo, materials[0]);
      if (!innerMesh.name) innerMesh.name = 'architecture.primitive.inner';
      innerMesh.castShadow = castShadow;
      innerMesh.receiveShadow = receiveShadow;
      stripGroup.add(innerMesh);

      if (materials[2] !== materials[1]) {
        const topPositions = new Float32Array([
          ax, yTop, az,
          bx, yTop, bz,
          cx, yTop, cz,
          dx, yTop, dz,
        ]);
        const topUvs = new Float32Array([
          ax / tileW, az / tileH,
          bx / tileW, bz / tileH,
          cx / tileW, cz / tileH,
          dx / tileW, dz / tileH,
        ]);
        const topGeo = new THREE.BufferGeometry();
        topGeo.setAttribute('position', new THREE.BufferAttribute(topPositions, 3));
        topGeo.setAttribute('uv', new THREE.BufferAttribute(topUvs, 2));
        topGeo.setIndex([0, 1, 2, 0, 2, 3]);
        topGeo.computeVertexNormals();
        const topMesh = new THREE.Mesh(topGeo, materials[2]);
        topMesh.name = 'architecture.primitive.topCap';
        stripGroup.add(topMesh);
      }

      const outerPositions = new Float32Array([
        // 0..3: Outer Face (-N): A0, B0, B1, A1
        ax, yBottom, az,
        bx, yBottom, bz,
        bx, yTop, bz,
        ax, yTop, az,
        // 4..7: Top Face (+Y): A1, B1, C1, D1
        ax, yTop, az,
        bx, yTop, bz,
        cx, yTop, cz,
        dx, yTop, dz,
        // 8..11: Bottom Face (-Y): A0, D0, C0, B0
        ax, yBottom, az,
        dx, yBottom, dz,
        cx, yBottom, cz,
        bx, yBottom, bz,
        // 12..15: Start Cap (-T): A0, A1, D1, D0
        ax, yBottom, az,
        ax, yTop, az,
        dx, yTop, dz,
        dx, yBottom, dz,
        // 16..19: End Cap (+T): B0, C0, C1, B1
        bx, yBottom, bz,
        cx, yBottom, cz,
        cx, yTop, cz,
        bx, yTop, bz,
      ]);
      const outerUvs = new Float32Array([
        // Outer Face
        u0, v0,
        u1, v0,
        u1, v1,
        u0, v1,
        // Top Face
        ax / tileW, az / tileH,
        bx / tileW, bz / tileH,
        cx / tileW, cz / tileH,
        dx / tileW, dz / tileH,
        // Bottom Face
        ax / tileW, az / tileH,
        dx / tileW, dz / tileH,
        cx / tileW, cz / tileH,
        bx / tileW, bz / tileH,
        // Start Cap
        0, v0,
        0, v1,
        (dIn - dOut) / tileW, v1,
        (dIn - dOut) / tileW, v0,
        // End Cap
        0, v0,
        (dIn - dOut) / tileW, v0,
        (dIn - dOut) / tileW, v1,
        0, v1,
      ]);
      const outerIndices =
        materials[2] !== materials[1]
          ? [
              0, 1, 2, 0, 2, 3,       // Outer Face
              8, 9, 10, 8, 10, 11,    // Bottom Face
              12, 13, 14, 12, 14, 15, // Start Cap
              16, 17, 18, 16, 18, 19, // End Cap
            ]
          : [
              0, 1, 2, 0, 2, 3,       // Outer Face
              4, 5, 6, 4, 6, 7,       // Top Face
              8, 9, 10, 8, 10, 11,    // Bottom Face
              12, 13, 14, 12, 14, 15, // Start Cap
              16, 17, 18, 16, 18, 19, // End Cap
            ];
      const outerGeo = new THREE.BufferGeometry();
      outerGeo.setAttribute('position', new THREE.BufferAttribute(outerPositions, 3));
      outerGeo.setAttribute('uv', new THREE.BufferAttribute(outerUvs, 2));
      outerGeo.setIndex(outerIndices);
      outerGeo.computeVertexNormals();
      const outerMesh = new THREE.Mesh(outerGeo, materials[1]);
      if (!outerMesh.name) outerMesh.name = 'architecture.primitive.outer';
      outerMesh.castShadow = castShadow;
      outerMesh.receiveShadow = receiveShadow;
      stripGroup.add(outerMesh);
      continue;
    }

    // 24 vertices (4 per face * 6 faces) for crisp flat normals and per-face UVs
    const positions = new Float32Array([
      // 0..3: Inner Face (+N): D0, D1, C1, C0
      dx, yBottom, dz,
      dx, yTop, dz,
      cx, yTop, cz,
      cx, yBottom, cz,
      // 4..7: Outer Face (-N): A0, B0, B1, A1
      ax, yBottom, az,
      bx, yBottom, bz,
      bx, yTop, bz,
      ax, yTop, az,
      // 8..11: Top Face (+Y): A1, B1, C1, D1 (T x N = +Y)
      ax, yTop, az,
      bx, yTop, bz,
      cx, yTop, cz,
      dx, yTop, dz,
      // 12..15: Bottom Face (-Y): A0, D0, C0, B0 (N x T = -Y)
      ax, yBottom, az,
      dx, yBottom, dz,
      cx, yBottom, cz,
      bx, yBottom, bz,
      // 16..19: Start Cap (-T): A0, A1, D1, D0
      ax, yBottom, az,
      ax, yTop, az,
      dx, yTop, dz,
      dx, yBottom, dz,
      // 20..23: End Cap (+T): B0, C0, C1, B1
      bx, yBottom, bz,
      cx, yBottom, cz,
      cx, yTop, cz,
      bx, yTop, bz,
    ]);

    const uvs = new Float32Array([
      // Inner Face
      0, v0,
      0, v1,
      innerLen / tileW, v1,
      innerLen / tileW, v0,
      // Outer Face (continuous arc-length brick UVs)
      u0, v0,
      u1, v0,
      u1, v1,
      u0, v1,
      // Top Face
      ax / tileW, az / tileH,
      bx / tileW, bz / tileH,
      cx / tileW, cz / tileH,
      dx / tileW, dz / tileH,
      // Bottom Face
      ax / tileW, az / tileH,
      dx / tileW, dz / tileH,
      cx / tileW, cz / tileH,
      bx / tileW, bz / tileH,

      // Start Cap
      0, v0,
      0, v1,
      (dIn - dOut) / tileW, v1,
      (dIn - dOut) / tileW, v0,
      // End Cap
      0, v0,
      (dIn - dOut) / tileW, v0,
      (dIn - dOut) / tileW, v1,
      0, v1,
    ]);

    const indices = [
      0, 1, 2, 0, 2, 3,       // Inner Face (Group 0)
      4, 5, 6, 4, 6, 7,       // Outer Face (Group 1)
      8, 9, 10, 8, 10, 11,    // Top Face (Group 2)
      12, 13, 14, 12, 14, 15, // Bottom Face (Group 2)
      16, 17, 18, 16, 18, 19, // Start Cap (Group 2)
      20, 21, 22, 20, 22, 23, // End Cap (Group 2)
    ];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const singleMat = Array.isArray(materials) ? materials[0] : (materials as THREE.Material);
    const mesh = new THREE.Mesh(geo, singleMat);
    if (!mesh.name) mesh.name = 'architecture.primitive.mesh';
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    stripGroup.add(mesh);
  }

  parent.add(stripGroup);
  return stripGroup;
}

