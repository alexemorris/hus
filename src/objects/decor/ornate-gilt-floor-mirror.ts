import * as THREE from 'three';
import {
  sharedBoxGeometry,
  sharedCylinderGeometry,
  sharedSphereGeometry,
} from '../shared/geometry-cache.ts';
import { buildSweptMouldingGeometry } from '../../engine/geometry/swept-moulding.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';

export interface OrnateGiltFloorMirrorOptions {
  readonly name: string;
  readonly zone: RoomZoneId;
  /** Overall outer width in metres (William Wood Venosa default: 1.00 m). */
  readonly width?: number;
  /** Overall outer height in metres (William Wood Venosa default: 1.80 m). */
  readonly height?: number;
  /** Backward leaner angle in degrees (default: 2.75°; pass 0 for vertical wall-hung). */
  readonly leanDeg?: number;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
}

/**
 * Builds a closed rounded-bottom, full-arch-top 2D outline path `(x, y)` in `[ -halfW..+halfW, yMin..yMax ]`
 * matching the William Wood `Venosa` (180 cm × 100 cm) silhouette:
 * - Softly rounded bottom corners (`bottomR`)
 * - Straight vertical sides up to the arch spring (`yMax - topArchR`)
 * - Smooth full-span semi-circular arch crown (`topArchR = halfW`)
 */
function sampleVenosaOutlinePoints(
  halfW: number,
  yMin: number,
  yMax: number,
  bottomR: number,
  bottomArcSegs = 12,
  topArcSegs = 40
): Array<[number, number]> {
  const topArchR = halfW;
  const springY = yMax - topArchR;
  const bR = Math.min(bottomR, halfW * 0.45);
  const pts: Array<[number, number]> = [];

  // Start at bottom-center (0, yMin) -> go left along bottom rail
  pts.push([0, yMin]);
  pts.push([-(halfW - bR), yMin]);

  // Bottom-left rounded corner: center (-(halfW - bR), yMin + bR), angle -90° -> -180°
  for (let i = 1; i <= bottomArcSegs; i++) {
    const t = i / bottomArcSegs;
    const ang = -Math.PI * 0.5 - t * Math.PI * 0.5;
    pts.push([
      -(halfW - bR) + Math.cos(ang) * bR,
      yMin + bR + Math.sin(ang) * bR,
    ]);
  }

  // Left vertical stile up to arch spring
  pts.push([-halfW, springY]);

  // Top full-span arch: center (0, springY), angle 180° -> 0°
  for (let i = 1; i <= topArcSegs; i++) {
    const t = i / topArcSegs;
    const ang = Math.PI * (1 - t);
    pts.push([
      Math.cos(ang) * topArchR,
      springY + Math.sin(ang) * topArchR,
    ]);
  }

  // Right vertical stile down to bottom-right corner start
  pts.push([halfW, yMin + bR]);

  // Bottom-right rounded corner: center (halfW - bR, yMin + bR), angle 0° -> -90°
  for (let i = 1; i <= bottomArcSegs; i++) {
    const t = i / bottomArcSegs;
    const ang = -t * Math.PI * 0.5;
    pts.push([
      halfW - bR + Math.cos(ang) * bR,
      yMin + bR + Math.sin(ang) * bR,
    ]);
  }

  // Close back to bottom-center (0, yMin)
  pts.push([0, yMin]);
  return pts;
}

function buildVenosaShape(
  halfW: number,
  yMin: number,
  yMax: number,
  bottomR: number
): THREE.Shape {
  const topArchR = halfW;
  const springY = yMax - topArchR;
  const bR = Math.min(bottomR, halfW * 0.45);

  const shape = new THREE.Shape();
  shape.moveTo(-(halfW - bR), yMin);
  shape.absarc(-(halfW - bR), yMin + bR, bR, -Math.PI * 0.5, -Math.PI, true);
  shape.lineTo(-halfW, springY);
  shape.absarc(0, springY, topArchR, Math.PI, 0, true);
  shape.lineTo(halfW, yMin + bR);
  shape.absarc(halfW - bR, yMin + bR, bR, 0, -Math.PI * 0.5, true);
  shape.closePath();
  return shape;
}

/**
 * William Wood — `Venosa` Full Length Antique-Gold Arched Metal Mirror (`180 cm × 100 cm`).
 *
 * Official specifications:
 * - Overall Size: `1.800 m H × 1.000 m W`
 * - Inner Mirror Opening: `1.760 m H × 0.960 m W`
 * - Frame Width: `20 mm` (`0.75"`) slim reeded antique-gold metal surround
 * - Frame Depth: `15 mm` metal surround (`20 mm` overall with rear backing board)
 * - Signature Venetian inner mirror-pane hairline seam (`95 mm` inset) with 9 radial
 *   division seams and 9 miniature dark antique-bronze fluted rosette studs.
 */
export function buildOrnateGiltFloorMirror(
  options: OrnateGiltFloorMirrorOptions
): THREE.Group {
  const {
    name,
    zone,
    width = 1.0,
    height = 1.8,
    leanDeg = 2.75,
    position = [0, 0, 0],
    rotationY = 0,
  } = options;

  const halfW = width * 0.5;
  const frameWidth = 0.02; // 20 mm (0.75") per William Wood Venosa spec
  const frameDepth = 0.02; // 15 mm metal rim + 5 mm backing
  const outerBottomR = 0.095;
  const innerHalfW = halfW - frameWidth; // 0.480 m -> 0.960 m inner width
  const innerYMin = frameWidth; // 0.020 m
  const innerYMax = height - frameWidth; // 1.780 m -> 1.760 m inner height
  const innerBottomR = outerBottomR - frameWidth; // 0.075 m

  const mirrorGroup = new THREE.Group();
  mirrorGroup.name = name;
  mirrorGroup.userData.zone = zone;
  mirrorGroup.position.set(position[0], position[1], position[2]);
  mirrorGroup.rotation.y = rotationY;

  // Materials — muted patinated antique gold metal, dark antique bronze rosettes & crisp flat silvered glass
  const antiqueGoldMetalMat = new THREE.MeshStandardMaterial({
    color: 0x947542,
    roughness: 0.38,
    metalness: 0.78,
  });
  const antiqueGoldRecessMat = new THREE.MeshStandardMaterial({
    color: 0x765b31,
    roughness: 0.44,
    metalness: 0.74,
  });
  const darkBronzeRosetteMat = new THREE.MeshStandardMaterial({
    color: 0x3b2e20,
    roughness: 0.42,
    metalness: 0.76,
  });
  const seamLineMat = new THREE.MeshStandardMaterial({
    color: 0x45392c,
    roughness: 0.35,
    metalness: 0.65,
  });
  const backingBoardMat = new THREE.MeshStandardMaterial({
    color: 0x221d1a,
    roughness: 0.85,
    metalness: 0.04,
  });
  const feltPadMat = new THREE.MeshStandardMaterial({
    color: 0x262423,
    roughness: 0.95,
    metalness: 0.0,
  });
  const mirrorGlassMat = new THREE.MeshStandardMaterial({
    color: 0xeef1f3,
    roughness: 0.025,
    metalness: 0.965,
    envMapIntensity: 1.45,
  });

  // Leaner pivot group: when leanDeg > 0 (e.g. 2.75° against West wall X = -9.56 m from base position X = -9.55 m),
  // height * sin(2.75°) = 86.4 mm backward lean so baseBackZ = 0.078 m places top back edge right against the wall
  // (-9.5584 m) while keeping the bottom rail 70 mm clear in front of the 18 mm skirting!
  const leanRad = (leanDeg * Math.PI) / 180;
  const baseBackZ = leanDeg > 0 ? Math.max(0.012, height * Math.sin(leanRad) - 0.008) : 0;

  const leanerAssembly = new THREE.Group();
  leanerAssembly.name = `${name}.leanerAssembly`;
  leanerAssembly.position.set(0, 0.002, baseBackZ);
  leanerAssembly.rotation.x = -leanRad;
  mirrorGroup.add(leanerAssembly);

  // Discrete 2 mm dark wool-felt floor glide strips where the bottom rail touches the floor
  for (const sx of [-1, 1] as const) {
    const floorPad = new THREE.Mesh(
      sharedBoxGeometry(0.08, 0.002, frameDepth * 0.85),
      feltPadMat
    );
    floorPad.name = `${name}.floorFeltPad.${sx < 0 ? 'left' : 'right'}`;
    floorPad.position.set(sx * (halfW - outerBottomR - 0.06), 0.001, baseBackZ + frameDepth * 0.45);
    mirrorGroup.add(floorPad);
  }

  // 1. Rear MDF / dark-lacquered metal backing plate (5 mm thick)
  const backingShape = buildVenosaShape(halfW - 0.003, 0.003, height - 0.003, outerBottomR - 0.003);
  const backingGeo = new THREE.ExtrudeGeometry(backingShape, {
    depth: 0.005,
    bevelEnabled: false,
    curveSegments: 32,
  });
  const backingMesh = new THREE.Mesh(backingGeo, backingBoardMat);
  backingMesh.name = `${name}.backingBoard`;
  backingMesh.position.z = 0;
  backingMesh.castShadow = true;
  backingMesh.receiveShadow = true;
  leanerAssembly.add(backingMesh);

  // 2. Crisp flat silvered mirror glass plate (non-bevelled per Venosa spec)
  const glassShape = buildVenosaShape(innerHalfW + 0.002, innerYMin - 0.002, innerYMax + 0.002, innerBottomR);
  const glassGeo = new THREE.ShapeGeometry(glassShape, 36);
  const glassMesh = new THREE.Mesh(glassGeo, mirrorGlassMat);
  glassMesh.name = `${name}.mirrorGlass`;
  glassMesh.position.z = 0.0065;
  glassMesh.receiveShadow = true;
  leanerAssembly.add(glassMesh);

  // 3. Slim 20 mm × 20 mm reeded Antique-Gold metal outer frame (matching venosa_4.jpg macro profile)
  // Profile in (d = outward depth 0..frameDepth, h = inward offset 0..-frameWidth from outer boundary):
  const rimProfile = new THREE.Shape();
  rimProfile.moveTo(0, 0);
  rimProfile.lineTo(frameDepth * 0.78, 0);
  // Softly bullnosed outer bead + delicate twin reeding across the 20 mm front face
  rimProfile.quadraticCurveTo(frameDepth, -0.001, frameDepth, -0.0045);
  rimProfile.lineTo(frameDepth * 0.9, -0.0065);
  rimProfile.quadraticCurveTo(frameDepth * 0.98, -0.0095, frameDepth * 0.98, -0.012);
  rimProfile.lineTo(frameDepth * 0.88, -0.014);
  rimProfile.quadraticCurveTo(frameDepth * 0.94, -0.017, frameDepth * 0.82, -frameWidth);
  // Step down to mirror glass plane (z = 0.0065 m)
  rimProfile.lineTo(0.006, -frameWidth);
  rimProfile.lineTo(0.006, -frameWidth + 0.004);
  rimProfile.lineTo(0, -frameWidth + 0.004);
  rimProfile.closePath();

  // Note: along our clockwise path (bottom-center -> left -> top arch -> right -> bottom-center),
  // seg.n = (-t.y, t.x) points OUTWARD when path is clockwise! Wait: let's check:
  // Going UP left stile: t = (0, 1) -> seg.n = (-1, 0) = LEFT (OUTWARD!).
  // So h <= 0 moves INWARD (`a + seg.n.x * h` moves right when h < 0)! That matches `rimProfile` (`h` in `[0, -frameWidth]`)!
  const outerOutline = sampleVenosaOutlinePoints(halfW, 0, height, outerBottomR, 14, 44);
  const frameGeo = buildSweptMouldingGeometry(
    rimProfile,
    outerOutline,
    (a, y, d) => new THREE.Vector3(a, y, d),
    8
  );
  frameGeo.computeVertexNormals();
  const outerFrameMesh = new THREE.Mesh(frameGeo, antiqueGoldMetalMat);
  outerFrameMesh.name = `${name}.antiqueGoldFrame`;
  outerFrameMesh.castShadow = true;
  outerFrameMesh.receiveShadow = true;
  leanerAssembly.add(outerFrameMesh);

  // Subtle recessed inner sight-lip shadow line right inside the 20 mm metal rim
  const innerLipProfile = new THREE.Shape();
  innerLipProfile.moveTo(0.0065, 0);
  innerLipProfile.lineTo(0.0095, 0);
  innerLipProfile.lineTo(0.0095, -0.0022);
  innerLipProfile.lineTo(0.0065, -0.0022);
  innerLipProfile.closePath();
  const innerOutline = sampleVenosaOutlinePoints(innerHalfW, innerYMin, innerYMax, innerBottomR, 10, 36);
  const innerLipGeo = buildSweptMouldingGeometry(
    innerLipProfile,
    innerOutline,
    (a, y, d) => new THREE.Vector3(a, y, d),
    4
  );
  innerLipGeo.computeVertexNormals();
  const innerLipMesh = new THREE.Mesh(innerLipGeo, antiqueGoldRecessMat);
  innerLipMesh.name = `${name}.innerSightLip`;
  leanerAssembly.add(innerLipMesh);

  // 4. Signature Venetian Inner Mirror-Pane Hairline Seam (inset 95 mm inside the inner sight edge)
  const borderInset = 0.095;
  const paneHalfW = innerHalfW - borderInset; // 0.385 m
  const paneYMin = innerYMin + borderInset; // 0.115 m
  const paneYMax = innerYMax - borderInset; // 1.685 m
  const paneBottomR = 0.052;
  const paneSpringY = paneYMax - paneHalfW; // 1.685 - 0.385 = 1.300 m (concentric with outer arch spring 1.80 - 0.50 = 1.300 m!)

  const seamProfile = new THREE.Shape();
  seamProfile.moveTo(0.0065, -0.0009);
  seamProfile.lineTo(0.0079, -0.0009);
  seamProfile.lineTo(0.0079, 0.0009);
  seamProfile.lineTo(0.0065, 0.0009);
  seamProfile.closePath();

  const paneOutline = sampleVenosaOutlinePoints(paneHalfW, paneYMin, paneYMax, paneBottomR, 10, 36);
  const paneSeamGeo = buildSweptMouldingGeometry(
    seamProfile,
    paneOutline,
    (a, y, d) => new THREE.Vector3(a, y, d),
    4
  );
  paneSeamGeo.computeVertexNormals();
  const paneSeamMesh = new THREE.Mesh(paneSeamGeo, seamLineMat);
  paneSeamMesh.name = `${name}.venetianInnerSeam`;
  leanerAssembly.add(paneSeamMesh);

  // 9 Radial / Perpendicular Border Division Seams & 9 Miniature Fluted Dark-Bronze Rosettes (matching venosa_1.jpg & venosa_4.jpg)
  const addDivisionSeam = (
    seamId: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const bar = new THREE.Mesh(
      sharedBoxGeometry(len, 0.0018, 0.0014),
      seamLineMat
    );
    bar.name = `${name}.paneDivision.${seamId}`;
    bar.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, 0.0072);
    bar.rotation.z = Math.atan2(dy, dx);
    leanerAssembly.add(bar);
  };

  const addFlutedRosetteStud = (studId: string, rx: number, ry: number) => {
    const rosetteGrp = new THREE.Group();
    rosetteGrp.name = `${name}.rosette.${studId}`;
    rosetteGrp.position.set(rx, ry, 0.0072);

    const disc = new THREE.Mesh(
      sharedCylinderGeometry(0.0072, 0.0078, 0.0032, 14),
      darkBronzeRosetteMat
    );
    disc.rotation.x = Math.PI / 2;
    disc.position.z = 0.0016;
    rosetteGrp.add(disc);

    // Subtle fluted petals & central pip (matching venosa_4.jpg macro)
    for (let p = 0; p < 8; p++) {
      const ang = (p / 8) * Math.PI * 2;
      const petal = new THREE.Mesh(
        sharedSphereGeometry(0.0021, 6, 5),
        antiqueGoldRecessMat
      );
      petal.scale.set(1.35, 0.68, 0.55);
      petal.position.set(Math.cos(ang) * 0.0044, Math.sin(ang) * 0.0044, 0.003);
      petal.rotation.z = ang;
      rosetteGrp.add(petal);
    }

    const pip = new THREE.Mesh(
      sharedSphereGeometry(0.0022, 8, 6),
      darkBronzeRosetteMat
    );
    pip.scale.set(1, 1, 0.65);
    pip.position.z = 0.0034;
    rosetteGrp.add(pip);

    leanerAssembly.add(rosetteGrp);
  };

  // Top crown vertical seam + rosette (12 o'clock)
  addDivisionSeam('topCrown', 0, paneYMax, 0, innerYMax);
  addFlutedRosetteStud('topCrown', 0, paneYMax);

  // Left & Right pairs at arch spring (Y = 1.300 m), mid-stile (Y = 0.760 m), and lower-stile above corner curve (Y = 0.175 m)
  const lowerStileJoinY = paneYMin + paneBottomR + 0.008; // 0.175 m
  const midStileJoinY = (paneSpringY + lowerStileJoinY) * 0.5 + 0.02; // ~0.758 m
  const bottomRailJoinX = paneHalfW - paneBottomR - 0.008; // ~0.325 m

  for (const sx of [-1, 1] as const) {
    const sideTag = sx < 0 ? 'left' : 'right';
    // Arch spring horizontal division
    addDivisionSeam(`${sideTag}Spring`, sx * paneHalfW, paneSpringY, sx * innerHalfW, paneSpringY);
    addFlutedRosetteStud(`${sideTag}Spring`, sx * paneHalfW, paneSpringY);

    // Mid-height horizontal division
    addDivisionSeam(`${sideTag}Mid`, sx * paneHalfW, midStileJoinY, sx * innerHalfW, midStileJoinY);
    addFlutedRosetteStud(`${sideTag}Mid`, sx * paneHalfW, midStileJoinY);

    // Lower-stile horizontal division (just above inner bottom corner curve, matching venosa_1.jpg!)
    addDivisionSeam(`${sideTag}LowerSide`, sx * paneHalfW, lowerStileJoinY, sx * innerHalfW, lowerStileJoinY);
    addFlutedRosetteStud(`${sideTag}LowerSide`, sx * paneHalfW, lowerStileJoinY);

    // Bottom vertical division (just inside inner bottom corner curve, matching venosa_1.jpg!)
    addDivisionSeam(`${sideTag}Bottom`, sx * bottomRailJoinX, paneYMin, sx * bottomRailJoinX, innerYMin);
    addFlutedRosetteStud(`${sideTag}Bottom`, sx * bottomRailJoinX, paneYMin);
  }

  return mirrorGroup;
}
