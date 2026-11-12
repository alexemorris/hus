import { describe, expect, it } from 'vitest';
import {
  carveBasin,
  createTerrainSampler,
  customTerrainModifier,
  decodeHusGridLayer,
  evaluateTerrainModifiers,
  gradePad,
  sampleHusGridLayers,
  sculptStamps,
  smoothstep,
  splinePath,
  type HusGridDocument,
  type HusGridLayerSpec,
} from './terrain-modifiers.ts';

function encodeInt16Base64(values: readonly number[]): string {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setInt16(i * 2, values[i]!, true);
  }
  return Buffer.from(bytes).toString('base64');
}

describe('terrain-modifiers: .husgrid.json decoding & multi-tier sampling', () => {
  it('decodes default Int16 millimetre grids and matches QuantizedHeightGridSpec', () => {
    const sampleGrid: HusGridLayerSpec = {
      minX: -10,
      maxX: 10,
      minZ: -10,
      maxZ: 10,
      step: 10,
      cols: 3,
      rows: 3,
      base64Int16Mm: encodeInt16Base64([120, 240, 360, 180, 320, 460, 220, 380, 540]),
    };
    const decoded = decodeHusGridLayer(sampleGrid);
    expect(decoded.cols).toBe(3);
    expect(decoded.rows).toBe(3);
    expect(decoded.scaleM).toBe(0.001);
    expect(decoded.heightsM.length).toBe(9);
    const originSample = sampleHusGridLayers([sampleGrid], 0, 0);
    expect(originSample).toBeCloseTo(0.32, 5);
  });

  it('supports scaleM for steep canyon/mountain relief (> 100 m) without Int16 overflow', () => {
    // 2x2 grid spanning [-50..+50]^2 with -145.25 m to +182.75 m relief at 1 cm (scaleM = 0.01)
    const heightsCm = [-14525, -4000, 6250, 18275];
    const steepLayer: HusGridLayerSpec = {
      minX: -50,
      maxX: 50,
      minZ: -50,
      maxZ: 50,
      step: 100,
      cols: 2,
      rows: 2,
      scaleM: 0.01,
      base64Int16Mm: encodeInt16Base64(heightsCm),
    };

    const doc: HusGridDocument = {
      format: 'husgrid-v1',
      origin: { lat: 34.1003, lon: -118.3698, datumElevationM: 295.4 },
      source: 'synthetic-steep-canyon',
      grids: [steepLayer],
    };

    const sampler = createTerrainSampler({ base: doc });
    expect(sampler.sampleTerrainY(-50, -50)).toBeCloseTo(-145.25, 2);
    expect(sampler.sampleTerrainY(50, -50)).toBeCloseTo(-40.0, 2);
    expect(sampler.sampleTerrainY(-50, 50)).toBeCloseTo(62.5, 2);
    expect(sampler.sampleTerrainY(50, 50)).toBeCloseTo(182.75, 2);
    // Bilinear midpoint average = (-145.25 - 40 + 62.5 + 182.75) / 4 = 15.0 m
    expect(sampler.sampleTerrainY(0, 0)).toBeCloseTo(15.0, 2);
  });

  it('C1-blends concentric multi-tier grids seamlessly across inner margins', () => {
    // Inner 3x3 grid [-10..+10]^2 @ 10m step, constant +4.000 m, blendMarginM = 4m
    const innerValues = new Array(9).fill(4000);
    const innerGrid: HusGridLayerSpec = {
      minX: -10,
      maxX: 10,
      minZ: -10,
      maxZ: 10,
      step: 10,
      cols: 3,
      rows: 3,
      blendMarginM: 4,
      base64Int16Mm: encodeInt16Base64(innerValues),
    };
    // Outer 3x3 grid [-50..+50]^2 @ 50m step, constant +1.000 m
    const outerValues = new Array(9).fill(1000);
    const outerGrid: HusGridLayerSpec = {
      minX: -50,
      maxX: 50,
      minZ: -50,
      maxZ: 50,
      step: 50,
      cols: 3,
      rows: 3,
      base64Int16Mm: encodeInt16Base64(outerValues),
    };

    const layers = [innerGrid, outerGrid];
    // Deep inside inner grid (margin = 10 >= 4) -> pure inner = 4.0 m
    expect(sampleHusGridLayers(layers, 0, 0)).toBeCloseTo(4.0, 5);
    expect(sampleHusGridLayers(layers, 6, 0)).toBeCloseTo(4.0, 5);
    // Mid-margin (wx = 8 => margin = 2m => smoothstep(0, 4, 2) = 0.5) -> 2.5 m
    expect(sampleHusGridLayers(layers, 8, 0)).toBeCloseTo(2.5, 5);
    // At inner boundary (wx = 10 => margin = 0) -> pure outer = 1.0 m
    expect(sampleHusGridLayers(layers, 10, 0)).toBeCloseTo(1.0, 5);
    // Outside inner grid -> pure outer = 1.0 m
    expect(sampleHusGridLayers(layers, 25, -18)).toBeCloseTo(1.0, 5);
    // Empty grid list falls back cleanly
    expect(sampleHusGridLayers([], 0, 0, 7.25)).toBe(7.25);
  });
});

describe('terrain-modifiers: gradePad, splinePath, carveBasin, sculptStamps & pipeline', () => {
  it('grades flat, sloped, and rotated pads with C1 feathering', () => {
    // Base slope: y = 0.1 * x
    const base = (wx: number, _wz: number) => 0.1 * wx;
    const rot = Math.PI / 6; // 30 deg
    const pad = gradePad({
      centerX: 10,
      centerZ: -4,
      width: 12,
      depth: 8,
      rotationY: rot,
      elevationY: 3.5,
      slopeX: 0.05,
      featherM: 2.0,
    });

    const sampler = createTerrainSampler({ base, modifiers: [pad] });

    // Center of rotated pad is at exact elevationY = 3.5
    expect(sampler.sampleTerrainY(10, -4)).toBeCloseTo(3.5, 6);

    // Move +4m along pad's local +X axis: world (10 + 4*cos(rot), -4 - 4*sin(rot))
    const wxLocalPlus4 = 10 + 4 * Math.cos(rot);
    const wzLocalPlus4 = -4 - 4 * Math.sin(rot);
    expect(sampler.sampleTerrainY(wxLocalPlus4, wzLocalPlus4)).toBeCloseTo(
      3.5 + 0.05 * 4,
      5
    );

    // Halfway across the 2m feather outside local +X edge (lx = 6 + 1 = 7 => w = 0.5)
    const wxFeatherMid = 10 + 7 * Math.cos(rot);
    const wzFeatherMid = -4 - 7 * Math.sin(rot);
    const expectedTarget = 3.5 + 0.05 * 7;
    const expectedBase = base(wxFeatherMid, wzFeatherMid);
    expect(sampler.sampleTerrainY(wxFeatherMid, wzFeatherMid)).toBeCloseTo(
      0.5 * expectedBase + 0.5 * expectedTarget,
      5
    );

    // Outside feather band (lx = 6 + 2.5 = 8.5) -> untouched base terrain
    const wxOutside = 10 + 8.5 * Math.cos(rot);
    const wzOutside = -4 - 8.5 * Math.sin(rot);
    expect(sampler.sampleTerrainY(wxOutside, wzOutside)).toBeCloseTo(
      base(wxOutside, wzOutside),
      6
    );
  });

  it('supports interior-only sub-slab mesh carves without disturbing exterior grade', () => {
    const subSlabCarve = gradePad({
      minX: -10,
      maxX: 10,
      minZ: -5,
      maxZ: 5,
      elevationY: -1.25,
      featherM: 0.25,
      featherSide: 'inside',
      insetM: 0.02,
      mode: 'min',
    });

    const sampler = createTerrainSampler({
      base: 'flat',
      flatElevationY: 0.2,
      meshCarveModifiers: [subSlabCarve],
    });

    // Walkthrough terrain is un-carved everywhere
    expect(sampler.sampleTerrainY(0, 0)).toBeCloseTo(0.2, 6);
    // Carved mesh is depressed strictly inside walls
    expect(sampler.sampleCarvedMeshY(0, 0)).toBeCloseTo(-1.25, 6);
    // Exactly on wall face (x = 10) and just outside (x = 10.01) has 0.000 mm exterior trench!
    expect(sampler.sampleCarvedMeshY(9.99, 0)).toBeCloseTo(0.2, 6);
    expect(sampler.sampleCarvedMeshY(10.0, 0)).toBeCloseTo(0.2, 6);
    expect(sampler.sampleCarvedMeshY(10.05, 0)).toBeCloseTo(0.2, 6);
  });

  it('grades splinePath driveways with explicit elevations, crown camber, and terrain-following smoothing', () => {
    const driveway = splinePath({
      points: [
        [-20, 0, 0.0],
        [0, 5, 2.0],
        [20, 0, 4.0],
      ],
      halfWidthM: 2.0,
      featherM: 2.0,
      crownM: 0.08,
    });

    const sampler = createTerrainSampler({
      base: 'flat',
      flatElevationY: 0,
      modifiers: [driveway],
    });

    // Start, middle control point, and end on centreline include 0.08 m crown
    expect(sampler.sampleTerrainY(-20, 0)).toBeCloseTo(0.08, 2);
    expect(sampler.sampleTerrainY(0, 5)).toBeCloseTo(2.08, 2);
    expect(sampler.sampleTerrainY(20, 0)).toBeCloseTo(4.08, 2);

    // At path shoulder (dist = halfWidthM = 2.0m from [0, 5]), crown drops to 0 -> ~2.0 m
    expect(sampler.sampleTerrainY(0, 7)).toBeCloseTo(2.0, 1);

    // Far away from path -> untouched base 0 m
    expect(sampler.sampleTerrainY(0, 20)).toBeCloseTo(0, 6);

    // Terrain-following spline (omitted y) smooths out high-frequency bumps along path
    const bumpyBase = (wx: number, _wz: number) => 0.1 * wx + 1.2 * Math.sin(wx * 2.5);
    const gardenWalk = splinePath({
      points: [
        [-15, 0],
        [0, 0],
        [15, 0],
      ],
      halfWidthM: 1.5,
      featherM: 1.0,
      smoothingWindowM: 5.0,
    });
    const walkSampler = createTerrainSampler({
      base: bumpyBase,
      modifiers: [gardenWalk],
    });
    // Raw bump amplitude is 1.2m; smoothed path near x=0 stays tightly near macro grade 0.0m
    expect(Math.abs(walkSampler.sampleTerrainY(0.6, 0))).toBeLessThan(0.25);
    // Outside path feather (z = 5m), original bumpy terrain is preserved
    expect(walkSampler.sampleTerrainY(0.6, 5)).toBeCloseTo(bumpyBase(0.6, 5), 6);
  });

  it('carves elliptical, rectangular, and polygonal basins cleanly', () => {
    const pond = carveBasin({
      shape: 'ellipse',
      centerX: -8,
      centerZ: 6,
      radiusX: 5,
      radiusZ: 3,
      bottomY: -1.8,
      featherM: 1.5,
      profile: 'smooth',
    });

    const sunkenCourt = carveBasin({
      shape: 'box',
      minX: 4,
      maxX: 12,
      minZ: -4,
      maxZ: 4,
      bottomY: -1.0,
      wallSlopeM: 1.0,
      featherM: 1.0,
      profile: 'flatBottom',
    });

    const swalePoly = carveBasin({
      shape: 'polygon',
      vertices: [
        [20, -4],
        [28, -4],
        [28, 4],
        [20, 4],
      ],
      depthM: 0.9,
      wallSlopeM: 1.0,
      featherM: 1.0,
    });

    const sampler = createTerrainSampler({
      base: 'flat',
      flatElevationY: 0.5,
      modifiers: [pond, sunkenCourt, swalePoly],
    });

    expect(sampler.sampleTerrainY(-8, 6)).toBeCloseTo(-1.8, 4);
    expect(sampler.sampleTerrainY(-8, 12)).toBeCloseTo(0.5, 6);

    // Flat-bottom box basin holds exact -1.0m across interior core [5..11] x [-3..3]
    expect(sampler.sampleTerrainY(8, 0)).toBeCloseTo(-1.0, 6);
    expect(sampler.sampleTerrainY(6, 2)).toBeCloseTo(-1.0, 6);
    expect(sampler.sampleTerrainY(15, 0)).toBeCloseTo(0.5, 6);

    // Polygon basin with depthM = 0.9 depresses 0.5m base down to -0.4m
    expect(sampler.sampleTerrainY(24, 0)).toBeCloseTo(-0.4, 5);
  });

  it('applies sculptStamps mounds/hollows, custom modifiers, and accurate finite-difference normals', () => {
    const stamps = sculptStamps({
      stamps: [
        { x: 0, z: 0, radiusX: 6, radiusZ: 4, deltaY: 2.2, falloff: 'smooth' },
        { x: 15, z: 0, radiusX: 5, deltaY: -1.4, falloff: 'plateau', plateauRatio: 0.5 },
        { x: -15, z: 0, radiusX: 4, deltaY: 1.0, falloff: 'gaussian' },
      ],
    });
    const customStep = customTerrainModifier((wx, _wz, y) =>
      wx > 30 ? y + smoothstep(30, 34, wx) * 1.5 : y
    );

    expect(evaluateTerrainModifiers(0, 0, 0, [stamps, customStep])).toBeCloseTo(2.2, 6);
    expect(evaluateTerrainModifiers(0, 16, 0, [stamps, customStep])).toBeCloseTo(-1.4, 6);
    expect(evaluateTerrainModifiers(0, -15, 0, [stamps, customStep])).toBeCloseTo(1.0, 6);
    expect(evaluateTerrainModifiers(0, 36, 0, [stamps, customStep])).toBeCloseTo(1.5, 6);

    // Check normal on tilted plane y = 0.3 * x - 0.4 * z
    const planeSampler = createTerrainSampler({
      base: (wx, wz) => 0.3 * wx - 0.4 * wz,
    });
    const n = planeSampler.sampleNormal(4, -2, 0.25);
    const invLen = 1 / Math.hypot(0.3, 1, -0.4);
    expect(n.nx).toBeCloseTo(-0.3 * invLen, 6);
    expect(n.ny).toBeCloseTo(invLen, 6);
    expect(n.nz).toBeCloseTo(0.4 * invLen, 6);
    expect(Math.hypot(n.nx, n.ny, n.nz)).toBeCloseTo(1, 6);
  });
});
