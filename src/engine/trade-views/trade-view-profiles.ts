import type { TradeView } from '../../core/types/twin-ux.ts';
import type { TradeCategory } from './trade-classifier.ts';

/** How a category is rendered in a given trade view. */
export type TradeDisplayMode = 'normal' | 'ghost' | 'hidden' | 'highlight';

export type TradeViewProfile = Readonly<Record<TradeCategory, TradeDisplayMode>>;

/** Highlight tint per category (sRGB hex). Distinct hues so electricians / plumbers can tell systems apart. */
export const TRADE_CATEGORY_COLORS: Readonly<Record<TradeCategory, number>> = {
  structure: 0xd9822b,
  envelope: 0x7d9cc0,
  insulation: 0xff6fb5,
  finishes: 0xc8b89a,
  joinery: 0xa0703c,
  furniture: 0x9e9e9e,
  decor: 0xb0a0c0,
  electrical: 0xff7a00,
  lighting: 0xffd400,
  smart: 0x00c2ff,
  plumbing: 0x2f6bff,
  heating: 0xff3b30,
  sanitary: 0x22d3b0,
  external: 0x6fae4f,
  vehicle: 0x8a8a8a,
  other: 0x9e9e9e,
};

/** Human labels for legends. */
export const TRADE_CATEGORY_LABELS: Readonly<Record<TradeCategory, string>> = {
  structure: 'Structure',
  envelope: 'Envelope',
  insulation: 'Insulation',
  finishes: 'Finishes',
  joinery: 'Joinery',
  furniture: 'Furniture & appliances',
  decor: 'Decor',
  electrical: 'Electrical',
  lighting: 'Lighting',
  smart: 'Smart home / KNX',
  plumbing: 'Plumbing',
  heating: 'Heating',
  sanitary: 'Sanitaryware',
  external: 'External works',
  vehicle: 'Vehicles',
  other: 'Other',
};

const ALL_NORMAL: TradeViewProfile = {
  structure: 'normal',
  envelope: 'normal',
  insulation: 'normal',
  finishes: 'normal',
  joinery: 'normal',
  furniture: 'normal',
  decor: 'normal',
  electrical: 'normal',
  lighting: 'normal',
  smart: 'normal',
  plumbing: 'normal',
  heating: 'normal',
  sanitary: 'normal',
  external: 'normal',
  vehicle: 'normal',
  other: 'normal',
};

/**
 * Per-view display modes. Lights (THREE.Light) are never touched by any profile; only
 * renderable geometry is ghosted / hidden / highlighted.
 */
export const TRADE_VIEW_PROFILES: Readonly<Record<TradeView, TradeViewProfile>> = {
  owner: ALL_NORMAL,
  architect: {
    ...ALL_NORMAL,
    furniture: 'ghost',
    decor: 'ghost',
    vehicle: 'ghost',
    electrical: 'hidden',
    smart: 'hidden',
    plumbing: 'hidden',
    heating: 'hidden',
  },
  builder: {
    ...ALL_NORMAL,
    structure: 'highlight',
    envelope: 'highlight',
    insulation: 'highlight',
    furniture: 'ghost',
    decor: 'ghost',
    vehicle: 'ghost',
    smart: 'hidden',
  },
  electrician: {
    ...ALL_NORMAL,
    electrical: 'highlight',
    lighting: 'highlight',
    smart: 'highlight',
    furniture: 'ghost',
    decor: 'ghost',
    vehicle: 'ghost',
  },
  plumber: {
    ...ALL_NORMAL,
    plumbing: 'highlight',
    heating: 'highlight',
    sanitary: 'highlight',
    furniture: 'ghost',
    decor: 'ghost',
    vehicle: 'ghost',
  },
};

export function getTradeDisplayMode(view: TradeView, category: TradeCategory): TradeDisplayMode {
  return TRADE_VIEW_PROFILES[view][category];
}

/** Categories highlighted in a view (legend / schedule export). */
export function getHighlightedCategories(view: TradeView): TradeCategory[] {
  const profile = TRADE_VIEW_PROFILES[view];
  return (Object.keys(profile) as TradeCategory[]).filter((c) => profile[c] === 'highlight');
}
