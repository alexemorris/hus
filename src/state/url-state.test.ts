import { applyVariationsToUrl, parseVariationSearchParams } from './url-state.ts';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShareViewState } from '../core/types/twin-ux.ts';
import {
  SHARE_URL_PARAM,
  buildShareUrl,
  configureShareStateCodec,
  decodeShareState,
  encodeShareState,
  isRoomZoneId,
  readShareStateFromLocation,
} from './url-state.ts';

const SAMPLE: ShareViewState = {
  cam: [-12.34, 8.5, 21.07],
  target: [-4.2, 0, 3.9],
  floor: 'first',
  ortho: true,
  room: 'kitchen',
  view: 'electrician',
  guest: false,
};

function rawParam(compact: Record<string, unknown>): string {
  return btoa(JSON.stringify(compact)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeRaw(param: string): Record<string, unknown> {
  const padded = param.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as Record<string, unknown>;
}

const BASE = { c: [1, 2, 3], t: [0, 0, 0], o: 0, w: 0, g: 0 };

afterEach(() => {
  configureShareStateCodec();
});

describe('share-link codec', () => {
  it('round-trips a full view state', () => {
    const encoded = encodeShareState(SAMPLE);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShareState(encoded)).toEqual(SAMPLE);
  });

  it('round-trips without a room and with guest mode', () => {
    const state: ShareViewState = { ...SAMPLE, room: undefined, guest: true, floor: 'all', view: 'owner' };
    const { room: _room, ...expected } = state;
    expect(decodeShareState(encodeShareState(state))).toEqual(expected);
  });

  it('rounds coordinates to centimetres', () => {
    const decoded = decodeShareState(
      encodeShareState({ ...SAMPLE, cam: [1.23456, -2.34567, 3.005], target: [0.004, 0, 0] })
    );
    expect(decoded?.cam).toEqual([1.23, -2.35, 3.01]);
    expect(decoded?.target).toEqual([0, 0, 0]);
  });

  it('rejects malformed input', () => {
    expect(decodeShareState('')).toBeNull();
    expect(decodeShareState('not base64!')).toBeNull();
    expect(decodeShareState(btoa('{"c":[1,2],"t":[0,0,0]}'))).toBeNull();
    expect(decodeShareState(btoa('[1,2,3]'))).toBeNull();
  });

  it('keeps the compact numeric floor index for ground/first/all links', () => {
    expect(decodeRaw(encodeShareState({ ...SAMPLE, floor: 'ground' })).f).toBe(0);
    expect(decodeRaw(encodeShareState({ ...SAMPLE, floor: 'first' })).f).toBe(1);
    expect(decodeRaw(encodeShareState({ ...SAMPLE, floor: 'all' })).f).toBe(2);
    expect(decodeShareState(rawParam({ ...BASE, f: 0 }))?.floor).toBe('ground');
    expect(decodeShareState(rawParam({ ...BASE, f: 1 }))?.floor).toBe('first');
    expect(decodeShareState(rawParam({ ...BASE, f: 2 }))?.floor).toBe('all');
    expect(decodeShareState(rawParam({ ...BASE, f: 7 }))?.floor).toBe('ground');
    expect(decodeShareState(rawParam(BASE))?.floor).toBe('ground');
  });

  it('accepts any safe room id when rooms are not restricted', () => {
    for (const room of ['livingPavilion', 'poolDeck', 'kitchen', 'masterBedroom']) {
      const decoded = decodeShareState(encodeShareState({ ...SAMPLE, room }));
      expect(decoded?.room).toBe(room);
    }
  });

  it('drops unsafe room ids on decode and encode', () => {
    for (const r of ['not a room!', '', '<script>', 'a/b', 'x'.repeat(65), 42, null]) {
      const decoded = decodeShareState(rawParam({ ...BASE, f: 0, r }));
      expect(decoded).not.toBeNull();
      expect(decoded?.room).toBeUndefined();
    }
    expect(decodeRaw(encodeShareState({ ...SAMPLE, room: 'not a room!' })).r).toBeUndefined();
    expect(isRoomZoneId('not a room!')).toBe(false);
    expect(isRoomZoneId('')).toBe(false);
    expect(isRoomZoneId('poolDeck')).toBe(true);
  });

  it('filters rooms through allowedRooms when provided', () => {
    const options = { allowedRooms: new Set(['livingPavilion', 'poolDeck']) };
    const pavilion = encodeShareState({ ...SAMPLE, room: 'livingPavilion' }, options);
    expect(decodeShareState(pavilion, options)?.room).toBe('livingPavilion');
    expect(decodeShareState(rawParam({ ...BASE, f: 0, r: 'kitchen' }), options)?.room).toBeUndefined();
    expect(decodeRaw(encodeShareState({ ...SAMPLE, room: 'kitchen' }, options)).r).toBeUndefined();
    expect(decodeShareState(rawParam({ ...BASE, f: 0, r: 'kitchen' }))?.room).toBe('kitchen');
  });

  it('round-trips custom floor ids as strings when no floors are configured', () => {
    for (const floor of ['level3', 'mezzanine', 'penthouse']) {
      const encoded = encodeShareState({ ...SAMPLE, floor });
      expect(decodeRaw(encoded).f).toBe(floor);
      expect(decodeShareState(encoded)?.floor).toBe(floor);
    }
    expect(decodeShareState(rawParam({ ...BASE, f: 'not a floor!' }))?.floor).toBe('ground');
  });

  it('indexes numeric floors into the configured floors plus all', () => {
    const options = { floors: ['level1', 'level2', 'level3'] };
    const encoded = encodeShareState({ ...SAMPLE, floor: 'level3' }, options);
    expect(decodeRaw(encoded).f).toBe(2);
    expect(decodeShareState(encoded, options)?.floor).toBe('level3');
    expect(decodeShareState(encodeShareState({ ...SAMPLE, floor: 'all' }, options), options)?.floor).toBe('all');
    expect(decodeRaw(encodeShareState({ ...SAMPLE, floor: 'all' }, options)).f).toBe(3);
    expect(decodeShareState(rawParam({ ...BASE, f: 'level2' }), options)?.floor).toBe('level2');
    expect(decodeShareState(rawParam({ ...BASE, f: 'ground' }), options)?.floor).toBe('level1');
    expect(decodeShareState(rawParam({ ...BASE, f: 9 }), options)?.floor).toBe('level1');
    expect(decodeShareState(encodeShareState({ ...SAMPLE, floor: 'first' }, options), options)?.floor).toBe('level1');
  });

  it('handles a single-floor house', () => {
    const options = { floors: ['main'] };
    expect(decodeShareState(encodeShareState({ ...SAMPLE, floor: 'main' }, options), options)?.floor).toBe('main');
    expect(decodeShareState(rawParam({ ...BASE, f: 1 }), options)?.floor).toBe('all');
  });

  it('uses configureShareStateCodec defaults until reset, with per-call options winning', () => {
    configureShareStateCodec({ allowedRooms: new Set(['poolDeck']), floors: ['level1', 'level2'] });
    const state: ShareViewState = { ...SAMPLE, room: 'poolDeck', floor: 'level2' };
    const encoded = encodeShareState(state);
    expect(decodeShareState(encoded)).toEqual(state);
    expect(decodeShareState(rawParam({ ...BASE, f: 0, r: 'kitchen' }))?.room).toBeUndefined();
    expect(readShareStateFromLocation(`?${SHARE_URL_PARAM}=${encoded}`)).toEqual(state);
    expect(
      decodeShareState(rawParam({ ...BASE, f: 0, r: 'kitchen' }), { allowedRooms: new Set(['kitchen']) })?.room
    ).toBe('kitchen');

    configureShareStateCodec();
    expect(decodeShareState(rawParam({ ...BASE, f: 1, r: 'kitchen' }))).toMatchObject({
      room: 'kitchen',
      floor: 'first',
    });
  });

  it('builds share URLs without dev/transport params and reads them back', () => {
    const url = new URL(
      buildShareUrl(SAMPLE, 'https://example.test/hus/?dev=1&knxWs=ws://x&keep=1#frag')
    );
    expect(url.pathname).toBe('/hus/');
    expect(url.hash).toBe('');
    expect(url.searchParams.has('dev')).toBe(false);
    expect(url.searchParams.has('knxWs')).toBe(false);
    expect(url.searchParams.get('keep')).toBe('1');
    expect(url.searchParams.has(SHARE_URL_PARAM)).toBe(true);
    expect(readShareStateFromLocation(url.search)).toEqual(SAMPLE);
  });
});

describe('url-state room variation selections', () => {
  it('preserves room variation selections in ShareViewState and ?vars= / ?var.<id>= URLs', () => {
    expect(parseVariationSearchParams('?vars=east-wall:cupboards&var.island=oak')).toEqual({
      'east-wall': 'cupboards',
      island: 'oak',
    });
    const encoded = encodeShareState({
      cam: [1, 2, 3],
      target: [0, 1, 0],
      floor: 'first',
      ortho: false,
      room: 'studio',
      view: 'architect',
      guest: true,
      vars: { 'east-wall': 'cupboards' },
    });
    expect(decodeShareState(encoded)?.vars).toEqual({ 'east-wall': 'cupboards' });
    const shareHref = buildShareUrl(
      {
        cam: [1, 2, 3],
        target: [0, 1, 0],
        floor: 'first',
        ortho: false,
        view: 'owner',
        guest: true,
        vars: { 'east-wall': 'cupboards' },
      },
      'https://example.com/?dev=1'
    );
    expect(shareHref).toContain('vars=east-wall%3Acupboards');
    expect(shareHref).not.toContain('dev=1');
    expect(applyVariationsToUrl(shareHref, {})).not.toContain('vars=');
  });
});
