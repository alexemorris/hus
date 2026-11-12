import * as THREE from 'three';
import type { RoomLodController } from '../../lod/lod-manager.ts';
import type {
  BifoldPanelRef,
  LightGroupMap,
  ZoneIndicatorMaterials,
} from '../../viewer/scene-types.ts';
import type { PropertySceneLayers, RoomSwitchLedBinding } from '../../viewer/scene-content.ts';
import {
  type BatchOptimizerHooks,
  getBoundPropertySceneProfile,
} from '../../viewer/property-scene-profile.ts';

/** Userdata flag for helper meshes that must never be batched, deduplicated or shadow-culled. */
export const SHADOW_PASS_HOOK_FLAG = 'isShadowPassHook';

const NO_BATCH_HOOKS: BatchOptimizerHooks = {};

export const LEAF_OR_MICRO_SHADOW_EXCLUDE_RE =
  /leaf|leaves|foliage|blossom|petal|tendril|grapeCluster|berry|herb|fern|moss|needle|climbingIvy|patioBorderPlant|filament|bristle|spoke|cassette|chainring|bolt|screw|nut|washer|rivet|keycap/i;

/** Home-specific batching rules: explicit option first, then the profile the scene was built from. */
export function resolveBatchHooks(
  explicitHooks: BatchOptimizerHooks | undefined,
  scene: THREE.Scene
): BatchOptimizerHooks {
  return (
    explicitHooks ??
    getBoundPropertySceneProfile(scene)?.batchHooks ??
    NO_BATCH_HOOKS
  );
}

export function bindAdditionalInteriorLodGroups(
  layers: PropertySceneLayers,
  lodController: RoomLodController,
  hooks: BatchOptimizerHooks
): void {
  const explicitGroupZones = hooks.explicitLodGroups ?? [];

  for (const [name, zoneId, tier] of explicitGroupZones) {
    const obj = layers.scene.getObjectByName(name);
    if (obj && obj.userData?.lodTier === undefined) {
      lodController.registerObjectWithTier(zoneId, obj, tier);
    }
  }

  const resolveGroupLodZone = hooks.resolveGroupLodZone;
  if (resolveGroupLodZone) {
    layers.scene.traverse((obj) => {
      if (obj instanceof THREE.Group && obj.userData?.lodTier === undefined) {
        const zoneId = resolveGroupLodZone(obj);
        if (zoneId) lodController.registerObjectWithTier(zoneId, obj, 1);
      }
    });
  }

  // Register the home's moving / animated interior assemblies at LOD1 so closed-shell exterior (>=28.5m) and
  // hidden-floor / distant cutaway views cull them cleanly while preserving full interactive behavior up close.
  for (const child of layers.scene.children) {
    const registerDynamicInterior = (node: THREE.Object3D): void => {
      if (node.userData?.lodTier !== undefined) return;
      const n = typeof node.name === 'string' ? node.name : '';
      const u = node.userData ?? {};
      if (
        u.isArchitecturalShell ||
        u.isCutawayWall ||
        u.isBifoldDoor ||
        u.isCarGate ||
        u.isUniFiCamera ||
        u.isUniFiAccessReader ||
        u.isFittingFx ||
        u.isLightGlowPool ||
        /floor|wall|ceiling|roof|window|sill|lintel|beam|truss|brick|plaster|cladding|door|gate|bifold/i.test(
          n
        )
      ) {
        for (const sub of node.children) registerDynamicInterior(sub);
        return;
      }
      const z = hooks.resolveDynamicInteriorZone?.(n);
      if (z) {
        let containsLight = false;
        node.traverse((sub) => {
          if (sub instanceof THREE.Light) containsLight = true;
        });
        if (containsLight) {
          for (const sub of node.children) registerDynamicInterior(sub);
          return;
        }
        lodController.registerObjectWithTier(z, node, 1);
        return;
      }
      for (const sub of node.children) registerDynamicInterior(sub);
    };
    registerDynamicInterior(child);
  }
}

/**
 * Collects objects that actually move/animate at runtime or are dynamically toggled by overlays.
 * Static clickable objects (such as the static dining table base/chairs, static light fixture
 * housings, and static UFH manifold parts) are NOT excluded here so they can be merged by
 * matching interactive signature while keeping `interactiveMeshes` intact.
 */
export function collectProtectedObjects(
  layers: PropertySceneLayers,
  bifoldPanels: readonly BifoldPanelRef[],
  getDynamicObjects: () => Set<THREE.Object3D>,
  hooks: BatchOptimizerHooks
): Set<THREE.Object3D> {
  const protectedSet = getDynamicObjects();

  const markSubtree = (root: THREE.Object3D): void => {
    root.traverse((node) => protectedSet.add(node));
  };

  for (const panel of bifoldPanels) {
    markSubtree(panel.group);
  }

  layers.scene.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh &&
      (obj.userData?.isUfhProtectedFloor === true || hooks.isUfhProtectedFloor?.(obj) === true)
    ) {
      protectedSet.add(obj);
    }
    const u = obj.userData;
    if (!u) return;
    if (u.isBifoldDoor || u.isAnnotationGroup || u.isSecurityFovCone) {
      markSubtree(obj);
    }
  });

  return protectedSet;
}

export function collectMutableMaterials(
  layers: PropertySceneLayers,
  lightGroups: LightGroupMap,
  indicatorMats: ZoneIndicatorMaterials,
  roomSwitchLedMats: readonly RoomSwitchLedBinding[],
  hooks: BatchOptimizerHooks
): Set<THREE.Material> {
  const set = new Set<THREE.Material>();

  for (const grp of Object.values(lightGroups)) {
    if (!grp) continue;
    for (const m of grp.emissives) set.add(m);
    for (const m of grp.cones) set.add(m);
    for (const p of grp.pools) set.add(p.mat);
  }
  for (const m of Object.values(indicatorMats)) {
    if (m instanceof THREE.Material) set.add(m);
  }
  for (const b of roomSwitchLedMats) {
    set.add(b.mat);
  }
  layers.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (
      obj.userData?.isDynamicMaterial === true ||
      hooks.isDynamicMaterialMesh?.(obj) === true
    ) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m) set.add(m);
      }
    }
  });
  return set;
}

export function collectVisibilityContainers(
  scene: THREE.Scene,
  layers: PropertySceneLayers,
  protectedObjects: ReadonlySet<THREE.Object3D>,
  hooks: BatchOptimizerHooks
): {
  readonly topContainers: Set<THREE.Object3D>;
  readonly subContainers: THREE.Object3D[];
  readonly allContainers: THREE.Object3D[];
} {
  const {
    firstFloorMeshGroup,
    groundFloorCeilingGroup,
    ceilingMeshGroup,
    cutawayWallGroups,
  } = layers;

  const baseTopContainers: THREE.Object3D[] = [
    scene,
    firstFloorMeshGroup,
    groundFloorCeilingGroup,
    ceilingMeshGroup,
    cutawayWallGroups.southWest,
    cutawayWallGroups.west,
    cutawayWallGroups.north,
    cutawayWallGroups.east,
  ];
  const topContainers = new Set<THREE.Object3D>(baseTopContainers);
  const extraLayerContainers: THREE.Object3D[] = [];
  const addExtraContainer = (grp: THREE.Object3D | undefined): void => {
    if (!grp || grp.parent === null || topContainers.has(grp)) return;
    topContainers.add(grp);
    extraLayerContainers.push(grp);
  };
  addExtraContainer(layers.roofGroup);
  addExtraContainer(layers.siteGroup);
  if (layers.floorLayers) {
    for (let i = 0; i < layers.floorLayers.length; i++) {
      const entry = layers.floorLayers[i]!;
      addExtraContainer(entry.contentGroup);
      addExtraContainer(entry.slabGroup);
      addExtraContainer(entry.ceilingGroup);
    }
  }

  const subContainers: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    if (obj instanceof THREE.Group && !topContainers.has(obj) && !protectedObjects.has(obj)) {
      const u = obj.userData;
      if (
        u?.ufhZoneId ||
        u?.isBatchSubContainer === true ||
        hooks.isBatchSubContainer?.(obj) === true ||
        (!obj.visible && (!obj.parent || obj.parent.visible))
      ) {
        topContainers.add(obj);
        subContainers.push(obj);
      }
    }
  });

  const allContainers: THREE.Object3D[] = [
    ...baseTopContainers,
    ...extraLayerContainers,
    ...subContainers,
  ];

  return { topContainers, subContainers, allContainers };
}

export function isClosedSolidGeometry(geo: THREE.BufferGeometry): boolean {
  const gType = geo.type;
  if (
    gType === 'BoxGeometry' ||
    gType === 'RoundedBoxGeometry' ||
    gType === 'IcosahedronGeometry' ||
    gType === 'TorusGeometry' ||
    gType === 'TubeGeometry' ||
    gType === 'ExtrudeGeometry'
  ) {
    return true;
  }
  if (gType === 'CylinderGeometry' || gType === 'ConeGeometry') {
    const params = (geo as THREE.CylinderGeometry).parameters;
    return !params?.openEnded;
  }
  if (gType === 'SphereGeometry') {
    const params = (geo as THREE.SphereGeometry).parameters;
    const phiLength = params?.phiLength ?? Math.PI * 2;
    const thetaLength = params?.thetaLength ?? Math.PI;
    return phiLength >= Math.PI * 1.99 && thetaLength >= Math.PI * 0.99;
  }
  return false;
}

export function isDynamicMaterial(
  mat: THREE.Material | null | undefined,
  mutableMaterials: ReadonlySet<THREE.Material>
): boolean {
  if (!mat) return true;
  const matU = mat.userData as Record<string, unknown> | undefined;
  if (
    mutableMaterials.has(mat) ||
    Boolean(matU?.isDynamicGolfScreen) ||
    Boolean(matU?.isDynamicGolfStatusLight) ||
    matU?.cutawayLightOpacity !== undefined
  ) {
    return true;
  }
  if (
    mat instanceof THREE.MeshStandardMaterial &&
    mat.transparent &&
    mat.opacity >= 0.30 &&
    mat.opacity <= 0.44 &&
    mat.depthWrite === false
  ) {
    mat.userData = { ...mat.userData, cutawayLightOpacity: mat.opacity };
    return true;
  }
  return false;
}

export function isMaterialRenderDynamic(
  mat: THREE.Material | null | undefined,
  mutableMaterials: ReadonlySet<THREE.Material>,
  indicatorMats: ZoneIndicatorMaterials | undefined
): boolean {
  if (!mat) return true;
  if (mat === indicatorMats?.tvScreenMat) return true;
  return isDynamicMaterial(mat, mutableMaterials);
}

export function isNonBatchableMaterial(
  mat: THREE.Material | null | undefined,
  indicatorMats: ZoneIndicatorMaterials | undefined
): boolean {
  if (!mat) return true;
  if (mat === indicatorMats?.tvScreenMat) return true;
  const matU = mat.userData as Record<string, unknown> | undefined;
  return Boolean(matU?.isDynamicGolfScreen) || Boolean(matU?.isDynamicGolfStatusLight);
}

export function isBatchableMesh(
  mesh: THREE.Mesh,
  protectedObjects: ReadonlySet<THREE.Object3D>,
  _mutableMaterials: ReadonlySet<THREE.Material>,
  indicatorMats: ZoneIndicatorMaterials | undefined,
  allowChildren = false
): boolean {
  if (!mesh.visible) return false;
  if (mesh.userData?.[SHADOW_PASS_HOOK_FLAG]) return false;
  if (protectedObjects.has(mesh)) return false;
  if (!allowChildren && mesh.children.length > 0) return false;
  if (Array.isArray(mesh.material) || !mesh.material) return false;
  if (isNonBatchableMaterial(mesh.material, indicatorMats)) return false;
  const posAttr = mesh.geometry.getAttribute('position');
  if (!posAttr || posAttr.count === 0) return false;
  return true;
}

export function isBatchableMultiMaterialMesh(
  mesh: THREE.Mesh,
  protectedObjects: ReadonlySet<THREE.Object3D>,
  _mutableMaterials: ReadonlySet<THREE.Material>,
  indicatorMats: ZoneIndicatorMaterials | undefined,
  allowChildren = false
): boolean {
  if (!mesh.visible) return false;
  if (mesh.userData?.[SHADOW_PASS_HOOK_FLAG]) return false;
  if (protectedObjects.has(mesh)) return false;
  if (!allowChildren && mesh.children.length > 0) return false;
  if (!Array.isArray(mesh.material) || mesh.material.length < 2) return false;
  const geo = mesh.geometry;
  const posAttr = geo.getAttribute('position');
  if (!posAttr || posAttr.count === 0 || !geo.index || geo.groups.length < 2) return false;
  for (let i = 0; i < geo.groups.length; i++) {
    const grp = geo.groups[i]!;
    if (grp.count <= 0) return false;
    const mat = mesh.material[grp.materialIndex ?? 0];
    if (
      !mat ||
      (mat.transparent && (mat.blending ?? THREE.NormalBlending) !== THREE.NormalBlending) ||
      isNonBatchableMaterial(mat, indicatorMats)
    ) {
      return false;
    }
  }
  return true;
}

export function buildInteractiveKey(
  _u: Record<string, unknown> | undefined,
  _isInteractive: boolean
): string {
  return '';
}
