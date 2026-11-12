import * as THREE from 'three';
import {
  sharedBoxGeometry,
  sharedCylinderGeometry,
  sharedSphereGeometry,
} from '../shared/geometry-cache.ts';
import { ensureNamedAddedChildren, prepGeo, tagHighLod } from '../shared/scene-helpers.ts';
import {
  getStaircaseWalkableSampler,
  registerStaircaseWalkableSampler,
  type StairWalkableSampler,
} from '../../engine/walkthrough/auto-elevation-composer.ts';

export { getStaircaseWalkableSampler, registerStaircaseWalkableSampler, type StairWalkableSampler };

export type StaircaseLayout = 'straight' | 'quarter-turn' | 'half-turn' | 'L' | 'U';
export type CardinalAscentDirection = 'north' | 'south' | 'east' | 'west';
export type StairTurnDirection = 'left' | 'right';
export type StairOpenSide = 'left' | 'right' | 'both' | 'none';
export type StringerSideMode = 'closed' | 'cut' | 'wall';
export type NewelCapStyle = 'pyramid' | 'ball' | 'acorn';
export type SpindleStyle = 'turned' | 'square-chamfered';
export type SpandrelStyle = 'open-soffit' | 'cupboard' | 'none';

export interface StairStringerSidesConfig {
  readonly left?: StringerSideMode;
  readonly right?: StringerSideMode;
}

export interface StairRodOptions {
  readonly material?: THREE.Material;
  readonly radius?: number;
}

export interface StairRunnerOptions {
  readonly width?: number;
  readonly thickness?: number;
  readonly material: THREE.Material;
  readonly borderWidth?: number;
  readonly borderMaterial?: THREE.Material;
  readonly stairRods?: StairRodOptions | boolean;
}

export interface CreateStaircaseOptions {
  readonly layout?: StaircaseLayout;
  readonly bottomY: number;
  readonly topY: number;
  readonly origin?: readonly [number, number];
  readonly headingRad?: number;
  readonly direction?: CardinalAscentDirection;
  readonly width?: number;
  readonly targetRiserM?: number;
  readonly goingM?: number;
  readonly turnDirection?: StairTurnDirection;
  readonly turnAfterRisers?: number;
  readonly halfLandingGapM?: number;
  readonly openSide?: StairOpenSide;
  readonly stringerStyle?: 'closed' | 'cut';
  readonly stringers?: StairStringerSidesConfig;
  readonly includeTreadBrackets?: boolean;
  readonly includeLandingApron?: boolean;
  readonly curtailBottomStep?: boolean | 'left' | 'right' | 'both';
  readonly spindlesPerTread?: number;
  readonly newelCap?: NewelCapStyle;
  readonly spindleStyle?: SpindleStyle;
  readonly spindleMaxClearGapM?: number;
  readonly spandrel?: SpandrelStyle;
  readonly runner?: StairRunnerOptions;
  readonly treadMaterial?: THREE.Material;
  readonly riserMaterial?: THREE.Material;
  readonly stringerMaterial?: THREE.Material;
  readonly balustradeMaterial?: THREE.Material;
  readonly handrailMaterial?: THREE.Material;
  readonly newelCapMaterial?: THREE.Material;
  readonly soffitMaterial?: THREE.Material;
  readonly zone?: string;
  readonly name?: string;
}

export interface StaircaseBuildResult {
  readonly group: THREE.Group;
  readonly voidOpeningXZ: readonly [number, number][];
  sampleWalkableY(worldX: number, worldZ: number): number | null;
  readonly bounds: THREE.Box3;
  readonly riserCount: number;
  readonly riserHeightM: number;
  readonly goingM: number;
  readonly maxSpindleClearGapM: number;
}

export interface CreateBalustradeRunOptions {
  readonly points: readonly (readonly [number, number] | readonly [number, number, number])[];
  readonly elevationY?: number;
  readonly height?: number;
  readonly newelCap?: NewelCapStyle;
  readonly spindleStyle?: SpindleStyle;
  readonly spindleMaxClearGapM?: number;
  readonly includeStartNewel?: boolean;
  readonly includeEndNewel?: boolean;
  readonly includeTrimmerFascia?: boolean;
  readonly slabThicknessM?: number;
  readonly balustradeMaterial?: THREE.Material;
  readonly handrailMaterial?: THREE.Material;
  readonly newelCapMaterial?: THREE.Material;
  readonly fasciaMaterial?: THREE.Material;
  readonly zone?: string;
  readonly name?: string;
}

export interface BalustradeRunResult {
  readonly group: THREE.Group;
  readonly maxSpindleClearGapM: number;
  readonly spindleCount: number;
  readonly newelCount: number;
}

const EPS = 0.0005;
const TREAD_THICKNESS_M = 0.028;
const NOSING_PROJECTION_M = 0.022;
const RISER_THICKNESS_M = 0.018;
const STRINGER_THICKNESS_M = 0.032;
const NEWEL_SIZE_M = 0.09;
const HALF_NEWEL_M = NEWEL_SIZE_M * 0.5;
const SPINDLE_WIDTH_M = 0.032;
const HANDRAIL_HEIGHT_M = 0.9;
const SHOE_RAIL_HEIGHT_M = 0.025;
const SHOE_RAIL_WIDTH_M = 0.044;
const PART_K_MAX_RISER_M = 0.22;
const PART_K_MAX_SPINDLE_GAP_M = 0.099;
const TOP_LANDING_APRON_M = 0.1;

let defaultOakMat: THREE.MeshStandardMaterial | null = null;
let defaultDarkHandrailMat: THREE.MeshStandardMaterial | null = null;
let defaultSatinWhiteMat: THREE.MeshStandardMaterial | null = null;
let defaultPlasterSoffitMat: THREE.MeshStandardMaterial | null = null;
let defaultBrassRodMat: THREE.MeshStandardMaterial | null = null;

function getDefaultOakMaterial(): THREE.MeshStandardMaterial {
  if (!defaultOakMat) {
    defaultOakMat = new THREE.MeshStandardMaterial({
      name: 'staircase.oakTimber',
      color: 0x9b7148,
      roughness: 0.42,
      metalness: 0.02,
    });
  }
  return defaultOakMat;
}

function getDefaultHandrailMaterial(): THREE.MeshStandardMaterial {
  if (!defaultDarkHandrailMat) {
    defaultDarkHandrailMat = new THREE.MeshStandardMaterial({
      name: 'staircase.polishedHandrailTimber',
      color: 0x5c3a21,
      roughness: 0.3,
      metalness: 0.03,
    });
  }
  return defaultDarkHandrailMat;
}

function getDefaultSatinWhiteMaterial(): THREE.MeshStandardMaterial {
  if (!defaultSatinWhiteMat) {
    defaultSatinWhiteMat = new THREE.MeshStandardMaterial({
      name: 'staircase.paintedSatinwood',
      color: 0xf4f1ea,
      roughness: 0.38,
      metalness: 0.01,
    });
  }
  return defaultSatinWhiteMat;
}

function getDefaultPlasterSoffitMaterial(): THREE.MeshStandardMaterial {
  if (!defaultPlasterSoffitMat) {
    defaultPlasterSoffitMat = new THREE.MeshStandardMaterial({
      name: 'staircase.plasterSoffit',
      color: 0xf7f5f0,
      roughness: 0.85,
      metalness: 0.0,
    });
  }
  return defaultPlasterSoffitMat;
}

function getDefaultBrassRodMaterial(): THREE.MeshStandardMaterial {
  if (!defaultBrassRodMat) {
    defaultBrassRodMat = new THREE.MeshStandardMaterial({
      name: 'staircase.agedBrassRod',
      color: 0xc8a14b,
      roughness: 0.26,
      metalness: 0.88,
    });
  }
  return defaultBrassRodMat;
}

function resolveHeadingRad(
  headingRad: number | undefined,
  direction: CardinalAscentDirection | undefined
): number {
  if (typeof headingRad === 'number' && Number.isFinite(headingRad)) {
    return headingRad;
  }
  switch (direction) {
    case 'east':
      return -Math.PI * 0.5;
    case 'south':
      return Math.PI;
    case 'west':
      return Math.PI * 0.5;
    case 'north':
    default:
      return 0;
  }
}

function normalizeLayout(layout: StaircaseLayout | undefined): 'straight' | 'quarter-turn' | 'half-turn' {
  if (layout === 'L' || layout === 'quarter-turn') return 'quarter-turn';
  if (layout === 'U' || layout === 'half-turn') return 'half-turn';
  return 'straight';
}

interface ResolvedSideModes {
  readonly leftStringer: StringerSideMode;
  readonly rightStringer: StringerSideMode;
  readonly leftOpenBalustrade: boolean;
  readonly rightOpenBalustrade: boolean;
  readonly curtailLeft: boolean;
  readonly curtailRight: boolean;
}

function resolveSideModes(options: CreateStaircaseOptions): ResolvedSideModes {
  const defaultOpenStyle: 'closed' | 'cut' = options.stringerStyle ?? 'closed';
  const explicitOpen = options.openSide;

  let leftOpen: boolean;
  let rightOpen: boolean;
  if (explicitOpen !== undefined) {
    leftOpen = explicitOpen === 'left' || explicitOpen === 'both';
    rightOpen = explicitOpen === 'right' || explicitOpen === 'both';
  } else {
    leftOpen =
      options.stringers?.left === 'cut' || options.stringers?.left === 'closed' ? true : false;
    rightOpen = options.stringers?.right === 'wall' ? false : true;
  }

  const leftStringer: StringerSideMode =
    options.stringers?.left ?? (leftOpen ? defaultOpenStyle : 'wall');
  const rightStringer: StringerSideMode =
    options.stringers?.right ?? (rightOpen ? defaultOpenStyle : 'wall');

  const leftOpenBalustrade = leftStringer !== 'wall' && explicitOpen !== 'none';
  const rightOpenBalustrade = rightStringer !== 'wall' && explicitOpen !== 'none';

  const curtailOpt = options.curtailBottomStep ?? false;
  const curtailLeft =
    curtailOpt === 'left' ||
    curtailOpt === 'both' ||
    (curtailOpt === true && leftOpenBalustrade);
  const curtailRight =
    curtailOpt === 'right' ||
    curtailOpt === 'both' ||
    (curtailOpt === true && rightOpenBalustrade);

  return {
    leftStringer,
    rightStringer,
    leftOpenBalustrade,
    rightOpenBalustrade,
    curtailLeft,
    curtailRight,
  };
}

let cachedToadBackShape: THREE.Shape | null = null;

function getToadBackHandrailShape(): THREE.Shape {
  if (cachedToadBackShape) return cachedToadBackShape;
  const shape = new THREE.Shape();
  // Ergonomic Georgian toad's-back moulded handrail cross-section (width 58 mm, height 46 mm).
  // Origin (0, 0) is the center of the flat bottom underside.
  shape.moveTo(-0.021, 0);
  shape.lineTo(0.021, 0);
  shape.lineTo(0.023, 0.01);
  // Right thumb groove cove
  shape.quadraticCurveTo(0.018, 0.016, 0.028, 0.023);
  // Upper crown roll
  shape.bezierCurveTo(0.031, 0.034, 0.018, 0.046, 0, 0.046);
  shape.bezierCurveTo(-0.018, 0.046, -0.031, 0.034, -0.028, 0.023);
  // Left thumb groove cove
  shape.quadraticCurveTo(-0.018, 0.016, -0.023, 0.01);
  shape.closePath();
  cachedToadBackShape = shape;
  return shape;
}

function buildExtrudedHandrailSegment(
  lengthM: number,
  pitchSlope: number
): THREE.BufferGeometry {
  const shape = getToadBackHandrailShape();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: lengthM,
    bevelEnabled: false,
    curveSegments: 10,
  });
  // ExtrudeGeometry extrudes along +Z [0 .. lengthM] with shape X = lateral, shape Y = vertical.
  // Re-map so local +Z -> -Z (flight ascent direction s in [0 .. lengthM]) and shear Y by pitchSlope * s
  // so vertical cross-section stays plumb while rising along the rake!
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i);
    const sy = pos.getY(i);
    const sz = pos.getZ(i);
    pos.setXYZ(i, sx, sy + sz * pitchSlope, -sz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function buildRakedBarGeometry(
  widthX: number,
  heightY: number,
  lengthS: number,
  pitchSlope: number
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(widthX, heightY, lengthS);
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + heightY * 0.5; // [0 .. heightY]
    const z = pos.getZ(i) - lengthS * 0.5; // [-lengthS .. 0] => s = -z in [0 .. lengthS]
    const s = -z;
    pos.setXYZ(i, x, y + s * pitchSlope, -s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function buildShearedBlockGeometry(
  widthX: number,
  depthS: number,
  yBottomCenter: number,
  yTopCenter: number,
  bottomSlope: number,
  topSlope: number
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(widthX, 1, depthS);
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const isTop = pos.getY(i) > 0;
    const z = pos.getZ(i);
    const ds = -z; // +s is -Z
    const y = isTop ? yTopCenter + ds * topSlope : yBottomCenter + ds * bottomSlope;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

const turnedVaseGeoCache = new Map<string, THREE.LatheGeometry>();

function getTurnedBalusterShaftGeometry(shaftHeight: number): THREE.LatheGeometry {
  const key = shaftHeight.toFixed(4);
  let cached = turnedVaseGeoCache.get(key);
  if (cached) return cached;

  const profile: readonly [number, number][] = [
    [0.0, 0.011],
    [0.04, 0.0145],
    [0.1, 0.0095],
    [0.24, 0.0155],
    [0.36, 0.0135],
    [0.46, 0.0085],
    [0.54, 0.0125],
    [0.64, 0.009],
    [0.86, 0.013],
    [0.94, 0.0085],
    [1.0, 0.011],
  ];
  const pts = profile.map(([t, r]) => new THREE.Vector2(r, t * shaftHeight));
  cached = new THREE.LatheGeometry(pts, 12);
  cached.computeBoundingBox();
  cached.computeBoundingSphere();
  turnedVaseGeoCache.set(key, cached);
  return cached;
}

function createSpindleObject(
  yBottomCenter: number,
  yTopCenter: number,
  bottomSlope: number,
  topSlope: number,
  style: SpindleStyle,
  material: THREE.Material,
  namePrefix: string
): THREE.Group {
  const g = new THREE.Group();
  g.name = namePrefix;

  const halfDepth = SPINDLE_WIDTH_M * 0.5;
  const minClearYBottom = yBottomCenter + Math.abs(bottomSlope) * halfDepth;
  const maxClearYTop = yTopCenter - Math.abs(topSlope) * halfDepth;
  const totalClear = Math.max(0.08, maxClearYTop - minClearYBottom);

  if (style === 'square-chamfered') {
    const bodyGeo = buildShearedBlockGeometry(
      SPINDLE_WIDTH_M,
      SPINDLE_WIDTH_M,
      yBottomCenter,
      yTopCenter,
      bottomSlope,
      topSlope
    );
    const mesh = new THREE.Mesh(bodyGeo, material);
    mesh.name = `${namePrefix}.shaft`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return g;
  }

  const bottomBlockTop = Math.min(minClearYBottom + totalClear * 0.22, maxClearYTop - 0.06);
  const topBlockBottom = Math.max(maxClearYTop - totalClear * 0.18, bottomBlockTop + 0.04);

  const botGeo = buildShearedBlockGeometry(
    SPINDLE_WIDTH_M,
    SPINDLE_WIDTH_M,
    yBottomCenter,
    bottomBlockTop,
    bottomSlope,
    0
  );
  const botMesh = new THREE.Mesh(botGeo, material);
  botMesh.name = `${namePrefix}.bottomBlock`;
  botMesh.castShadow = true;
  botMesh.receiveShadow = true;
  g.add(botMesh);

  const topGeo = buildShearedBlockGeometry(
    SPINDLE_WIDTH_M,
    SPINDLE_WIDTH_M,
    topBlockBottom,
    yTopCenter,
    0,
    topSlope
  );
  const topMesh = new THREE.Mesh(topGeo, material);
  topMesh.name = `${namePrefix}.topBlock`;
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  g.add(topMesh);

  const shaftBottom = bottomBlockTop + EPS;
  const shaftTop = topBlockBottom - EPS;
  const shaftHeight = Math.max(0.02, shaftTop - shaftBottom);
  const latheMesh = new THREE.Mesh(getTurnedBalusterShaftGeometry(shaftHeight), material);
  latheMesh.name = `${namePrefix}.turnedVase`;
  latheMesh.position.y = shaftBottom;
  latheMesh.castShadow = true;
  latheMesh.receiveShadow = true;
  g.add(latheMesh);

  return g;
}

function createNewelPost(
  yBottom: number,
  yShaftTop: number,
  capStyle: NewelCapStyle,
  shaftMat: THREE.Material,
  capMat: THREE.Material,
  namePrefix: string
): THREE.Group {
  const newel = new THREE.Group();
  newel.name = namePrefix;

  const totalShaftH = Math.max(0.25, yShaftTop - yBottom);
  const plinthH = Math.min(0.34, totalShaftH * 0.34);
  const collarH = 0.022;
  const midH = Math.max(0.06, totalShaftH - plinthH - collarH - 2 * EPS);

  const plinth = new THREE.Mesh(
    sharedBoxGeometry(NEWEL_SIZE_M, plinthH, NEWEL_SIZE_M),
    shaftMat
  );
  plinth.name = `${namePrefix}.plinth`;
  plinth.position.y = yBottom + plinthH * 0.5;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  newel.add(plinth);

  const midY0 = yBottom + plinthH + EPS;
  const midShaft = new THREE.Mesh(
    sharedBoxGeometry(NEWEL_SIZE_M - 0.006, midH, NEWEL_SIZE_M - 0.006),
    shaftMat
  );
  midShaft.name = `${namePrefix}.shaft`;
  midShaft.position.y = midY0 + midH * 0.5;
  midShaft.castShadow = true;
  midShaft.receiveShadow = true;
  newel.add(midShaft);

  const collarY0 = midY0 + midH + EPS;
  const collar = new THREE.Mesh(
    sharedBoxGeometry(NEWEL_SIZE_M + 0.008, collarH, NEWEL_SIZE_M + 0.008),
    capMat
  );
  collar.name = `${namePrefix}.neckCollar`;
  collar.position.y = collarY0 + collarH * 0.5;
  collar.castShadow = true;
  collar.receiveShadow = true;
  newel.add(collar);

  const capBaseY = collarY0 + collarH + EPS;
  if (capStyle === 'pyramid') {
    const pyrH = 0.038;
    const pyrGeo = prepGeo(new THREE.ConeGeometry(NEWEL_SIZE_M * 0.72, pyrH, 4));
    const pyr = new THREE.Mesh(pyrGeo, capMat);
    pyr.name = `${namePrefix}.pyramidCap`;
    pyr.rotation.y = Math.PI * 0.25;
    pyr.position.y = capBaseY + pyrH * 0.5;
    pyr.castShadow = true;
    newel.add(pyr);
  } else if (capStyle === 'acorn') {
    const stem = new THREE.Mesh(sharedCylinderGeometry(0.022, 0.028, 0.018, 14), capMat);
    stem.name = `${namePrefix}.acornCup`;
    stem.position.y = capBaseY + 0.009;
    newel.add(stem);

    const acorn = new THREE.Mesh(sharedSphereGeometry(0.035, 16, 12), capMat);
    acorn.name = `${namePrefix}.acornFinial`;
    acorn.scale.set(1, 1.32, 1);
    acorn.position.y = capBaseY + 0.018 + EPS + 0.044;
    acorn.castShadow = true;
    newel.add(acorn);
  } else {
    const neck = new THREE.Mesh(sharedCylinderGeometry(0.018, 0.026, 0.018, 14), capMat);
    neck.name = `${namePrefix}.ballPedestal`;
    neck.position.y = capBaseY + 0.009;
    newel.add(neck);

    const ball = new THREE.Mesh(sharedSphereGeometry(0.038, 16, 14), capMat);
    ball.name = `${namePrefix}.ballCap`;
    ball.position.y = capBaseY + 0.018 + EPS + 0.036;
    ball.castShadow = true;
    newel.add(ball);
  }

  return newel;
}

function buildClosedStringerGeometry(
  sStart: number,
  sEnd: number,
  flightBottomY: number,
  pitchSlope: number,
  riserHeightM: number
): THREE.BufferGeometry {
  const topAbovePitch = 0.048;
  const depthBelowPitch = riserHeightM + 0.068;

  // Planar shape in (u = s, v = y) extruded along +Z by STRINGER_THICKNESS_M, then rotated so extrusion is along +X.
  const shape = new THREE.Shape();
  const yTopStart = flightBottomY + riserHeightM + sStart * pitchSlope + topAbovePitch;
  const yBotStart = Math.max(flightBottomY + EPS, flightBottomY + riserHeightM + sStart * pitchSlope - depthBelowPitch);
  const yTopEnd = flightBottomY + riserHeightM + sEnd * pitchSlope + topAbovePitch;
  const yBotEnd = Math.max(flightBottomY + EPS, flightBottomY + riserHeightM + sEnd * pitchSlope - depthBelowPitch);

  shape.moveTo(sStart, yBotStart);
  if (yBotStart <= flightBottomY + EPS + 1e-4 && yBotEnd > flightBottomY + EPS) {
    const sFloorKnee = (depthBelowPitch - riserHeightM + EPS) / Math.max(1e-4, pitchSlope);
    if (sFloorKnee > sStart + 0.01 && sFloorKnee < sEnd - 0.01) {
      shape.lineTo(sFloorKnee, flightBottomY + EPS);
    }
  }
  shape.lineTo(sEnd, yBotEnd);
  shape.lineTo(sEnd, yTopEnd);
  shape.lineTo(sStart, yTopStart);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: STRINGER_THICKNESS_M, bevelEnabled: false });
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getX(i);
    const y = pos.getY(i);
    const thick = pos.getZ(i) - STRINGER_THICKNESS_M * 0.5;
    pos.setXYZ(i, thick, y, -s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function buildCutStringerGeometry(
  flightRisers: number,
  goingM: number,
  riserHeightM: number,
  flightBottomY: number,
  sMinTrim: number,
  sMaxTrim: number
): THREE.BufferGeometry {
  const pitchSlope = riserHeightM / goingM;
  const soffitOffset = riserHeightM + 0.068;

  // Build stepped upper contour [(s, y)] from sMinTrim to sMaxTrim
  const topPts: [number, number][] = [];
  for (let k = 0; k < flightRisers; k++) {
    const riserBackS = k * goingM + RISER_THICKNESS_M + EPS;
    const treadUndersideY = flightBottomY + (k + 1) * riserHeightM - TREAD_THICKNESS_M - EPS;
    const nextRiserBackS =
      k === flightRisers - 1
        ? Math.min(sMaxTrim, k * goingM + TOP_LANDING_APRON_M)
        : (k + 1) * goingM + RISER_THICKNESS_M + EPS;

    const segS0 = Math.max(sMinTrim, riserBackS);
    const segS1 = Math.min(sMaxTrim, nextRiserBackS);
    if (segS1 <= segS0 + 1e-4) continue;

    if (topPts.length === 0) {
      topPts.push([segS0, treadUndersideY]);
    } else {
      const prev = topPts[topPts.length - 1]!;
      if (Math.abs(prev[0] - segS0) > 1e-4) {
        topPts.push([segS0, prev[1]]);
      }
      topPts.push([segS0, treadUndersideY]);
    }
    topPts.push([segS1, treadUndersideY]);
  }

  if (topPts.length < 2) {
    return buildClosedStringerGeometry(sMinTrim, sMaxTrim, flightBottomY, pitchSlope, riserHeightM);
  }

  const actualS0 = topPts[0]![0];
  const actualS1 = topPts[topPts.length - 1]![0];
  const yBot0 = Math.max(
    flightBottomY + EPS,
    flightBottomY + riserHeightM + actualS0 * pitchSlope - soffitOffset
  );
  const yBot1 = Math.max(
    flightBottomY + EPS,
    flightBottomY + riserHeightM + actualS1 * pitchSlope - soffitOffset
  );

  const shape = new THREE.Shape();
  shape.moveTo(actualS0, yBot0);
  const sKnee = (soffitOffset - riserHeightM + EPS) / Math.max(1e-4, pitchSlope);
  if (sKnee > actualS0 + 0.01 && sKnee < actualS1 - 0.01) {
    shape.lineTo(sKnee, flightBottomY + EPS);
  }
  shape.lineTo(actualS1, yBot1);
  for (let i = topPts.length - 1; i >= 0; i--) {
    shape.lineTo(topPts[i]![0], topPts[i]![1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: STRINGER_THICKNESS_M, bevelEnabled: false });
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getX(i);
    const y = pos.getY(i);
    const thick = pos.getZ(i) - STRINGER_THICKNESS_M * 0.5;
    pos.setXYZ(i, thick, y, -s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

let cachedBracketGeoMap = new Map<string, THREE.BufferGeometry>();

function getGeorgianTreadBracketGeometry(goingM: number, riserHeightM: number): THREE.BufferGeometry {
  const len = Math.max(0.08, goingM - RISER_THICKNESS_M - 0.02);
  const h = Math.min(0.065, riserHeightM * 0.42);
  const key = `${len.toFixed(3)}:${h.toFixed(3)}`;
  let geo = cachedBracketGeoMap.get(key);
  if (geo) return geo;

  // Decorative Georgian S-scroll carved tread bracket in (s, y) plane, thickness 6 mm.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(len, 0);
  shape.quadraticCurveTo(len * 0.82, -h * 0.48, len * 0.54, -h * 0.36);
  shape.bezierCurveTo(len * 0.32, -h * 0.26, len * 0.22, -h * 0.95, 0, -h);
  shape.closePath();

  const thick = 0.006;
  const ext = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 8 });
  const pos = ext.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getX(i);
    const y = pos.getY(i);
    const x = pos.getZ(i) - thick * 0.5;
    pos.setXYZ(i, x, y, -s);
  }
  pos.needsUpdate = true;
  ext.computeVertexNormals();
  ext.computeBoundingBox();
  ext.computeBoundingSphere();
  cachedBracketGeoMap.set(key, ext);
  return ext;
}

function buildFlightRunnerStripGeometry(
  flightRisers: number,
  goingM: number,
  riserHeightM: number,
  flightBottomY: number,
  stripWidth: number,
  runnerThickness: number,
  topRunExtensionM: number
): THREE.BufferGeometry {
  const clear = 0.002;
  const rNose = TREAD_THICKNESS_M * 0.5;
  const outerPts: [number, number][] = [];
  const innerPts: [number, number][] = [];

  const pushOffsetPair = (sInner: number, yInner: number, nx: number, ny: number): void => {
    innerPts.push([sInner, yInner]);
    outerPts.push([sInner + nx * runnerThickness, yInner + ny * runnerThickness]);
  };

  for (let k = 0; k < flightRisers; k++) {
    const yStepBottom = k === 0 ? flightBottomY + clear : flightBottomY + k * riserHeightM + clear;
    const yStepTop = flightBottomY + (k + 1) * riserHeightM;
    const sRiserFront = k * goingM - clear;

    // Bottom of riser k
    pushOffsetPair(sRiserFront, yStepBottom + (k === 0 ? 0 : runnerThickness), -1, 0);

    // Rise up riser k to just beneath the scotia, then step out clear of the scotia and nosing neck
    const noseCenterY = yStepTop - rNose;
    const noseCenterS = k * goingM - (NOSING_PROJECTION_M - rNose) - EPS;
    const arcRadiusInner = rNose + clear;
    const yUnderScotia = yStepTop - TREAD_THICKNESS_M - 0.012;
    const sScotiaFront = k * goingM - 0.0115;
    pushOffsetPair(sRiserFront, yUnderScotia, -1, -1);
    pushOffsetPair(sScotiaFront, yUnderScotia, -1, -1);

    // Smooth wrap around bullnose nosing (from underside to top), mitred where the front leg meets the arc
    const thetaStart = 2 * Math.PI - Math.acos((sScotiaFront - noseCenterS) / arcRadiusInner);
    const thetaEnd = Math.PI * 0.5;
    const arcSteps = 8;
    for (let a = 0; a <= arcSteps; a++) {
      const theta = thetaStart - (a / arcSteps) * (thetaStart - thetaEnd);
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      if (a === 0) {
        const mitre = 1 / (1 - c);
        pushOffsetPair(
          noseCenterS + c * arcRadiusInner,
          noseCenterY + sn * arcRadiusInner,
          (c - 1) * mitre,
          sn * mitre
        );
        continue;
      }
      pushOffsetPair(noseCenterS + c * arcRadiusInner, noseCenterY + sn * arcRadiusInner, c, sn);
    }

    // Horizontal run across tread k (or top landing nosing)
    const sRunEnd =
      k === flightRisers - 1
        ? k * goingM + topRunExtensionM
        : (k + 1) * goingM - clear - runnerThickness;
    pushOffsetPair(sRunEnd, yStepTop + clear, 0, 1);
  }

  const shape = new THREE.Shape();
  shape.moveTo(innerPts[0]![0], innerPts[0]![1]);
  for (let i = 1; i < innerPts.length; i++) {
    shape.lineTo(innerPts[i]![0], innerPts[i]![1]);
  }
  for (let i = outerPts.length - 1; i >= 0; i--) {
    shape.lineTo(outerPts[i]![0], outerPts[i]![1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: stripWidth, bevelEnabled: false });
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getX(i);
    const y = pos.getY(i);
    const x = pos.getZ(i) - stripWidth * 0.5;
    pos.setXYZ(i, x, y, -s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

interface FlightBuildSpec {
  readonly flightIndex: number;
  readonly riserCount: number;
  readonly bottomY: number;
  readonly topY: number;
  readonly riserHeightM: number;
  readonly goingM: number;
  readonly width: number;
  readonly leftStringer: StringerSideMode;
  readonly rightStringer: StringerSideMode;
  readonly leftOpenBalustrade: boolean;
  readonly rightOpenBalustrade: boolean;
  readonly curtailLeft: boolean;
  readonly curtailRight: boolean;
  readonly includeTreadBrackets: boolean;
  readonly includeFootNewels: boolean;
  readonly includeTopNewels: boolean;
  readonly includeTopLandingApron: boolean;
  readonly spindlesPerTread: number;
  readonly spindleMaxClearGapM: number;
  readonly spindleStyle: SpindleStyle;
  readonly newelCap: NewelCapStyle;
  readonly spandrel: SpandrelStyle;
  readonly runner?: StairRunnerOptions;
  readonly treadMat: THREE.Material;
  readonly riserMat: THREE.Material;
  readonly stringerMat: THREE.Material;
  readonly balustradeMat: THREE.Material;
  readonly handrailMat: THREE.Material;
  readonly newelCapMat: THREE.Material;
  readonly soffitMat: THREE.Material;
}

function buildFlightGroup(spec: FlightBuildSpec): {
  readonly group: THREE.Group;
  readonly maxSpindleClearGapM: number;
} {
  const fg = new THREE.Group();
  fg.name = `flight_${spec.flightIndex}`;

  const {
    riserCount,
    bottomY,
    riserHeightM,
    goingM,
    width,
    treadMat,
    riserMat,
    stringerMat,
    balustradeMat,
    handrailMat,
    newelCapMat,
    soffitMat,
  } = spec;

  const halfW = width * 0.5;
  const innerHalfW = halfW - STRINGER_THICKNESS_M;
  const pitchSlope = riserHeightM / goingM;
  const rNose = TREAD_THICKNESS_M * 0.5;
  const scotiaSize = 0.009;
  let maxSpindleClearGapM = 0;

  // Treads, bullnose nosings, scotias, and risers
  for (let k = 0; k < riserCount; k++) {
    const isTopRiser = k === riserCount - 1;
    const yRiserBot = (k === 0 ? bottomY : bottomY + k * riserHeightM) + EPS;
    const yStepTop = bottomY + (k + 1) * riserHeightM;
    const yRiserTop = yStepTop - TREAD_THICKNESS_M - EPS;
    const riserH = Math.max(0.01, yRiserTop - yRiserBot);

    const riserLeftX =
      spec.leftStringer === 'cut' ? -(halfW - 0.008) : -(innerHalfW - EPS);
    const riserRightX =
      spec.rightStringer === 'cut' ? halfW - 0.008 : innerHalfW - EPS;
    const riserW = riserRightX - riserLeftX;
    const riserCenterX = (riserLeftX + riserRightX) * 0.5;

    const riser = new THREE.Mesh(
      sharedBoxGeometry(riserW, riserH, RISER_THICKNESS_M),
      riserMat
    );
    riser.name = `flight_${spec.flightIndex}.riser_${k}`;
    riser.position.set(
      riserCenterX,
      (yRiserBot + yRiserTop) * 0.5,
      -(k * goingM + RISER_THICKNESS_M * 0.5 + EPS)
    );
    riser.castShadow = true;
    riser.receiveShadow = true;
    fg.add(riser);

    if (isTopRiser && !spec.includeTopLandingApron) {
      continue;
    }

    const treadDepth = isTopRiser
      ? TOP_LANDING_APRON_M
      : goingM + RISER_THICKNESS_M;
    const treadLeftX = spec.leftStringer === 'cut' ? -halfW : -(innerHalfW - EPS);
    const treadRightX = spec.rightStringer === 'cut' ? halfW : innerHalfW - EPS;
    const treadW = treadRightX - treadLeftX;
    const treadCenterX = (treadLeftX + treadRightX) * 0.5;

    const treadBoard = new THREE.Mesh(
      sharedBoxGeometry(treadW, TREAD_THICKNESS_M, treadDepth),
      treadMat
    );
    treadBoard.name = isTopRiser
      ? `flight_${spec.flightIndex}.landingNosingBoard`
      : `flight_${spec.flightIndex}.tread_${k}`;
    treadBoard.position.set(
      treadCenterX,
      yStepTop - TREAD_THICKNESS_M * 0.5,
      -(k * goingM + treadDepth * 0.5)
    );
    treadBoard.castShadow = true;
    treadBoard.receiveShadow = true;
    fg.add(treadBoard);

    // Front bullnose projection (non-overlapping in Z: ends at -k * goingM + EPS)
    const noseNeckDepth = Math.max(0.002, NOSING_PROJECTION_M - rNose - EPS);
    const noseNeck = new THREE.Mesh(
      sharedBoxGeometry(treadW, TREAD_THICKNESS_M, noseNeckDepth),
      treadMat
    );
    noseNeck.name = `flight_${spec.flightIndex}.nosingNeck_${k}`;
    noseNeck.position.set(
      treadCenterX,
      yStepTop - TREAD_THICKNESS_M * 0.5,
      -(k * goingM - EPS - noseNeckDepth * 0.5)
    );
    fg.add(noseNeck);

    // Half-cylinder bullnose tip
    const bullnoseGeo = prepGeo(
      new THREE.CylinderGeometry(rNose, rNose, treadW, 12, 1, false, 0, Math.PI)
    );
    const bullnose = new THREE.Mesh(bullnoseGeo, treadMat);
    bullnose.name = `flight_${spec.flightIndex}.bullnose_${k}`;
    bullnose.rotation.z = -Math.PI * 0.5;
    bullnose.rotation.x = -Math.PI * 0.5;
    bullnose.position.set(
      treadCenterX,
      yStepTop - rNose,
      -(k * goingM - EPS - noseNeckDepth - EPS)
    );
    bullnose.castShadow = true;
    fg.add(bullnose);

    // Scotia moulding beneath front bullnose
    const scotia = new THREE.Mesh(
      sharedBoxGeometry(treadW - 0.004, scotiaSize, scotiaSize),
      riserMat
    );
    scotia.name = `flight_${spec.flightIndex}.scotia_${k}`;
    scotia.position.set(
      treadCenterX,
      yStepTop - TREAD_THICKNESS_M - EPS - scotiaSize * 0.5,
      -(k * goingM - EPS - scotiaSize * 0.5)
    );
    tagHighLod(scotia, 14);
    fg.add(scotia);

    // Open / cut stringer side nosing returns + Georgian S-scroll tread brackets
    if (!isTopRiser) {
      for (const side of ['left', 'right'] as const) {
        const mode = side === 'left' ? spec.leftStringer : spec.rightStringer;
        if (mode !== 'cut') continue;
        const sign = side === 'left' ? -1 : 1;
        const isCurtailedHere =
          k === 0 && (side === 'left' ? spec.curtailLeft : spec.curtailRight);
        if (isCurtailedHere) continue;

        const sideHasTopNewel =
          spec.includeTopNewels &&
          (side === 'left' ? spec.leftOpenBalustrade : spec.rightOpenBalustrade);
        const returnStartS = k * goingM - NOSING_PROJECTION_M + 0.002;
        const returnEndS =
          k === riserCount - 2 && sideHasTopNewel
            ? (k + 1) * goingM - HALF_NEWEL_M - 2 * EPS
            : (k + 1) * goingM - 0.002;
        const returnDepth = Math.max(0.02, returnEndS - returnStartS);
        const returnCenterS = (returnStartS + returnEndS) * 0.5;

        const sideReturnNeck = new THREE.Mesh(
          sharedBoxGeometry(noseNeckDepth, TREAD_THICKNESS_M, returnDepth),
          treadMat
        );
        sideReturnNeck.name = `flight_${spec.flightIndex}.treadReturn_${side}_${k}`;
        sideReturnNeck.position.set(
          sign * (halfW + EPS + noseNeckDepth * 0.5),
          yStepTop - TREAD_THICKNESS_M * 0.5,
          -returnCenterS
        );
        fg.add(sideReturnNeck);

        const sideCyl = new THREE.Mesh(
          sharedCylinderGeometry(rNose, rNose, returnDepth, 10),
          treadMat
        );
        sideCyl.name = `flight_${spec.flightIndex}.treadReturnBullnose_${side}_${k}`;
        sideCyl.rotation.x = Math.PI * 0.5;
        sideCyl.position.set(
          sign * (halfW + EPS + noseNeckDepth + rNose * 0.55),
          yStepTop - rNose,
          -returnCenterS
        );
        fg.add(sideCyl);

        const sideScotia = new THREE.Mesh(
          sharedBoxGeometry(scotiaSize, scotiaSize, returnDepth - 0.012),
          stringerMat
        );
        sideScotia.name = `flight_${spec.flightIndex}.treadReturnScotia_${side}_${k}`;
        sideScotia.position.set(
          sign * (halfW + EPS + scotiaSize * 0.5),
          yStepTop - TREAD_THICKNESS_M - EPS - scotiaSize * 0.5,
          -returnCenterS
        );
        tagHighLod(sideScotia, 14);
        fg.add(sideScotia);

        if (spec.includeTreadBrackets) {
          const bracketGeo = getGeorgianTreadBracketGeometry(goingM, riserHeightM);
          const bracket = new THREE.Mesh(bracketGeo, stringerMat);
          bracket.name = `flight_${spec.flightIndex}.treadBracket_${side}_${k}`;
          bracket.position.set(
            sign * (halfW + EPS + 0.003),
            yStepTop - TREAD_THICKNESS_M - scotiaSize - 2 * EPS,
            -(k * goingM + RISER_THICKNESS_M + 0.01)
          );
          tagHighLod(bracket, 16);
          fg.add(bracket);
        }
      }
    }

    // Georgian D-end / bullnose curtail bottom step on k === 0
    if (k === 0 && (spec.curtailLeft || spec.curtailRight)) {
      const curtailRadius = (goingM + NOSING_PROJECTION_M) * 0.5;
      const curtailCenterS = goingM * 0.5 - NOSING_PROJECTION_M * 0.5;
      for (const side of ['left', 'right'] as const) {
        const enabled = side === 'left' ? spec.curtailLeft : spec.curtailRight;
        if (!enabled) continue;
        const sign = side === 'left' ? -1 : 1;
        const thetaStart = side === 'right' ? 0 : Math.PI;
        const curtailTreadGeo = prepGeo(
          new THREE.CylinderGeometry(
            curtailRadius,
            curtailRadius,
            TREAD_THICKNESS_M,
            18,
            1,
            false,
            thetaStart,
            Math.PI
          )
        );
        const curtailTread = new THREE.Mesh(curtailTreadGeo, treadMat);
        curtailTread.name = `flight_${spec.flightIndex}.curtailTread_${side}`;
        curtailTread.position.set(
          sign * (halfW + EPS),
          yStepTop - TREAD_THICKNESS_M * 0.5,
          -curtailCenterS
        );
        curtailTread.castShadow = true;
        curtailTread.receiveShadow = true;
        fg.add(curtailTread);

        const drumRadius = Math.max(0.04, curtailRadius - NOSING_PROJECTION_M);
        const drumGeo = prepGeo(
          new THREE.CylinderGeometry(
            drumRadius,
            drumRadius,
            riserH,
            18,
            1,
            false,
            thetaStart,
            Math.PI
          )
        );
        const curtailDrum = new THREE.Mesh(drumGeo, riserMat);
        curtailDrum.name = `flight_${spec.flightIndex}.curtailRiserDrum_${side}`;
        curtailDrum.position.set(
          sign * (halfW + EPS),
          (yRiserBot + yRiserTop) * 0.5,
          -curtailCenterS
        );
        curtailDrum.castShadow = true;
        fg.add(curtailDrum);
      }
    }
  }

  // Stringers, Newels, Rails, and Spindles per side
  const topRiserS = (riserCount - 1) * goingM;

  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1;
    const sideCenterX = sign * (halfW - STRINGER_THICKNESS_M * 0.5);
    const stringerMode = side === 'left' ? spec.leftStringer : spec.rightStringer;
    const hasBalustrade =
      side === 'left' ? spec.leftOpenBalustrade : spec.rightOpenBalustrade;
    const isCurtailed = side === 'left' ? spec.curtailLeft : spec.curtailRight;

    const footNewelCenterS = isCurtailed ? goingM * 0.5 : 0;
    const topNewelCenterS = topRiserS;

    const sStringerStart =
      hasBalustrade && spec.includeFootNewels
        ? footNewelCenterS + HALF_NEWEL_M + EPS
        : -NOSING_PROJECTION_M;
    const sStringerEnd =
      hasBalustrade && spec.includeTopNewels
        ? topNewelCenterS - HALF_NEWEL_M - EPS
        : topRiserS + (spec.includeTopLandingApron ? TOP_LANDING_APRON_M : 0);

    if (sStringerEnd > sStringerStart + 0.04) {
      const stringerGeo =
        stringerMode === 'cut'
          ? buildCutStringerGeometry(
              riserCount,
              goingM,
              riserHeightM,
              bottomY,
              sStringerStart,
              sStringerEnd
            )
          : buildClosedStringerGeometry(
              sStringerStart,
              sStringerEnd,
              bottomY,
              pitchSlope,
              riserHeightM
            );
      const stringerMesh = new THREE.Mesh(stringerGeo, stringerMat);
      stringerMesh.name = `flight_${spec.flightIndex}.stringer_${side}`;
      stringerMesh.position.x = sideCenterX;
      stringerMesh.castShadow = true;
      stringerMesh.receiveShadow = true;
      fg.add(stringerMesh);
    }

    if (!hasBalustrade) continue;

    // Foot & Top Newel Posts
    if (spec.includeFootNewels) {
      const footBaseY = isCurtailed ? bottomY + riserHeightM + EPS : bottomY;
      const footTopY =
        bottomY + riserHeightM + footNewelCenterS * pitchSlope + HANDRAIL_HEIGHT_M + 0.055;
      const footNewel = createNewelPost(
        footBaseY,
        footTopY,
        spec.newelCap,
        balustradeMat,
        newelCapMat,
        `flight_${spec.flightIndex}.footNewel_${side}`
      );
      footNewel.position.set(sideCenterX, 0, -footNewelCenterS);
      fg.add(footNewel);
    }

    if (spec.includeTopNewels) {
      const topNewelBaseY = Math.max(bottomY, spec.topY - riserHeightM - 0.14);
      const topNewelTopY = spec.topY + HANDRAIL_HEIGHT_M + 0.055;
      const topNewel = createNewelPost(
        topNewelBaseY,
        topNewelTopY,
        spec.newelCap,
        balustradeMat,
        newelCapMat,
        `flight_${spec.flightIndex}.topNewel_${side}`
      );
      topNewel.position.set(sideCenterX, 0, -topNewelCenterS);
      fg.add(topNewel);
    }

    // Clear balustrade span between newels
    const sRailStart = footNewelCenterS + HALF_NEWEL_M + EPS;
    const sRailEnd = topNewelCenterS - HALF_NEWEL_M - EPS;
    const railSpanS = sRailEnd - sRailStart;
    if (railSpanS <= 0.05) continue;

    const yPitchAt = (s: number): number => bottomY + riserHeightM + s * pitchSlope;
    const yHandrailUndersideAt = (s: number): number => yPitchAt(s) + HANDRAIL_HEIGHT_M - 0.046;

    // Swept toad's-back moulded handrail
    const handrailGeo = buildExtrudedHandrailSegment(railSpanS, pitchSlope);
    const handrailMesh = new THREE.Mesh(handrailGeo, handrailMat);
    handrailMesh.name = `flight_${spec.flightIndex}.handrail_${side}`;
    handrailMesh.position.set(sideCenterX, yHandrailUndersideAt(sRailStart), -sRailStart);
    handrailMesh.castShadow = true;
    fg.add(handrailMesh);

    const maxAllowedGap = Math.min(PART_K_MAX_SPINDLE_GAP_M, spec.spindleMaxClearGapM);

    if (stringerMode === 'cut') {
      // Georgian cut stringer: spindles stand directly on top of each open tread (NO sloped shoe-rail!)
      const minPerTread = Math.max(
        spec.spindlesPerTread,
        Math.ceil(goingM / (SPINDLE_WIDTH_M + maxAllowedGap))
      );
      const spindleCenters: { readonly s: number; readonly treadTopY: number }[] = [];

      for (let k = 0; k < riserCount - 1; k++) {
        const treadTopY = bottomY + (k + 1) * riserHeightM;
        const treadS0 = k * goingM;
        for (let p = 0; p < minPerTread; p++) {
          const frac = (p + 0.5) / minPerTread;
          const sc = treadS0 + frac * goingM;
          if (
            sc - SPINDLE_WIDTH_M * 0.5 >= sRailStart + 0.004 &&
            sc + SPINDLE_WIDTH_M * 0.5 <= sRailEnd - 0.004
          ) {
            spindleCenters.push({ s: sc, treadTopY });
          }
        }
      }

      // Ensure end gaps next to foot & top newels also strictly obey < maxAllowedGap
      while (spindleCenters.length > 0) {
        const first = spindleCenters[0]!;
        const startGap = first.s - SPINDLE_WIDTH_M * 0.5 - sRailStart;
        if (startGap <= maxAllowedGap) break;
        const insertS = sRailStart + maxAllowedGap * 0.65 + SPINDLE_WIDTH_M * 0.5;
        const kIdx = Math.max(0, Math.min(riserCount - 2, Math.floor(insertS / goingM)));
        spindleCenters.unshift({ s: insertS, treadTopY: bottomY + (kIdx + 1) * riserHeightM });
      }
      while (spindleCenters.length > 0) {
        const last = spindleCenters[spindleCenters.length - 1]!;
        const endGap = sRailEnd - (last.s + SPINDLE_WIDTH_M * 0.5);
        if (endGap <= maxAllowedGap) break;
        const insertS = sRailEnd - maxAllowedGap * 0.65 - SPINDLE_WIDTH_M * 0.5;
        const kIdx = Math.max(0, Math.min(riserCount - 2, Math.floor(insertS / goingM)));
        spindleCenters.push({ s: insertS, treadTopY: bottomY + (kIdx + 1) * riserHeightM });
      }

      if (spindleCenters.length === 0) {
        const midS = (sRailStart + sRailEnd) * 0.5;
        const kIdx = Math.max(0, Math.min(riserCount - 2, Math.floor(midS / goingM)));
        spindleCenters.push({ s: midS, treadTopY: bottomY + (kIdx + 1) * riserHeightM });
      }

      // Track exact maximum clear horizontal gap
      let prevEdge = sRailStart;
      for (let idx = 0; idx < spindleCenters.length; idx++) {
        const entry = spindleCenters[idx]!;
        const gap = entry.s - SPINDLE_WIDTH_M * 0.5 - prevEdge;
        if (gap > maxSpindleClearGapM) maxSpindleClearGapM = gap;
        prevEdge = entry.s + SPINDLE_WIDTH_M * 0.5;

        const spindle = createSpindleObject(
          entry.treadTopY + EPS,
          yHandrailUndersideAt(entry.s) - EPS,
          0,
          pitchSlope,
          spec.spindleStyle,
          balustradeMat,
          `flight_${spec.flightIndex}.cutSpindle_${side}_${idx}`
        );
        spindle.position.set(sideCenterX, 0, -entry.s);
        fg.add(spindle);
      }
      const trailingGap = sRailEnd - prevEdge;
      if (trailingGap > maxSpindleClearGapM) maxSpindleClearGapM = trailingGap;
    } else {
      // Closed stringer: raked shoe/baserail + uniform < 100mm spindles
      const yShoeBaseAt = (s: number): number => yPitchAt(s) + 0.048 + EPS;
      const shoeGeo = buildRakedBarGeometry(
        SHOE_RAIL_WIDTH_M,
        SHOE_RAIL_HEIGHT_M,
        railSpanS,
        pitchSlope
      );
      const shoeMesh = new THREE.Mesh(shoeGeo, balustradeMat);
      shoeMesh.name = `flight_${spec.flightIndex}.shoeRail_${side}`;
      shoeMesh.position.set(sideCenterX, yShoeBaseAt(sRailStart), -sRailStart);
      shoeMesh.castShadow = true;
      fg.add(shoeMesh);

      const spindleCount = Math.max(
        1,
        Math.ceil((railSpanS - maxAllowedGap) / (SPINDLE_WIDTH_M + maxAllowedGap))
      );
      const clearGap = (railSpanS - spindleCount * SPINDLE_WIDTH_M) / (spindleCount + 1);
      if (clearGap > maxSpindleClearGapM) maxSpindleClearGapM = clearGap;

      for (let idx = 0; idx < spindleCount; idx++) {
        const sc =
          sRailStart +
          clearGap * (idx + 1) +
          SPINDLE_WIDTH_M * (idx + 0.5);
        const yBot = yShoeBaseAt(sc) + SHOE_RAIL_HEIGHT_M + EPS;
        const yTop = yHandrailUndersideAt(sc) - EPS;
        const spindle = createSpindleObject(
          yBot,
          yTop,
          pitchSlope,
          pitchSlope,
          spec.spindleStyle,
          balustradeMat,
          `flight_${spec.flightIndex}.spindle_${side}_${idx}`
        );
        spindle.position.set(sideCenterX, 0, -sc);
        fg.add(spindle);
      }
    }
  }

  // Spandrel / Under-stair plaster soffit or panelled cupboard
  if (spec.spandrel !== 'none') {
    const soffitDrop = riserHeightM + 0.072;
    const soffitThick = 0.02;
    const sSoffit0 = Math.max(0, (soffitDrop - riserHeightM + soffitThick + 2 * EPS) / pitchSlope);
    const sSoffit1 = topRiserS;
    if (sSoffit1 > sSoffit0 + 0.05) {
      const soffitLen = sSoffit1 - sSoffit0;
      const soffitGeo = buildRakedBarGeometry(
        width - 2 * EPS,
        soffitThick,
        soffitLen,
        pitchSlope
      );
      const soffitMesh = new THREE.Mesh(soffitGeo, soffitMat);
      soffitMesh.name = `flight_${spec.flightIndex}.soffitLining`;
      const ySoffit0 =
        bottomY + riserHeightM + sSoffit0 * pitchSlope - soffitDrop - soffitThick;
      soffitMesh.position.set(0, ySoffit0, -sSoffit0);
      soffitMesh.receiveShadow = true;
      fg.add(soffitMesh);

      if (spec.spandrel === 'cupboard' && bottomY < 0.01 + bottomY) {
        for (const side of ['left', 'right'] as const) {
          const isOpen =
            side === 'left' ? spec.leftOpenBalustrade : spec.rightOpenBalustrade;
          if (!isOpen) continue;
          const sign = side === 'left' ? -1 : 1;
          const spandrelX = sign * (halfW - STRINGER_THICKNESS_M * 0.5);
          const sPan0 = Math.max(sSoffit0 + 0.04, HALF_NEWEL_M + EPS);
          const sPan1 = topRiserS - HALF_NEWEL_M - EPS;
          if (sPan1 > sPan0 + 0.18) {
            const shape = new THREE.Shape();
            const y0 = Math.max(
              bottomY + EPS,
              bottomY + riserHeightM + sPan0 * pitchSlope - soffitDrop - soffitThick - EPS
            );
            const y1 = Math.max(
              bottomY + EPS,
              bottomY + riserHeightM + sPan1 * pitchSlope - soffitDrop - soffitThick - EPS
            );
            shape.moveTo(sPan0, bottomY + EPS);
            shape.lineTo(sPan1, bottomY + EPS);
            shape.lineTo(sPan1, y1);
            shape.lineTo(sPan0, y0);
            shape.closePath();

            const panThick = 0.022;
            const panGeo = new THREE.ExtrudeGeometry(shape, {
              depth: panThick,
              bevelEnabled: false,
            });
            const pos = panGeo.attributes['position'] as THREE.BufferAttribute;
            for (let i = 0; i < pos.count; i++) {
              const s = pos.getX(i);
              const y = pos.getY(i);
              const x = pos.getZ(i) - panThick * 0.5;
              pos.setXYZ(i, x, y, -s);
            }
            pos.needsUpdate = true;
            panGeo.computeVertexNormals();
            panGeo.computeBoundingBox();
            panGeo.computeBoundingSphere();

            const spandrelWall = new THREE.Mesh(panGeo, stringerMat);
            spandrelWall.name = `flight_${spec.flightIndex}.understairsCupboardSpandrel_${side}`;
            spandrelWall.position.x = spandrelX;
            spandrelWall.castShadow = true;
            spandrelWall.receiveShadow = true;
            fg.add(spandrelWall);
          }
        }
      }
    }
  }

  // Carpet Runner + Contrasting Borders + Brass Stair Rods
  if (spec.runner) {
    const runnerOpts = spec.runner;
    const maxRunnerW = Math.max(0.24, (innerHalfW - 0.02) * 2);
    const runnerW = Math.min(maxRunnerW, runnerOpts.width ?? width * 0.62);
    const runnerThick = runnerOpts.thickness ?? 0.006;
    const borderW =
      runnerOpts.borderMaterial && runnerOpts.borderWidth && runnerOpts.borderWidth > 0
        ? Math.min(runnerW * 0.25, runnerOpts.borderWidth)
        : 0;
    const mainW = runnerW - 2 * borderW - (borderW > 0 ? 0.001 : 0);
    const topExt = spec.includeTopLandingApron ? TOP_LANDING_APRON_M : 0.03;

    const mainRunnerGeo = buildFlightRunnerStripGeometry(
      riserCount,
      goingM,
      riserHeightM,
      bottomY,
      mainW,
      runnerThick,
      topExt
    );
    const mainRunner = new THREE.Mesh(mainRunnerGeo, runnerOpts.material);
    mainRunner.name = `flight_${spec.flightIndex}.carpetRunner`;
    mainRunner.castShadow = true;
    mainRunner.receiveShadow = true;
    fg.add(mainRunner);

    if (borderW > 0 && runnerOpts.borderMaterial) {
      const borderGeo = buildFlightRunnerStripGeometry(
        riserCount,
        goingM,
        riserHeightM,
        bottomY,
        borderW,
        runnerThick,
        topExt
      );
      const borderOffsetX = (mainW + borderW) * 0.5 + 0.0005;
      for (const bSide of ['left', 'right'] as const) {
        const bSign = bSide === 'left' ? -1 : 1;
        const bMesh = new THREE.Mesh(borderGeo, runnerOpts.borderMaterial);
        bMesh.name = `flight_${spec.flightIndex}.carpetRunnerBorder_${bSide}`;
        bMesh.position.x = bSign * borderOffsetX;
        bMesh.receiveShadow = true;
        fg.add(bMesh);
      }
    }

    if (runnerOpts.stairRods !== false) {
      const rodCfg = typeof runnerOpts.stairRods === 'object' ? runnerOpts.stairRods : undefined;
      const rodMat = rodCfg?.material ?? getDefaultBrassRodMaterial();
      const rodRadius = rodCfg?.radius ?? 0.0065;
      const rodLen = runnerW + 0.032;

      for (let k = 1; k < riserCount; k++) {
        const treadTopY = bottomY + k * riserHeightM;
        const rodY = treadTopY + 0.002 + runnerThick + rodRadius + EPS;
        const rodS = k * goingM - 0.002 - runnerThick - rodRadius - EPS;

        const rodMesh = new THREE.Mesh(
          sharedCylinderGeometry(rodRadius, rodRadius, rodLen, 10),
          rodMat
        );
        rodMesh.name = `flight_${spec.flightIndex}.stairRod_${k}`;
        rodMesh.rotation.z = Math.PI * 0.5;
        rodMesh.position.set(0, rodY, -rodS);
        rodMesh.castShadow = true;
        tagHighLod(rodMesh, 14);
        fg.add(rodMesh);

        for (const fSide of ['left', 'right'] as const) {
          const fSign = fSide === 'left' ? -1 : 1;
          const finial = new THREE.Mesh(
            sharedSphereGeometry(rodRadius * 1.45, 10, 8),
            rodMat
          );
          finial.name = `flight_${spec.flightIndex}.stairRodFinial_${fSide}_${k}`;
          finial.position.set(fSign * (rodLen * 0.5 + rodRadius * 0.8), rodY, -rodS);
          tagHighLod(finial, 14);
          fg.add(finial);

          const bracket = new THREE.Mesh(
            sharedBoxGeometry(0.012, rodRadius * 2.2, rodRadius * 2.2),
            rodMat
          );
          bracket.name = `flight_${spec.flightIndex}.stairRodBracket_${fSide}_${k}`;
          bracket.position.set(fSign * (runnerW * 0.5 + 0.008), rodY, -rodS);
          tagHighLod(bracket, 14);
          fg.add(bracket);
        }
      }
    }
  }

  return { group: fg, maxSpindleClearGapM };
}

/**
 * Generates an architecturally accurate, zero-z-fighting UK Part K compliant straight,
 * quarter-turn ('L'), or half-turn ('U') staircase with closed or Georgian cut stringers,
 * < 100 mm clear-gap spindles, optional carpet runner + brass stair rods, upper-floor void
 * cutout polygon, and an exact walkable elevation sampler.
 */
export function createStaircase(options: CreateStaircaseOptions): StaircaseBuildResult {
  const layout = normalizeLayout(options.layout);
  const bottomY = options.bottomY;
  const topY = options.topY;
  const totalRiseM = Math.max(0.2, topY - bottomY);
  const originX = options.origin?.[0] ?? 0;
  const originZ = options.origin?.[1] ?? 0;
  const headingRad = resolveHeadingRad(options.headingRad, options.direction);

  const width = Math.max(0.6, options.width ?? 0.96);
  const halfW = width * 0.5;
  const targetRiserM = Math.min(PART_K_MAX_RISER_M, Math.max(0.13, options.targetRiserM ?? 0.192));
  const minPartKRisers = Math.ceil(totalRiseM / PART_K_MAX_RISER_M - 1e-9);
  const riserCount = Math.max(layout === 'straight' ? 2 : 4, minPartKRisers, Math.round(totalRiseM / targetRiserM));
  const riserHeightM = totalRiseM / riserCount;
  const goingM = Math.max(0.18, options.goingM ?? 0.245);
  const turnDirection: StairTurnDirection = options.turnDirection ?? 'right';
  const turnSign = turnDirection === 'right' ? 1 : -1;
  const halfLandingGapM = Math.max(0.04, options.halfLandingGapM ?? 0.12);

  const sideModes = resolveSideModes(options);
  const includeTreadBrackets = options.includeTreadBrackets ?? true;
  const includeTopLandingApron = options.includeLandingApron ?? true;
  const spindlesPerTread = Math.max(2, Math.round(options.spindlesPerTread ?? 2));
  const spindleMaxClearGapM = Math.min(
    PART_K_MAX_SPINDLE_GAP_M,
    Math.max(0.04, options.spindleMaxClearGapM ?? 0.092)
  );
  const spindleStyle: SpindleStyle = options.spindleStyle ?? 'turned';
  const newelCap: NewelCapStyle = options.newelCap ?? 'ball';
  const spandrel: SpandrelStyle = options.spandrel ?? 'open-soffit';

  const treadMat = options.treadMaterial ?? getDefaultOakMaterial();
  const riserMat = options.riserMaterial ?? getDefaultSatinWhiteMaterial();
  const stringerMat = options.stringerMaterial ?? getDefaultSatinWhiteMaterial();
  const balustradeMat = options.balustradeMaterial ?? getDefaultSatinWhiteMaterial();
  const handrailMat = options.handrailMaterial ?? getDefaultHandrailMaterial();
  const newelCapMat = options.newelCapMaterial ?? handrailMat;
  const soffitMat = options.soffitMaterial ?? getDefaultPlasterSoffitMaterial();

  const group = new THREE.Group();
  const baseName = options.name ?? 'staircase';
  group.name = baseName;
  group.position.set(originX, 0, originZ);
  group.rotation.y = headingRad;
  if (options.zone) {
    group.userData.zoneId = options.zone;
  }

  let maxSpindleClearGapM = 0;

  const cosH = Math.cos(headingRad);
  const sinH = Math.sin(headingRad);
  const localToWorldXZ = (lx: number, lz: number): [number, number] => [
    originX + lx * cosH + lz * sinH,
    originZ - lx * sinH + lz * cosH,
  ];
  const worldToLocalXZ = (wx: number, wz: number): [number, number] => {
    const dx = wx - originX;
    const dz = wz - originZ;
    return [dx * cosH - dz * sinH, dx * sinH + dz * cosH];
  };

  let voidLocalPoly: [number, number][] = [];
  let sampleLocalY: (lx: number, lz: number) => number | null;

  if (layout === 'straight') {
    const flightRes = buildFlightGroup({
      flightIndex: 1,
      riserCount,
      bottomY,
      topY,
      riserHeightM,
      goingM,
      width,
      leftStringer: sideModes.leftStringer,
      rightStringer: sideModes.rightStringer,
      leftOpenBalustrade: sideModes.leftOpenBalustrade,
      rightOpenBalustrade: sideModes.rightOpenBalustrade,
      curtailLeft: sideModes.curtailLeft,
      curtailRight: sideModes.curtailRight,
      includeTreadBrackets,
      includeFootNewels: true,
      includeTopNewels: true,
      includeTopLandingApron,
      spindlesPerTread,
      spindleMaxClearGapM,
      spindleStyle,
      newelCap,
      spandrel,
      runner: options.runner,
      treadMat,
      riserMat,
      stringerMat,
      balustradeMat,
      handrailMat,
      newelCapMat,
      soffitMat,
    });
    group.add(flightRes.group);
    maxSpindleClearGapM = Math.max(maxSpindleClearGapM, flightRes.maxSpindleClearGapM);

    const flightRunM = (riserCount - 1) * goingM;
    const voidEndS = flightRunM + TOP_LANDING_APRON_M + 2 * EPS;
    voidLocalPoly = [
      [-halfW - 2 * EPS, 0],
      [halfW + 2 * EPS, 0],
      [halfW + 2 * EPS, -voidEndS],
      [-halfW - 2 * EPS, -voidEndS],
    ];

    sampleLocalY = (lx, lz) => {
      if (Math.abs(lx) > halfW + 1e-6) return null;
      const s = -lz;
      if (s < -NOSING_PROJECTION_M - 1e-6 || s > flightRunM + TOP_LANDING_APRON_M + 1e-6) {
        return null;
      }
      if (s <= 0) return bottomY;
      if (s >= flightRunM) return topY;
      return bottomY + (s / Math.max(1e-6, flightRunM)) * (topY - bottomY);
    };
  } else if (layout === 'quarter-turn') {
    const n1 = Math.max(
      2,
      Math.min(riserCount - 2, Math.round(options.turnAfterRisers ?? Math.floor(riserCount * 0.5)))
    );
    const n2 = riserCount - n1;
    const landingY = bottomY + n1 * riserHeightM;
    const run1 = (n1 - 1) * goingM;
    const run2 = (n2 - 1) * goingM;

    const f1 = buildFlightGroup({
      flightIndex: 1,
      riserCount: n1,
      bottomY,
      topY: landingY,
      riserHeightM,
      goingM,
      width,
      leftStringer: sideModes.leftStringer,
      rightStringer: sideModes.rightStringer,
      leftOpenBalustrade: sideModes.leftOpenBalustrade,
      rightOpenBalustrade: sideModes.rightOpenBalustrade,
      curtailLeft: sideModes.curtailLeft,
      curtailRight: sideModes.curtailRight,
      includeTreadBrackets,
      includeFootNewels: true,
      includeTopNewels: true,
      includeTopLandingApron: false,
      spindlesPerTread,
      spindleMaxClearGapM,
      spindleStyle,
      newelCap,
      spandrel,
      runner: options.runner,
      treadMat,
      riserMat,
      stringerMat,
      balustradeMat,
      handrailMat,
      newelCapMat,
      soffitMat,
    });
    group.add(f1.group);
    maxSpindleClearGapM = Math.max(maxSpindleClearGapM, f1.maxSpindleClearGapM);

    // Quarter-space landing at z in [-run1 - width, -run1], x in [-halfW, +halfW]
    const landingGroup = new THREE.Group();
    landingGroup.name = 'quarterLanding';
    const landingBoard = new THREE.Mesh(
      sharedBoxGeometry(width, TREAD_THICKNESS_M, width),
      treadMat
    );
    landingBoard.name = 'quarterLanding.deck';
    landingBoard.position.set(0, landingY - TREAD_THICKNESS_M * 0.5, -(run1 + halfW));
    landingBoard.castShadow = true;
    landingBoard.receiveShadow = true;
    landingGroup.add(landingBoard);

    const landingFramingH = 0.14;
    const landingFraming = new THREE.Mesh(
      sharedBoxGeometry(width - 0.01, landingFramingH, width - 0.01),
      soffitMat
    );
    landingFraming.name = 'quarterLanding.soffitBox';
    landingFraming.position.set(
      0,
      landingY - TREAD_THICKNESS_M - EPS - landingFramingH * 0.5,
      -(run1 + halfW)
    );
    landingGroup.add(landingFraming);

    if (options.runner) {
      const rThick = options.runner.thickness ?? 0.006;
      const rW = Math.min((halfW - STRINGER_THICKNESS_M - 0.02) * 2, options.runner.width ?? width * 0.62);
      const padSize = halfW + rW * 0.5;
      const pad = new THREE.Mesh(
        sharedBoxGeometry(padSize, rThick, padSize),
        options.runner.material
      );
      pad.name = 'quarterLanding.carpetPad';
      pad.position.set(
        turnSign * (halfW - padSize * 0.5),
        landingY + 0.002 + rThick * 0.5,
        -(run1 + padSize * 0.5)
      );
      landingGroup.add(pad);
    }
    group.add(landingGroup);

    // Flight 2 rotated by -turnSign * PI/2 around Y, origin at (turnSign * halfW, 0, -(run1 + halfW))
    const f2 = buildFlightGroup({
      flightIndex: 2,
      riserCount: n2,
      bottomY: landingY,
      topY,
      riserHeightM,
      goingM,
      width,
      leftStringer: sideModes.leftStringer,
      rightStringer: sideModes.rightStringer,
      leftOpenBalustrade: sideModes.leftOpenBalustrade,
      rightOpenBalustrade: sideModes.rightOpenBalustrade,
      curtailLeft: false,
      curtailRight: false,
      includeTreadBrackets,
      includeFootNewels: false,
      includeTopNewels: true,
      includeTopLandingApron,
      spindlesPerTread,
      spindleMaxClearGapM,
      spindleStyle,
      newelCap,
      spandrel,
      runner: options.runner,
      treadMat,
      riserMat,
      stringerMat,
      balustradeMat,
      handrailMat,
      newelCapMat,
      soffitMat,
    });
    f2.group.position.set(turnSign * halfW, 0, -(run1 + halfW));
    f2.group.rotation.y = -turnSign * Math.PI * 0.5;
    group.add(f2.group);
    maxSpindleClearGapM = Math.max(maxSpindleClearGapM, f2.maxSpindleClearGapM);

    // L-shaped six-vertex void polygon in local XZ
    const outerX = turnSign * (halfW + run2);
    if (turnSign > 0) {
      voidLocalPoly = [
        [-halfW, 0],
        [halfW, 0],
        [halfW, -run1],
        [outerX, -run1],
        [outerX, -(run1 + width)],
        [-halfW, -(run1 + width)],
      ];
    } else {
      voidLocalPoly = [
        [-halfW, 0],
        [halfW, 0],
        [halfW, -(run1 + width)],
        [outerX, -(run1 + width)],
        [outerX, -run1],
        [-halfW, -run1],
      ];
    }

    sampleLocalY = (lx, lz) => {
      // Quarter-space landing check
      const s1 = -lz;
      if (Math.abs(lx) <= halfW + 1e-6 && s1 >= run1 - 1e-6 && s1 <= run1 + width + 1e-6) {
        return landingY;
      }
      // Flight 1 check
      if (Math.abs(lx) <= halfW + 1e-6 && s1 >= -NOSING_PROJECTION_M - 1e-6 && s1 <= run1) {
        if (s1 <= 0) return bottomY;
        return bottomY + (s1 / Math.max(1e-6, run1)) * (landingY - bottomY);
      }
      // Flight 2 check: ascends along turnSign * +X from xStart = turnSign * halfW
      const s2 = turnSign * lx - halfW;
      const u2 = lz + (run1 + halfW);
      if (
        Math.abs(u2) <= halfW + 1e-6 &&
        s2 >= -1e-6 &&
        s2 <= run2 + TOP_LANDING_APRON_M + 1e-6
      ) {
        if (s2 >= run2) return topY;
        return landingY + (s2 / Math.max(1e-6, run2)) * (topY - landingY);
      }
      return null;
    };
  } else {
    // Half-turn ('U') staircase
    const n1 = Math.max(
      2,
      Math.min(riserCount - 2, Math.round(options.turnAfterRisers ?? Math.floor(riserCount * 0.5)))
    );
    const n2 = riserCount - n1;
    const landingY = bottomY + n1 * riserHeightM;
    const run1 = (n1 - 1) * goingM;
    const run2 = (n2 - 1) * goingM;
    const flight2CenterX = turnSign * (width + halfLandingGapM);

    // On a U-stair, the inner well side is right when turning right, left when turning left
    const f1 = buildFlightGroup({
      flightIndex: 1,
      riserCount: n1,
      bottomY,
      topY: landingY,
      riserHeightM,
      goingM,
      width,
      leftStringer: sideModes.leftStringer,
      rightStringer: sideModes.rightStringer,
      leftOpenBalustrade: sideModes.leftOpenBalustrade,
      rightOpenBalustrade: sideModes.rightOpenBalustrade,
      curtailLeft: sideModes.curtailLeft,
      curtailRight: sideModes.curtailRight,
      includeTreadBrackets,
      includeFootNewels: true,
      includeTopNewels: true,
      includeTopLandingApron: false,
      spindlesPerTread,
      spindleMaxClearGapM,
      spindleStyle,
      newelCap,
      spandrel,
      runner: options.runner,
      treadMat,
      riserMat,
      stringerMat,
      balustradeMat,
      handrailMat,
      newelCapMat,
      soffitMat,
    });
    group.add(f1.group);
    maxSpindleClearGapM = Math.max(maxSpindleClearGapM, f1.maxSpindleClearGapM);

    // Full-width half-space landing: width = 2 * width + halfLandingGapM, depth = width
    const totalWellWidth = 2 * width + halfLandingGapM;
    const landingCenterX = flight2CenterX * 0.5;
    const landingGroup = new THREE.Group();
    landingGroup.name = 'halfLanding';

    const landingDeck = new THREE.Mesh(
      sharedBoxGeometry(totalWellWidth, TREAD_THICKNESS_M, width),
      treadMat
    );
    landingDeck.name = 'halfLanding.deck';
    landingDeck.position.set(landingCenterX, landingY - TREAD_THICKNESS_M * 0.5, -(run1 + halfW));
    landingDeck.castShadow = true;
    landingDeck.receiveShadow = true;
    landingGroup.add(landingDeck);

    const landingFramingH = 0.14;
    const landingFraming = new THREE.Mesh(
      sharedBoxGeometry(totalWellWidth - 0.01, landingFramingH, width - 0.01),
      soffitMat
    );
    landingFraming.name = 'halfLanding.soffitBox';
    landingFraming.position.set(
      landingCenterX,
      landingY - TREAD_THICKNESS_M - EPS - landingFramingH * 0.5,
      -(run1 + halfW)
    );
    landingGroup.add(landingFraming);

    // Short balustrade across the well gap on the half-landing edge if inner side is open
    const innerWellOpen =
      turnSign > 0 ? sideModes.rightOpenBalustrade : sideModes.leftOpenBalustrade;
    if (innerWellOpen && halfLandingGapM > 0.02) {
      const wellBridge = createBalustradeRun({
        points: [
          [turnSign * (halfW - STRINGER_THICKNESS_M * 0.5), -(run1 - EPS)],
          [flight2CenterX - turnSign * (halfW - STRINGER_THICKNESS_M * 0.5), -(run1 - EPS)],
        ],
        elevationY: landingY,
        height: HANDRAIL_HEIGHT_M,
        newelCap,
        spindleStyle,
        spindleMaxClearGapM,
        includeStartNewel: false,
        includeEndNewel: false,
        balustradeMaterial: balustradeMat,
        handrailMaterial: handrailMat,
        newelCapMaterial: newelCapMat,
        name: 'halfLanding.wellBalustrade',
      });
      landingGroup.add(wellBridge.group);
      if (wellBridge.spindleCount > 0) {
        maxSpindleClearGapM = Math.max(maxSpindleClearGapM, wellBridge.maxSpindleClearGapM);
      }
    }

    if (options.runner) {
      const rThick = options.runner.thickness ?? 0.006;
      const rW = Math.min((halfW - STRINGER_THICKNESS_M - 0.02) * 2, options.runner.width ?? width * 0.62);
      const uSpanWidth = Math.abs(flight2CenterX) + rW;
      const uPad = new THREE.Mesh(
        sharedBoxGeometry(uSpanWidth, rThick, halfW + rW * 0.5),
        options.runner.material
      );
      uPad.name = 'halfLanding.carpetPad';
      uPad.position.set(
        landingCenterX,
        landingY + 0.002 + rThick * 0.5,
        -(run1 + (halfW + rW * 0.5) * 0.5)
      );
      landingGroup.add(uPad);
    }
    group.add(landingGroup);

    // Flight 2 reversed 180 deg (ascending toward +Z in staircase local coordinates)
    // Because Flight 2 is rotated 180 deg, its local right faces toward Flight 1 when turnDirection === 'right'!
    const f2LeftStringer =
      turnSign > 0 ? (innerWellOpen ? sideModes.rightStringer : 'wall') : sideModes.leftStringer;
    const f2RightStringer =
      turnSign > 0 ? sideModes.leftStringer : (innerWellOpen ? sideModes.leftStringer : 'wall');
    const f2LeftOpen = f2LeftStringer !== 'wall';
    const f2RightOpen = f2RightStringer !== 'wall';

    // Wait: when f2.rotation.y = Math.PI, f2's local +X (right) maps to parent -X!
    // For turnSign > 0 (Flight 2 is at +X = width + gap), parent -X is the INNER WELL side!
    // So f2's RIGHT side is the inner well side when turnSign > 0, and f2's LEFT side is the inner well side when turnSign < 0!
    const f2ActualRightMode = turnSign > 0 ? sideModes.rightStringer : sideModes.leftStringer;
    const f2ActualLeftMode = turnSign > 0 ? sideModes.leftStringer : sideModes.rightStringer;
    const f2ActualRightOpen = turnSign > 0 ? sideModes.rightOpenBalustrade : sideModes.leftOpenBalustrade;
    const f2ActualLeftOpen = turnSign > 0 ? sideModes.leftOpenBalustrade : sideModes.rightOpenBalustrade;
    void f2LeftOpen;
    void f2RightOpen;

    const f2 = buildFlightGroup({
      flightIndex: 2,
      riserCount: n2,
      bottomY: landingY,
      topY,
      riserHeightM,
      goingM,
      width,
      leftStringer: f2ActualLeftMode,
      rightStringer: f2ActualRightMode,
      leftOpenBalustrade: f2ActualLeftOpen,
      rightOpenBalustrade: f2ActualRightOpen,
      curtailLeft: false,
      curtailRight: false,
      includeTreadBrackets,
      includeFootNewels: true,
      includeTopNewels: true,
      includeTopLandingApron,
      spindlesPerTread,
      spindleMaxClearGapM,
      spindleStyle,
      newelCap,
      spandrel,
      runner: options.runner,
      treadMat,
      riserMat,
      stringerMat,
      balustradeMat,
      handrailMat,
      newelCapMat,
      soffitMat,
    });
    f2.group.position.set(flight2CenterX, 0, -run1);
    f2.group.rotation.y = Math.PI;
    group.add(f2.group);
    maxSpindleClearGapM = Math.max(maxSpindleClearGapM, f2.maxSpindleClearGapM);

    const minX = Math.min(-halfW, flight2CenterX - halfW);
    const maxX = Math.max(halfW, flight2CenterX + halfW);
    const maxFrontZ = Math.max(0, run2 - run1);
    voidLocalPoly = [
      [minX, maxFrontZ],
      [maxX, maxFrontZ],
      [maxX, -(run1 + width)],
      [minX, -(run1 + width)],
    ];

    sampleLocalY = (lx, lz) => {
      const s1 = -lz;
      // Half-space landing check
      if (
        lx >= minX - 1e-6 &&
        lx <= maxX + 1e-6 &&
        s1 >= run1 - 1e-6 &&
        s1 <= run1 + width + 1e-6
      ) {
        return landingY;
      }
      // Flight 1 check
      if (Math.abs(lx) <= halfW + 1e-6 && s1 >= -NOSING_PROJECTION_M - 1e-6 && s1 <= run1) {
        if (s1 <= 0) return bottomY;
        return bottomY + (s1 / Math.max(1e-6, run1)) * (landingY - bottomY);
      }
      // Flight 2 check: starts at z = -run1 and ascends toward +Z (s2 = lz - (-run1) = lz + run1)
      const s2 = lz + run1;
      if (
        Math.abs(lx - flight2CenterX) <= halfW + 1e-6 &&
        s2 >= -1e-6 &&
        s2 <= run2 + TOP_LANDING_APRON_M + 1e-6
      ) {
        if (s2 >= run2) return topY;
        return landingY + (s2 / Math.max(1e-6, run2)) * (topY - landingY);
      }
      return null;
    };
  }

  ensureNamedAddedChildren(group, 0, baseName);
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const voidOpeningXZ = voidLocalPoly.map(([lx, lz]) => localToWorldXZ(lx, lz));

  const result: StaircaseBuildResult = {
    group,
    voidOpeningXZ,
    sampleWalkableY(worldX: number, worldZ: number): number | null {
      const [lx, lz] = worldToLocalXZ(worldX, worldZ);
      return sampleLocalY(lx, lz);
    },
    bounds,
    riserCount,
    riserHeightM,
    goingM,
    maxSpindleClearGapM,
  };

  registerStaircaseWalkableSampler(group, {
    bottomY,
    topY,
    voidOpeningXZ,
    bounds,
    sampleWalkableY: result.sampleWalkableY,
    voidLocalXZ: voidLocalPoly,
    sampleLocalWalkableY: sampleLocalY,
  });

  return result;
}

/**
 * Generates a horizontal landing balustrade along a 2D (`[x, z]`) or 3D (`[x, y, z]`) polyline
 * with `90 × 90 mm` newels, shoe rail, swept toad's-back moulded handrail, `< 100 mm` clear-gap
 * spindles, and optional stairwell trimmer apron fascia covering the upper floor slab edge.
 */
export function createBalustradeRun(options: CreateBalustradeRunOptions): BalustradeRunResult {
  const baseElevationY = options.elevationY ?? 0;
  const height = Math.max(0.5, options.height ?? 0.92);
  const newelCap: NewelCapStyle = options.newelCap ?? 'ball';
  const spindleStyle: SpindleStyle = options.spindleStyle ?? 'turned';
  const maxAllowedGap = Math.min(
    PART_K_MAX_SPINDLE_GAP_M,
    Math.max(0.04, options.spindleMaxClearGapM ?? 0.092)
  );
  const includeStartNewel = options.includeStartNewel ?? true;
  const includeEndNewel = options.includeEndNewel ?? true;
  const includeTrimmerFascia = options.includeTrimmerFascia ?? false;
  const slabThicknessM = Math.max(0.08, options.slabThicknessM ?? 0.24);

  const balustradeMat = options.balustradeMaterial ?? getDefaultSatinWhiteMaterial();
  const handrailMat = options.handrailMaterial ?? getDefaultHandrailMaterial();
  const newelCapMat = options.newelCapMaterial ?? handrailMat;
  const fasciaMat = options.fasciaMaterial ?? balustradeMat;

  const baseName = options.name ?? 'balustradeRun';
  const group = new THREE.Group();
  group.name = baseName;
  if (options.zone) {
    group.userData.zoneId = options.zone;
  }

  const pts3D: [number, number, number][] = options.points.map((pt) =>
    pt.length === 3 ? [pt[0], pt[1], pt[2]] : [pt[0], baseElevationY, pt[1]]
  );

  if (pts3D.length < 2) {
    return { group, maxSpindleClearGapM: 0, spindleCount: 0, newelCount: 0 };
  }

  let newelCount = 0;
  let spindleCount = 0;
  let maxSpindleClearGapM = 0;

  const hasNewelAt = (idx: number): boolean => {
    if (idx === 0) return includeStartNewel;
    if (idx === pts3D.length - 1) return includeEndNewel;
    return true;
  };

  for (let i = 0; i < pts3D.length; i++) {
    if (!hasNewelAt(i)) continue;
    const [px, py, pz] = pts3D[i]!;
    const newel = createNewelPost(
      py + EPS,
      py + height + 0.045,
      newelCap,
      balustradeMat,
      newelCapMat,
      `${baseName}.newel_${i}`
    );
    newel.position.set(px, 0, pz);
    group.add(newel);
    newelCount++;
  }

  for (let segIdx = 0; segIdx < pts3D.length - 1; segIdx++) {
    const p0 = pts3D[segIdx]!;
    const p1 = pts3D[segIdx + 1]!;
    const dx = p1[0] - p0[0];
    const dz = p1[2] - p0[2];
    const segLen = Math.hypot(dx, dz);
    if (segLen <= 1e-4) continue;

    const dirX = dx / segLen;
    const dirZ = dz / segLen;
    // Local -Z of buildExtrudedHandrailSegment points along segment direction (dirX, dirZ):
    // (-sin(yaw), -cos(yaw)) = (dirX, dirZ) => yaw = atan2(-dirX, -dirZ)
    const segYaw = Math.atan2(-dirX, -dirZ);
    const segY = p0[1];

    const trimStart = hasNewelAt(segIdx) ? HALF_NEWEL_M + EPS : EPS;
    const trimEnd = hasNewelAt(segIdx + 1) ? HALF_NEWEL_M + EPS : EPS;
    const clearLen = segLen - trimStart - trimEnd;

    const segGroup = new THREE.Group();
    segGroup.name = `${baseName}.segment_${segIdx}`;
    segGroup.position.set(p0[0], 0, p0[2]);
    segGroup.rotation.y = segYaw;
    group.add(segGroup);

    if (includeTrimmerFascia) {
      const fasciaThick = 0.018;
      const fasciaH = Math.max(0.04, slabThicknessM - EPS);
      const fasciaMesh = new THREE.Mesh(
        sharedBoxGeometry(fasciaThick, fasciaH, segLen),
        fasciaMat
      );
      fasciaMesh.name = `${baseName}.trimmerFascia_${segIdx}`;
      // Offset 0.5 mm outside newel/balustrade edge (+X or -X clear of slab face)
      const fasciaX = -(HALF_NEWEL_M + EPS + fasciaThick * 0.5);
      fasciaMesh.position.set(fasciaX, segY - EPS - fasciaH * 0.5, -segLen * 0.5);
      fasciaMesh.receiveShadow = true;
      segGroup.add(fasciaMesh);

      const beadRadius = 0.008;
      const beadMesh = new THREE.Mesh(
        sharedCylinderGeometry(beadRadius, beadRadius, segLen, 10),
        fasciaMat
      );
      beadMesh.name = `${baseName}.trimmerBead_${segIdx}`;
      beadMesh.rotation.x = Math.PI * 0.5;
      beadMesh.position.set(
        fasciaX,
        segY - slabThicknessM - beadRadius - EPS,
        -segLen * 0.5
      );
      tagHighLod(beadMesh, 16);
      segGroup.add(beadMesh);
    }

    if (clearLen <= 0.02) continue;

    // Shoe rail
    const shoeMesh = new THREE.Mesh(
      sharedBoxGeometry(SHOE_RAIL_WIDTH_M, SHOE_RAIL_HEIGHT_M, clearLen),
      balustradeMat
    );
    shoeMesh.name = `${baseName}.shoeRail_${segIdx}`;
    shoeMesh.position.set(
      0,
      segY + EPS + SHOE_RAIL_HEIGHT_M * 0.5,
      -(trimStart + clearLen * 0.5)
    );
    shoeMesh.castShadow = true;
    segGroup.add(shoeMesh);

    // Swept toad's-back moulded handrail
    const yHandrailUnderside = segY + height - 0.046;
    const handrailGeo = buildExtrudedHandrailSegment(clearLen, 0);
    const handrailMesh = new THREE.Mesh(handrailGeo, handrailMat);
    handrailMesh.name = `${baseName}.handrail_${segIdx}`;
    handrailMesh.position.set(0, yHandrailUnderside, -trimStart);
    handrailMesh.castShadow = true;
    segGroup.add(handrailMesh);

    // Spindles (< 100 mm clear horizontal gap)
    const segSpindleCount = Math.max(
      1,
      Math.ceil((clearLen - maxAllowedGap) / (SPINDLE_WIDTH_M + maxAllowedGap))
    );
    const clearGap = (clearLen - segSpindleCount * SPINDLE_WIDTH_M) / (segSpindleCount + 1);
    if (clearGap > maxSpindleClearGapM) maxSpindleClearGapM = clearGap;

    const ySpindleBot = segY + EPS + SHOE_RAIL_HEIGHT_M + EPS;
    const ySpindleTop = yHandrailUnderside - EPS;

    for (let k = 0; k < segSpindleCount; k++) {
      const sc = trimStart + clearGap * (k + 1) + SPINDLE_WIDTH_M * (k + 0.5);
      const spindle = createSpindleObject(
        ySpindleBot,
        ySpindleTop,
        0,
        0,
        spindleStyle,
        balustradeMat,
        `${baseName}.spindle_${segIdx}_${k}`
      );
      spindle.position.set(0, 0, -sc);
      segGroup.add(spindle);
      spindleCount++;
    }
  }

  ensureNamedAddedChildren(group, 0, baseName);
  group.updateMatrixWorld(true);

  return {
    group,
    maxSpindleClearGapM,
    spindleCount,
    newelCount,
  };
}
