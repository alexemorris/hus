import { describe, expect, it } from 'vitest';
import {
  TRADE_CATEGORY_USERDATA_KEY,
  classifyName,
  isTradeCategory,
  splitNameSegments,
  tokenizeSegment,
} from './trade-classifier.ts';

describe('tokenizeSegment / splitNameSegments', () => {
  it('splits camelCase segments into lower-case words', () => {
    expect(tokenizeSegment('bootRoomManifoldCupboard')).toEqual(['boot', 'room', 'manifold', 'cupboard']);
    expect(tokenizeSegment('KNXWiringCenter')).toEqual(['knx', 'wiring', 'center']);
  });

  it('splits hierarchical names on dots, slashes, colons and pipes', () => {
    expect(splitNameSegments('kitchen.island/sink:tap|x')).toEqual(['kitchen', 'island', 'sink', 'tap', 'x']);
    expect(splitNameSegments('')).toEqual([]);
  });
});

describe('classifyName', () => {
  const cases: readonly (readonly [string, readonly string[], string])[] = [
    ['bootRoomManifoldCupboard', [], 'joinery'],
    ['kitchen.island.sink.tap', [], 'plumbing'],
    ['porsche992TurboS.headlight', [], 'vehicle'],
    ['hall.corstonSocket.southWall', [], 'electrical'],
    ['knxWiringCenter', [], 'smart'],
    ['showerRoom.wall', [], 'structure'],
    ['courtyard.wall', [], 'external'],
    ['pipe', ['radiator'], 'heating'],
    ['cable', ['pendant'], 'lighting'],
    ['ufhLoop3', [], 'heating'],
    ['sofa', ['livingRoom'], 'furniture'],
  ];

  it.each(cases)('classifies %s (parents %j) as %s', (name, parents, expected) => {
    expect(classifyName(name, parents, {})).toBe(expected);
  });

  it('honours an explicit tradeCategory in userData', () => {
    expect(classifyName('sofa', [], { [TRADE_CATEGORY_USERDATA_KEY]: 'plumbing' })).toBe('plumbing');
  });

  it('uses semantic userData flags (own first, then ancestors)', () => {
    expect(classifyName('mesh', [], { isKNXSwitch: true })).toBe('smart');
    expect(classifyName('mesh', [], { ufhZoneId: 'kitchen' })).toBe('heating');
    expect(classifyName('mesh', [], {}, [{}, { isCarGate: true }])).toBe('external');
  });

  it('keeps KNX-switched sockets electrical', () => {
    expect(classifyName('doubleSocket', [], { switchPa: '1.1.1' })).toBe('electrical');
    expect(classifyName('doubleSocket', [], { circuitId: 'kitchen_pendants' })).toBe('electrical');
  });

  it('falls back to structural / LOD hints for unknown names', () => {
    expect(classifyName('xyzzy', [], {})).toBe('other');
    expect(classifyName('xyzzy', [], { isArchitecturalShell: true })).toBe('structure');
    expect(classifyName('xyzzy', [], {}, [{ cutawayWall: true }])).toBe('structure');
    expect(classifyName('xyzzy', [], { lodTier: 'high' })).toBe('decor');
  });

  it('always returns a valid trade category', () => {
    for (const name of ['', 'a.b.c', '123', 'Wall', 'LIGHT', 'garden.bench.leg']) {
      expect(isTradeCategory(classifyName(name, [], {}))).toBe(true);
    }
  });
});
