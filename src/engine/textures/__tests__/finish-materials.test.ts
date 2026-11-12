import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FINISH_SHEENS,
  clearFinishMaterialCache,
  createFinishMaterial,
  type FinishSheen,
} from '../finish-materials.ts';

describe('finish-materials sheen registry', () => {
  beforeEach(() => {
    clearFinishMaterialCache();
  });

  it('defines all 20 calibrated paint, timber/stone, and architectural metal/enamel sheens', () => {
    const expectedSheens: readonly [FinishSheen, number, number][] = [
      // Paint & Plaster
      ['lime-wash', 0.9, 0.0],
      ['chalky-matte', 0.86, 0.0],
      ['estate-emulsion', 0.82, 0.0],
      ['modern-emulsion', 0.72, 0.0],
      ['eggshell', 0.38, 0.01],
      ['satinwood', 0.28, 0.01],
      ['full-gloss', 0.14, 0.06],
      // Timber & Stone
      ['oiled-oak', 0.46, 0.02],
      ['waxed-walnut', 0.32, 0.02],
      ['fumed-mahogany', 0.3, 0.03],
      ['honed-stone', 0.34, 0.01],
      ['polished-marble', 0.18, 0.02],
      ['riven-slate', 0.76, 0.03],
      // Architectural Metals & Enamel
      ['unlacquered-brass', 0.28, 0.88],
      ['aged-brass', 0.36, 0.84],
      ['polished-chrome', 0.12, 0.94],
      ['brushed-nickel', 0.32, 0.86],
      ['wrought-iron', 0.4, 0.62],
      ['cast-iron', 0.54, 0.55],
      ['vitreous-enamel', 0.15, 0.08],
    ];

    expect(Object.keys(FINISH_SHEENS)).toHaveLength(20);
    for (const [sheen, expectedRoughness, expectedMetalness] of expectedSheens) {
      const mat = createFinishMaterial(sheen);
      expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mat.roughness).toBeCloseTo(expectedRoughness, 5);
      expect(mat.metalness).toBeCloseTo(expectedMetalness, 5);
      expect(mat.color.getHexString()).toBe(
        new THREE.Color(FINISH_SHEENS[sheen].defaultColor).getHexString()
      );
      expect(mat.roughnessMap).toBeNull();
      expect(mat.normalMap).toBeNull();
    }
  });

  it('returns the exact same cached MeshStandardMaterial reference across equivalent hex/numeric colour formats unless unique is true', () => {
    const a = createFinishMaterial('eggshell', '#E6E3DB');
    const b = createFinishMaterial('eggshell', '#e6e3db');
    const c = createFinishMaterial('eggshell', 0xe6e3db);

    expect(a).toBe(b);
    expect(a).toBe(c);

    // Different sheen or side produces a distinct cached entry
    const satin = createFinishMaterial('satinwood', '#E6E3DB');
    const doubleSided = createFinishMaterial('eggshell', '#E6E3DB', { side: THREE.DoubleSide });
    expect(satin).not.toBe(a);
    expect(doubleSided).not.toBe(a);
    expect(doubleSided.side).toBe(THREE.DoubleSide);

    // Default colour omitted vs explicit default hex also shares the exact instance
    const brassDefault = createFinishMaterial('aged-brass');
    const brassExplicit = createFinishMaterial('aged-brass', '#B5914B');
    expect(brassDefault).toBe(brassExplicit);

    // unique: true allocates an isolated instance for runtime mutation
    const uniqueA = createFinishMaterial('eggshell', '#E6E3DB', { unique: true });
    const uniqueB = createFinishMaterial('eggshell', '#E6E3DB', { unique: true });
    expect(uniqueA).not.toBe(a);
    expect(uniqueA).not.toBe(uniqueB);
  });

  it('attaches shared singleton procedural micro-grain maps when microGrain is enabled', () => {
    const shingleGrain = createFinishMaterial('eggshell', '#D5D4CA', { microGrain: true });
    const hagueBlueGrain = createFinishMaterial('estate-emulsion', '#3F4D57', { microGrain: true });
    const shingleFlat = createFinishMaterial('eggshell', '#D5D4CA');

    expect(shingleGrain).not.toBe(shingleFlat);
    expect(shingleGrain.roughnessMap).toBeInstanceOf(THREE.DataTexture);
    expect(shingleGrain.normalMap).toBeInstanceOf(THREE.DataTexture);
    // Singleton micro-grain maps are shared across different colours and sheens
    expect(shingleGrain.roughnessMap).toBe(hagueBlueGrain.roughnessMap);
    expect(shingleGrain.normalMap).toBe(hagueBlueGrain.normalMap);
  });
});
