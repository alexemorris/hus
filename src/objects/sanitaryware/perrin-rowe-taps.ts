import * as THREE from 'three';
import { attachAssetInteraction, attachAssetMetadata, formatBrasswareFinishLabel } from '../shared/catalog-smart-metadata.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import {
  finalizeSanitaryGroup,
  getBathroomBrassMaterials,
  getBlackPorcelainMaterial,
  getVitreousChinaMaterial,
} from './bathroom-materials.ts';
import type {
  BathroomMetalMaterialPalette,
  BrasswareFinishCode,
  PerrinRoweBasinLeverStyle,
  PerrinRoweBasinTapCollection,
  PerrinRoweBasinTapMount,
  PerrinRoweBasinTapOptions,
  PerrinRoweBasinTapSpec,
  PerrinRoweKitchenLeverStyle,
  PerrinRoweKitchenTapModel,
  PerrinRoweKitchenTapOptions,
  PerrinRoweKitchenTapSpec,
  TapMountAnchor,
} from './bathroom-spec-types.ts';

/**
 * WeakMap registry storing `TapMountAnchor` metadata per fixture root `THREE.Object3D`
 * without mutating `fixture.userData` (preserving 100% 0-byte scene snapshot stability
 * on existing homes while enabling `getTapMountAnchor` & `mountTapOnFixture` everywhere).
 */
const tapMountAnchorRegistry = new WeakMap<THREE.Object3D, TapMountAnchor>();
const tapMountKindRegistry = new WeakMap<THREE.Object3D, PerrinRoweBasinTapMount | 'bridge-deck' | 'wall-bridge'>();

export function isCustomTapObject3D(
  val: PerrinRoweBasinTapSpec | PerrinRoweKitchenTapSpec | THREE.Object3D
): val is THREE.Object3D {
  return 'isObject3D' in val && Boolean((val as THREE.Object3D).isObject3D);
}

export function registerTapMountAnchor(fixture: THREE.Object3D, anchor: TapMountAnchor): void {
  tapMountAnchorRegistry.set(fixture, anchor);
}

export function getTapMountAnchor(fixture: THREE.Object3D): TapMountAnchor | null {
  const registered = tapMountAnchorRegistry.get(fixture);
  if (registered) return registered;
  const ud = fixture.userData as { tapMountAnchor?: TapMountAnchor } | undefined;
  return ud?.tapMountAnchor ?? null;
}

/**
 * Mounts any `tap` (`THREE.Object3D`, e.g. from `buildPerrinRoweBasinTap` or `buildPerrinRoweKitchenTap`)
 * onto a sanitaryware/joinery `fixture` using its registered `TapMountAnchor`.
 */
export function mountTapOnFixture(
  fixture: THREE.Object3D,
  tap: THREE.Object3D,
  mountKind?: 'deck' | 'wall'
): THREE.Object3D {
  const anchor = getTapMountAnchor(fixture);
  if (!anchor) {
    fixture.add(tap);
    return tap;
  }
  const detectedTapMount = tapMountKindRegistry.get(tap);
  const useWall =
    mountKind === 'wall' ||
    (mountKind === undefined &&
      (detectedTapMount === '2-hole-wall' || detectedTapMount === 'wall-bridge'));
  const targetPos =
    useWall && anchor.wallPosition ? anchor.wallPosition : anchor.deckPosition;

  tap.position.set(targetPos[0], targetPos[1], targetPos[2]);
  tap.rotation.y = anchor.rotationY;
  fixture.add(tap);
  return tap;
}

// ---------------------------------------------------------------------------
// Shared Geometric Primitives (Collection-Accurate Collars, Spouts & Handles)
// ---------------------------------------------------------------------------

const OCT_AF_TO_RADIUS = 1 / (2 * Math.cos(Math.PI / 8));

function createOctagonalFrustumY(
  afBottomM: number,
  afTopM: number,
  heightM: number
): THREE.BufferGeometry {
  const rBottom = afBottomM * OCT_AF_TO_RADIUS;
  const rTop = afTopM * OCT_AF_TO_RADIUS;
  const cyl = new THREE.CylinderGeometry(rTop, rBottom, heightM, 8, 1, false);
  cyl.rotateY(Math.PI / 8);
  const faceted = cyl.toNonIndexed();
  cyl.dispose();
  faceted.computeVertexNormals();
  return prepGeo(faceted);
}

function createOctagonalFrustumZ(
  afWallM: number,
  afFrontM: number,
  depthM: number
): THREE.BufferGeometry {
  const geo = createOctagonalFrustumY(afWallM, afFrontM, depthM);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, depthM * 0.5);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function createSteppedCircularRoseGeometry(
  outerRadius: number,
  innerBossRadius: number,
  totalDepth: number
): THREE.LatheGeometry {
  const stepR = outerRadius * 0.8;
  const d1 = totalDepth * 0.46;
  const d2 = totalDepth * 0.56;
  const pts = [
    new THREE.Vector2(innerBossRadius * 0.85, 0),
    new THREE.Vector2(outerRadius, 0),
    new THREE.Vector2(outerRadius, d1 * 0.82),
    new THREE.Vector2(outerRadius - 0.0014, d1),
    new THREE.Vector2(stepR + 0.0012, d2),
    new THREE.Vector2(stepR, totalDepth * 0.9),
    new THREE.Vector2(stepR - 0.0012, totalDepth),
    new THREE.Vector2(innerBossRadius, totalDepth),
  ];
  return prepGeo(new THREE.LatheGeometry(pts, 28));
}

function createTurnedBalusterRoseGeometry(
  outerRadius: number,
  innerBossRadius: number,
  totalDepth: number
): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(innerBossRadius * 0.85, 0),
    new THREE.Vector2(outerRadius, 0),
    new THREE.Vector2(outerRadius, totalDepth * 0.24),
    new THREE.Vector2(outerRadius * 0.86, totalDepth * 0.42),
    new THREE.Vector2(outerRadius * 0.78, totalDepth * 0.68),
    new THREE.Vector2(innerBossRadius * 1.18, totalDepth * 0.88),
    new THREE.Vector2(innerBossRadius, totalDepth),
  ];
  return prepGeo(new THREE.LatheGeometry(pts, 28));
}

function buildHorizontalToDownwardArmCurve(
  startY: number,
  startZ: number,
  reachZ: number,
  bendRadius: number,
  endY: number
): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const r = Math.min(
    bendRadius,
    Math.max(0.008, (reachZ - startZ) * 0.48),
    Math.max(0.008, (startY - endY) * 0.85)
  );
  const tangentZ = reachZ - r;
  const arcCenterY = startY - r;

  if (tangentZ > startZ + 0.001) {
    path.add(
      new THREE.LineCurve3(
        new THREE.Vector3(0, startY, startZ),
        new THREE.Vector3(0, startY, tangentZ)
      )
    );
  }

  const k = 0.5522847498 * r * 0.5;
  const midAngle = Math.PI * 0.25;
  const sin45 = Math.sin(midAngle);
  const cos45 = Math.cos(midAngle);
  const p0 = new THREE.Vector3(0, startY, tangentZ);
  const pMid = new THREE.Vector3(0, arcCenterY + r * cos45, tangentZ + r * sin45);
  const pEnd = new THREE.Vector3(0, arcCenterY, reachZ);

  const t45Y = -sin45;
  const t45Z = cos45;
  path.add(
    new THREE.CubicBezierCurve3(
      p0,
      new THREE.Vector3(0, startY, tangentZ + k * 0.92),
      new THREE.Vector3(0, pMid.y - t45Y * k * 0.92, pMid.z - t45Z * k * 0.92),
      pMid
    )
  );
  path.add(
    new THREE.CubicBezierCurve3(
      pMid,
      new THREE.Vector3(0, pMid.y + t45Y * k * 0.92, pMid.z + t45Z * k * 0.92),
      new THREE.Vector3(0, arcCenterY + k * 0.92, reachZ),
      pEnd
    )
  );

  if (arcCenterY > endY + 0.001) {
    path.add(
      new THREE.LineCurve3(
        new THREE.Vector3(0, arcCenterY, reachZ),
        new THREE.Vector3(0, endY, reachZ)
      )
    );
  }
  return path;
}

function resolveBasinLeverStyle(
  collection: PerrinRoweBasinTapCollection,
  leverStyle?: PerrinRoweBasinLeverStyle
): 'metal' | 'whitePorcelain' | 'blackPorcelain' | 'crosshead' {
  if (leverStyle === 'porcelain') return 'whitePorcelain';
  if (leverStyle) return leverStyle;
  if (collection === 'traditional') return 'whitePorcelain';
  if (collection === 'deco') return 'crosshead';
  return 'metal';
}

function resolveKitchenLeverStyle(
  model: PerrinRoweKitchenTapModel,
  leverStyle?: PerrinRoweKitchenLeverStyle
): 'whitePorcelain' | 'blackPorcelain' | 'metal' {
  if (leverStyle === 'porcelain') return 'whitePorcelain';
  if (leverStyle) return leverStyle;
  if (model === 'armstrong-bridge' || model === 'monobloc-swan') return 'metal';
  return 'whitePorcelain';
}

function buildCrossheadHandle(
  namePrefix: string,
  collection: PerrinRoweBasinTapCollection,
  mats: BathroomMetalMaterialPalette,
  spanM: number,
  axis: 'Y' | 'Z'
): THREE.Group {
  const group = new THREE.Group();
  group.name = namePrefix;

  const core = new THREE.Group();
  core.name = `${namePrefix}.core`;

  const isDeco = collection === 'deco';
  const hubGeo = isDeco
    ? createOctagonalFrustumY(0.024, 0.021, 0.015)
    : prepGeo(new THREE.CylinderGeometry(0.0115, 0.0125, 0.015, 22));
  const hub = new THREE.Mesh(hubGeo, mats.primary);
  hub.name = `${namePrefix}.hub`;
  core.add(hub);

  const indice = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0058, 0.0058, 0.002, 16)),
    getVitreousChinaMaterial()
  );
  indice.name = `${namePrefix}.ceramicIndice`;
  indice.position.y = 0.0088;
  core.add(indice);

  const spokeStartR = 0.01;
  const spokeLen = Math.max(0.015, spanM * 0.5 - spokeStartR - 0.003);
  const spokeGeo = isDeco
    ? createOctagonalFrustumY(0.01, 0.0132, spokeLen)
    : prepGeo(new THREE.CylinderGeometry(0.0056, 0.0044, spokeLen, 16));
  const capGeo = isDeco
    ? createOctagonalFrustumY(0.0132, 0.009, 0.0035)
    : prepGeo(new THREE.SphereGeometry(0.006, 14, 10));

  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.name = `${namePrefix}.spoke.${i}`;
    arm.rotation.y = (i * Math.PI) / 2;

    const shaft = new THREE.Mesh(spokeGeo, mats.primary);
    shaft.name = `${namePrefix}.spokeShaft.${i}`;
    shaft.rotation.z = -Math.PI * 0.5;
    shaft.position.x = spokeStartR + spokeLen * 0.5;
    arm.add(shaft);

    const cap = new THREE.Mesh(
      capGeo,
      collection === 'armstrong' ? mats.knurled : mats.primary
    );
    cap.name = `${namePrefix}.spokeCap.${i}`;
    if (isDeco) cap.rotation.z = -Math.PI * 0.5;
    cap.position.x = spokeStartR + spokeLen + (isDeco ? 0.0018 : 0.002);
    arm.add(cap);

    core.add(arm);
  }

  if (axis === 'Z') {
    core.rotation.x = Math.PI * 0.5;
  }
  group.add(core);
  return group;
}

function addHorizontalLeverHandle(
  parent: THREE.Group,
  namePrefix: string,
  collection: PerrinRoweBasinTapCollection,
  leverStyle: 'metal' | 'whitePorcelain' | 'blackPorcelain',
  mats: BathroomMetalMaterialPalette,
  signX: -1 | 1,
  yPos: number,
  zPos = 0
): void {
  const stem = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0056, 0.007, 0.018, 16)),
    mats.primary
  );
  stem.name = `${namePrefix}.leverStem`;
  stem.rotation.z = -signX * Math.PI * 0.5;
  stem.position.set(signX * 0.021, yPos, zPos);
  parent.add(stem);

  const isPorcelain = leverStyle === 'whitePorcelain' || leverStyle === 'blackPorcelain';
  const gripMat =
    leverStyle === 'whitePorcelain'
      ? getVitreousChinaMaterial()
      : leverStyle === 'blackPorcelain'
        ? getBlackPorcelainMaterial()
        : mats.primary;

  const gripGeo = isPorcelain
    ? prepGeo(
        new THREE.LatheGeometry(
          [
            new THREE.Vector2(0.0055, -0.023),
            new THREE.Vector2(0.008, -0.015),
            new THREE.Vector2(0.0104, -0.002),
            new THREE.Vector2(0.0108, 0.01),
            new THREE.Vector2(0.009, 0.019),
            new THREE.Vector2(0.0056, 0.023),
          ],
          20
        )
      )
    : collection === 'deco'
      ? createOctagonalFrustumY(0.011, 0.013, 0.046)
      : prepGeo(new THREE.CylinderGeometry(0.0056, 0.005, 0.046, 18));

  const grip = new THREE.Mesh(gripGeo, gripMat);
  grip.name = `${namePrefix}.leverGrip`;
  grip.rotation.z = -signX * Math.PI * 0.5;
  grip.position.set(signX * 0.053, yPos, zPos);
  parent.add(grip);

  const tipMat = collection === 'armstrong' ? mats.knurled : mats.primary;
  const tipGeo = isPorcelain
    ? prepGeo(new THREE.SphereGeometry(0.0056, 14, 10))
    : collection === 'deco'
      ? createOctagonalFrustumY(0.013, 0.0095, 0.007)
      : prepGeo(new THREE.CylinderGeometry(0.006, 0.006, 0.008, 18));
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.name = `${namePrefix}.leverFinial`;
  if (!isPorcelain) tip.rotation.z = -signX * Math.PI * 0.5;
  tip.position.set(signX * (isPorcelain ? 0.08 : 0.079), yPos, zPos);
  parent.add(tip);
}

/**
 * Builds a matching Perrin & Rowe `1 1/4"` slotted or unslotted click-clack basin waste
 * (`Ø63 mm` flange + domed mushroom plug, local origin at bowl waste seat `y = 0`).
 */
export function buildPerrinRoweBasinWaste(opts: {
  readonly namePrefix?: string;
  readonly finish: BrasswareFinishCode;
  readonly slotted?: boolean;
}): THREE.Group {
  const p = opts.namePrefix ?? 'perrinRoweBasinWaste';
  const mats = getBathroomBrassMaterials(opts.finish);
  const slotted = opts.slotted ?? true;

  const group = new THREE.Group();
  group.name = p;

  const flange = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0315, 0.025, 0.0036, 28)),
    mats.primary
  );
  flange.name = `${p}.wasteFlange`;
  flange.position.y = 0.0018;
  group.add(flange);

  const throat = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.0032, 24)),
    mats.darkShadow
  );
  throat.name = `${p}.wasteShadowGap`;
  throat.position.y = 0.0044;
  group.add(throat);

  const domePts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.021, 0),
    new THREE.Vector2(0.021, 0.003),
    new THREE.Vector2(0.015, 0.0058),
    new THREE.Vector2(0, 0.0072),
  ];
  const dome = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(domePts, 28)), mats.primary);
  dome.name = `${p}.clickClackDomePlug`;
  dome.position.y = 0.0062;
  group.add(dome);

  if (slotted) {
    const tailSlot = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.019, 0.019, 0.026, 20)),
      mats.primary
    );
    tailSlot.name = `${p}.slottedTailpiece`;
    tailSlot.position.y = -0.0135;
    group.add(tailSlot);
  }

  return group;
}

// ---------------------------------------------------------------------------
// 1. Unified Parametric Perrin & Rowe Basin Tap Dispatcher
// ---------------------------------------------------------------------------

function addDeckBaseCollar(
  parent: THREE.Group,
  namePrefix: string,
  collection: PerrinRoweBasinTapCollection,
  mats: BathroomMetalMaterialPalette,
  outerRadius: number,
  bodyRadius: number
): number {
  if (collection === 'deco') {
    const lower = new THREE.Mesh(
      createOctagonalFrustumY(outerRadius * 2, outerRadius * 1.92, 0.01),
      mats.primary
    );
    lower.name = `${namePrefix}.octPlinth`;
    lower.position.y = 0.005;
    parent.add(lower);

    const step = new THREE.Mesh(
      createOctagonalFrustumY(outerRadius * 1.66, bodyRadius * 2.08, 0.008),
      mats.primary
    );
    step.name = `${namePrefix}.octPlinthStep`;
    step.position.y = 0.0145;
    parent.add(step);
    return 0.019;
  }

  const roseGeo =
    collection === 'traditional'
      ? createTurnedBalusterRoseGeometry(outerRadius, bodyRadius, 0.014)
      : createSteppedCircularRoseGeometry(outerRadius, bodyRadius, 0.012);
  const plinth = new THREE.Mesh(roseGeo, mats.primary);
  plinth.name = `${namePrefix}.deckPlinth`;
  parent.add(plinth);

  if (collection === 'armstrong') {
    const knurl = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(bodyRadius * 1.04, bodyRadius * 1.04, 0.015, 28)),
      mats.knurled
    );
    knurl.name = `${namePrefix}.knurledCollar`;
    knurl.position.y = 0.02;
    parent.add(knurl);
    return 0.028;
  }

  if (collection === 'traditional') {
    const ring = new THREE.Mesh(
      prepGeo(new THREE.TorusGeometry(bodyRadius * 1.08, 0.0028, 10, 24)),
      mats.primary
    );
    ring.name = `${namePrefix}.balusterNeckRing`;
    ring.rotation.x = Math.PI * 0.5;
    ring.position.y = 0.018;
    parent.add(ring);
    return 0.021;
  }

  // 'langbourn': sleek stepped mid-century collar
  const stepRing = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(bodyRadius * 1.06, bodyRadius * 1.12, 0.009, 26)),
    mats.primary
  );
  stepRing.name = `${namePrefix}.steppedCollar`;
  stepRing.position.y = 0.017;
  parent.add(stepRing);
  return 0.022;
}

function addSwanOrDecoDeckSpout(
  spoutGroup: THREE.Group,
  namePrefix: string,
  collection: PerrinRoweBasinTapCollection,
  mats: BathroomMetalMaterialPalette,
  collarTopY: number,
  spoutReachM: number,
  includePopUpRod: boolean
): void {
  if (collection === 'deco') {
    const colH = 0.072;
    const bodyColumn = new THREE.Mesh(
      createOctagonalFrustumY(0.042, 0.032, colH),
      mats.primary
    );
    bodyColumn.name = `${namePrefix}.spoutColumn`;
    bodyColumn.position.y = collarTopY + colH * 0.5 + 0.0005;
    spoutGroup.add(bodyColumn);

    const topCap = new THREE.Mesh(
      createOctagonalFrustumY(0.033, 0.024, 0.009),
      mats.primary
    );
    topCap.name = `${namePrefix}.spoutTopCap`;
    topCap.position.y = collarTopY + colH + 0.0055;
    spoutGroup.add(topCap);

    const armLen = Math.max(0.06, spoutReachM - 0.016);
    const arm = new THREE.Mesh(
      createOctagonalFrustumY(0.025, 0.021, armLen),
      mats.primary
    );
    arm.name = `${namePrefix}.facetedSpoutArm`;
    arm.rotation.x = Math.PI * 0.5 - 0.05;
    arm.position.set(0, collarTopY + 0.058, 0.016 + armLen * 0.5);
    spoutGroup.add(arm);

    const nozzle = new THREE.Mesh(
      createOctagonalFrustumY(0.021, 0.023, 0.013),
      mats.primary
    );
    nozzle.name = `${namePrefix}.nozzleCuff`;
    nozzle.position.set(0, collarTopY + 0.047, spoutReachM);
    spoutGroup.add(nozzle);

    const aerator = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0085, 0.0085, 0.0025, 16)),
      mats.darkShadow
    );
    aerator.name = `${namePrefix}.aerator`;
    aerator.position.set(0, collarTopY + 0.039, spoutReachM);
    spoutGroup.add(aerator);
  } else {
    const shoulder = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.012, 0.0155, 0.006, 24)),
      mats.primary
    );
    shoulder.name = `${namePrefix}.shoulder`;
    shoulder.position.y = collarTopY + 0.0035;
    spoutGroup.add(shoulder);

    const baseY = collarTopY + 0.006;
    const swanPts = [
      new THREE.Vector3(0, baseY, 0),
      new THREE.Vector3(0, baseY + 0.062, 0),
      new THREE.Vector3(0, baseY + 0.112, 0.005),
      new THREE.Vector3(0, baseY + 0.148, spoutReachM * 0.22),
      new THREE.Vector3(0, baseY + 0.162, spoutReachM * 0.52),
      new THREE.Vector3(0, baseY + 0.148, spoutReachM * 0.82),
      new THREE.Vector3(0, baseY + 0.114, spoutReachM * 0.96),
      new THREE.Vector3(0, baseY + 0.09, spoutReachM),
    ];
    const swanCurve = new THREE.CatmullRomCurve3(swanPts, false, 'centripetal');
    const swanTube = new THREE.Mesh(
      prepGeo(new THREE.TubeGeometry(swanCurve, 34, 0.011, 20, false)),
      mats.primary
    );
    swanTube.name = `${namePrefix}.swanNeckTube`;
    spoutGroup.add(swanTube);

    const nozzlePivot = new THREE.Group();
    nozzlePivot.name = `${namePrefix}.nozzle`;
    nozzlePivot.position.set(0, baseY + 0.09, spoutReachM);
    nozzlePivot.rotation.x = -0.2;
    spoutGroup.add(nozzlePivot);

    const bezelMat = collection === 'armstrong' ? mats.knurled : mats.primary;
    const bezelGeo =
      collection === 'traditional'
        ? prepGeo(new THREE.CylinderGeometry(0.0115, 0.0148, 0.012, 24))
        : prepGeo(new THREE.CylinderGeometry(0.0128, 0.0124, 0.011, 24));
    const bezel = new THREE.Mesh(bezelGeo, bezelMat);
    bezel.name = `${namePrefix}.nozzleBezel`;
    bezel.position.y = -0.0045;
    nozzlePivot.add(bezel);

    const aerator = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.002, 20)),
      mats.darkShadow
    );
    aerator.name = `${namePrefix}.aerator`;
    aerator.position.y = -0.0112;
    nozzlePivot.add(aerator);
  }

  if (includePopUpRod) {
    const rodZ = -0.022;
    const guide = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0058, 0.0068, 0.015, 16)),
      mats.primary
    );
    guide.name = `${namePrefix}.popUpRodGuide`;
    guide.position.set(0, 0.008, rodZ);
    spoutGroup.add(guide);

    const rod = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0028, 0.0028, 0.064, 12)),
      mats.primary
    );
    rod.name = `${namePrefix}.popUpLiftRod`;
    rod.position.set(0, 0.048, rodZ);
    spoutGroup.add(rod);

    const knobGeo =
      collection === 'deco'
        ? createOctagonalFrustumY(0.011, 0.014, 0.013)
        : prepGeo(new THREE.CylinderGeometry(0.0072, 0.0054, 0.013, 18));
    const knob = new THREE.Mesh(
      knobGeo,
      collection === 'armstrong' ? mats.knurled : mats.primary
    );
    knob.name = `${namePrefix}.popUpLiftKnob`;
    knob.position.set(0, 0.087, rodZ);
    spoutGroup.add(knob);
  }
}

function addWallRoseAndCollar(
  parent: THREE.Group,
  namePrefix: string,
  collection: PerrinRoweBasinTapCollection,
  mats: BathroomMetalMaterialPalette,
  outerRadius: number,
  bodyRadius: number
): number {
  if (collection === 'deco') {
    const rose = new THREE.Mesh(
      createOctagonalFrustumZ(outerRadius * 2, outerRadius * 1.82, 0.011),
      mats.primary
    );
    rose.name = `${namePrefix}.octWallRose`;
    parent.add(rose);

    const collar = new THREE.Mesh(
      createOctagonalFrustumZ(outerRadius * 1.5, bodyRadius * 2.05, 0.014),
      mats.primary
    );
    collar.name = `${namePrefix}.octCollar`;
    collar.position.z = 0.0115;
    parent.add(collar);
    return 0.026;
  }

  const roseGeo =
    collection === 'traditional'
      ? createTurnedBalusterRoseGeometry(outerRadius, bodyRadius, 0.014)
      : createSteppedCircularRoseGeometry(outerRadius, bodyRadius, 0.012);
  const rose = new THREE.Mesh(roseGeo, mats.primary);
  rose.name = `${namePrefix}.wallRose`;
  rose.rotation.x = Math.PI * 0.5;
  parent.add(rose);

  if (collection === 'armstrong') {
    const knurl = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(bodyRadius * 1.02, bodyRadius * 1.02, 0.016, 26)),
      mats.knurled
    );
    knurl.name = `${namePrefix}.knurledCollar`;
    knurl.rotation.x = Math.PI * 0.5;
    knurl.position.z = 0.0205;
    parent.add(knurl);
    return 0.029;
  }

  const step = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(bodyRadius * 1.04, bodyRadius * 1.12, 0.01, 24)),
    mats.primary
  );
  step.name = `${namePrefix}.steppedCollar`;
  step.rotation.x = Math.PI * 0.5;
  step.position.z = 0.0195;
  parent.add(step);
  return 0.025;
}

/**
 * Builds a parametric Perrin & Rowe basin mixer across all 4 collections
 * (`'armstrong' | 'traditional' | 'langbourn' | 'deco'`), 3 mounting styles
 * (`'3-hole-deck' | 'monobloc-deck' | '2-hole-wall'`), 4 handle styles, and all 9 metal finishes.
 *
 * Coordinate convention:
 * - Deck mounts (`'3-hole-deck'`, `'monobloc-deck'`): `y = 0` sits on the tap deck; spout projects along `+Z`.
 * - Wall mount (`'2-hole-wall'`): `z = 0` sits flush on the finished wall; spout projects along `+Z`, `+Y` is up.
 */
export function buildPerrinRoweBasinTap(opts: PerrinRoweBasinTapOptions): THREE.Group {
  const p = opts.namePrefix ?? `perrinRowe.${opts.collection}.${opts.mount}.${opts.finish}`;
  const { collection, mount, finish } = opts;
  const leverStyle = resolveBasinLeverStyle(collection, opts.leverStyle);
  const mats = getBathroomBrassMaterials(finish);
  const chinaMat = getVitreousChinaMaterial();

  const root = new THREE.Group();
  root.name = p;
  tapMountKindRegistry.set(root, mount);

  if (mount === '3-hole-deck') {
    const spreadM = opts.holeSpreadM ?? 0.2;
    const spoutReachM = opts.spoutReachM ?? 0.135;
    const halfSpread = spreadM * 0.5;

    const spoutGroup = new THREE.Group();
    spoutGroup.name = `${p}.centreSpout`;
    root.add(spoutGroup);

    const spoutCollarTopY = addDeckBaseCollar(
      spoutGroup,
      spoutGroup.name,
      collection,
      mats,
      0.026,
      0.0165
    );
    addSwanOrDecoDeckSpout(
      spoutGroup,
      spoutGroup.name,
      collection,
      mats,
      spoutCollarTopY,
      spoutReachM,
      true
    );

    for (const [vTag, signX] of [
      ['hotValve', -1],
      ['coldValve', 1],
    ] as const) {
      const vGroup = new THREE.Group();
      vGroup.name = `${p}.${vTag}`;
      vGroup.position.set(signX * halfSpread, 0, 0);
      root.add(vGroup);

      const collarTopY = addDeckBaseCollar(
        vGroup,
        vGroup.name,
        collection,
        mats,
        0.0245,
        0.016
      );

      const bodyH = 0.036;
      const bodyGeo =
        collection === 'deco'
          ? createOctagonalFrustumY(0.034, 0.025, bodyH)
          : prepGeo(new THREE.CylinderGeometry(0.0155, 0.0162, bodyH, 24));
      const body = new THREE.Mesh(bodyGeo, mats.primary);
      body.name = `${vGroup.name}.valveBody`;
      body.position.y = collarTopY + bodyH * 0.5 + 0.0005;
      vGroup.add(body);

      if (collection === 'armstrong') {
        const knurlBand = new THREE.Mesh(
          prepGeo(new THREE.CylinderGeometry(0.0176, 0.0176, 0.013, 26)),
          mats.knurled
        );
        knurlBand.name = `${vGroup.name}.upperKnurlBand`;
        knurlBand.position.y = collarTopY + bodyH * 0.62;
        vGroup.add(knurlBand);
      }

      const topY = collarTopY + bodyH + 0.001;
      if (leverStyle === 'crosshead') {
        const stem = new THREE.Mesh(
          prepGeo(new THREE.CylinderGeometry(0.0075, 0.0085, 0.014, 16)),
          mats.primary
        );
        stem.name = `${vGroup.name}.stem`;
        stem.position.y = topY + 0.007;
        vGroup.add(stem);

        const cross = buildCrossheadHandle(
          `${vGroup.name}.crosshead`,
          collection,
          mats,
          0.074,
          'Y'
        );
        cross.position.y = topY + 0.022;
        vGroup.add(cross);
      } else {
        const capPts = [
          new THREE.Vector2(0.0155, 0),
          new THREE.Vector2(0.0145, 0.0045),
          new THREE.Vector2(0.01, 0.0085),
          new THREE.Vector2(0, 0.0095),
        ];
        const cap = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(capPts, 20)), mats.primary);
        cap.name = `${vGroup.name}.domeCap`;
        cap.position.y = topY;
        vGroup.add(cap);

        if (collection === 'traditional' || leverStyle !== 'metal') {
          const idxDisc = new THREE.Mesh(
            prepGeo(new THREE.CylinderGeometry(0.0072, 0.0076, 0.002, 18)),
            chinaMat
          );
          idxDisc.name = `${vGroup.name}.ceramicIndex`;
          idxDisc.position.y = topY + 0.0108;
          vGroup.add(idxDisc);
        }

        addHorizontalLeverHandle(
          vGroup,
          vGroup.name,
          collection,
          leverStyle,
          mats,
          signX,
          collarTopY + bodyH * 0.72
        );
      }
    }
  } else if (mount === 'monobloc-deck') {
    const spoutReachM = opts.spoutReachM ?? 0.13;

    const bodyGroup = new THREE.Group();
    bodyGroup.name = `${p}.monoblocBody`;
    root.add(bodyGroup);

    const collarTopY = addDeckBaseCollar(
      bodyGroup,
      bodyGroup.name,
      collection,
      mats,
      0.028,
      0.021
    );

    const bodyH = 0.072;
    const bodyGeo =
      collection === 'deco'
        ? createOctagonalFrustumY(0.044, 0.036, bodyH)
        : prepGeo(new THREE.CylinderGeometry(0.0195, 0.021, bodyH, 26));
    const body = new THREE.Mesh(bodyGeo, mats.primary);
    body.name = `${bodyGroup.name}.turret`;
    body.position.y = collarTopY + bodyH * 0.5 + 0.0005;
    bodyGroup.add(body);

    const turretTopY = collarTopY + bodyH + 0.001;
    addSwanOrDecoDeckSpout(
      bodyGroup,
      `${p}.spout`,
      collection,
      mats,
      turretTopY,
      spoutReachM,
      true
    );

    // Side control(s) on monobloc body
    if (leverStyle === 'crosshead') {
      for (const [sideTag, signX] of [
        ['hotCrosshead', -1],
        ['coldCrosshead', 1],
      ] as const) {
        const boss = new THREE.Mesh(
          prepGeo(new THREE.CylinderGeometry(0.009, 0.0105, 0.018, 16)),
          mats.primary
        );
        boss.name = `${p}.${sideTag}Boss`;
        boss.rotation.z = -signX * Math.PI * 0.5;
        boss.position.set(signX * 0.028, collarTopY + bodyH * 0.55, 0);
        bodyGroup.add(boss);

        const cross = buildCrossheadHandle(
          `${p}.${sideTag}`,
          collection,
          mats,
          0.062,
          'Y'
        );
        cross.rotation.z = -signX * Math.PI * 0.5;
        cross.position.set(signX * 0.045, collarTopY + bodyH * 0.55, 0);
        bodyGroup.add(cross);
      }
    } else {
      addHorizontalLeverHandle(
        bodyGroup,
        `${p}.sideMixerLever`,
        collection,
        leverStyle,
        mats,
        1,
        collarTopY + bodyH * 0.56
      );
    }
  } else {
    // '2-hole-wall'
    const leverOffsetXM = opts.holeSpreadM ?? 0.105;
    const spoutReachM = opts.spoutReachM ?? 0.177;

    const spoutGroup = new THREE.Group();
    spoutGroup.name = `${p}.wallSpout`;
    root.add(spoutGroup);

    const spoutCollarZ = addWallRoseAndCollar(
      spoutGroup,
      spoutGroup.name,
      collection,
      mats,
      0.0275,
      0.0165
    );

    if (collection === 'deco') {
      const armLen = Math.max(0.08, spoutReachM - spoutCollarZ - 0.012);
      const arm = new THREE.Mesh(
        createOctagonalFrustumZ(0.026, 0.022, armLen),
        mats.primary
      );
      arm.name = `${spoutGroup.name}.facetedArm`;
      arm.position.z = spoutCollarZ + 0.0005;
      spoutGroup.add(arm);

      const drop = new THREE.Mesh(
        createOctagonalFrustumY(0.022, 0.024, 0.032),
        mats.primary
      );
      drop.name = `${spoutGroup.name}.nozzleDrop`;
      drop.position.set(0, -0.012, spoutReachM);
      spoutGroup.add(drop);

      const aerator = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.0088, 0.0088, 0.0025, 16)),
        mats.darkShadow
      );
      aerator.name = `${spoutGroup.name}.aerator`;
      aerator.position.set(0, -0.0295, spoutReachM);
      spoutGroup.add(aerator);
    } else {
      const shoulder = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.0125, 0.0155, 0.006, 24)),
        mats.primary
      );
      shoulder.name = `${spoutGroup.name}.shoulder`;
      shoulder.rotation.x = Math.PI * 0.5;
      shoulder.position.z = spoutCollarZ + 0.0035;
      spoutGroup.add(shoulder);

      const spoutCurve = buildHorizontalToDownwardArmCurve(
        0,
        spoutCollarZ + 0.006,
        spoutReachM,
        0.034,
        -0.034
      );
      const spoutTube = new THREE.Mesh(
        prepGeo(new THREE.TubeGeometry(spoutCurve, 28, 0.012, 20, false)),
        mats.primary
      );
      spoutTube.name = `${spoutGroup.name}.spoutTube`;
      spoutGroup.add(spoutTube);

      const cuff = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.0134, 0.013, 0.01, 24)),
        collection === 'armstrong' ? mats.knurled : mats.primary
      );
      cuff.name = `${spoutGroup.name}.nozzleCuff`;
      cuff.position.set(0, -0.0395, spoutReachM);
      spoutGroup.add(cuff);

      const aerator = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.0092, 0.0092, 0.002, 20)),
        mats.darkShadow
      );
      aerator.name = `${spoutGroup.name}.aerator`;
      aerator.position.set(0, -0.0458, spoutReachM);
      spoutGroup.add(aerator);
    }

    const valveGroup = new THREE.Group();
    valveGroup.name = `${p}.wallMixerValve`;
    valveGroup.position.set(leverOffsetXM, 0, 0);
    root.add(valveGroup);

    const valveCollarZ = addWallRoseAndCollar(
      valveGroup,
      valveGroup.name,
      collection,
      mats,
      0.024,
      0.0175
    );

    const bodyLen = 0.036;
    const bodyGeo =
      collection === 'deco'
        ? createOctagonalFrustumZ(0.034, 0.028, bodyLen)
        : prepGeo(new THREE.CylinderGeometry(0.0175, 0.0175, bodyLen, 26));
    const body = new THREE.Mesh(bodyGeo, mats.primary);
    body.name = `${valveGroup.name}.body`;
    if (collection !== 'deco') {
      body.rotation.x = Math.PI * 0.5;
      body.position.z = valveCollarZ + bodyLen * 0.5 + 0.0005;
    } else {
      body.position.z = valveCollarZ + 0.0005;
    }
    valveGroup.add(body);

    const frontZ = valveCollarZ + bodyLen + 0.001;
    if (leverStyle === 'crosshead') {
      const cross = buildCrossheadHandle(
        `${valveGroup.name}.crosshead`,
        collection,
        mats,
        0.074,
        'Z'
      );
      cross.position.z = frontZ + 0.008;
      valveGroup.add(cross);
    } else {
      const cap = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.015, 0.0175, 0.008, 22)),
        mats.primary
      );
      cap.name = `${valveGroup.name}.frontCap`;
      cap.rotation.x = Math.PI * 0.5;
      cap.position.z = frontZ + 0.0045;
      valveGroup.add(cap);

      addHorizontalLeverHandle(
        valveGroup,
        valveGroup.name,
        collection,
        leverStyle,
        mats,
        1,
        0,
        valveCollarZ + bodyLen * 0.65
      );
    }
  }

  if (opts.includeWaste) {
    const waste = buildPerrinRoweBasinWaste({
      namePrefix: `${p}.basinWaste`,
      finish,
      slotted: opts.slottedWaste ?? true,
    });
    waste.position.set(0, mount === '2-hole-wall' ? -0.215 : -0.155, opts.spoutReachM ?? 0.135);
    root.add(waste);
  }

  attachAssetInteraction(root, {
    kind: 'toggle',
    label: 'Turn On Basin Tap',
    activeLabel: 'Turn Off Basin Tap',
    audio: {
      openPreset: 'tapValveTurn', closePreset: 'tapValveTurn',
      activeLoopPreset: 'waterTapFlow',
      volume: 0.65,
    },
  });
  const colName = collection.charAt(0).toUpperCase() + collection.slice(1);
  return attachAssetMetadata(finalizeSanitaryGroup(root, 'plumbing'), {
    name: `Perrin & Rowe ${colName} ${mount === '3-hole-deck' ? '3-Hole Deck' : mount === '2-hole-wall' ? '2-Hole Wall' : 'Monobloc'} Basin Mixer`,
    brand: 'Perrin & Rowe',
    collection: colName,
    sku: `PR-${collection.slice(0, 3).toUpperCase()}-BSN-${finish}`,
    finish: formatBrasswareFinishLabel(finish),
    category: 'sanitaryware',
    dimensionsMm: [mount === 'monobloc-deck' ? 140 : 230, Math.round((opts.spoutReachM ?? 0.135) * 1000) + 45, 210],
    productUrl: 'https://www.perrinandrowe.co.uk/bathroom/basin-taps/',
    schematicUrl: 'https://www.perrinandrowe.co.uk/downloads/technical-drawings/basin-mixers.pdf',
  });
}

// ---------------------------------------------------------------------------
// 2. Unified Parametric Perrin & Rowe Kitchen Tap Dispatcher
// ---------------------------------------------------------------------------

/**
 * Builds a parametric Perrin & Rowe kitchen mixer across all 4 models
 * (`'phoenician-bridge' | 'armstrong-bridge' | 'monobloc-swan' | 'wall-bridge'`),
 * handle styles (`'whitePorcelain' | 'blackPorcelain' | 'metal'`), optional side rinse spray,
 * and all 9 metal finishes.
 *
 * Coordinate convention:
 * - Deck models (`'phoenician-bridge'`, `'armstrong-bridge'`, `'monobloc-swan'`): `y = 0` sits on worktop/tap deck; spout projects along `+Z`.
 * - `'wall-bridge'`: `z = 0` sits on rear splashback wall; spout projects along `+Z`, `+Y` is up.
 */
export function buildPerrinRoweKitchenTap(opts: PerrinRoweKitchenTapOptions): THREE.Group {
  const p = opts.namePrefix ?? `perrinRoweKitchen.${opts.model}.${opts.finish}`;
  const { model, finish } = opts;
  const leverStyle = resolveKitchenLeverStyle(model, opts.leverStyle);
  const mats = getBathroomBrassMaterials(finish);
  const isArmstrong = model === 'armstrong-bridge';
  const collectionStyle: PerrinRoweBasinTapCollection = isArmstrong ? 'armstrong' : 'traditional';

  const holeSpreadM = opts.holeSpreadM ?? 0.2;
  const spoutReachM = opts.spoutReachM ?? 0.225;
  const defaultRinse = model === 'phoenician-bridge' || model === 'armstrong-bridge';
  const includeRinseSpray = opts.includeRinseSpray ?? defaultRinse;

  const root = new THREE.Group();
  root.name = p;
  tapMountKindRegistry.set(
    root,
    model === 'wall-bridge'
      ? 'wall-bridge'
      : model === 'monobloc-swan'
        ? 'monobloc-deck'
        : 'bridge-deck'
  );

  const addKitchenSwanSpout = (parent: THREE.Group, baseY: number, baseZ: number): void => {
    const spoutCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, baseY + 0.016, baseZ),
        new THREE.Vector3(0, baseY + 0.168, baseZ + spoutReachM * 0.06),
        new THREE.Vector3(0, baseY + 0.248, baseZ + spoutReachM * 0.42),
        new THREE.Vector3(0, baseY + 0.226, baseZ + spoutReachM * 0.82),
        new THREE.Vector3(0, baseY + 0.146, baseZ + spoutReachM),
      ],
      false,
      'centripetal'
    );
    const spoutTube = new THREE.Mesh(
      prepGeo(new THREE.TubeGeometry(spoutCurve, 30, 0.0108, 18, false)),
      mats.primary
    );
    spoutTube.name = `${p}.swanNeckSpout`;
    parent.add(spoutTube);

    const nozzle = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.013, 0.0124, 0.016, 20)),
      isArmstrong ? mats.knurled : mats.primary
    );
    nozzle.name = `${p}.spoutAeratorNozzle`;
    nozzle.position.set(0, baseY + 0.137, baseZ + spoutReachM);
    parent.add(nozzle);

    const aerator = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.002, 18)),
      mats.darkShadow
    );
    aerator.name = `${p}.spoutAeratorScreen`;
    aerator.position.set(0, baseY + 0.1278, baseZ + spoutReachM);
    parent.add(aerator);
  };

  if (model === 'phoenician-bridge' || model === 'armstrong-bridge') {
    const halfSpan = holeSpreadM * 0.5;
    const bridgeY = 0.105;

    for (const [pTag, signX] of [
      ['Hot', -1],
      ['Cold', 1],
    ] as const) {
      const px = signX * halfSpan;
      const pillarGroup = new THREE.Group();
      pillarGroup.name = `${p}.pillar${pTag}`;
      pillarGroup.position.set(px, 0, 0);
      root.add(pillarGroup);

      const collarTopY = addDeckBaseCollar(
        pillarGroup,
        pillarGroup.name,
        collectionStyle,
        mats,
        0.027,
        0.014
      );

      const riserH = Math.max(0.04, bridgeY - collarTopY - 0.016);
      const riser = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.0125, 0.013, riserH, 20)),
        mats.primary
      );
      riser.name = `${pillarGroup.name}.riser`;
      riser.position.y = collarTopY + riserH * 0.5 + 0.0005;
      pillarGroup.add(riser);

      const unionGeo = isArmstrong
        ? prepGeo(new THREE.CylinderGeometry(0.019, 0.019, 0.026, 22))
        : prepGeo(new THREE.SphereGeometry(0.0185, 18, 14));
      const union = new THREE.Mesh(unionGeo, isArmstrong ? mats.knurled : mats.primary);
      union.name = `${pillarGroup.name}.bridgeUnion`;
      union.position.y = bridgeY;
      pillarGroup.add(union);

      const bonnet = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.012, 0.0135, 0.032, 20)),
        mats.primary
      );
      bonnet.name = `${pillarGroup.name}.valveBonnet`;
      bonnet.position.y = bridgeY + 0.028;
      pillarGroup.add(bonnet);

      addHorizontalLeverHandle(
        pillarGroup,
        pillarGroup.name,
        collectionStyle,
        leverStyle,
        mats,
        signX,
        bridgeY + 0.042
      );
    }

    const barSpan = Math.max(0.06, holeSpreadM - 0.036);
    const bridgeBar = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.012, 0.012, barSpan, 20)),
      mats.primary
    );
    bridgeBar.name = `${p}.bridgeCrossbar`;
    bridgeBar.rotation.z = Math.PI * 0.5;
    bridgeBar.position.set(0, bridgeY, 0);
    root.add(bridgeBar);

    const teeGeo = isArmstrong
      ? prepGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.032, 24))
      : prepGeo(new THREE.SphereGeometry(0.0205, 18, 14));
    const tee = new THREE.Mesh(teeGeo, isArmstrong ? mats.knurled : mats.primary);
    tee.name = `${p}.centerTeeBoss`;
    tee.position.set(0, bridgeY, 0);
    root.add(tee);

    addKitchenSwanSpout(root, bridgeY, 0);
  } else if (model === 'monobloc-swan') {
    const monoblocGroup = new THREE.Group();
    monoblocGroup.name = `${p}.monoblocBase`;
    root.add(monoblocGroup);

    const collarTopY = addDeckBaseCollar(
      monoblocGroup,
      monoblocGroup.name,
      'armstrong',
      mats,
      0.029,
      0.022
    );

    const bodyH = 0.088;
    const body = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0205, 0.022, bodyH, 26)),
      mats.primary
    );
    body.name = `${monoblocGroup.name}.valveColumn`;
    body.position.y = collarTopY + bodyH * 0.5 + 0.0005;
    monoblocGroup.add(body);

    const swivelCollar = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 26)),
      mats.knurled
    );
    swivelCollar.name = `${monoblocGroup.name}.swivelCollar`;
    swivelCollar.position.y = collarTopY + bodyH + 0.008;
    monoblocGroup.add(swivelCollar);

    addHorizontalLeverHandle(
      monoblocGroup,
      `${monoblocGroup.name}.mixerLever`,
      'armstrong',
      leverStyle,
      mats,
      1,
      collarTopY + bodyH * 0.56
    );

    addKitchenSwanSpout(root, collarTopY + bodyH + 0.015, 0);
  } else {
    // 'wall-bridge'
    const halfSpan = holeSpreadM * 0.5;
    const armOutZ = 0.056;

    for (const [pTag, signX] of [
      ['Hot', -1],
      ['Cold', 1],
    ] as const) {
      const px = signX * halfSpan;
      const wallUnion = new THREE.Group();
      wallUnion.name = `${p}.wallInlet${pTag}`;
      wallUnion.position.set(px, 0, 0);
      root.add(wallUnion);

      const collarZ = addWallRoseAndCollar(
        wallUnion,
        wallUnion.name,
        'traditional',
        mats,
        0.028,
        0.015
      );

      const standoffLen = Math.max(0.016, armOutZ - collarZ - 0.012);
      const standoff = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.013, 0.013, standoffLen, 20)),
        mats.primary
      );
      standoff.name = `${wallUnion.name}.standoff`;
      standoff.rotation.x = Math.PI * 0.5;
      standoff.position.z = collarZ + standoffLen * 0.5 + 0.0005;
      wallUnion.add(standoff);

      const elbow = new THREE.Mesh(
        prepGeo(new THREE.SphereGeometry(0.0185, 18, 14)),
        mats.primary
      );
      elbow.name = `${wallUnion.name}.unionElbow`;
      elbow.position.z = armOutZ;
      wallUnion.add(elbow);

      const bonnet = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.012, 0.0135, 0.03, 20)),
        mats.primary
      );
      bonnet.name = `${wallUnion.name}.valveBonnet`;
      bonnet.position.set(0, 0.026, armOutZ);
      wallUnion.add(bonnet);

      addHorizontalLeverHandle(
        wallUnion,
        wallUnion.name,
        'traditional',
        leverStyle,
        mats,
        signX,
        0.04,
        armOutZ
      );
    }

    const barSpan = Math.max(0.06, holeSpreadM - 0.036);
    const bridgeBar = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.012, 0.012, barSpan, 20)),
      mats.primary
    );
    bridgeBar.name = `${p}.wallBridgeCrossbar`;
    bridgeBar.rotation.z = Math.PI * 0.5;
    bridgeBar.position.set(0, 0, armOutZ);
    root.add(bridgeBar);

    const tee = new THREE.Mesh(
      prepGeo(new THREE.SphereGeometry(0.0205, 18, 14)),
      mats.primary
    );
    tee.name = `${p}.centerTeeBoss`;
    tee.position.set(0, 0, armOutZ);
    root.add(tee);

    addKitchenSwanSpout(root, 0, armOutZ);
  }

  if (includeRinseSpray && model !== 'wall-bridge') {
    const rx = model === 'monobloc-swan' ? 0.16 : holeSpreadM * 0.5 + 0.11;
    const rinseGroup = new THREE.Group();
    rinseGroup.name = `${p}.sideRinseSpray`;
    rinseGroup.position.set(rx, 0, 0);
    root.add(rinseGroup);

    const holder = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.022, 0.026, 0.026, 20)),
      isArmstrong ? mats.knurled : mats.primary
    );
    holder.name = `${rinseGroup.name}.deckSocket`;
    holder.position.y = 0.013;
    rinseGroup.add(holder);

    const gripMat =
      leverStyle === 'whitePorcelain'
        ? getVitreousChinaMaterial()
        : leverStyle === 'blackPorcelain'
          ? getBlackPorcelainMaterial()
          : mats.primary;
    const grip = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0125, 0.011, 0.072, 18)),
      gripMat
    );
    grip.name = `${rinseGroup.name}.wandGrip`;
    grip.position.y = 0.063;
    rinseGroup.add(grip);

    const head = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.019, 0.014, 0.036, 20)),
      mats.primary
    );
    head.name = `${rinseGroup.name}.sprayHead`;
    head.position.set(0, 0.118, 0.005);
    rinseGroup.add(head);

    const face = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.002, 18)),
      mats.darkShadow
    );
    face.name = `${rinseGroup.name}.sprayNozzleFace`;
    face.position.set(0, 0.1372, 0.005);
    rinseGroup.add(face);

    const trigger = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.005, 0.048, 0.011)),
      mats.primary
    );
    trigger.name = `${rinseGroup.name}.triggerLever`;
    trigger.position.set(0, 0.088, 0.018);
    trigger.rotation.x = -0.18;
    rinseGroup.add(trigger);
  }

  attachAssetInteraction(root, {
    kind: 'toggle',
    label: 'Turn On Kitchen Mixer Tap',
    activeLabel: 'Turn Off Kitchen Mixer Tap',
    audio: {
      openPreset: 'tapValveTurn', closePreset: 'tapValveTurn',
      activeLoopPreset: 'waterTapFlow',
      volume: 0.68,
    },
  });
  const modelLabel =
    model === 'phoenician-bridge'
      ? 'Phoenician Bridge Mixer'
      : model === 'armstrong-bridge'
        ? 'Armstrong Bridge Mixer'
        : model === 'wall-bridge'
          ? 'Wall-Mounted Bridge Mixer'
          : 'Monobloc Swan-Neck Mixer';
  const skuBase =
    model === 'phoenician-bridge' ? '4460' : model === 'armstrong-bridge' ? '4861' : model === 'wall-bridge' ? '4272' : '4325';
  return attachAssetMetadata(finalizeSanitaryGroup(root, 'plumbing'), {
    name: `Perrin & Rowe ${modelLabel}${(opts.includeRinseSpray ?? false) ? ' with Rinse' : ''}`,
    brand: 'Perrin & Rowe',
    collection: model === 'armstrong-bridge' ? 'Armstrong' : 'Traditional Kitchen',
    sku: `PR-${skuBase}-${finish}`,
    finish: formatBrasswareFinishLabel(finish),
    category: 'sanitaryware',
    dimensionsMm: [250, Math.round((opts.spoutReachM ?? 0.22) * 1000) + 55, 385],
    productUrl: 'https://www.perrinandrowe.co.uk/kitchen/kitchen-taps/',
    schematicUrl: `https://www.perrinandrowe.co.uk/downloads/spec-sheets/PR-${skuBase}-Spec.pdf`,
  });
}

// ---------------------------------------------------------------------------
// Internal Slot Resolution Helpers for Sanitaryware & Joinery Builders
// ---------------------------------------------------------------------------

export function buildBasinTapFromSpec(
  spec: PerrinRoweBasinTapSpec,
  fallbackFinish: BrasswareFinishCode,
  fallbackMount: PerrinRoweBasinTapMount,
  fallbackNamePrefix: string
): THREE.Group {
  return buildPerrinRoweBasinTap({
    namePrefix: spec.namePrefix ?? fallbackNamePrefix,
    collection: spec.collection,
    mount: spec.mount ?? fallbackMount,
    finish: spec.finish ?? fallbackFinish,
    leverStyle: spec.leverStyle,
    holeSpreadM: spec.holeSpreadM,
    spoutReachM: spec.spoutReachM,
    includeWaste: spec.includeWaste,
    slottedWaste: spec.slottedWaste,
  });
}

export function resolveKitchenTapModelFromSpec(
  spec: PerrinRoweKitchenTapSpec
): PerrinRoweKitchenTapModel {
  if (spec.model) return spec.model;
  if (spec.mount === '2-hole-wall' || spec.mount === 'wall-bridge') return 'wall-bridge';
  if (spec.mount === 'monobloc-deck') return 'monobloc-swan';
  if (spec.collection === 'armstrong' || spec.collection === 'langbourn') {
    return 'armstrong-bridge';
  }
  return 'phoenician-bridge';
}

export function buildKitchenTapFromSpec(
  spec: PerrinRoweKitchenTapSpec,
  fallbackFinish: BrasswareFinishCode,
  fallbackNamePrefix: string
): THREE.Group {
  const model = resolveKitchenTapModelFromSpec(spec);
  return buildPerrinRoweKitchenTap({
    namePrefix: spec.namePrefix ?? fallbackNamePrefix,
    model,
    finish: spec.finish ?? fallbackFinish,
    leverStyle: spec.leverStyle,
    includeRinseSpray: spec.includeRinseSpray,
    holeSpreadM: spec.holeSpreadM,
    spoutReachM: spec.spoutReachM,
  });
}
