import * as THREE from 'three';

/**
 * Trade category assigned to every renderable object in the twin. Used by the
 * trade-view overlays (owner / architect / builder / electrician / plumber) to
 * decide whether an object is shown normally, ghosted, hidden or highlighted.
 */
export type TradeCategory =
  | 'structure'
  | 'envelope'
  | 'insulation'
  | 'finishes'
  | 'joinery'
  | 'furniture'
  | 'decor'
  | 'electrical'
  | 'lighting'
  | 'smart'
  | 'plumbing'
  | 'heating'
  | 'sanitary'
  | 'external'
  | 'vehicle'
  | 'other';

export const TRADE_CATEGORIES: readonly TradeCategory[] = [
  'structure',
  'envelope',
  'insulation',
  'finishes',
  'joinery',
  'furniture',
  'decor',
  'electrical',
  'lighting',
  'smart',
  'plumbing',
  'heating',
  'sanitary',
  'external',
  'vehicle',
  'other',
];

/** `userData` key written by {@link classifyScene} and honoured by {@link classifyObject}. */
export const TRADE_CATEGORY_USERDATA_KEY = 'tradeCategory';

const TRADE_CATEGORY_SET: ReadonlySet<string> = new Set<string>(TRADE_CATEGORIES);

export function isTradeCategory(value: unknown): value is TradeCategory {
  return typeof value === 'string' && TRADE_CATEGORY_SET.has(value);
}

/** 2 = unambiguous token, 1 = ambiguous token (only used if no strong token is found). */
type TokenStrength = 1 | 2;

interface TokenRule {
  readonly category: TradeCategory;
  readonly strength: TokenStrength;
}

interface CategoryTokens {
  readonly strong: readonly string[];
  readonly weak?: readonly string[];
}

/**
 * Token vocabulary derived from a static survey of the ~4.5k literal `.name =` assignments
 * in `src/` plus a runtime walk of a full multi-room architectural scene graph. Tokens are lower-case
 * camelCase words; multi-word entries (bigrams) are written joined, e.g. `beertap`.
 */
const CATEGORY_TOKENS: Readonly<Record<Exclude<TradeCategory, 'other'>, CategoryTokens>> = {
  structure: {
    strong: [
      'wall', 'brick', 'brickwork', 'masonry', 'blockwork', 'stud', 'studwork', 'partition', 'pier',
      'beam', 'joist', 'joists', 'rafter', 'truss', 'purlin', 'lintel', 'rsj', 'kingpost', 'strut',
      'foundation', 'footing', 'chimney', 'chimneystack', 'padstone', 'girder',
      'noggin', 'wallplate', 'ridgeboard', 'steelwork', 'gable', 'stack', 'breast',
    ],
    weak: [
      'slab', 'column', 'pillar', 'post', 'steel', 'portal', 'header', 'brace', 'bearing', 'pilaster',
      'corbel', 'arch', 'fireplace', 'returnwall', 'stone', 'block', 'jut',
    ],
  },
  envelope: {
    strong: [
      'roof', 'roofing', 'slate', 'slates', 'eaves', 'soffit', 'bargeboard', 'verge', 'gutter',
      'downpipe', 'hopper', 'flashing', 'window', 'windows', 'glazing', 'sill', 'mullion', 'transom',
      'casement', 'velux', 'skylight', 'rooflight', 'render', 'cladding', 'weatherboard', 'membrane',
      'dpc', 'dormer', 'muntin', 'bifold', 'bifolds', 'porch', 'ridge', 'hip', 'louvres', 'louvre',
      'glazed', 'fanlight', 'shutter', 'shutters', 'leadwork', 'bay', 'socketring',
    ],
    weak: ['glass', 'pane', 'fascia', 'lead', 'canopy', 'valley', 'coping', 'cappings', 'cap'],
  },
  insulation: {
    strong: [
      'insulation', 'insulated', 'celotex', 'kingspan', 'rockwool', 'woodfibre', 'woodfiber',
      'mineralwool', 'steico', 'pavatex', 'quilt', 'sheepswool', 'hempcrete', 'thermalbreak',
    ],
  },
  finishes: {
    strong: [
      'plaster', 'plasterboard', 'skim', 'paint', 'skirting', 'skirtings', 'baseboard', 'baseboards',
      'architrave', 'architraves', 'cornice', 'coving', 'cove', 'dado', 'picturerail', 'carpet',
      'tiling', 'floorboard', 'floorboards', 'flooring', 'parquet', 'screed', 'lining', 'splashback',
      'backsplash', 'wallpaper', 'limewash', 'floorfinish', 'tiles', 'plasterliner', 'mantle', 'mantel',
      'frieze', 'rosette', 'ceilingrose', 'surround', 'nosing', 'bullnose',
    ],
    weak: [
      'floor', 'ceiling', 'tile', 'moulding', 'molding', 'liner', 'threshold', 'reveal', 'hearth',
      'trim', 'herringbone', 'mitre', 'beading', 'bead', 'upstand', 'skirt',
    ],
  },
  joinery: {
    strong: [
      'cupboard', 'cupboards', 'cabinet', 'cabinets', 'cabinetry', 'wardrobe', 'wardrobes', 'worktop',
      'countertop', 'carcass', 'stair', 'stairs', 'staircase', 'stairwell', 'tread', 'stringer', 'newel',
      'baluster', 'balusters', 'balustrade', 'banister', 'handrail', 'island', 'larder', 'pantry',
      'panelling', 'paneling', 'wainscot', 'joinery', 'shelving', 'drawers', 'plinth', 'dresser',
      'doorframe', 'doorset', 'understairs', 'boxing', 'landingrail', 'kickboard',
    ],
    weak: [
      'door', 'doors', 'stile', 'rail', 'shelf', 'drawer', 'counter', 'riser', 'hinge', 'jamb',
      'hatch', 'ladder', 'guardrail', 'panel', 'leaf', 'step', 'steps', 'muntins',
    ],
  },
  furniture: {
    strong: [
      'sofa', 'chair', 'chairs', 'armchair', 'stool', 'stools', 'table', 'desk', 'bed', 'mattress',
      'headboard', 'sideboard', 'chest', 'bookcase', 'ottoman', 'chaise', 'beanbag', 'pouffe', 'tv',
      'television', 'oled', 'qled', 'monitor', 'projector', 'macbook', 'laptop', 'imac', 'printer',
      'piano', 'roland', 'playstation', 'nintendo', 'xbox', 'fridge', 'freezer', 'oven', 'hob',
      'cooker', 'aga', 'dishwasher', 'washer', 'dryer', 'microwave', 'toaster', 'kettle', 'espresso',
      'dualit', 'neff', 'smeg', 'cooler', 'treadmill', 'technogym', 'trackman', 'bambu', 'boombox',
      'trinitron', 'vcr', 'sonos', 'speaker', 'speakers', 'subwoofer', 'amplifier', 'turntable',
      'crib', 'cot', 'nightstand', 'bedside', 'console', 'credenza', 'bench', 'barstool', 'recliner',
      'futon', 'daybed', 'hammock', 'lounger', 'deckchair', 'parasol', 'hood', 'cookerhood',
      'extractorhood', 'washingmachine', 'tumbledryer', 'winecooler', 'grinder', 'drill', 'drills',
      'saw', 'sander', 'vice', 'toolbench', 'workbench', 'tstak', 'barbell', 'dumbbell', 'squat',
      'rowing', 'bike', 'simulator', 'stihl', 'blower', 'trimmer', 'mower', 'tablet', 'ipad', 'samsung',
      'sony', 'lg', 'pegboard', 'rack', 'beertap', 'kegerator', 'cocktail', 'barcart',
    ],
    weak: ['screen', 'stand', 'machine', 'seat', 'tool', 'tools', 'unit', 'leg', 'legs', 'range', 'frame', 'bar'],
  },
  decor: {
    strong: [
      'picture', 'pictures', 'painting', 'artwork', 'canvas', 'print', 'poster', 'vase', 'urn',
      'cushion', 'cushions', 'pillow', 'pillows', 'throw', 'rug', 'curtain', 'curtains', 'blind',
      'blinds', 'candle', 'candles', 'clock', 'ornament', 'sculpture', 'bottle', 'bottles', 'tumbler',
      'glassware', 'mug', 'book', 'books', 'magazine', 'fruit', 'lemon', 'lemons', 'apple',
      'orange', 'flower', 'flowers', 'bouquet', 'houseplant', 'certificate', 'certificates', 'photo',
      'photograph', 'whiteboard', 'towel', 'towels', 'basket', 'trophy', 'helmet', 'ball', 'balls',
      'club', 'clubs', 'golfbag', 'tourbag', 'bag', 'headcover', 'wine', 'champagne', 'pellegrino',
      'water', 'tray', 'bowl', 'tapestry', 'mirror', 'decanter', 'pint', 'foam', 'glasses', 'teapot',
      'plates', 'cutlery', 'cookbook', 'hat', 'coat', 'shoes', 'boots', 'umbrella', 'tablecloth',
      'napkin', 'duvet', 'quilt', 'blanket', 'linen', 'sheet', 'figurine', 'globe', 'records', 'vinyl',
      'controller', 'remote', 'headphones', 'ivy', 'fern', 'succulent', 'orchid',
      'bonsai', 'leafset', 'plant', 'plants', 'herb', 'herbs', 'spirit', 'beer', 'can', 'cans',
    ],
    weak: ['art', 'sign', 'shade', 'stem', 'pot', 'pots', 'cup'],
  },
  electrical: {
    strong: [
      'socket', 'sockets', 'fuse', 'consumerunit', 'electrical', 'isolator', 'spur', 'fcu', 'rcd',
      'rcbo', 'mcb', 'breaker', 'busbar', 'cable', 'cables', 'wiring', 'conduit', 'trunking',
      'backbox', 'incomer', 'charger', 'evcharger', 'meter', 'distributionboard',
      'subboard', 'switchgear', 'contactor', 'transformer', 'inverter', 'battery', 'batteries',
      'solar', 'pv', 'earth', 'earthing', 'plug', 'lampplug', 'powercord', 'extensionlead',
      'powerstrip', 'gland', 'din', 'mep', 'extractorfan', 'fan', 'ups',
    ],
    weak: ['outlet', 'phase', 'adapter', 'brick', 'enclosure', 'cord', 'distribution'],
  },
  lighting: {
    strong: [
      'light', 'lights', 'lighting', 'lamp', 'lamps', 'lampshade', 'pendant', 'pendants', 'sconce',
      'sconces', 'downlight', 'downlights', 'spotlight', 'spotlights', 'spot', 'spots', 'uplight',
      'uplights', 'chandelier', 'lantern', 'lanterns', 'bulb', 'bulbs', 'luminaire', 'filament',
      'lampholder', 'ledstrip', 'ledstrips', 'lamppost', 'fairy', 'festoon', 'picturelight',
      'striplight', 'wallwasher', 'floodlight', 'bollard', 'nightlight', 'lightbar', 'ledchannel',
      'ledlight', 'ledgroup', 'diffuser', 'reflector',
    ],
    weak: ['led', 'leds', 'fitting', 'canopy', 'gallery'],
  },
  smart: {
    strong: [
      'knx', 'keypad', 'switch', 'switches', 'switchplate', 'dimmer', 'thermostat', 'pir', 'presence',
      'unifi', 'ubiquiti', 'camera', 'cameras', 'cctv', 'router', 'gateway', 'doorbell', 'intercom',
      'nest', 'hue', 'lutron', 'loxone', 'actuators', 'server', 'networkrack', 'ap', 'accesspoint',
      'reader', 'accessreader', 'tempsensor', 'motionsensor', 'touchpanel', 'smoke',
      'smokealarm', 'alarm', 'siren', 'thermalsensor',
    ],
    weak: ['sensor', 'sensors', 'motion', 'controller', 'statusled'],
  },
  plumbing: {
    strong: [
      'pipe', 'pipes', 'pipework', 'valve', 'valves', 'tap', 'taps', 'drain', 'drainage', 'trap',
      'soilpipe', 'soilstack', 'wastepipe', 'stopcock', 'cylinder', 'gully', 'aav', 'munsen',
      'plumbing', 'hose', 'hosepipe', 'watersoftener', 'softener', 'mixertap', 'plughole', 'overflow',
      'wastetrap', 'feedpipe', 'coldwater', 'hotwater', 'flowpipe', 'returnpipe',
      'isolationvalve', 'compression', 'union', 'bleed',
    ],
    weak: ['waste', 'mixer', 'spout', 'tank', 'outlet', 'riser', 'header', 'flange', 'drop', 'pump', 'tee', 'elbow', 'stub', 'mains'],
  },
  heating: {
    strong: [
      'ufh', 'underfloor', 'manifold', 'radiator', 'radiators', 'rad', 'boiler', 'viessmann',
      'heatpump', 'actuator', 'flowmeter', 'expansion', 'vessel', 'stove', 'woodburner', 'woodburning',
      'towelrail', 'heatedtowelrail', 'heating', 'heater', 'aircon', 'airconditioning', 'condenser',
      'thermostatic', 'hvac', 'mvhr', 'ventilation', 'ducting', 'duct', 'firebox', 'heated', 'elbowsocket',
      'heatingloop', 'ufhloop', 'zoneactuator', 'mixingvalve',
    ],
    weak: ['vent', 'grille', 'ac', 'flue'],
  },
  sanitary: {
    strong: [
      'toilet', 'toilets', 'flush', 'basin', 'basins', 'sink', 'sinks', 'bath', 'bathtub', 'shower',
      'showers', 'showerhead', 'bidet', 'urinal', 'vanity', 'washbasin', 'showertray', 'showerscreen',
      'rainfall', 'handwand', 'bathpanel', 'cistern', 'cisterncover', 'drainer', 'belfast',
    ],
    weak: ['tub', 'enclosure', 'pan'],
  },
  external: {
    strong: [
      'lawn', 'grass', 'hedge', 'hedges', 'tree', 'trees', 'shrub', 'shrubs', 'path', 'paths',
      'patio', 'terrace', 'paving', 'paver', 'pavers', 'cobble', 'cobbles', 'gravel', 'driveway',
      'fence', 'fencing', 'pergola', 'fountain', 'pond', 'pool', 'bin', 'bins', 'shed', 'birdbath',
      'raisedbed', 'vegetable', 'vegetables', 'grapevine',
      'orchard', 'flowerbed', 'kerb', 'curb', 'bollards', 'carport', 'gatepost', 'trellis',
      'sundial', 'firepit', 'firebowl', 'compost', 'soil', 'planter',
      'planters', 'decking', 'deck', 'rattan', 'boxhedge', 'topiary',
    ],
    weak: ['gate', 'gates', 'drive', 'turf', 'vine', 'vines', 'grape', 'grapes'],
  },
  vehicle: {
    strong: [
      'porsche', 'defender', 'landrover', 'rover', 'car', 'cars', 'vehicle', 'bicycle', 'motorbike',
      'motorcycle', 'tractor', 'quadbike', 'scooter', 'trailer', 'headlight', 'taillight', 'tyre',
      'tire', 'brompton', 'carbonbike',
    ],
  },
};

/**
 * Tokens that, when found anywhere in the name chain (any depth), force a category regardless of
 * leaf tokens. Used for self-contained assemblies whose parts would otherwise be mis-read as
 * services (a Porsche headlight is not a light fitting; a tool-bench power strip is not a socket).
 */
const DOMINANT_TOKENS: ReadonlyMap<string, TradeCategory> = new Map<string, TradeCategory>([
  ['porsche', 'vehicle'],
  ['defender', 'vehicle'],
  ['landrover', 'vehicle'],
  ['bicycle', 'vehicle'],
  ['motorbike', 'vehicle'],
  ['motorcycle', 'vehicle'],
  ['tractor', 'vehicle'],
  ['brompton', 'vehicle'],
  ['toolbench', 'furniture'],
  ['workbench', 'furniture'],
  ['playstation', 'furniture'],
  ['macbook', 'furniture'],
  ['technogym', 'furniture'],
  ['trinitron', 'furniture'],
  ['oled', 'furniture'],
  ['callaway', 'decor'],
  ['tourbag', 'decor'],
  ['stihl', 'furniture'],
  ['bambu', 'furniture'],
  ['beertap', 'furniture'],
  ['corstonswitch', 'smart'],
]);

/** Tokens that dominate the segment they appear in (e.g. `knxWiringCenter` is smart, not wiring). */
const SEGMENT_DOMINANT_TOKENS: ReadonlyMap<string, TradeCategory> = new Map<string, TradeCategory>([
  ['knx', 'smart'],
  ['unifi', 'smart'],
  ['ubiquiti', 'smart'],
  ['ufh', 'heating'],
  ['insulation', 'insulation'],
  ['woodfibre', 'insulation'],
]);

/**
 * Words that mark a segment as a room / zone / building container. Such segments are skipped so
 * `showerRoom` does not make every wall in the shower room "sanitary".
 */
const ROOM_HEAD_TOKENS: ReadonlySet<string> = new Set<string>([
  'room', 'rooms', 'lobby', 'hall', 'landing', 'ensuite', 'wc', 'bathroom', 'kitchen', 'study',
  'bedroom', 'cloakroom', 'utility', 'corridor', 'snug', 'mezzanine', 'loft', 'barn', 'garage',
  'stable', 'stables', 'store', 'gym', 'outbuildings', 'outbuilding', 'firstfloor', 'groundfloor',
  'wing', 'cellar', 'lounge', 'office', 'annex', 'annexe', 'porchway', 'entrance', 'scullery',
  'bootroom', 'larderroom', 'washroom', 'plantroom', 'sittingroom', 'livingroom', 'familyroom',
  'diningroom', 'showerroom', 'mainbedroom', 'cinema', 'library', 'workshop', 'downstairs', 'upstairs',
]);

const COMPASS_TOKENS: ReadonlySet<string> = new Set<string>([
  'north', 'south', 'east', 'west', 'ne', 'nw', 'se', 'sw', 'upper', 'lower', 'left', 'right', 'front',
  'back', 'rear', 'middle', 'center', 'centre', 'inner', 'outer', 'side', 'end',
]);

/** Ancestor tokens that turn structure/envelope/finishes/joinery into hard landscaping. */
const EXTERNAL_CONTEXT_TOKENS: ReadonlySet<string> = new Set<string>([
  'garden', 'grounds', 'patio', 'pergola', 'driveway', 'lawn', 'orchard', 'terrace',
  'vegetable', 'kitchengarden', 'paddock', 'yard',
]);

const TOKEN_RULES: ReadonlyMap<string, TokenRule> = (() => {
  const map = new Map<string, TokenRule>();
  const categories = Object.keys(CATEGORY_TOKENS) as Exclude<TradeCategory, 'other'>[];
  // Strong first so a strong mapping is never overwritten by a weak duplicate elsewhere.
  for (const category of categories) {
    for (const token of CATEGORY_TOKENS[category].strong) {
      if (!map.has(token)) map.set(token, { category, strength: 2 });
    }
  }
  for (const category of categories) {
    for (const token of CATEGORY_TOKENS[category].weak ?? []) {
      if (!map.has(token)) map.set(token, { category, strength: 1 });
    }
  }
  return map;
})();

const CAMEL_TOKEN_RE = /[A-Z]{2,}(?=[A-Z][a-z]|\d|$|[^A-Za-z])|[A-Z]?[a-z]+|[A-Z]+/g;

/** Splits a single dotted-name segment (e.g. `porsche992TurboS`) into lower-case words. */
export function tokenizeSegment(segment: string): string[] {
  const out: string[] = [];
  const matches = segment.match(CAMEL_TOKEN_RE);
  if (!matches) return out;
  for (const m of matches) out.push(m.toLowerCase());
  return out;
}

/** Splits a hierarchical object name into its dotted / slash separated segments. */
export function splitNameSegments(name: string): string[] {
  if (!name) return [];
  return name.split(/[./:|]+/).filter((s) => s.length > 0);
}

function lookupToken(token: string): TokenRule | undefined {
  const direct = TOKEN_RULES.get(token);
  if (direct) return direct;
  if (token.length > 3 && token.endsWith('es')) {
    const r = TOKEN_RULES.get(token.slice(0, -2));
    if (r) return r;
  }
  if (token.length > 2 && token.endsWith('s')) {
    return TOKEN_RULES.get(token.slice(0, -1));
  }
  return undefined;
}

interface SegmentMatch {
  readonly category: TradeCategory;
  readonly strength: TokenStrength;
}

/**
 * Head-noun match of one segment: scans right-to-left (English compounds put the head noun last:
 * `bootRoomManifoldCupboard` is a cupboard), preferring bigrams, returning the first strong match or
 * failing that the first weak one.
 */
function matchSegment(tokens: readonly string[]): SegmentMatch | undefined {
  if (tokens.length === 0) return undefined;
  for (const t of tokens) {
    const dom = SEGMENT_DOMINANT_TOKENS.get(t);
    if (dom) return { category: dom, strength: 2 };
  }
  const last = tokens[tokens.length - 1]!;
  if (ROOM_HEAD_TOKENS.has(last)) return undefined;
  if (tokens.length >= 2 && ROOM_HEAD_TOKENS.has(tokens[tokens.length - 2]! + last)) return undefined;

  // `southWall`, `northWallEast`, `westPartitionWall` used as a *location* qualifier (e.g.
  // `hall.corstonSocket.southWall`) must not outrank the device segment, so compass-qualified
  // wall segments only count as weak structure.
  if (tokens.some((t) => COMPASS_TOKENS.has(t)) && tokens.some((t) => t === 'wall' || t === 'walls')) {
    const head = tokens.filter((t) => !COMPASS_TOKENS.has(t));
    const last = head[head.length - 1];
    if (last === 'wall' || last === 'walls' || last === 'partition' || last === undefined) {
      return { category: 'structure', strength: 1 };
    }
  }
  let weak: SegmentMatch | undefined;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (i > 0) {
      const bigram = lookupToken(tokens[i - 1]! + t);
      if (bigram) {
        if (bigram.strength === 2) return bigram;
        weak ??= bigram;
      }
    }
    const uni = lookupToken(t);
    if (uni) {
      if (uni.strength === 2) return uni;
      weak ??= uni;
    }
  }
  return weak;
}

function readBool(u: Readonly<Record<string, unknown>>, key: string): boolean {
  const v = u[key];
  return v !== undefined && v !== null && v !== false && v !== '';
}

/** Categories derived purely from well-known `userData` flags (nearest object first). */
function classifyUserData(u: Readonly<Record<string, unknown>>): TradeCategory | undefined {
  const explicit = u[TRADE_CATEGORY_USERDATA_KEY];
  if (isTradeCategory(explicit)) return explicit;
  if (
    readBool(u, 'isKNXSwitch') ||
    readBool(u, 'isKnxTempSensor') ||
    readBool(u, 'isCourtyardSwitch') ||
    readBool(u, 'isUtilitySwitch') ||
    readBool(u, 'isKitchenMotionSensor') ||
    readBool(u, 'isUtilityMotionSensor') ||
    readBool(u, 'roomMotionSensorId') ||
    readBool(u, 'switchPa') ||
    readBool(u, 'isUniFiCamera') ||
    readBool(u, 'isUniFiAccessReader') ||
    readBool(u, 'isUniFiAp')
  ) {
    return 'smart';
  }
  if (readBool(u, 'ufhZoneId')) return 'heating';
  if (readBool(u, 'isCarGate')) return 'external';
  if (readBool(u, 'isFrameTV') || readBool(u, 'isGolfSimulatorDynamic')) return 'furniture';
  if (readBool(u, 'circuitId')) return 'lighting';
  if (readBool(u, 'isBifoldDoor') || u['bifoldRole'] !== undefined) return 'envelope';
  return undefined;
}

function hasArchitecturalFlag(u: Readonly<Record<string, unknown>>): boolean {
  return readBool(u, 'isArchitecturalShell') || readBool(u, 'cutawayWall') || readBool(u, 'isCutawayWall');
}

/**
 * Pure, unit-testable classifier.
 *
 * @param name The object's own name (may be hierarchical, e.g. `kitchen.island.sink.tap`).
 * @param parentNames Ancestor names, nearest parent first.
 * @param userData The object's userData merged with ancestor userData (nearest wins), or just its own.
 * @param ancestorUserData Optional ancestor userData records, nearest first.
 */
export function classifyName(
  name: string,
  parentNames: readonly string[],
  userData: Readonly<Record<string, unknown>>,
  ancestorUserData: readonly Readonly<Record<string, unknown>>[] = []
): TradeCategory {
  // 1. Explicit / semantic userData flags (nearest first).
  const explicit = userData[TRADE_CATEGORY_USERDATA_KEY];
  if (isTradeCategory(explicit)) return explicit;
  let fromUserData = classifyUserData(userData);
  if (!fromUserData) {
    for (const au of ancestorUserData) {
      fromUserData = classifyUserData(au);
      if (fromUserData) break;
    }
  }
  const fromNames = classifyFromNames(name, parentNames, userData, ancestorUserData);
  if (fromUserData) {
    // KNX-switched sockets carry `switchPa` / `circuitId`, but they are still sockets for the electrician.
    if ((fromUserData === 'smart' || fromUserData === 'lighting') && fromNames === 'electrical') {
      return 'electrical';
    }
    return fromUserData;
  }
  return fromNames;
}

function classifyFromNames(
  name: string,
  parentNames: readonly string[],
  userData: Readonly<Record<string, unknown>>,
  ancestorUserData: readonly Readonly<Record<string, unknown>>[]
): TradeCategory {

  // 2. Build leaf-first segment token lists from the name chain.
  const segmentTokens: string[][] = [];
  const pushName = (n: string): void => {
    const segs = splitNameSegments(n);
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i] === 'batch') continue;
      segmentTokens.push(tokenizeSegment(segs[i]!));
    }
  };
  pushName(name);
  for (const p of parentNames) pushName(p);

  // 3. Dominant assembly tokens anywhere in the chain.
  for (const tokens of segmentTokens) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      const dom = DOMINANT_TOKENS.get(t) ?? (i > 0 ? DOMINANT_TOKENS.get(tokens[i - 1]! + t) : undefined);
      if (dom) return dom;
    }
  }

  // 4. Leaf-most strong segment match, else leaf-most weak match.
  const matches: (SegmentMatch | undefined)[] = segmentTokens.map((tokens) => matchSegment(tokens));
  let chosenIdx = matches.findIndex((m) => m !== undefined && m.strength === 2);
  if (chosenIdx < 0) chosenIdx = matches.findIndex((m) => m !== undefined);
  let category: TradeCategory = chosenIdx >= 0 ? matches[chosenIdx]!.category : 'other';

  // 5. Family refinements based on strong ancestor context.
  const ancestorStrong = (cat: TradeCategory): boolean => {
    for (let i = chosenIdx + 1; i < matches.length; i++) {
      const m = matches[i];
      if (m && m.strength === 2 && m.category === cat) return true;
    }
    return false;
  };
  if (chosenIdx >= 0) {
    if (category === 'plumbing' && ancestorStrong('heating')) category = 'heating';
    else if (category === 'electrical' && ancestorStrong('lighting')) category = 'lighting';
    else if ((category === 'decor' || category === 'joinery') && ancestorStrong('sanitary')) {
      // Toilet bowls, vanity drawers etc. stay with the sanitaryware.
      if (category === 'decor') category = 'sanitary';
    }
  }

  // 6. Hard-landscaping context.
  const chosenWeak = chosenIdx >= 0 && matches[chosenIdx]!.strength === 1;
  if (
    category === 'structure' ||
    category === 'finishes' ||
    category === 'other' ||
    (chosenWeak && (category === 'joinery' || category === 'envelope'))
  ) {
    // Only segments whose head noun is a landscape context (`courtyard`, `vegetableGarden`,
    // `rattanPatio`), not incidental mentions such as `courtyardDoor`.
    const isExternalContextToken = (token: string): boolean =>
      EXTERNAL_CONTEXT_TOKENS.has(token) || token.endsWith('yard');
    const inExternal = segmentTokens.some(
      (tokens) => tokens.length > 0 && isExternalContextToken(tokens[tokens.length - 1]!)
    );
    if (inExternal) return 'external';
  }

  // 7. Fallbacks from structural flags / LOD hints.
  if (category === 'other') {
    if (hasArchitecturalFlag(userData) || ancestorUserData.some((au) => hasArchitecturalFlag(au))) {
      return 'structure';
    }
    const lod = userData['lodTier'];
    if (lod === 'high' || lod === 2) return 'decor';
  }
  return category;
}

function asRecord(u: unknown): Readonly<Record<string, unknown>> {
  return u !== null && typeof u === 'object' ? (u as Record<string, unknown>) : {};
}

/** Classifies a live scene object using its name, ancestor names and userData. */
export function classifyObject(obj: THREE.Object3D): TradeCategory {
  const own = asRecord(obj.userData);
  const cached = own[TRADE_CATEGORY_USERDATA_KEY];
  if (isTradeCategory(cached)) return cached;
  const parentNames: string[] = [];
  const ancestorUserData: Readonly<Record<string, unknown>>[] = [];
  let p = obj.parent;
  while (p) {
    if (p.name) parentNames.push(p.name);
    ancestorUserData.push(asRecord(p.userData));
    p = p.parent;
  }
  return classifyName(obj.name, parentNames, own, ancestorUserData);
}

/** True for objects that render geometry and therefore take part in trade overlays. */
export function isRenderableObject(obj: THREE.Object3D): obj is THREE.Mesh | THREE.Line | THREE.Points {
  return obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points;
}

export interface ClassifySceneOptions {
  /** Re-classify objects that already carry `userData.tradeCategory`. Default false. */
  readonly overwrite?: boolean;
}

/**
 * Classifies every renderable object under `roots` and writes `userData.tradeCategory`.
 * Run this once BEFORE `SceneBatchOptimizer.optimize()` so merged batches can be keyed by category
 * and inherit the tag (merged meshes copy their template mesh's userData).
 *
 * Returns per-category counts.
 */
export function classifyScene(
  roots: readonly THREE.Object3D[],
  options: ClassifySceneOptions = {}
): Record<TradeCategory, number> {
  const counts = Object.fromEntries(TRADE_CATEGORIES.map((c) => [c, 0])) as Record<TradeCategory, number>;
  const visit = (
    node: THREE.Object3D,
    parentNames: readonly string[],
    ancestorUserData: readonly Readonly<Record<string, unknown>>[]
  ): void => {
    const own = asRecord(node.userData);
    if (isRenderableObject(node)) {
      const existing = own[TRADE_CATEGORY_USERDATA_KEY];
      let cat: TradeCategory;
      if (!options.overwrite && isTradeCategory(existing)) {
        cat = existing;
      } else {
        const ownWithoutTag: Record<string, unknown> = { ...own };
        delete ownWithoutTag[TRADE_CATEGORY_USERDATA_KEY];
        cat = classifyName(node.name, parentNames, ownWithoutTag, ancestorUserData);
        node.userData[TRADE_CATEGORY_USERDATA_KEY] = cat;
      }
      counts[cat]++;
    }
    if (node.children.length === 0) return;
    const nextNames = node.name ? [node.name, ...parentNames] : parentNames;
    const nextUd = [own, ...ancestorUserData];
    for (const child of node.children) visit(child, nextNames, nextUd);
  };
  for (const root of roots) {
    const names: string[] = [];
    const uds: Readonly<Record<string, unknown>>[] = [];
    let p = root.parent;
    while (p) {
      if (p.name) names.push(p.name);
      uds.push(asRecord(p.userData));
      p = p.parent;
    }
    visit(root, names, uds);
  }
  return counts;
}
