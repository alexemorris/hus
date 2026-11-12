import * as THREE from 'three';
import type { AcousticPortalState } from '../../core/types/acoustics.ts';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import { soundEngine } from '../../engine/audio/sound-engine.ts';
import { attachAssetInteraction, attachAssetMetadata, mmFromMetres } from '../shared/catalog-smart-metadata.ts';
import {
  tagCutaway,
  tagDynamicBatch,
  type InteractionTarget,
} from '../../engine/geometry/mesh-traits.ts';
import type { AnimatedInteractable } from '../../engine/interaction/handlers/animated-interactable.ts';
import { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import {
  sharedBoxGeometry,
  sharedCylinderGeometry,
  sharedSphereGeometry,
} from '../shared/geometry-cache.ts';
import { ensureNamedAddedChildren, prepGeo, tagHighLod } from '../shared/scene-helpers.ts';

export type GeorgianLintelStyle = 'gauged-brick-jack-arch' | 'stone-keystone-arch' | 'none';
export type GeorgianSillStyle = 'yorkstone' | 'painted-stone' | 'none';

export interface CreateGeorgianSashWindowOptions {
  readonly width?: number;
  readonly height?: number;
  readonly wallThickness?: number;
  readonly boxRecessFromExteriorM?: number;
  readonly panesCols?: number;
  readonly panesTopRows?: number;
  readonly panesBottomRows?: number;
  readonly astragalWidthM?: number;
  readonly glazingProportion?: number;
  readonly initialOpenRatio?: number;
  readonly maxOpenTravelM?: number;
  readonly lintel?: GeorgianLintelStyle;
  readonly sill?: GeorgianSillStyle;
  readonly includeInteriorArchitrave?: boolean;
  readonly includeHorns?: boolean;
  readonly cutawayWall?: CutawayWallDescriptor;
  readonly interactions?: InteractionTarget;
  readonly id?: string;
  readonly label?: string;
  readonly zone?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly frameMaterial?: THREE.Material;
  readonly glassMaterial?: THREE.Material;
  readonly hardwareMaterial?: THREE.Material;
  readonly rubbedBrickMaterial?: THREE.Material;
  readonly mortarMaterial?: THREE.Material;
  readonly stoneSillMaterial?: THREE.Material;
  readonly architraveMaterial?: THREE.Material;
}

export interface RegisterVerticalSlidingSashOptions {
  readonly windowGroup: THREE.Group;
  readonly lowerSashGroup: THREE.Group;
  readonly fitchLeverPivot?: THREE.Object3D;
  readonly clickableTargets?: readonly THREE.Object3D[];
  readonly id?: string;
  readonly label?: string;
  readonly aliases?: readonly string[];
  readonly closedY?: number;
  readonly maxOpenTravelM: number;
  readonly clearOpeningWidthM?: number;
  readonly initialOpenRatio?: number;
  readonly durationSeconds?: number;
  readonly cutawayWall?: CutawayWallDescriptor;
}

export interface GeorgianSashWindowResult {
  readonly group: THREE.Group;
  readonly upperSashGroup: THREE.Group;
  readonly lowerSashGroup: THREE.Group;
  readonly fitchLeverPivot: THREE.Group;
  readonly glassPanes: readonly THREE.Mesh[];
  readonly voussoirCount: number;
  readonly sillWidthM: number;
  readonly sillProjectionM: number;
  readonly clearOpeningWidthM: number;
  readonly maxOpenTravelM: number;
  readonly closedLowerSashY: number;
  readonly controller?: VerticalSlidingSashController;
}

const EPS = 0.0005;
const SASH_THICKNESS_M = 0.034;
const TRACK_HALF_OFFSET_M = 0.019; // zUpper = boxCenterZ - 0.019, zLower = boxCenterZ + 0.019 => 4 mm clear gap!
const PULLEY_STILE_WIDTH_M = 0.052;
const HEAD_LINING_HEIGHT_M = 0.048;
const TIMBER_CILL_HEIGHT_M = 0.046;
const SASH_STILE_WIDTH_M = 0.042;
const SASH_TOP_RAIL_M = 0.042;
const SASH_MEETING_RAIL_M = 0.032;
const SASH_BOTTOM_RAIL_M = 0.058;

const JACK_ARCH_HEIGHT_M = 0.225;
const JACK_ARCH_SKEWBACK_DEG = 14;
const JACK_ARCH_PROUD_M = 0.018;
const MORTAR_JOINT_WIDTH_M = 0.0025;
const MORTAR_RECESS_M = 0.0015;

const SILL_PROJECTION_M = 0.055;
const SILL_EAR_EXTENSION_M = 0.045;
const SILL_HEIGHT_M = 0.075;

let defaultFrameWhiteMat: THREE.MeshStandardMaterial | null = null;
let defaultArchitraveWhiteMat: THREE.MeshStandardMaterial | null = null;
let defaultGlassMat: THREE.MeshPhysicalMaterial | null = null;
let defaultBrassMat: THREE.MeshStandardMaterial | null = null;
let defaultRubbedBrickMat: THREE.MeshStandardMaterial | null = null;
let defaultLimeMortarMat: THREE.MeshStandardMaterial | null = null;
let defaultYorkstoneMat: THREE.MeshStandardMaterial | null = null;
let defaultPaintedStoneMat: THREE.MeshStandardMaterial | null = null;
let defaultSashCordMat: THREE.MeshStandardMaterial | null = null;

function getDefaultFrameMaterial(): THREE.MeshStandardMaterial {
  if (!defaultFrameWhiteMat) {
    defaultFrameWhiteMat = new THREE.MeshStandardMaterial({
      name: 'georgianSash.paintedTimberFrame',
      color: 0xf5f2eb,
      roughness: 0.36,
      metalness: 0.01,
    });
  }
  return defaultFrameWhiteMat;
}

function getDefaultArchitraveMaterial(): THREE.MeshStandardMaterial {
  if (!defaultArchitraveWhiteMat) {
    defaultArchitraveWhiteMat = new THREE.MeshStandardMaterial({
      name: 'georgianSash.interiorArchitrave',
      color: 0xf7f4ed,
      roughness: 0.4,
      metalness: 0.01,
    });
  }
  return defaultArchitraveWhiteMat;
}

function getDefaultGlassMaterial(): THREE.MeshPhysicalMaterial {
  if (!defaultGlassMat) {
    defaultGlassMat = new THREE.MeshPhysicalMaterial({
      name: 'georgianSash.crownGlass',
      color: 0xdff0f5,
      transparent: true,
      opacity: 0.24,
      transmission: 0,
      roughness: 0.05,
      metalness: 0.0,
      ior: 1.52,
      reflectivity: 0.48,
      depthWrite: false,
    });
  }
  return defaultGlassMat;
}

function getDefaultHardwareMaterial(): THREE.MeshStandardMaterial {
  if (!defaultBrassMat) {
    defaultBrassMat = new THREE.MeshStandardMaterial({
      name: 'georgianSash.lacqueredBrass',
      color: 0xc9a24b,
      roughness: 0.25,
      metalness: 0.88,
    });
  }
  return defaultBrassMat;
}

function getDefaultRubbedBrickMaterial(): THREE.MeshStandardMaterial {
  if (!defaultRubbedBrickMat) {
    defaultRubbedBrickMat = new THREE.MeshStandardMaterial({
      name: 'georgianSash.gaugedRubbedBrick',
      color: 0xb85238,
      roughness: 0.78,
      metalness: 0.0,
    });
  }
  return defaultRubbedBrickMat;
}

function getDefaultMortarMaterial(): THREE.MeshStandardMaterial {
  if (!defaultLimeMortarMat) {
    defaultLimeMortarMat = new THREE.MeshStandardMaterial({
      name: 'georgianSash.limePuttyMortar',
      color: 0xe8e2d5,
      roughness: 0.9,
      metalness: 0.0,
    });
  }
  return defaultLimeMortarMat;
}

function getDefaultYorkstoneMaterial(): THREE.MeshStandardMaterial {
  if (!defaultYorkstoneMat) {
    defaultYorkstoneMat = new THREE.MeshStandardMaterial({
      name: 'georgianSash.sawnYorkstone',
      color: 0xc8bca4,
      roughness: 0.82,
      metalness: 0.0,
    });
  }
  return defaultYorkstoneMat;
}

function getDefaultPaintedStoneMaterial(): THREE.MeshStandardMaterial {
  if (!defaultPaintedStoneMat) {
    defaultPaintedStoneMat = new THREE.MeshStandardMaterial({
      name: 'georgianSash.paintedStone',
      color: 0xeeeae0,
      roughness: 0.55,
      metalness: 0.0,
    });
  }
  return defaultPaintedStoneMat;
}

function getDefaultSashCordMaterial(): THREE.MeshStandardMaterial {
  if (!defaultSashCordMat) {
    defaultSashCordMat = new THREE.MeshStandardMaterial({
      name: 'georgianSash.waxedHempCord',
      color: 0xd9ccb4,
      roughness: 0.88,
      metalness: 0.0,
    });
  }
  return defaultSashCordMat;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function resolveInteractionRegistry(target: InteractionTarget): InteractionRegistry {
  if (target instanceof InteractionRegistry) {
    return target;
  }
  return target.interactions;
}

let sashInstanceSeq = 0;

function buildQuadPrismXY(
  xBotL: number,
  xBotR: number,
  xTopR: number,
  xTopL: number,
  yBot: number,
  yTop: number,
  zFront: number,
  zBack: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(xBotL, yBot);
  shape.lineTo(xBotR, yBot);
  shape.lineTo(xTopR, yTop);
  shape.lineTo(xTopL, yTop);
  shape.closePath();

  const depth = Math.max(0.002, zBack - zFront);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, zFront + pos.getZ(i));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function buildYorkstoneSillGeometry(
  totalWidth: number,
  zFront: number,
  zBack: number
): THREE.BufferGeometry {
  // Cross-section in (z, y) extruded along X [-totalWidth/2, +totalWidth/2].
  // Top weather-wash slopes down from zBack (y = 0) to zFront (y = -0.014),
  // front face drops to y = -SILL_HEIGHT_M, with an underside throated drip groove!
  const yTopBack = -EPS;
  const yTopFront = -0.014;
  const yBot = -SILL_HEIGHT_M;
  const dripZ0 = zFront + 0.016;
  const dripZ1 = zFront + 0.026;
  const dripY = yBot + 0.009;

  const shape = new THREE.Shape();
  shape.moveTo(zFront, yBot);
  if (dripZ1 < zBack - 0.01) {
    shape.lineTo(dripZ0, yBot);
    shape.lineTo(dripZ0 + 0.002, dripY);
    shape.lineTo(dripZ1 - 0.002, dripY);
    shape.lineTo(dripZ1, yBot);
  }
  shape.lineTo(zBack, yBot);
  shape.lineTo(zBack, yTopBack);
  shape.lineTo(zBack - 0.018, yTopBack);
  shape.lineTo(zFront, yTopFront);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: totalWidth, bevelEnabled: false });
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getX(i);
    const y = pos.getY(i);
    const x = pos.getZ(i) - totalWidth * 0.5;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

let cachedHornGeo: THREE.BufferGeometry | null = null;

function getVictorianSashHornGeometry(): THREE.BufferGeometry {
  if (cachedHornGeo) return cachedHornGeo;
  const h = 0.052;
  const w = SASH_STILE_WIDTH_M;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w, -0.01);
  shape.bezierCurveTo(w * 0.65, -0.014, w * 0.55, -h * 0.65, w * 0.18, -h);
  shape.lineTo(0, -h);
  shape.closePath();

  const depth = SASH_THICKNESS_M;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, pos.getZ(i) - depth * 0.5);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  cachedHornGeo = geo;
  return geo;
}

interface BuildSashLeafParams {
  readonly namePrefix: string;
  readonly sashWidth: number;
  readonly sashHeight: number;
  readonly topRailH: number;
  readonly bottomRailH: number;
  readonly cols: number;
  readonly rows: number;
  readonly astragalWidthM: number;
  readonly frameMat: THREE.Material;
  readonly glassMat: THREE.Material;
  readonly includeHorns: boolean;
  readonly glassPanesOut: THREE.Mesh[];
}

function buildSashLeaf(params: BuildSashLeafParams): THREE.Group {
  const {
    namePrefix,
    sashWidth,
    sashHeight,
    topRailH,
    bottomRailH,
    cols,
    rows,
    astragalWidthM,
    frameMat,
    glassMat,
    includeHorns,
    glassPanesOut,
  } = params;

  const sash = new THREE.Group();
  sash.name = namePrefix;

  const halfW = sashWidth * 0.5;
  const stileW = SASH_STILE_WIDTH_M;
  const innerClearW = Math.max(0.08, sashWidth - 2 * stileW);
  const innerClearH = Math.max(0.08, sashHeight - topRailH - bottomRailH);

  // Left & Right vertical stiles (full height of sash)
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1;
    const stile = new THREE.Mesh(
      sharedBoxGeometry(stileW, sashHeight, SASH_THICKNESS_M),
      frameMat
    );
    stile.name = `${namePrefix}.stile_${side}`;
    stile.position.set(sign * (halfW - stileW * 0.5), sashHeight * 0.5, 0);
    stile.castShadow = true;
    stile.receiveShadow = true;
    sash.add(stile);
  }

  // Top & Bottom rails trimmed strictly between stiles (zero overlap!)
  const railSpanW = Math.max(0.04, innerClearW - 2 * EPS);
  const bottomRail = new THREE.Mesh(
    sharedBoxGeometry(railSpanW, bottomRailH, SASH_THICKNESS_M),
    frameMat
  );
  bottomRail.name = `${namePrefix}.bottomRail`;
  bottomRail.position.set(0, bottomRailH * 0.5, 0);
  bottomRail.castShadow = true;
  bottomRail.receiveShadow = true;
  sash.add(bottomRail);

  const topRail = new THREE.Mesh(
    sharedBoxGeometry(railSpanW, topRailH, SASH_THICKNESS_M),
    frameMat
  );
  topRail.name = `${namePrefix}.topRail`;
  topRail.position.set(0, sashHeight - topRailH * 0.5, 0);
  topRail.castShadow = true;
  topRail.receiveShadow = true;
  sash.add(topRail);

  // Optional Victorian ogee sash horns below upper sash stiles
  if (includeHorns) {
    const hornGeo = getVictorianSashHornGeometry();
    const leftHorn = new THREE.Mesh(hornGeo, frameMat);
    leftHorn.name = `${namePrefix}.horn_left`;
    leftHorn.position.set(-halfW, -EPS, 0);
    sash.add(leftHorn);

    const rightHorn = new THREE.Mesh(hornGeo, frameMat);
    rightHorn.name = `${namePrefix}.horn_right`;
    rightHorn.scale.x = -1;
    rightHorn.position.set(halfW, -EPS, 0);
    sash.add(rightHorn);
  }

  // Slender ovolo glazing bars (astragals) & individual rebated glass panes
  const paneTotalAstragalX = (cols - 1) * astragalWidthM;
  const paneTotalAstragalY = (rows - 1) * astragalWidthM;
  const cellW = (innerClearW - paneTotalAstragalX) / cols;
  const cellH = (innerClearH - paneTotalAstragalY) / rows;
  const astragalDepth = SASH_THICKNESS_M - 0.008;
  const glassThickness = 0.004;

  const xStart = -innerClearW * 0.5;
  const yStart = bottomRailH;

  // Continuous vertical astragals spanning between bottomRail and topRail
  for (let c = 1; c < cols; c++) {
    const ax = xStart + c * cellW + (c - 0.5) * astragalWidthM;
    const vBar = new THREE.Mesh(
      sharedBoxGeometry(astragalWidthM, innerClearH - 2 * EPS, astragalDepth),
      frameMat
    );
    vBar.name = `${namePrefix}.verticalAstragal_${c}`;
    vBar.position.set(ax, yStart + innerClearH * 0.5, 0);
    vBar.castShadow = true;
    sash.add(vBar);
  }

  // Horizontal astragal segments trimmed strictly between vertical bars / stiles
  for (let r = 1; r < rows; r++) {
    const ay = yStart + r * cellH + (r - 0.5) * astragalWidthM;
    for (let c = 0; c < cols; c++) {
      const cx = xStart + c * (cellW + astragalWidthM) + cellW * 0.5;
      const hBar = new THREE.Mesh(
        sharedBoxGeometry(Math.max(0.01, cellW - 2 * EPS), astragalWidthM, astragalDepth),
        frameMat
      );
      hBar.name = `${namePrefix}.horizontalAstragal_${r}_${c}`;
      hBar.position.set(cx, ay, 0);
      hBar.castShadow = true;
      sash.add(hBar);
    }
  }

  // Individual rebated crown-glass panes (zero overlap with stiles, rails, or astragals!)
  for (let r = 0; r < rows; r++) {
    const py = yStart + r * (cellH + astragalWidthM) + cellH * 0.5;
    for (let c = 0; c < cols; c++) {
      const px = xStart + c * (cellW + astragalWidthM) + cellW * 0.5;
      const paneW = Math.max(0.02, cellW - 2 * EPS);
      const paneH = Math.max(0.02, cellH - 2 * EPS);
      const paneMesh = new THREE.Mesh(
        sharedBoxGeometry(paneW, paneH, glassThickness),
        glassMat
      );
      paneMesh.name = `${namePrefix}.glassPane_${r}_${c}`;
      paneMesh.position.set(px, py, 0);
      paneMesh.userData.isExteriorGlazedPortal = true;
      sash.add(paneMesh);
      glassPanesOut.push(paneMesh);
    }
  }

  return sash;
}

function applyRecursiveCutawayTag(root: THREE.Object3D, descriptor: CutawayWallDescriptor): void {
  tagCutaway(root, descriptor, { recursive: true });
  root.traverse((child) => {
    if (child instanceof THREE.Group) {
      child.userData.isCutawayWall = true;
      child.userData.cutawayWall = descriptor;
    }
  });
}

/**
 * Interactive controller for a British Georgian / Victorian vertical-sliding box-sash window.
 * Smoothly slides `lowerSashGroup` vertically with `easeInOutCubic`, rotates the brass Fitch
 * sash fastener, emits spatial cord-and-pulley foley, and exposes live `AcousticPortalState`.
 */
export class VerticalSlidingSashController implements AnimatedInteractable {
  public readonly id: string;
  public readonly label: string;
  public readonly aliases: readonly string[];
  public readonly clickableTargets: readonly THREE.Object3D[];

  private readonly windowGroup: THREE.Group;
  private readonly lowerSashGroup: THREE.Group;
  private readonly fitchLeverPivot: THREE.Object3D | undefined;
  private readonly closedY: number;
  private readonly maxOpenTravelM: number;
  private readonly clearOpeningWidthM: number;
  private readonly durationSeconds: number;
  private readonly worldPosScratch = new THREE.Vector3();

  private progress01: number;
  private target01: number;

  public constructor(options: RegisterVerticalSlidingSashOptions) {
    sashInstanceSeq += 1;
    this.id = options.id ?? `georgian-sash-window-${sashInstanceSeq}`;
    this.label = options.label ?? 'Georgian Sash Window';
    this.aliases = options.aliases ?? [
      'sash window',
      'open window',
      'close window',
      'georgian sash',
    ];
    this.windowGroup = options.windowGroup;
    this.lowerSashGroup = options.lowerSashGroup;
    this.fitchLeverPivot = options.fitchLeverPivot;
    this.clickableTargets = options.clickableTargets ?? [options.windowGroup];
    this.closedY = options.closedY ?? options.lowerSashGroup.position.y;
    this.maxOpenTravelM = Math.max(0.01, options.maxOpenTravelM);
    this.clearOpeningWidthM = Math.max(0.1, options.clearOpeningWidthM ?? 0.9);
    this.durationSeconds = Math.max(0.05, options.durationSeconds ?? 0.65);

    const initRatio = clamp01(options.initialOpenRatio ?? 0);
    this.progress01 = initRatio;
    this.target01 = initRatio > 0.5 ? 1 : 0;

    tagDynamicBatch(this.lowerSashGroup);

    const cutawayDesc =
      options.cutawayWall ??
      (this.windowGroup.userData?.cutawayWall as CutawayWallDescriptor | undefined);
    if (cutawayDesc) {
      applyRecursiveCutawayTag(this.windowGroup, cutawayDesc);
    }

    this.applyKinematics();
  }

  public getOpenness01(): number {
    return clamp01(easeInOutCubic(this.progress01));
  }

  public isOpen(): boolean {
    return this.target01 > 0.5;
  }

  public setOpenRatio(ratio01: number): void {
    const r = clamp01(ratio01);
    this.progress01 = r;
    this.target01 = r > 0.5 ? 1 : 0;
    this.applyKinematics();
  }

  public describe(): string {
    return this.target01 > 0.5 ? `Close ${this.label}` : `Open ${this.label}`;
  }

  public trigger(): boolean {
    const opening = this.target01 < 0.5;
    this.target01 = opening ? 1 : 0;
    this.emitSashFoley(opening);
    return true;
  }

  public step(dtSeconds: number): boolean {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return false;
    if (Math.abs(this.progress01 - this.target01) <= 1e-6) {
      if (this.progress01 !== this.target01) {
        this.progress01 = this.target01;
        this.applyKinematics();
        return true;
      }
      return false;
    }

    const delta = dtSeconds / this.durationSeconds;
    if (this.progress01 < this.target01) {
      this.progress01 = Math.min(this.target01, this.progress01 + delta);
    } else {
      this.progress01 = Math.max(this.target01, this.progress01 - delta);
    }
    this.applyKinematics();
    return true;
  }

  public collectDynamicObjects(out: Set<THREE.Object3D>): void {
    out.add(this.lowerSashGroup);
    if (this.fitchLeverPivot) {
      out.add(this.fitchLeverPivot);
    }
  }

  public getAcousticPortalState(): AcousticPortalState {
    this.windowGroup.updateWorldMatrix(true, false);
    this.windowGroup.getWorldPosition(this.worldPosScratch);
    return {
      id: this.id,
      position: [this.worldPosScratch.x, this.worldPosScratch.y, this.worldPosScratch.z],
      areaM2: this.clearOpeningWidthM * this.maxOpenTravelM,
      openness: this.getOpenness01(),
    };
  }

  private applyKinematics(): void {
    const eased = easeInOutCubic(this.progress01);
    this.lowerSashGroup.position.y = this.closedY + eased * this.maxOpenTravelM;
    this.lowerSashGroup.updateMatrix();

    if (this.fitchLeverPivot) {
      // Brass Fitch fastener unlatches 90 deg during the first 18% of travel (and latches in the final 18% when closing)
      const latchPhase = clamp01(this.progress01 / 0.18);
      this.fitchLeverPivot.rotation.y = easeInOutCubic(latchPhase) * (Math.PI * 0.5);
      this.fitchLeverPivot.updateMatrix();
    }
  }

  private emitSashFoley(opening: boolean): void {
    try {
      this.windowGroup.updateWorldMatrix(true, false);
      this.windowGroup.getWorldPosition(this.worldPosScratch);
      const pos = {
        x: this.worldPosScratch.x,
        y: this.worldPosScratch.y,
        z: this.worldPosScratch.z,
      };
      soundEngine.playSpatial(pos, (tk) => {
        const t0 = tk.now;
        // Brass Fitch fastener click
        tk.tone({
          startTime: t0 + (opening ? 0.0 : 0.52),
          duration: 0.035,
          type: 'triangle',
          freqStart: opening ? 1420 : 1180,
          freqEnd: opening ? 920 : 760,
          gainPeak: 0.08,
        });
        // Timber sash slide & pulley cord rumble
        tk.noiseBurst({
          startTime: t0 + 0.03,
          duration: 0.52,
          filterType: 'bandpass',
          freqStart: opening ? 320 : 440,
          freqEnd: opening ? 460 : 280,
          q: 1.4,
          gainPeak: 0.12,
          attackSec: 0.04,
        });
      });
    } catch {
      // Safe no-op in headless Node test environments without WebAudio
    }
  }
}

/**
 * Registers a vertical-sliding Georgian box-sash window on an `InteractionRegistry` or
 * `SceneBuilderContext`, tagging `lowerSashGroup` for dynamic batch exclusion, preserving
 * recursive `cutawayWall` metadata, and wiring `registerExteriorAcousticPortal` when available.
 */
export function registerVerticalSlidingSash(
  target: InteractionTarget,
  options: RegisterVerticalSlidingSashOptions
): VerticalSlidingSashController {
  const registry = resolveInteractionRegistry(target);
  const controller = new VerticalSlidingSashController(options);
  registry.registerAnimatedInteractable(controller);

  const portalRegistry = registry as unknown as {
    registerExteriorAcousticPortal?: (provider: () => AcousticPortalState) => void;
  };
  if (typeof portalRegistry.registerExteriorAcousticPortal === 'function') {
    portalRegistry.registerExteriorAcousticPortal(() => controller.getAcousticPortalState());
  }

  return controller;
}

/**
 * Builds an authentic, zero-z-fighting British Georgian / Victorian double-hung box-sash window
 * with offset outer/inner sash tracks, slender 18 mm ovolo glazing bars, brass Fitch fastener &
 * sash lifts, splayed gauged rubbed-brick jack-arch lintel, sawn Yorkstone sill, interior reveal
 * linings & moulded architrave, and optional automatic interaction registration.
 */
export function createGeorgianSashWindow(
  options: CreateGeorgianSashWindowOptions = {}
): GeorgianSashWindowResult {
  const width = Math.max(0.45, options.width ?? 1.08);
  const height = Math.max(0.75, options.height ?? 1.85);
  const wallThickness = Math.max(0.16, options.wallThickness ?? 0.26);
  const boxRecessFromExteriorM = Math.max(
    0.02,
    Math.min(wallThickness - 0.1, options.boxRecessFromExteriorM ?? 0.1)
  );
  const panesCols = Math.max(1, Math.round(options.panesCols ?? 3));
  const panesTopRows = Math.max(1, Math.round(options.panesTopRows ?? 2));
  const panesBottomRows = Math.max(1, Math.round(options.panesBottomRows ?? 2));
  const astragalWidthM = Math.max(0.01, Math.min(0.036, options.astragalWidthM ?? 0.018));
  const glazingProportion = Math.max(0.25, Math.min(0.75, options.glazingProportion ?? 0.5));
  const initialOpenRatio = clamp01(options.initialOpenRatio ?? 0);
  const lintelStyle: GeorgianLintelStyle = options.lintel ?? 'gauged-brick-jack-arch';
  const sillStyle: GeorgianSillStyle = options.sill ?? 'yorkstone';
  const includeInteriorArchitrave = options.includeInteriorArchitrave ?? true;
  const includeHorns = options.includeHorns ?? false;

  const frameMat = options.frameMaterial ?? getDefaultFrameMaterial();
  const glassMat = options.glassMaterial ?? getDefaultGlassMaterial();
  const hardwareMat = options.hardwareMaterial ?? getDefaultHardwareMaterial();
  const rubbedBrickMat = options.rubbedBrickMaterial ?? getDefaultRubbedBrickMaterial();
  const mortarMat = options.mortarMaterial ?? getDefaultMortarMaterial();
  const stoneSillMat =
    options.stoneSillMaterial ??
    (sillStyle === 'painted-stone' ? getDefaultPaintedStoneMaterial() : getDefaultYorkstoneMaterial());
  const architraveMat = options.architraveMaterial ?? getDefaultArchitraveMaterial();
  const cordMat = getDefaultSashCordMaterial();

  const baseName = options.id ?? 'georgianSashWindow';
  const group = new THREE.Group();
  group.name = baseName;
  if (options.position) {
    group.position.set(options.position[0], options.position[1], options.position[2]);
  }
  if (typeof options.rotationY === 'number') {
    group.rotation.y = options.rotationY;
  }
  if (options.zone) {
    group.userData.zoneId = options.zone;
  }

  const halfW = width * 0.5;
  const zExt = -wallThickness * 0.5;
  const zInt = wallThickness * 0.5;

  // Box-frame Z plane layout:
  // Outer lining front sits at zExt + boxRecessFromExteriorM (default -0.13 + 0.10 = -0.03 m).
  const outerLiningThickness = 0.014;
  const zBoxFront = zExt + boxRecessFromExteriorM;
  const boxCenterZ = zBoxFront + outerLiningThickness + TRACK_HALF_OFFSET_M + SASH_THICKNESS_M * 0.5 + 0.002;
  const zUpper = boxCenterZ - TRACK_HALF_OFFSET_M;
  const zLower = boxCenterZ + TRACK_HALF_OFFSET_M;
  const zStaffBeadBack = zLower + SASH_THICKNESS_M * 0.5 + 0.002 + 0.014;

  // Box-Frame (weathered timber cill, pulley stiles, head lining, outer lining, parting bead, staff bead)
  const boxFrameGroup = new THREE.Group();
  boxFrameGroup.name = `${baseName}.boxFrame`;
  group.add(boxFrameGroup);

  const boxTotalDepth = zStaffBeadBack - zBoxFront;
  const boxMidZ = (zBoxFront + zStaffBeadBack) * 0.5;

  // Weathered timber cill at bottom of structural opening (Y in [EPS, TIMBER_CILL_HEIGHT_M])
  const timberCill = new THREE.Mesh(
    sharedBoxGeometry(width, TIMBER_CILL_HEIGHT_M - EPS, boxTotalDepth + 0.016),
    frameMat
  );
  timberCill.name = `${baseName}.timberCill`;
  timberCill.position.set(0, (TIMBER_CILL_HEIGHT_M + EPS) * 0.5, boxMidZ - 0.008);
  timberCill.castShadow = true;
  timberCill.receiveShadow = true;
  boxFrameGroup.add(timberCill);

  // Head lining at top of structural opening (Y in [height - HEAD_LINING_HEIGHT_M, height - EPS])
  const headLining = new THREE.Mesh(
    sharedBoxGeometry(width, HEAD_LINING_HEIGHT_M - EPS, boxTotalDepth),
    frameMat
  );
  headLining.name = `${baseName}.headLining`;
  headLining.position.set(0, height - (HEAD_LINING_HEIGHT_M + EPS) * 0.5, boxMidZ);
  headLining.castShadow = true;
  boxFrameGroup.add(headLining);

  const innerFrameY0 = TIMBER_CILL_HEIGHT_M;
  const innerFrameY1 = height - HEAD_LINING_HEIGHT_M;
  const innerHeight = Math.max(0.3, innerFrameY1 - innerFrameY0);
  const pulleyStileH = Math.max(0.2, innerHeight - 2 * EPS);

  // Left & Right pulley stiles, parting beads, outer linings, staff beads, and sash cords
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1;
    const stileX = sign * (halfW - PULLEY_STILE_WIDTH_M * 0.5);

    const pulleyStile = new THREE.Mesh(
      sharedBoxGeometry(PULLEY_STILE_WIDTH_M, pulleyStileH, boxTotalDepth),
      frameMat
    );
    pulleyStile.name = `${baseName}.pulleyStile_${side}`;
    pulleyStile.position.set(stileX, innerFrameY0 + innerHeight * 0.5, boxMidZ);
    pulleyStile.castShadow = true;
    pulleyStile.receiveShadow = true;
    boxFrameGroup.add(pulleyStile);

    const innerFaceX = sign * (halfW - PULLEY_STILE_WIDTH_M - 0.004);
    const partingBead = new THREE.Mesh(
      sharedBoxGeometry(0.007, pulleyStileH, 0.003),
      frameMat
    );
    partingBead.name = `${baseName}.partingBead_${side}`;
    partingBead.position.set(innerFaceX, innerFrameY0 + innerHeight * 0.5, boxCenterZ);
    tagHighLod(partingBead, 14);
    boxFrameGroup.add(partingBead);

    const staffBead = new THREE.Mesh(
      sharedBoxGeometry(0.012, pulleyStileH, 0.012),
      frameMat
    );
    staffBead.name = `${baseName}.staffBead_${side}`;
    staffBead.position.set(
      sign * (halfW - PULLEY_STILE_WIDTH_M - 0.006 - EPS),
      innerFrameY0 + innerHeight * 0.5,
      zLower + SASH_THICKNESS_M * 0.5 + 0.008
    );
    tagHighLod(staffBead, 14);
    boxFrameGroup.add(staffBead);

    // Subtle waxed-hemp sash cord in lower track groove
    const cordH = innerHeight * 0.52;
    const cord = new THREE.Mesh(sharedCylinderGeometry(0.0028, 0.0028, cordH, 8), cordMat);
    cord.name = `${baseName}.sashCord_${side}`;
    cord.position.set(
      sign * (halfW - PULLEY_STILE_WIDTH_M - 0.0035),
      innerFrameY1 - cordH * 0.5 - 0.01,
      zLower
    );
    tagHighLod(cord, 12);
    boxFrameGroup.add(cord);
  }

  // Head parting bead & staff bead
  const clearOpeningWidthM = Math.max(0.2, width - 2 * PULLEY_STILE_WIDTH_M);
  const sashWidth = clearOpeningWidthM - 0.003;

  // Upper Outer Sash & Lower Inner Sliding Sash
  // Meeting rails overlap vertically by SASH_MEETING_RAIL_M at split elevation:
  const splitCenterY = innerFrameY0 + innerHeight * (1 - glazingProportion);
  const meetingOverlap = SASH_MEETING_RAIL_M;
  const upperSashY0 = splitCenterY - meetingOverlap * 0.5;
  const upperSashHeight = Math.max(0.2, innerFrameY1 - EPS - upperSashY0);
  const lowerSashClosedY = innerFrameY0 + EPS;
  const lowerSashHeight = Math.max(0.2, splitCenterY + meetingOverlap * 0.5 - lowerSashClosedY);

  const glassPanes: THREE.Mesh[] = [];

  const upperSashGroup = buildSashLeaf({
    namePrefix: `${baseName}.upperSash`,
    sashWidth,
    sashHeight: upperSashHeight,
    topRailH: SASH_TOP_RAIL_M,
    bottomRailH: SASH_MEETING_RAIL_M,
    cols: panesCols,
    rows: panesTopRows,
    astragalWidthM,
    frameMat,
    glassMat,
    includeHorns,
    glassPanesOut: glassPanes,
  });
  upperSashGroup.position.set(0, upperSashY0, zUpper);
  group.add(upperSashGroup);

  const lowerSashGroup = buildSashLeaf({
    namePrefix: `${baseName}.lowerSash`,
    sashWidth,
    sashHeight: lowerSashHeight,
    topRailH: SASH_MEETING_RAIL_M,
    bottomRailH: SASH_BOTTOM_RAIL_M,
    cols: panesCols,
    rows: panesBottomRows,
    astragalWidthM,
    frameMat,
    glassMat,
    includeHorns: false,
    glassPanesOut: glassPanes,
  });
  lowerSashGroup.position.set(0, lowerSashClosedY, zLower);
  group.add(lowerSashGroup);

  // Period Brass Ironmongery:
  // Keep catch on upper sash meeting rail top (stationary in zUpper plane)
  const keepMesh = new THREE.Mesh(sharedBoxGeometry(0.036, 0.01, 0.014), hardwareMat);
  keepMesh.name = `${baseName}.fitchFastenerKeep`;
  keepMesh.position.set(0, SASH_MEETING_RAIL_M + 0.005 + 2 * EPS, 0.004);
  tagHighLod(keepMesh, 12);
  upperSashGroup.add(keepMesh);

  // Pivoting brass Fitch sash fastener on lower sash meeting rail top + twin sash lifts on bottom rail
  const fastenerBase = new THREE.Mesh(
    sharedCylinderGeometry(0.012, 0.014, 0.008, 12),
    hardwareMat
  );
  fastenerBase.name = `${baseName}.fitchFastenerBase`;
  fastenerBase.position.set(0, lowerSashHeight + 0.004 + EPS, -0.002);
  tagHighLod(fastenerBase, 12);
  lowerSashGroup.add(fastenerBase);

  const fitchLeverPivot = new THREE.Group();
  fitchLeverPivot.name = `${baseName}.fitchFastenerPivot`;
  fitchLeverPivot.position.set(0, lowerSashHeight + 0.011, -0.002);
  lowerSashGroup.add(fitchLeverPivot);

  const fitchArm = new THREE.Mesh(sharedBoxGeometry(0.01, 0.005, 0.032), hardwareMat);
  fitchArm.name = `${baseName}.fitchFastenerArm`;
  fitchArm.position.set(0, 0, -0.012);
  tagHighLod(fitchArm, 12);
  fitchLeverPivot.add(fitchArm);

  const fitchKnob = new THREE.Mesh(sharedSphereGeometry(0.0065, 10, 8), hardwareMat);
  fitchKnob.name = `${baseName}.fitchFastenerKnob`;
  fitchKnob.position.set(0, 0.003, -0.026);
  tagHighLod(fitchKnob, 12);
  fitchLeverPivot.add(fitchKnob);

  // Twin brass sash lifts on interior face of lower sash bottom rail
  const liftOffsetX = Math.min(sashWidth * 0.28, 0.24);
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1;
    const liftPlate = new THREE.Mesh(sharedBoxGeometry(0.048, 0.022, 0.004), hardwareMat);
    liftPlate.name = `${baseName}.sashLiftPlate_${side}`;
    liftPlate.position.set(
      sign * liftOffsetX,
      SASH_BOTTOM_RAIL_M * 0.45,
      SASH_THICKNESS_M * 0.5 + 0.002 + EPS
    );
    tagHighLod(liftPlate, 12);
    lowerSashGroup.add(liftPlate);

    const liftHook = new THREE.Mesh(sharedBoxGeometry(0.032, 0.008, 0.016), hardwareMat);
    liftHook.name = `${baseName}.sashLiftHook_${side}`;
    liftHook.position.set(
      sign * liftOffsetX,
      SASH_BOTTOM_RAIL_M * 0.36,
      SASH_THICKNESS_M * 0.5 + 0.012
    );
    tagHighLod(liftHook, 12);
    lowerSashGroup.add(liftHook);
  }

  // Georgian Exterior Masonry Dressings:
  // Splayed Gauged Rubbed-Brick Flat Jack-Arch Lintel
  let voussoirCount = 0;
  if (lintelStyle !== 'none') {
    const lintelGroup = new THREE.Group();
    lintelGroup.name = `${baseName}.jackArchLintel`;
    group.add(lintelGroup);

    const rawCount = Math.max(9, Math.round(width / 0.092));
    voussoirCount = rawCount % 2 === 1 ? rawCount : rawCount + 1; // Always odd (e.g. 11 or 13)
    const midIdx = (voussoirCount - 1) >> 1;

    const skewbackProj =
      JACK_ARCH_HEIGHT_M * Math.tan((JACK_ARCH_SKEWBACK_DEG * Math.PI) / 180);
    const yArchBot = height + EPS;
    const yArchTop = height + JACK_ARCH_HEIGHT_M;
    const zBrickFront = zExt - JACK_ARCH_PROUD_M;
    const zBrickBack = zBoxFront - EPS;
    const zMortarFront = zBrickFront + MORTAR_RECESS_M;
    const zMortarBack = zBrickBack - EPS;

    const xBotAt = (u: number): number => -halfW + u * width;
    const xTopAt = (u: number): number =>
      -(halfW + skewbackProj) + u * (width + 2 * skewbackProj);
    const halfJoint = MORTAR_JOINT_WIDTH_M * 0.5;
    const jointClear = 0.00025;

    for (let i = 0; i < voussoirCount; i++) {
      const u0 = i / voussoirCount;
      const u1 = (i + 1) / voussoirCount;

      const trimL = i === 0 ? 0 : halfJoint + jointClear;
      const trimR = i === voussoirCount - 1 ? 0 : halfJoint + jointClear;

      const isKeystone = lintelStyle === 'stone-keystone-arch' && i === midIdx;
      const vYBot = isKeystone ? yArchBot - 0.008 : yArchBot;
      const vYTop = isKeystone ? yArchTop + 0.022 : yArchTop;
      const vZFront = isKeystone ? zBrickFront - 0.014 : zBrickFront;
      const vMat = isKeystone ? getDefaultYorkstoneMaterial() : rubbedBrickMat;

      const vGeo = buildQuadPrismXY(
        xBotAt(u0) + trimL,
        xBotAt(u1) - trimR,
        xTopAt(u1) - trimR,
        xTopAt(u0) + trimL,
        vYBot,
        vYTop,
        vZFront,
        zBrickBack
      );
      const vMesh = new THREE.Mesh(vGeo, vMat);
      vMesh.name = isKeystone
        ? `${baseName}.jackArchKeystone`
        : `${baseName}.jackArchVoussoir_${i}`;
      vMesh.castShadow = true;
      vMesh.receiveShadow = true;
      lintelGroup.add(vMesh);

      if (i < voussoirCount - 1) {
        const uj = (i + 1) / voussoirCount;
        const mGeo = buildQuadPrismXY(
          xBotAt(uj) - halfJoint,
          xBotAt(uj) + halfJoint,
          xTopAt(uj) + halfJoint,
          xTopAt(uj) - halfJoint,
          yArchBot + EPS,
          yArchTop - EPS,
          zMortarFront,
          zMortarBack
        );
        const mMesh = new THREE.Mesh(mGeo, mortarMat);
        mMesh.name = `${baseName}.jackArchMortar_${i}`;
        lintelGroup.add(mMesh);
      }
    }
  }

  // Projecting Sawn Yorkstone Sill
  let sillWidthM = 0;
  let sillProjectionM = 0;
  if (sillStyle !== 'none') {
    sillWidthM = width + 2 * SILL_EAR_EXTENSION_M;
    sillProjectionM = SILL_PROJECTION_M;
    const zSillFront = zExt - SILL_PROJECTION_M;
    const zSillBack = boxMidZ;
    const sillGeo = buildYorkstoneSillGeometry(sillWidthM, zSillFront, zSillBack);
    const sillMesh = new THREE.Mesh(sillGeo, stoneSillMat);
    sillMesh.name = `${baseName}.stoneSill`;
    sillMesh.castShadow = true;
    sillMesh.receiveShadow = true;
    group.add(sillMesh);
  }

  // Interior Joinery (reveal linings, bullnose window board, moulded architrave surround)
  if (includeInteriorArchitrave) {
    const interiorGroup = new THREE.Group();
    interiorGroup.name = `${baseName}.interiorJoinery`;
    group.add(interiorGroup);

    const liningThickness = 0.018;
    const zLiningStart = zStaffBeadBack + EPS;
    const zLiningEnd = zInt - EPS;
    const liningDepth = Math.max(0.012, zLiningEnd - zLiningStart);
    const zLiningMid = (zLiningStart + zLiningEnd) * 0.5;

    // Left, right & head timber reveal linings (side linings land on top of the window board)
    const boardThickness = 0.024;
    const sideRevY0 = boardThickness + 2 * EPS;
    const sideRevY1 = height - 0.015;
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      const rev = new THREE.Mesh(
        sharedBoxGeometry(liningThickness, sideRevY1 - sideRevY0, liningDepth),
        architraveMat
      );
      rev.name = `${baseName}.revealLining_${side}`;
      rev.position.set(
        sign * (halfW - liningThickness * 0.5),
        (sideRevY0 + sideRevY1) * 0.5,
        zLiningMid
      );
      interiorGroup.add(rev);
    }

    const headRev = new THREE.Mesh(
      sharedBoxGeometry(width - 2 * liningThickness - 2 * EPS, liningThickness, liningDepth),
      architraveMat
    );
    headRev.name = `${baseName}.revealLining_head`;
    headRev.position.set(0, height - liningThickness * 0.5 - EPS, zLiningMid);
    interiorGroup.add(headRev);

    // Bullnose projecting interior window board (cill board)
    const architraveWidth = 0.068;
    const architraveProud = 0.018;
    const boardWidth = width + 2 * architraveWidth + 0.04;
    const zBoardBack = zStaffBeadBack + EPS;
    const zBoardFront = zInt + 0.036;
    const boardFlatDepth = Math.max(0.02, zBoardFront - zBoardBack);

    const cillBoard = new THREE.Mesh(
      sharedBoxGeometry(boardWidth, boardThickness, boardFlatDepth),
      architraveMat
    );
    cillBoard.name = `${baseName}.interiorWindowBoard`;
    cillBoard.position.set(
      0,
      boardThickness * 0.5 + EPS,
      (zBoardBack + zBoardFront) * 0.5
    );
    cillBoard.castShadow = true;
    cillBoard.receiveShadow = true;
    interiorGroup.add(cillBoard);

    const boardNoseR = boardThickness * 0.5;
    const boardBullnoseGeo = prepGeo(
      new THREE.CylinderGeometry(boardNoseR, boardNoseR, boardWidth, 12, 1, false, 0, Math.PI)
    );
    const boardBullnose = new THREE.Mesh(boardBullnoseGeo, architraveMat);
    boardBullnose.name = `${baseName}.interiorWindowBoardNose`;
    boardBullnose.rotation.z = Math.PI * 0.5;
    boardBullnose.rotation.x = Math.PI * 0.5;
    boardBullnose.position.set(0, boardNoseR + EPS, zBoardFront + EPS);
    interiorGroup.add(boardBullnose);

    // Moulded architrave surround proud of interior plaster face (+wallThickness/2 + EPS)
    const zArchBack = zInt + EPS;
    const zArchMid = zArchBack + architraveProud * 0.5;
    const legY0 = boardThickness + 2 * EPS;
    const legH = Math.max(0.2, height - legY0);

    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      const archLeg = new THREE.Mesh(
        sharedBoxGeometry(architraveWidth, legH, architraveProud),
        architraveMat
      );
      archLeg.name = `${baseName}.architraveLeg_${side}`;
      archLeg.position.set(
        sign * (halfW + architraveWidth * 0.5 - liningThickness),
        legY0 + legH * 0.5,
        zArchMid
      );
      archLeg.castShadow = true;
      interiorGroup.add(archLeg);
    }

    const headSpan = width + 2 * (architraveWidth - liningThickness);
    const archHead = new THREE.Mesh(
      sharedBoxGeometry(headSpan, architraveWidth, architraveProud),
      architraveMat
    );
    archHead.name = `${baseName}.architraveHead`;
    archHead.position.set(
      0,
      height + architraveWidth * 0.5 + EPS,
      zArchMid
    );
    archHead.castShadow = true;
    interiorGroup.add(archHead);
  }

  const defaultMaxTravel = Math.max(0.08, innerHeight * 0.5 - 0.1);
  const maxOpenTravelM = Math.max(
    0.04,
    Math.min(innerHeight - lowerSashHeight - 0.02, options.maxOpenTravelM ?? defaultMaxTravel)
  );

  // Apply initial open ratio even when no InteractionRegistry is passed
  if (initialOpenRatio > 0) {
    const easedInit = easeInOutCubic(initialOpenRatio);
    lowerSashGroup.position.y = lowerSashClosedY + easedInit * maxOpenTravelM;
    fitchLeverPivot.rotation.y =
      easeInOutCubic(clamp01(initialOpenRatio / 0.18)) * (Math.PI * 0.5);
  }

  ensureNamedAddedChildren(group, 0, baseName);

  if (options.cutawayWall) {
    applyRecursiveCutawayTag(group, options.cutawayWall);
  }

  let controller: VerticalSlidingSashController | undefined;
  if (options.interactions) {
    controller = registerVerticalSlidingSash(options.interactions, {
      windowGroup: group,
      lowerSashGroup,
      fitchLeverPivot,
      clickableTargets: [group],
      id: options.id,
      label: options.label,
      closedY: lowerSashClosedY,
      maxOpenTravelM,
      clearOpeningWidthM,
      initialOpenRatio,
      cutawayWall: options.cutawayWall,
    });
  } else {
    attachAssetInteraction(lowerSashGroup, {
      kind: 'slide',
      ...(options.id ? { id: options.id } : {}),
      label: options.label ? `Open ${options.label}` : 'Open Sash Window',
      slideDelta: [0, maxOpenTravelM, 0],
      acousticPortal: true,
      audio: { openPreset: 'sashWindowSlide', closePreset: 'sashWindowSlide' },
    });
  }

  const totalPanes = panesCols * (panesTopRows + panesBottomRows);
  attachAssetMetadata(group, {
    name: `Georgian ${panesCols * panesTopRows}-over-${panesCols * panesBottomRows} Box-Sash Window`,
    brand: 'Mumford & Wood',
    collection: 'Conservation Box Sash',
    sku: `MW-CBS-${totalPanes}P-${Math.round(width * 1000)}X${Math.round(height * 1000)}`,
    finish: 'Painted Accoya Off-White / Aged Brass Fitch Hardware',
    category: 'architectural',
    dimensionsMm: mmFromMetres(width, wallThickness, height),
    productUrl: 'https://www.mumfordwood.com/products/sash-windows/conservation-sash-windows/',
    schematicUrl: 'https://www.mumfordwood.com/technical/cad-details/conservation-box-sash-section.pdf',
  });

  group.updateMatrixWorld(true);

  return {
    group,
    upperSashGroup,
    lowerSashGroup,
    fitchLeverPivot,
    glassPanes,
    voussoirCount,
    sillWidthM,
    sillProjectionM,
    clearOpeningWidthM,
    maxOpenTravelM,
    closedLowerSashY: lowerSashClosedY,
    ...(controller !== undefined ? { controller } : {}),
  };
}
