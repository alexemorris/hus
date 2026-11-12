import { describe, expect, it } from 'vitest';
import { createTerrainSampler, evaluateTerrainModifiers, type TerrainModifier } from './terrain-modifiers.ts';
import {
  TerrainSculptSession,
  clampSculptRadiusM,
  clampSculptStrengthM,
  formatTerrainSculptModifierJson,
  formatTerrainSculptModifierTs,
} from './terrain-sculpt.ts';

describe('terrain-sculpt: stamp accumulation, undo, height evaluation & JSON/TS export', () => {
  it('clamps brush radius (1..25 m) and strength (0.05..1.0 m)', () => {
    expect(clampSculptRadiusM(0.2)).toBe(1);
    expect(clampSculptRadiusM(48)).toBe(25);
    expect(clampSculptRadiusM(8.5)).toBe(8.5);

    expect(clampSculptStrengthM(0.001)).toBe(0.05);
    expect(clampSculptStrengthM(4.2)).toBe(1.0);
    expect(clampSculptStrengthM(0.4)).toBe(0.4);
  });

  it('accumulates raise & lower strokes, evaluates height live, and supports undo/reset', () => {
    const baseSampleY = (): number => 2.0;
    const session = new TerrainSculptSession({
      mode: 'raise',
      radiusM: 6,
      strength: 0.5,
      patchId: 'garden-berm',
    });

    expect(session.getStrokeCount()).toBe(0);
    expect(session.canUndo()).toBe(false);
    expect(session.evaluateHeight(baseSampleY, 10, 20)).toBeCloseTo(2.0, 6);

    session.beginStroke(10, 20, baseSampleY);
    session.continueStroke(14, 20, baseSampleY);
    session.endStroke();

    expect(session.getStrokeCount()).toBe(1);
    expect(session.getStamps().length).toBeGreaterThanOrEqual(2);
    const raisedY = session.evaluateHeight(baseSampleY, 10, 20);
    expect(raisedY).toBeGreaterThan(2.5);
    expect(session.evaluateHeight(baseSampleY, 60, 60)).toBeCloseTo(2.0, 6);

    // Second stroke: lower at (30, -10)
    session.setMode('lower');
    session.setRadiusM(5);
    session.setStrength(0.4);
    session.beginStroke(30, -10, baseSampleY);
    session.endStroke();

    expect(session.getStrokeCount()).toBe(2);
    expect(session.evaluateHeight(baseSampleY, 30, -10)).toBeCloseTo(1.6, 5);

    // Undo pops only the second stroke
    expect(session.undoLastStroke()).toBe(true);
    expect(session.getStrokeCount()).toBe(1);
    expect(session.evaluateHeight(baseSampleY, 30, -10)).toBeCloseTo(2.0, 6);
    expect(session.evaluateHeight(baseSampleY, 10, 20)).toBeCloseTo(raisedY, 6);

    // Reset clears all strokes
    expect(session.resetStrokes()).toBe(true);
    expect(session.getStrokeCount()).toBe(0);
    expect(session.getStamps()).toHaveLength(0);
    expect(session.evaluateHeight(baseSampleY, 10, 20)).toBeCloseTo(2.0, 6);
  });

  it('supports flatten and smooth brush modes using standard TerrainStamp records', () => {
    // Sloped terrain y = 0.2 * wx
    const slopedBase = (wx: number): number => 0.2 * wx;
    const flattenSession = new TerrainSculptSession({
      mode: 'flatten',
      radiusM: 8,
      strength: 1.0,
    });
    // Start flatten at wx=0 (targetY = 0) and drag up the slope to wx=4 (where base is +0.8m)
    flattenSession.beginStroke(0, 0, slopedBase);
    flattenSession.continueStroke(4, 0, slopedBase);
    flattenSession.continueStroke(8, 0, slopedBase);
    flattenSession.endStroke();

    const flattenedAt4 = flattenSession.evaluateHeight(slopedBase, 4, 0);
    expect(flattenedAt4).toBeLessThan(slopedBase(4));

    // Smooth mode relaxes a sharp local peak toward surrounding ring elevation
    const peakBase = (wx: number, wz: number): number =>
      Math.max(0, 1.5 - Math.hypot(wx, wz) * 0.5);
    const smoothSession = new TerrainSculptSession({
      mode: 'smooth',
      radiusM: 6,
      strength: 0.8,
    });
    smoothSession.beginStroke(0, 0, peakBase);
    smoothSession.endStroke();

    const smoothedPeak = smoothSession.evaluateHeight(peakBase, 0, 0);
    expect(smoothedPeak).toBeLessThan(1.5);
    expect(smoothedPeak).toBeGreaterThan(0);
  });

  it('exports valid JSON and TypeScript TerrainModifier patches consumable directly by createTerrainSampler', () => {
    const session = new TerrainSculptSession({
      mode: 'raise',
      radiusM: 7.5,
      strength: 0.45,
      patchId: 'paddock-mound',
    });
    session.beginStroke(12.3456, -8.9012, () => 0);
    session.endStroke();

    const jsonText = session.formatModifierJson();
    const parsed = JSON.parse(jsonText) as TerrainModifier;
    expect(parsed.kind).toBe('sculptStamps');
    if (parsed.kind === 'sculptStamps') {
      expect(parsed.id).toBe('paddock-mound');
      expect(parsed.stamps).toHaveLength(1);
      expect(parsed.stamps[0]).toMatchObject({
        x: 12.346,
        z: -8.901,
        radiusX: 7.5,
        deltaY: 0.45,
        falloff: 'smooth',
      });
    }

    // Raw JSON object (without precomputed `prepared`) works directly in `createTerrainSampler` & `evaluateTerrainModifiers`!
    const sampler = createTerrainSampler({
      base: 'flat',
      flatElevationY: 1.0,
      modifiers: [parsed],
    });
    expect(sampler.sampleTerrainY(12.346, -8.901)).toBeCloseTo(1.45, 5);
    expect(evaluateTerrainModifiers(1.0, 12.346, -8.901, [parsed])).toBeCloseTo(1.45, 5);

    const tsText = session.formatModifierTs();
    expect(tsText).toContain("kind: 'sculptStamps'");
    expect(tsText).toContain("id: 'paddock-mound'");
    expect(tsText).toContain('x: 12.346, z: -8.901, radiusX: 7.5, deltaY: 0.45');

    // Standalone formatters handle empty stamp arrays cleanly
    expect(JSON.parse(formatTerrainSculptModifierJson([], 'empty-patch'))).toEqual({
      kind: 'sculptStamps',
      id: 'empty-patch',
      stamps: [],
    });
    expect(formatTerrainSculptModifierTs([], 'empty-patch')).toContain('stamps: []');
  });
});
