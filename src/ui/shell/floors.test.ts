import { afterEach, describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import type { TwinFloorInfo } from '../../core/types/twin-api.ts';
import type { FloorViewMode } from '../../core/types/scene.ts';
import type { ShareViewState } from '../../core/types/twin-ux.ts';
import {
  configureShareStateCodec,
  decodeShareState,
  encodeShareState,
} from '../../state/url-state.ts';
import {
  DEFAULT_FLOORS,
  DEFAULT_PROPERTY_NAME,
  buildFloorPills,
  floorEyebrowLabel,
  floorModeForDigit,
  listFloors,
  propertyNameOf,
} from './room-data.ts';
import { FloorSwitcher } from './TopBar.tsx';

const ONE_FLOOR: readonly TwinFloorInfo[] = [{ id: 'main', label: 'Main' }];
const TWO_FLOORS: readonly TwinFloorInfo[] = [
  { id: 'ground', label: 'Ground', elevationY: 0, ceilingHeight: 2.5 },
  { id: 'first', label: 'First', elevationY: 2.5, ceilingHeight: 2.4 },
];
const THREE_FLOORS: readonly TwinFloorInfo[] = [
  { id: 'level1', label: 'Level 1' },
  { id: 'level2', label: 'Level 2' },
  { id: 'level3', label: 'Level 3' },
];

interface ButtonProps {
  readonly title: string;
  readonly 'aria-pressed': boolean;
  readonly children: string;
  readonly onClick: () => void;
}

/** Renders the switcher (a hook-free function component) and returns its buttons. */
function renderSwitcher(
  floors: readonly TwinFloorInfo[],
  active: FloorViewMode,
  onSelect: (id: FloorViewMode) => void = () => undefined
): readonly VNode<ButtonProps>[] | null {
  const vnode = FloorSwitcher({ pills: buildFloorPills(floors), active, onSelect });
  if (vnode === null) return null;
  return (vnode as VNode<{ children: VNode<ButtonProps>[] }>).props.children;
}

afterEach(() => {
  configureShareStateCodec();
});

describe('floor switcher', () => {
  it('is hidden for a single-storey home', () => {
    expect(buildFloorPills(ONE_FLOOR)).toEqual([]);
    expect(buildFloorPills([])).toEqual([]);
    expect(renderSwitcher(ONE_FLOOR, 'main')).toBeNull();
  });

  it('renders ground / first / all for a two-storey home', () => {
    expect(buildFloorPills(TWO_FLOORS)).toEqual([
      { id: 'ground', label: 'Ground', key: '1' },
      { id: 'first', label: 'First', key: '2' },
      { id: 'all', label: 'All', key: '3' },
    ]);
    const buttons = renderSwitcher(TWO_FLOORS, 'first');
    expect(buttons?.map((b) => b.props.children)).toEqual(['Ground', 'First', 'All']);
    expect(buttons?.map((b) => b.props['aria-pressed'])).toEqual([false, true, false]);
    expect(buttons?.map((b) => b.props.title)).toEqual([
      'Ground floor (1)',
      'First floor (2)',
      'All floor (3)',
    ]);
  });

  it('renders one pill per storey plus All for a three-storey home', () => {
    const selected: FloorViewMode[] = [];
    const buttons = renderSwitcher(THREE_FLOORS, 'all', (id) => selected.push(id));
    expect(buttons?.map((b) => b.props.children)).toEqual(['Level 1', 'Level 2', 'Level 3', 'All']);
    expect(buttons?.map((b) => b.props['aria-pressed'])).toEqual([false, false, false, true]);
    for (const b of buttons ?? []) b.props.onClick();
    expect(selected).toEqual(['level1', 'level2', 'level3', 'all']);
  });

  it('only assigns digit keys to the first nine pills', () => {
    const many: TwinFloorInfo[] = Array.from({ length: 10 }, (_, i) => ({
      id: `l${i}`,
      label: `L${i}`,
    }));
    const pills = buildFloorPills(many);
    expect(pills).toHaveLength(11);
    expect(pills[8]?.key).toBe('9');
    expect(pills[9]?.key).toBe('');
    expect(pills[10]).toEqual({ id: 'all', label: 'All', key: '' });
  });
});

describe('floor digit keys', () => {
  it('maps 1..N to the floors and N+1 to all', () => {
    expect(floorModeForDigit(TWO_FLOORS, 1)).toBe('ground');
    expect(floorModeForDigit(TWO_FLOORS, 2)).toBe('first');
    expect(floorModeForDigit(TWO_FLOORS, 3)).toBe('all');
    expect(floorModeForDigit(TWO_FLOORS, 4)).toBeNull();
    expect(floorModeForDigit(THREE_FLOORS, 3)).toBe('level3');
    expect(floorModeForDigit(THREE_FLOORS, 4)).toBe('all');
    expect(floorModeForDigit(THREE_FLOORS, 5)).toBeNull();
  });

  it('is a no-op for single-storey homes and out-of-range digits', () => {
    for (let d = 1; d <= 9; d++) expect(floorModeForDigit(ONE_FLOOR, d)).toBeNull();
    expect(floorModeForDigit(TWO_FLOORS, 0)).toBeNull();
    expect(floorModeForDigit(TWO_FLOORS, 10)).toBeNull();
    expect(floorModeForDigit(TWO_FLOORS, 1.5)).toBeNull();
  });
});

describe('floor and property labels', () => {
  it('labels a room by its floor', () => {
    expect(floorEyebrowLabel(TWO_FLOORS, 'ground')).toBe('Ground floor');
    expect(floorEyebrowLabel(TWO_FLOORS, 'first')).toBe('First floor');
    expect(floorEyebrowLabel(THREE_FLOORS, 'level3')).toBe('Level 3 floor');
    expect(floorEyebrowLabel([{ id: 'g', label: 'Ground Floor' }], 'g')).toBe('Ground Floor');
  });

  it('falls back to a readable id for unlisted floors and names the exterior', () => {
    expect(floorEyebrowLabel(TWO_FLOORS, 'attic')).toBe('Attic floor');
    expect(floorEyebrowLabel(TWO_FLOORS, 'lower-ground')).toBe('Lower ground floor');
    expect(floorEyebrowLabel(TWO_FLOORS, 'exterior')).toBe('Outside');
  });

  it('reads floors and the property name from the twin, with defaults for older twins', () => {
    const api = { floors: { list: () => THREE_FLOORS, propertyName: () => 'Stahl House' } };
    expect(listFloors(api)).toBe(THREE_FLOORS);
    expect(propertyNameOf(api)).toBe('Stahl House');
    expect(listFloors({ floors: {} })).toBe(DEFAULT_FLOORS);
    expect(propertyNameOf({ floors: {} })).toBe(DEFAULT_PROPERTY_NAME);
    expect(DEFAULT_FLOORS.map((f) => f.id)).toEqual(['ground', 'first']);
  });
});

describe('share links for a custom house', () => {
  const state: ShareViewState = {
    cam: [4, 12, -9.5],
    target: [1, 6, 0],
    floor: 'level3',
    ortho: false,
    room: 'livingPavilion',
    view: 'owner',
    guest: true,
  };

  it('round-trips custom room and floor ids with no configuration', () => {
    expect(decodeShareState(encodeShareState(state))).toEqual(state);
    expect(decodeShareState(encodeShareState({ ...state, room: 'poolDeck', floor: 'all' }))).toEqual({
      ...state,
      room: 'poolDeck',
      floor: 'all',
    });
  });

  it('round-trips through the house configuration built from its floor list', () => {
    configureShareStateCodec({
      allowedRooms: new Set(['livingPavilion', 'poolDeck']),
      floors: THREE_FLOORS.map((f) => f.id),
    });
    expect(decodeShareState(encodeShareState(state))).toEqual(state);
    const foreign = decodeShareState(encodeShareState({ ...state, room: 'kitchen' }));
    expect(foreign?.room).toBeUndefined();
    expect(foreign?.floor).toBe('level3');
  });
});
