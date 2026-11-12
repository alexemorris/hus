import * as THREE from 'three';
import { attachAssetInteraction, attachAssetMetadata } from '../shared/catalog-smart-metadata.ts';
import type { SceneBuilderContext } from '../../engine/viewer/scene-types.ts';
import { getOrCreateCachedPropTexture } from '../../engine/textures/texture-registry.ts';
import {
  sharedBoxGeometry,
  sharedCylinderGeometry,
  sharedTorusGeometry,
} from '../shared/geometry-cache.ts';
import { tagHighLod } from '../shared/scene-helpers.ts';

export interface CoxNivalaDeskOptions {
  readonly name: string;
  readonly zone: string;
  /** World or parent-group position of the desk center on the finished floor (`y = FFL`). */
  readonly position: readonly [number, number, number];
  /**
   * Rotation around Y in radians (`0` = user sits on `-Z` side facing `+Z` toward the rear upstand at `+Z`).
   */
  readonly rotationY?: number;
  /** Optional interaction registry to register the right-hand drawer as a sliding drawer. */
  readonly interactions?: SceneBuilderContext['interactions'];
  /** Whether to include the matching sculpted oak & oatmeal bouclé desk chair tucked in front (`default: true`). */
  readonly includeChair?: boolean;
  /** Optional non-coplanar butt-joint & groove clearances for strict z-fight auditing (`default: false`). */
  readonly insetJoineryButtJoints?: boolean;
}

function createHoneyedWhiteOakTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('cox-nivala-desk:honeyed-white-oak', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#c9a476';
      ctx.fillRect(0, 0, 256, 256);

      for (let i = 0; i < 170; i++) {
        const y = (i * 1.5) % 256;
        const light = i % 3 === 0;
        ctx.strokeStyle = light ? 'rgba(241, 224, 198, 0.24)' : 'rgba(134, 96, 58, 0.21)';
        ctx.lineWidth = light ? 1.0 : 1.4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        const wave = Math.sin(i * 0.39) * 2.6;
        ctx.bezierCurveTo(86, y + wave, 170, y - wave, 256, y);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

function createChairBoucleTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('cox-nivala-desk:chair-oatmeal-boucle', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#dfd6c6';
      ctx.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 4) {
        for (let x = 0; x < 128; x += 4) {
          const v = ((x * 19 + y * 29) % 21) - 10;
          const base = 220 + v;
          ctx.fillStyle = `rgb(${base}, ${base - 9}, ${base - 22})`;
          ctx.fillRect(x, y, 3, 3);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

function createMacBookScreenTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('cox-nivala-desk:macbook-screen', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 256, 160);
      grad.addColorStop(0, '#17253b');
      grad.addColorStop(0.55, '#1e3a5f');
      grad.addColorStop(1, '#111827');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 160);

      // Top macOS menu bar
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.fillRect(0, 0, 256, 10);

      // Clean floating document/editor card
      ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
      ctx.fillRect(28, 20, 200, 114);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(28, 20, 200, 12);
      ctx.fillStyle = '#64748b';
      for (let line = 0; line < 7; line++) {
        ctx.fillRect(42, 44 + line * 11, 120 + ((line * 29) % 52), 4);
      }

      // Bottom dock bar
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(68, 142, 120, 12);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

function createRoundedUpstandHalfGeometry(
  width: number,
  height: number,
  thickness: number,
  roundLeftOuter: boolean
): THREE.BufferGeometry {
  const r = Math.min(0.018, height * 0.36);
  const shape = new THREE.Shape();
  const x0 = -width * 0.5;
  const x1 = width * 0.5;

  shape.moveTo(x0, 0);
  shape.lineTo(x1, 0);
  if (roundLeftOuter) {
    // Inner split notch on right (+X) is crisp vertical; outer left (-X) top corner is rounded!
    shape.lineTo(x1, height);
    shape.lineTo(x0 + r, height);
    shape.quadraticCurveTo(x0, height, x0, height - r);
  } else {
    // Inner split notch on left (-X) is crisp vertical; outer right (+X) top corner is rounded!
    shape.lineTo(x1, height - r);
    shape.quadraticCurveTo(x1, height, x1 - r, height);
    shape.lineTo(x0, height);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
  });
  geo.translate(0, 0, -thickness * 0.5);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds the Cox & Cox `Nivala Desk` (`SKU 1252340`, `H 81.5 × W 120 × D 57 cm`):
 * - Medium-warm honeyed white oak
 * - `1.200 × 0.570 m` chamfered desktop at `+0.765 m` above FFL
 * - `50 mm` tall rear upstand lip (`+0.765 .. +0.815 m`) with rounded outer top corners
 *   and the signature central `12 mm` wire-pass split notch at `X = 0`
 * - Under-top `12.5 cm` storage carcass split into:
 *   - Left open cubby (`W 54.5 × H 9.0 cm`) with a cloth-bound notebook & brass pen inside
 *   - Right drawer (`W 54.0 × H 8.5 cm`) with a `Ø 20 × 22 mm` brushed satin nickel round knob,
 *     registered as an interactive sliding drawer pulling `-Z` into the room
 * - `4` straight `36 × 36 mm` square oak legs with front-to-back side H-stretchers carrying
 *   the `109 × 15 cm` narrow rear book/storage shelf at `+0.39 m`
 * - Open 14" silver/space-grey MacBook Pro laptop + stoneware ceramic mug on the desktop
 * - Matching contemporary sculpted honeyed-oak & oatmeal bouclé desk chair tucked neatly in front.
 */
export function buildCoxNivalaDesk(
  parent: THREE.Object3D,
  options: CoxNivalaDeskOptions
): THREE.Group {
  const {
    name,
    zone,
    position,
    rotationY = 0,
    interactions,
    includeChair = true,
    insetJoineryButtJoints = false,
  } = options;

  const root = new THREE.Group();
  root.name = name;
  root.userData.zone = zone;
  root.userData.zoneId = zone;
  root.position.set(position[0], position[1], position[2]);
  root.rotation.y = rotationY;

  const oakMat = new THREE.MeshStandardMaterial({
    color: 0xd4b287,
    map: createHoneyedWhiteOakTexture(),
    roughness: 0.42,
    metalness: 0.02,
  });
  const satinNickelMat = new THREE.MeshStandardMaterial({
    color: 0xc8ccd0,
    roughness: 0.28,
    metalness: 0.86,
  });
  const spaceGreyAluminumMat = new THREE.MeshStandardMaterial({
    color: 0x8e939b,
    roughness: 0.28,
    metalness: 0.82,
  });
  const keyboardDarkMat = new THREE.MeshStandardMaterial({
    color: 0x1c1e22,
    roughness: 0.52,
    metalness: 0.12,
  });
  const macScreenBezelMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d10,
    roughness: 0.14,
    metalness: 0.18,
  });
  const macScreenDisplayMat = new THREE.MeshStandardMaterial({
    map: createMacBookScreenTexture(),
    emissive: 0x1e293b,
    emissiveIntensity: 0.35,
    roughness: 0.12,
    metalness: 0.08,
  });
  const stonewareMugMat = new THREE.MeshStandardMaterial({
    color: 0xe3ddd1,
    roughness: 0.54,
    metalness: 0.03,
  });
  const coffeeSurfaceMat = new THREE.MeshStandardMaterial({
    color: 0x3b2416,
    roughness: 0.18,
    metalness: 0.04,
  });
  const notebookCoverMat = new THREE.MeshStandardMaterial({
    color: 0x41534c,
    roughness: 0.78,
    metalness: 0.02,
  });
  const paperEdgeMat = new THREE.MeshStandardMaterial({
    color: 0xf4f0e6,
    roughness: 0.85,
  });
  const brassPenMat = new THREE.MeshStandardMaterial({
    color: 0xb99352,
    roughness: 0.3,
    metalness: 0.85,
  });
  const chairBoucleMat = new THREE.MeshStandardMaterial({
    color: 0xe4dccd,
    map: createChairBoucleTexture(),
    roughness: 0.86,
    metalness: 0.0,
  });

  // Exact Cox & Cox Nivala Desk dimensions (W = 1.200m, D = 0.570m, desktop = +0.765m, upstand top = +0.815m)
  const deskW = 1.20;
  const deskD = 0.57;
  const desktopTopY = 0.765;
  const desktopT = 0.02;
  const carcassH = 0.125; // Under-top 12.5 cm storage carcass (Y = +0.640 .. +0.765 m)
  const carcassBotY = desktopTopY - carcassH; // 0.640 m (generous 640 mm kneehole clearance!)
  const panelT = 0.0175;
  const legSize = 0.036; // 36 × 36 mm straight square oak legs

  // Chamfered Desktop Slab at +0.765 m + Under-Top Carcass Bottom & Outer Cheeks
  const desktop = new THREE.Mesh(
    sharedBoxGeometry(deskW, desktopT, deskD),
    oakMat
  );
  desktop.name = `${name}.desktop`;
  desktop.position.set(0, desktopTopY - desktopT * 0.5, 0);
  desktop.castShadow = true;
  desktop.receiveShadow = true;
  root.add(desktop);

  const carcassBottom = new THREE.Mesh(
    sharedBoxGeometry(deskW, panelT, deskD),
    oakMat
  );
  carcassBottom.name = `${name}.carcassBottom`;
  carcassBottom.position.set(0, carcassBotY + panelT * 0.5, 0);
  carcassBottom.castShadow = true;
  carcassBottom.receiveShadow = true;
  root.add(carcassBottom);

  const clearBayH = carcassH - desktopT - panelT; // 0.125 - 0.020 - 0.0175 = 0.0875 m (~9.0 cm clear cubby height!)
  const clearBayCenterY = carcassBotY + panelT + clearBayH * 0.5;

  // Outer carcass side cheeks & center divider (`W 54.5 cm` left open cubby + `W 54.0 cm` right drawer bay)
  // Let's check exact X math:
  // Total width 1.200 m -> outer cheeks 0.036 m each (flush with 36 mm legs): inner span = 1.128 m
  // Center divider 0.038 m -> remaining = 1.090 m -> 0.545 m left cubby + 0.545 m right drawer opening (`0.540 m` drawer front with 2.5 mm reveal!)
  const outerCheekW = legSize; // 0.036 m
  const centerDivW = 0.038;
  const bayClearW = (deskW - outerCheekW * 2 - centerDivW) * 0.5; // Exact 0.545 m (54.5 cm)!

  for (const [sideTag, sx] of [
    ['leftCarcassCheek', -deskW * 0.5 + outerCheekW * 0.5],
    ['rightCarcassCheek', deskW * 0.5 - outerCheekW * 0.5],
  ] as const) {
    const cheek = new THREE.Mesh(
      sharedBoxGeometry(outerCheekW, clearBayH, deskD),
      oakMat
    );
    cheek.name = `${name}.${sideTag}`;
    cheek.position.set(sx, clearBayCenterY, 0);
    cheek.castShadow = true;
    cheek.receiveShadow = true;
    root.add(cheek);
  }

  const centerDiv = new THREE.Mesh(
    sharedBoxGeometry(centerDivW, clearBayH, insetJoineryButtJoints ? deskD - 0.034 : deskD - 0.016),
    oakMat
  );
  centerDiv.name = `${name}.centerDivider`;
  centerDiv.position.set(0, clearBayCenterY, insetJoineryButtJoints ? -0.001 : 0.008);
  centerDiv.castShadow = true;
  centerDiv.receiveShadow = true;
  root.add(centerDiv);

  const carcassBack = new THREE.Mesh(
    sharedBoxGeometry(deskW - outerCheekW * 2, clearBayH, 0.016),
    oakMat
  );
  carcassBack.name = `${name}.carcassBack`;
  carcassBack.position.set(0, clearBayCenterY, deskD * 0.5 - 0.008);
  carcassBack.receiveShadow = true;
  root.add(carcassBack);

  // Signature 50 mm Tall Rear Upstand Lip (+0.765 .. +0.815 m) with Rounded Outer Top Corners & Central 12 mm Wire-Pass Split Notch at X = 0!
  const upstandH = 0.050; // +0.765 .. +0.815 m
  const upstandT = 0.018;
  const wireNotchW = 0.012; // Exact 12 mm central wire-pass split notch at X = 0
  const halfUpstandW = (deskW - wireNotchW) * 0.5; // 0.594 m each side

  // When seated at -Z facing +Z, viewer-left is +X (outer corner at +X -> roundLeftOuter=false in +X local)
  // and viewer-right is -X (outer corner at -X -> roundLeftOuter=true in +X local)
  const leftUpstand = new THREE.Mesh(
    createRoundedUpstandHalfGeometry(halfUpstandW, upstandH, upstandT, false),
    oakMat
  );
  leftUpstand.name = `${name}.rearUpstand_left`;
  leftUpstand.position.set(
    wireNotchW * 0.5 + halfUpstandW * 0.5,
    desktopTopY,
    deskD * 0.5 - upstandT * 0.5
  );
  leftUpstand.castShadow = true;
  leftUpstand.receiveShadow = true;
  root.add(leftUpstand);

  const rightUpstand = new THREE.Mesh(
    createRoundedUpstandHalfGeometry(halfUpstandW, upstandH, upstandT, true),
    oakMat
  );
  rightUpstand.name = `${name}.rearUpstand_right`;
  rightUpstand.position.set(
    -wireNotchW * 0.5 - halfUpstandW * 0.5,
    desktopTopY,
    deskD * 0.5 - upstandT * 0.5
  );
  rightUpstand.castShadow = true;
  rightUpstand.receiveShadow = true;
  root.add(rightUpstand);

  // Left Open Cubby (W 54.5 × H ~9.0 cm) with Cloth-Bound Notebook & Brass Pen Inside
  const leftCubbyCenterX = centerDivW * 0.5 + bayClearW * 0.5;
  const cubbyFloorY = carcassBotY + panelT;

  const notebookGroup = new THREE.Group();
  notebookGroup.name = `${name}.cubbyNotebook`;
  notebookGroup.position.set(leftCubbyCenterX - 0.04, cubbyFloorY, -deskD * 0.5 + 0.16);
  notebookGroup.rotation.y = 0.05;

  const nbCoverBot = new THREE.Mesh(
    sharedBoxGeometry(0.155, 0.004, 0.215),
    notebookCoverMat
  );
  nbCoverBot.name = `${name}.cubbyNotebook.bottomCover`;
  nbCoverBot.position.set(0, 0.002, 0);
  notebookGroup.add(nbCoverBot);

  const nbPages = new THREE.Mesh(
    sharedBoxGeometry(0.149, 0.014, 0.209),
    paperEdgeMat
  );
  nbPages.name = `${name}.cubbyNotebook.pages`;
  nbPages.position.set(0.002, 0.011, 0);
  notebookGroup.add(nbPages);

  const nbCoverTop = new THREE.Mesh(
    sharedBoxGeometry(0.155, 0.004, 0.215),
    notebookCoverMat
  );
  nbCoverTop.name = `${name}.cubbyNotebook.topCover`;
  nbCoverTop.position.set(0, 0.02, 0);
  nbCoverTop.castShadow = true;
  notebookGroup.add(nbCoverTop);

  root.add(notebookGroup);

  const cubbyPen = tagHighLod(
    new THREE.Mesh(sharedCylinderGeometry(0.0045, 0.0045, 0.142, 10), brassPenMat)
  );
  cubbyPen.name = `${name}.cubbyPen`;
  cubbyPen.rotation.x = Math.PI * 0.5;
  cubbyPen.rotation.z = -0.08;
  cubbyPen.position.set(leftCubbyCenterX + 0.10, cubbyFloorY + 0.005, -deskD * 0.5 + 0.15);
  root.add(cubbyPen);

  // Right Sliding Drawer (W 54.0 × H 8.5 cm front) + Ø 20 × 22 mm Brushed Satin Nickel Round Knob
  const rightBayCenterX = -(centerDivW * 0.5 + bayClearW * 0.5);
  const drawerFrontW = 0.540; // Exact 54.0 cm
  const drawerFrontH = 0.085; // Exact 8.5 cm
  const drawerFrontT = 0.018;
  const drawerBoxD = deskD - 0.048;

  const drawerGroup = new THREE.Group();
  drawerGroup.name = `${name}.rightDrawer`;
  drawerGroup.position.set(rightBayCenterX, clearBayCenterY, 0);

  const drawerFront = new THREE.Mesh(
    sharedBoxGeometry(drawerFrontW, drawerFrontH, drawerFrontT),
    oakMat
  );
  drawerFront.name = `${name}.rightDrawer.front`;
  drawerFront.position.set(0, 0, -deskD * 0.5 + drawerFrontT * 0.5 + 0.003);
  drawerFront.castShadow = true;
  drawerFront.receiveShadow = true;
  drawerGroup.add(drawerFront);

  // Real 5-sided solid-oak drawer box behind front fascia so sliding open looks completely authentic
  const boxSideT = 0.012;
  const boxSideH = drawerFrontH - 0.012;
  const boxCenterZ = -deskD * 0.5 + 0.003 + drawerFrontT + (drawerBoxD - drawerFrontT) * 0.5;
  const boxInnerLen = drawerBoxD - drawerFrontT;

  for (const [sTag, sx] of [
    ['leftSide', -drawerFrontW * 0.5 + boxSideT * 0.5 + 0.003],
    ['rightSide', drawerFrontW * 0.5 - boxSideT * 0.5 - 0.003],
  ] as const) {
    const dSide = new THREE.Mesh(
      sharedBoxGeometry(boxSideT, boxSideH, boxInnerLen),
      oakMat
    );
    dSide.name = `${name}.rightDrawer.${sTag}`;
    dSide.position.set(sx, -0.002, boxCenterZ);
    dSide.castShadow = true;
    drawerGroup.add(dSide);
  }

  const dBack = new THREE.Mesh(
    sharedBoxGeometry(drawerFrontW - boxSideT * 2 - 0.006, boxSideH, boxSideT),
    oakMat
  );
  dBack.name = `${name}.rightDrawer.back`;
  dBack.position.set(0, -0.002, boxCenterZ + boxInnerLen * 0.5 - boxSideT * 0.5);
  drawerGroup.add(dBack);

  const dBottom = new THREE.Mesh(
    sharedBoxGeometry(
      insetJoineryButtJoints ? drawerFrontW - boxSideT * 2 - 0.008 : drawerFrontW - 0.012,
      0.008,
      insetJoineryButtJoints ? boxInnerLen - boxSideT - 0.004 : boxInnerLen - 0.004
    ),
    oakMat
  );
  dBottom.name = `${name}.rightDrawer.bottom`;
  dBottom.position.set(
    0,
    insetJoineryButtJoints ? -boxSideH * 0.5 + 0.006 : -boxSideH * 0.5 + 0.002,
    insetJoineryButtJoints ? boxCenterZ - boxSideT * 0.5 - 0.001 : boxCenterZ
  );
  drawerGroup.add(dBottom);

  // Ø 20 × 22 mm Brushed Satin Nickel Round Knob (`radius = 0.010 m`, `projection = 0.022 m`)
  const knobFrontZ = -deskD * 0.5 + 0.003;
  const knobStem = new THREE.Mesh(
    sharedCylinderGeometry(0.0055, 0.007, 0.010, 14),
    satinNickelMat
  );
  knobStem.name = `${name}.rightDrawer.knobStem`;
  knobStem.rotation.x = Math.PI * 0.5;
  knobStem.position.set(0, 0, knobFrontZ - 0.005);
  drawerGroup.add(knobStem);

  const knobHead = new THREE.Mesh(
    sharedCylinderGeometry(0.010, 0.0095, 0.012, 18),
    satinNickelMat
  );
  knobHead.name = `${name}.rightDrawer.knob`;
  knobHead.rotation.x = Math.PI * 0.5;
  knobHead.position.set(0, 0, knobFrontZ - 0.016); // Outer face at -0.022 m (exact 22 mm projection!)
  knobHead.castShadow = true;
  drawerGroup.add(knobHead);

  root.add(drawerGroup);

  if (interactions) {
    interactions.registerSlidingDrawer(drawerGroup, new THREE.Vector3(0, 0, -0.28));
  } else {
    attachAssetInteraction(drawerGroup, {
      kind: 'slide',
      label: 'Open Nivala Oak Desk Drawer',
      slideDelta: [0, 0, -0.28],
      audio: { openPreset: 'drawerSlide', closePreset: 'drawerSlide' },
    });
  }

  // Four Straight 36 × 36 mm Square Oak Legs + Front-to-Back Side H-Stretchers + 109 × 15 cm Narrow Rear Shelf at +0.39 m
  const legH = carcassBotY; // 0.640 m from floor up to underside of carcass
  const legCenterX = deskW * 0.5 - legSize * 0.5; // ±0.582 m (inner face at ±0.564 m -> 1.128 m clear span)
  const legCenterZ = deskD * 0.5 - legSize * 0.5; // ±0.267 m
  for (const [legTag, sx, sz] of [
    ['frontLeft', -1, -1],
    ['frontRight', 1, -1],
    ['rearLeft', -1, 1],
    ['rearRight', 1, 1],
  ] as const) {
    const leg = new THREE.Mesh(
      sharedBoxGeometry(legSize, legH, legSize),
      oakMat
    );
    leg.name = `${name}.leg_${legTag}`;
    leg.position.set(sx * legCenterX, legH * 0.5, sz * legCenterZ);
    leg.castShadow = true;
    leg.receiveShadow = true;
    root.add(leg);
  }

  // Side front-to-back H-stretchers at Y_top = +0.390 m
  const lowerShelfTopY = 0.390;
  const stretcherH = 0.028;
  const stretcherW = 0.024;
  const stretcherLenZ = deskD - legSize * 2;
  for (const [stTag, sx] of [
    ['leftSideStretcher', -legCenterX],
    ['rightSideStretcher', legCenterX],
  ] as const) {
    const stretcher = new THREE.Mesh(
      sharedBoxGeometry(stretcherW, stretcherH, stretcherLenZ),
      oakMat
    );
    stretcher.name = `${name}.${stTag}`;
    stretcher.position.set(sx, lowerShelfTopY - stretcherH * 0.5, 0);
    stretcher.castShadow = true;
    stretcher.receiveShadow = true;
    root.add(stretcher);
  }

  // Narrow 109 × 15 cm rear book/storage shelf at +0.39 m carried between the side H-stretchers
  const rearShelfW = 1.128; // Spans cleanly between inner faces of left & right legs/stretchers (109..112.8 cm visible clear span)
  const rearShelfD = 0.150; // Exact 15 cm depth
  const rearShelfT = 0.018;
  const rearShelf = new THREE.Mesh(
    sharedBoxGeometry(rearShelfW, rearShelfT, rearShelfD),
    oakMat
  );
  rearShelf.name = `${name}.lowerRearShelf`;
  rearShelf.position.set(
    0,
    lowerShelfTopY - rearShelfT * 0.5,
    deskD * 0.5 - legSize - rearShelfD * 0.5 + 0.018
  );
  rearShelf.castShadow = true;
  rearShelf.receiveShadow = true;
  root.add(rearShelf);

  // On the Desktop (+0.765 m): Open 14" Space-Grey MacBook Pro Laptop + Ceramic Mug
  const laptopGroup = new THREE.Group();
  laptopGroup.name = `${name}.macbookPro`;
  laptopGroup.position.set(0.06, desktopTopY, -0.035);
  laptopGroup.rotation.y = -0.03;

  const mbW = 0.3126; // Exact 14" MacBook Pro width (31.26 cm)
  const mbD = 0.2212; // Exact 14" MacBook Pro depth (22.12 cm)
  const mbBaseH = 0.011;

  const mbBase = new THREE.Mesh(
    sharedBoxGeometry(mbW, mbBaseH, mbD),
    spaceGreyAluminumMat
  );
  mbBase.name = `${name}.macbookPro.base`;
  mbBase.position.set(0, mbBaseH * 0.5 + 0.001, 0);
  mbBase.castShadow = true;
  mbBase.receiveShadow = true;
  laptopGroup.add(mbBase);

  // Recessed dark anodized Magic Keyboard well + Force Touch trackpad
  const kbWell = new THREE.Mesh(
    sharedBoxGeometry(0.274, 0.0015, 0.106),
    keyboardDarkMat
  );
  kbWell.name = `${name}.macbookPro.keyboard`;
  kbWell.position.set(0, mbBaseH + 0.0012, 0.022);
  laptopGroup.add(kbWell);

  const trackpad = new THREE.Mesh(
    sharedBoxGeometry(0.13, 0.0008, insetJoineryButtJoints ? 0.068 : 0.08),
    spaceGreyAluminumMat
  );
  trackpad.name = `${name}.macbookPro.trackpad`;
  trackpad.position.set(
    0,
    insetJoineryButtJoints ? mbBaseH + 0.0015 : mbBaseH + 0.0011,
    insetJoineryButtJoints ? -0.069 : -0.064
  );
  laptopGroup.add(trackpad);

  // Hinged angled Liquid Retina XDR display lid (opened at ~108° facing the user at -Z)
  const lidPivot = new THREE.Group();
  lidPivot.name = `${name}.macbookPro.displayPivot`;
  lidPivot.position.set(0, mbBaseH + 0.001, mbD * 0.5 - 0.006);
  lidPivot.rotation.x = -0.32; // Tilted slightly back (+Z) from vertical so screen faces -Z/+Y toward seated user!

  const lidH = 0.212;
  const lidT = 0.0045;
  const lidShell = new THREE.Mesh(
    sharedBoxGeometry(mbW, lidH, lidT),
    spaceGreyAluminumMat
  );
  lidShell.name = `${name}.macbookPro.displayLid`;
  lidShell.position.set(0, lidH * 0.5, 0);
  lidShell.castShadow = true;
  lidPivot.add(lidShell);

  const lidBezel = new THREE.Mesh(
    sharedBoxGeometry(mbW - 0.004, lidH - 0.004, 0.0008),
    macScreenBezelMat
  );
  lidBezel.name = `${name}.macbookPro.displayBezel`;
  lidBezel.position.set(0, lidH * 0.5, -lidT * 0.5 - 0.0003);
  lidPivot.add(lidBezel);

  const lidScreen = new THREE.Mesh(
    sharedBoxGeometry(mbW - 0.014, lidH - 0.018, 0.0006),
    macScreenDisplayMat
  );
  lidScreen.name = `${name}.macbookPro.displayScreen`;
  lidScreen.position.set(0, lidH * 0.5 + 0.002, -lidT * 0.5 - 0.0008);
  lidPivot.add(lidScreen);

  laptopGroup.add(lidPivot);
  root.add(laptopGroup);

  // Handmade stoneware ceramic mug with handle & coffee surface
  const mugGroup = new THREE.Group();
  mugGroup.name = `${name}.ceramicMug`;
  mugGroup.position.set(-0.24, desktopTopY, -0.05);

  const mugBody = new THREE.Mesh(
    sharedCylinderGeometry(0.041, 0.037, 0.092, 18),
    stonewareMugMat
  );
  mugBody.name = `${name}.ceramicMug.body`;
  mugBody.position.set(0, 0.046, 0);
  mugBody.castShadow = true;
  mugBody.receiveShadow = true;
  mugGroup.add(mugBody);

  const mugCoffee = tagHighLod(
    new THREE.Mesh(sharedCylinderGeometry(0.036, 0.036, 0.004, 16), coffeeSurfaceMat)
  );
  mugCoffee.name = `${name}.ceramicMug.coffee`;
  mugCoffee.position.set(0, 0.082, 0);
  mugGroup.add(mugCoffee);

  const mugHandle = tagHighLod(
    new THREE.Mesh(sharedTorusGeometry(0.024, 0.0055, 8, 16, Math.PI), stonewareMugMat)
  );
  mugHandle.name = `${name}.ceramicMug.handle`;
  mugHandle.rotation.z = Math.PI * 0.5;
  mugHandle.position.set(-0.039, 0.048, 0);
  mugHandle.castShadow = true;
  mugGroup.add(mugHandle);

  root.add(mugGroup);

  // Contemporary Sculpted Honeyed-Oak & Oatmeal Bouclé Desk Chair (tucked neatly in front at zLocal = -0.36m, 0 collision!)
  if (includeChair) {
    const chairGroup = new THREE.Group();
    chairGroup.name = `${name}.chair`;
    // Positioned at xLocal = -0.08m, zLocal = -0.42m facing +Z toward the laptop & desk:
    // Seat front edge reaches zLocal = -0.20m (tucked 85mm under the +0.640m kneehole at Y = 0.46m < 0.640m!),
    // while chair legs sit at xLocal = -0.30..+0.14m (well inside the ±0.564m desk legs -> 0.0mm leg collision!)
    // and chair backrest outer edge is at zLocal = -0.66m (world Z ≈ 10.56m, >260mm clear of Bed 4 foot!).
    chairGroup.position.set(0.06, 0, -0.58);

    const seatW = 0.48;
    const seatD = 0.44;
    const seatTopY = 0.47;
    const chairLegH = 0.425;

    // 4 tapered solid-oak chair legs
    const cLegX = seatW * 0.5 - 0.042;
    const cLegZ = seatD * 0.5 - 0.042;
    for (const [cTag, sx, sz] of [
      ['frontLeft', -1, 1],
      ['frontRight', 1, 1],
      ['backLeft', -1, -1],
      ['backRight', 1, -1],
    ] as const) {
      const cLeg = new THREE.Mesh(
        sharedCylinderGeometry(0.017, 0.012, chairLegH, 14),
        oakMat
      );
      cLeg.name = `${name}.chair.leg_${cTag}`;
      cLeg.position.set(sx * cLegX, chairLegH * 0.5 + 0.001, sz * cLegZ);
      cLeg.rotation.z = sx * 0.05;
      cLeg.rotation.x = -sz * 0.05;
      cLeg.castShadow = true;
      cLeg.receiveShadow = true;
      chairGroup.add(cLeg);
    }

    // Solid-oak seat frame apron
    const seatFrame = new THREE.Mesh(
      sharedBoxGeometry(seatW - 0.03, 0.026, seatD - 0.03),
      oakMat
    );
    seatFrame.name = `${name}.chair.seatFrame`;
    seatFrame.position.set(0, chairLegH + 0.008, 0);
    seatFrame.castShadow = true;
    chairGroup.add(seatFrame);

    // Oatmeal bouclé upholstered seat cushion
    const seatCushion = new THREE.Mesh(
      sharedBoxGeometry(seatW, 0.052, seatD),
      chairBoucleMat
    );
    seatCushion.name = `${name}.chair.seatCushion`;
    seatCushion.position.set(0, seatTopY - 0.026, 0);
    seatCushion.castShadow = true;
    seatCushion.receiveShadow = true;
    chairGroup.add(seatCushion);

    // Rear solid-oak backrest uprights rising from back of seat frame to +0.785 m
    const uprightH = 0.34;
    for (const [uTag, sx] of [
      ['left', -1],
      ['right', 1],
    ] as const) {
      const upright = new THREE.Mesh(
        sharedCylinderGeometry(0.015, 0.016, uprightH, 14),
        oakMat
      );
      upright.name = `${name}.chair.backUpright_${uTag}`;
      upright.position.set(sx * (seatW * 0.5 - 0.045), seatTopY + uprightH * 0.45, -seatD * 0.5 + 0.022);
      upright.rotation.x = -0.10;
      upright.castShadow = true;
      chairGroup.add(upright);
    }

    // Sculpted steam-bent wrap-around oak backrest rail + oatmeal bouclé curved lumbar backrest cushion
    const oakBackRail = new THREE.Mesh(
      sharedBoxGeometry(seatW + 0.02, 0.065, 0.028),
      oakMat
    );
    oakBackRail.name = `${name}.chair.oakBackRail`;
    oakBackRail.position.set(0, 0.755, -seatD * 0.5 + 0.004);
    oakBackRail.castShadow = true;
    chairGroup.add(oakBackRail);

    // Subtle wrap-around oak elbow wings
    for (const [wTag, sx] of [
      ['left', -1],
      ['right', 1],
    ] as const) {
      const wing = new THREE.Mesh(
        sharedBoxGeometry(0.024, 0.056, insetJoineryButtJoints ? 0.106 : 0.13),
        oakMat
      );
      wing.name = `${name}.chair.armWing_${wTag}`;
      wing.position.set(
        sx * (seatW * 0.5 - 0.002),
        0.745,
        insetJoineryButtJoints ? -seatD * 0.5 + 0.084 : -seatD * 0.5 + 0.072
      );
      wing.rotation.x = 0.08;
      wing.castShadow = true;
      chairGroup.add(wing);
    }

    const backPad = new THREE.Mesh(
      sharedBoxGeometry(seatW - 0.024, 0.145, 0.038),
      chairBoucleMat
    );
    backPad.name = `${name}.chair.backrestCushion`;
    backPad.position.set(0, 0.715, -seatD * 0.5 + 0.032);
    backPad.rotation.x = -0.08;
    backPad.castShadow = true;
    backPad.receiveShadow = true;
    chairGroup.add(backPad);

    root.add(chairGroup);
  }

  attachAssetMetadata(root, {
    name: 'Cox & Cox Nivala Fluted Tambour Oak Desk & Bouclé Chair',
    brand: 'Cox & Cox',
    collection: 'Nivala',
    sku: 'CC-NIV-DSK-1200',
    finish: 'Honeyed White Oak & Oatmeal Bouclé',
    category: 'furniture',
    dimensionsMm: [1200, 570, 770],
    productUrl: 'https://www.coxandcox.co.uk/furniture/home-office/desks/',
    schematicUrl: 'https://www.coxandcox.co.uk/media/spec/Nivala-Oak-Desk-Spec.pdf',
  });
  parent.add(root);
  return root;
}
