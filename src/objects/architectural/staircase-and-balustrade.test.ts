import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createBalustradeRun,
  createStaircase,
} from './staircase-and-balustrade.ts';

function pointInPolygonXZ(
  px: number,
  pz: number,
  poly: readonly [number, number][]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    const intersect =
      zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

describe('staircase-and-balustrade', () => {
  describe('createStaircase', () => {
    it('builds a UK Part K compliant straight staircase with flush topY, <100 mm spindle gap, monotonic sampleWalkableY, and valid voidOpeningXZ', () => {
      const stair = createStaircase({
        layout: 'straight',
        bottomY: 0,
        topY: 2.85,
        origin: [1.5, 4.0],
        direction: 'north',
        width: 0.96,
        openSide: 'right',
        newelCap: 'ball',
        spindleStyle: 'turned',
        zone: 'hall',
      });

      expect(stair.riserHeightM).toBeLessThanOrEqual(0.22);
      expect(stair.riserCount * stair.riserHeightM).toBeCloseTo(2.85, 6);
      expect(stair.maxSpindleClearGapM).toBeGreaterThan(0);
      expect(stair.maxSpindleClearGapM).toBeLessThan(0.1);

      // Top landing nosing board top sits flush at topY
      let landingNosingMesh: THREE.Mesh | null = null;
      stair.group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.name.includes('landingNosingBoard')) {
          landingNosingMesh = child;
        }
      });
      expect(landingNosingMesh).not.toBeNull();
      const landingBox = new THREE.Box3().setFromObject(landingNosingMesh!);
      expect(landingBox.max.y).toBeCloseTo(2.85, 4);

      // Zero z-fighting check between riser_1 and tread_0 / tread_1
      let riser1: THREE.Mesh | null = null;
      let tread0: THREE.Mesh | null = null;
      let tread1: THREE.Mesh | null = null;
      stair.group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child.name.endsWith('.riser_1')) riser1 = child;
        if (child.name.endsWith('.tread_0')) tread0 = child;
        if (child.name.endsWith('.tread_1')) tread1 = child;
      });
      expect(riser1).not.toBeNull();
      expect(tread0).not.toBeNull();
      expect(tread1).not.toBeNull();
      const bRiser1 = new THREE.Box3().setFromObject(riser1!);
      const bTread0 = new THREE.Box3().setFromObject(tread0!);
      const bTread1 = new THREE.Box3().setFromObject(tread1!);
      expect(bRiser1.min.y).toBeGreaterThan(bTread0.max.y);
      expect(bRiser1.max.y).toBeLessThan(bTread1.min.y);

      // Monotonic sampleWalkableY from bottomY to topY along ascent (-Z)
      const totalRun = (stair.riserCount - 1) * stair.goingM;
      let prevY = -Infinity;
      for (let i = 0; i <= 20; i++) {
        const s = (i / 20) * totalRun;
        const sampled = stair.sampleWalkableY(1.5, 4.0 - s);
        expect(sampled).not.toBeNull();
        expect(sampled!).toBeGreaterThanOrEqual(prevY - 1e-6);
        prevY = sampled!;
      }
      expect(stair.sampleWalkableY(1.5, 4.0)).toBeCloseTo(0, 5);
      expect(stair.sampleWalkableY(1.5, 4.0 - totalRun)).toBeCloseTo(2.85, 5);

      // Outside footprint returns null
      expect(stair.sampleWalkableY(1.5 + 0.8, 4.0 - 1.0)).toBeNull();
      expect(stair.sampleWalkableY(1.5, 4.0 + 0.5)).toBeNull();
      expect(stair.sampleWalkableY(1.5, 4.0 - totalRun - 0.5)).toBeNull();

      // Valid voidOpeningXZ polygon with >= 2.0 m headroom at void entry
      expect(stair.voidOpeningXZ.length).toBe(4);
      expect(pointInPolygonXZ(1.5, 4.0 - totalRun * 0.5, stair.voidOpeningXZ)).toBe(true);
      const yAtFoot = stair.sampleWalkableY(1.5, 4.0)!;
      expect(2.85 - yAtFoot).toBeGreaterThanOrEqual(2.0);
    });

    it('builds a quarter-turn (L) staircase with intermediate quarter-space landing and monotonic elevation across the turn', () => {
      const stair = createStaircase({
        layout: 'L',
        bottomY: 0,
        topY: 2.7,
        origin: [0, 0],
        direction: 'north',
        turnDirection: 'right',
        turnAfterRisers: 7,
        width: 0.96,
        openSide: 'both',
        newelCap: 'acorn',
        spindleStyle: 'square-chamfered',
      });

      expect(stair.riserHeightM).toBeLessThanOrEqual(0.22);
      expect(stair.maxSpindleClearGapM).toBeLessThan(0.1);
      expect(stair.voidOpeningXZ.length).toBe(6);

      const run1 = 6 * stair.goingM;
      const run2 = (stair.riserCount - 7 - 1) * stair.goingM;
      const expectedLandingY = 7 * stair.riserHeightM;

      // Sample along flight 1 -> quarter landing -> flight 2
      const pathSamples: [number, number][] = [
        [0, 0],
        [0, -run1 * 0.5],
        [0, -run1],
        [0, -(run1 + 0.48)],
        [0.48 + run2 * 0.5, -(run1 + 0.48)],
        [0.48 + run2, -(run1 + 0.48)],
      ];

      let prev = -Infinity;
      for (const [wx, wz] of pathSamples) {
        const y = stair.sampleWalkableY(wx, wz);
        expect(y).not.toBeNull();
        expect(y!).toBeGreaterThanOrEqual(prev - 1e-6);
        prev = y!;
      }

      expect(stair.sampleWalkableY(0, 0)).toBeCloseTo(0, 5);
      expect(stair.sampleWalkableY(0, -(run1 + 0.48))).toBeCloseTo(expectedLandingY, 5);
      expect(stair.sampleWalkableY(0.48 + run2, -(run1 + 0.48))).toBeCloseTo(2.7, 5);
      expect(stair.sampleWalkableY(-1.2, -1.2)).toBeNull();
    });

    it('builds a half-turn (U) staircase with half-space landing, well gap, and monotonic elevation across 180-deg reversal', () => {
      const stair = createStaircase({
        layout: 'half-turn',
        bottomY: 0.1,
        topY: 3.1,
        origin: [2.0, -1.0],
        direction: 'north',
        turnDirection: 'right',
        halfLandingGapM: 0.16,
        width: 1.0,
        openSide: 'right',
        newelCap: 'pyramid',
        spandrel: 'cupboard',
      });

      expect(stair.riserHeightM).toBeLessThanOrEqual(0.22);
      expect(stair.maxSpindleClearGapM).toBeLessThan(0.1);
      expect(stair.voidOpeningXZ.length).toBe(4);

      const n1 = Math.floor(stair.riserCount / 2);
      const n2 = stair.riserCount - n1;
      const run1 = (n1 - 1) * stair.goingM;
      const run2 = (n2 - 1) * stair.goingM;
      const flight2X = 2.0 + 1.0 + 0.16;

      // Well gap between flight 1 and flight 2 returns null
      expect(stair.sampleWalkableY(2.0 + 0.58, -1.0 - run1 * 0.5)).toBeNull();

      // Ascent path: flight 1 -> half landing -> flight 2
      const yStart = stair.sampleWalkableY(2.0, -1.0)!;
      const yMid1 = stair.sampleWalkableY(2.0, -1.0 - run1 * 0.5)!;
      const yLandingA = stair.sampleWalkableY(2.0, -1.0 - run1 - 0.5)!;
      const yLandingB = stair.sampleWalkableY(flight2X, -1.0 - run1 - 0.5)!;
      const yMid2 = stair.sampleWalkableY(flight2X, -1.0 - run1 + run2 * 0.5)!;
      const yTop = stair.sampleWalkableY(flight2X, -1.0 - run1 + run2)!;

      expect(yStart).toBeCloseTo(0.1, 5);
      expect(yMid1).toBeGreaterThan(yStart);
      expect(yLandingA).toBeGreaterThan(yMid1);
      expect(yLandingB).toBeCloseTo(yLandingA, 5);
      expect(yMid2).toBeGreaterThan(yLandingB);
      expect(yTop).toBeCloseTo(3.1, 5);
    });

    it('supports Georgian open/cut stringers with 2 spindles per tread standing directly on treads, tread brackets, curtail bottom step, and carpet runner + brass stair rods', () => {
      const runnerMat = new THREE.MeshStandardMaterial({ color: 0x7b241c });
      const borderMat = new THREE.MeshStandardMaterial({ color: 0xd4ac0d });
      const rodMat = new THREE.MeshStandardMaterial({ color: 0xc9a24b, metalness: 0.9 });

      const stair = createStaircase({
        layout: 'straight',
        bottomY: 0,
        topY: 2.66,
        width: 1.02,
        stringers: { left: 'wall', right: 'cut' },
        spindlesPerTread: 2,
        curtailBottomStep: 'right',
        includeTreadBrackets: true,
        runner: {
          width: 0.62,
          thickness: 0.006,
          material: runnerMat,
          borderWidth: 0.045,
          borderMaterial: borderMat,
          stairRods: { material: rodMat, radius: 0.0065 },
        },
        zone: 'hall',
      });

      expect(stair.riserHeightM).toBeLessThanOrEqual(0.22);
      expect(stair.maxSpindleClearGapM).toBeLessThan(0.1);

      const cutSpindles: THREE.Object3D[] = [];
      let shoeRailCount = 0;
      let bracketCount = 0;
      let curtailFound = false;
      let runnerFound = false;
      let borderCount = 0;
      let rodCount = 0;
      let finialCount = 0;
      const treadsByIndex = new Map<number, THREE.Mesh>();

      stair.group.traverse((obj) => {
        if (obj instanceof THREE.Group && /\.cutSpindle_right_\d+$/.test(obj.name)) {
          cutSpindles.push(obj);
        }
        if (obj.name.includes('.shoeRail_right')) {
          shoeRailCount++;
        }
        if (obj.name.includes('.treadBracket_right_')) {
          bracketCount++;
        }
        if (obj.name.includes('.curtailTread_right')) {
          curtailFound = true;
        }
        if (obj.name.endsWith('.carpetRunner')) {
          runnerFound = true;
        }
        if (obj.name.includes('.carpetRunnerBorder_')) {
          borderCount++;
        }
        if (obj.name.includes('.stairRod_')) {
          rodCount++;
        }
        if (obj.name.includes('.stairRodFinial_')) {
          finialCount++;
        }
        const m = /\.tread_(\d+)$/.exec(obj.name);
        if (m && obj instanceof THREE.Mesh) {
          treadsByIndex.set(Number(m[1]), obj);
        }
      });

      // No sloped shoe-rail on a 'cut' stringer!
      expect(shoeRailCount).toBe(0);
      expect(curtailFound).toBe(true);
      expect(bracketCount).toBeGreaterThanOrEqual(stair.riserCount - 3);
      expect(cutSpindles.length).toBeGreaterThanOrEqual((stair.riserCount - 2) * 2);

      // Verify cut-stringer spindles stand directly on top of tread top + 0.5mm clearance (no z-fighting!)
      const midSpindle = cutSpindles[3]!;
      const spBox = new THREE.Box3().setFromObject(midSpindle);
      const matchingTread = Array.from(treadsByIndex.values()).find((tMesh) => {
        const tBox = new THREE.Box3().setFromObject(tMesh);
        return Math.abs(spBox.min.y - (tBox.max.y + 0.0005)) < 0.001;
      });
      expect(matchingTread).toBeDefined();

      // Verify carpet runner, non-overlapping borders, and brass stair rods + finials
      expect(runnerFound).toBe(true);
      expect(borderCount).toBe(2);
      expect(rodCount).toBe(stair.riserCount - 1);
      expect(finialCount).toBe((stair.riserCount - 1) * 2);
    });
  });

  describe('createBalustradeRun', () => {
    it('builds a multi-segment landing balustrade with <100 mm clear spindle gaps and stairwell trimmer fascia', () => {
      const run = createBalustradeRun({
        points: [
          [0, 0],
          [2.4, 0],
          [2.4, -1.8],
        ],
        elevationY: 2.85,
        height: 0.92,
        newelCap: 'ball',
        spindleStyle: 'turned',
        includeTrimmerFascia: true,
        slabThicknessM: 0.24,
        zone: 'landing',
      });

      expect(run.newelCount).toBe(3);
      expect(run.spindleCount).toBeGreaterThan(20);
      expect(run.maxSpindleClearGapM).toBeGreaterThan(0);
      expect(run.maxSpindleClearGapM).toBeLessThan(0.1);

      let fasciaCount = 0;
      let beadCount = 0;
      run.group.traverse((obj) => {
        if (obj.name.includes('trimmerFascia_')) fasciaCount++;
        if (obj.name.includes('trimmerBead_')) beadCount++;
      });
      expect(fasciaCount).toBe(2);
      expect(beadCount).toBe(2);
    });
  });
});
