import type * as THREE from 'three';

/**
 * Full 9-finish Perrin & Rowe / coordinated metalware finish matrix:
 * - `'CP'`: Chrome (cool mirror-bright electroplated chrome)
 * - `'NI'`: Polished Nickel (warm champagne-silver mirror nickel)
 * - `'PF'`: Pewter (hand-brushed satin nickel / warm pewter)
 * - `'BN'`: Brushed Nickel / Silver Nickel (Lefroy Brooks satin silver nickel)
 * - `'BR'`: Polished Brass (unlacquered mirror-bright solid brass)
 * - `'SB'`: Satin Brass (unlacquered living brushed aged solid brass)
 * - `'AB'`: Aged Brass (antique patinated ochre-bronze living brass)
 * - `'BZ'`: English Bronze (deep hand-finished oil-rubbed gunmetal bronze)
 * - `'IG'`: English Gold (rich warm 24ct polished gold)
 */
export const ALL_BRASSWARE_FINISH_CODES = [
  'CP',
  'NI',
  'PF',
  'BN',
  'BR',
  'SB',
  'AB',
  'BZ',
  'IG',
] as const;

export type BrasswareFinishCode = (typeof ALL_BRASSWARE_FINISH_CODES)[number];
export type MetalFinishCode = BrasswareFinishCode;

/** Named Corston Architectural Detail finish presets accepted alongside 2-letter `BrasswareFinishCode`s. */
export type CorstonFinishPreset = 'antiqueBrass' | 'polishedNickel' | 'bronze';
export type FixtureMetalFinish = BrasswareFinishCode | CorstonFinishPreset;

/**
 * Perrin & Rowe UK brassware design collections:
 * - `'armstrong'`: Industrial-heritage machined cylinders & diamond-knurled collars
 * - `'langbourn'`: Mid-century / contemporary smooth stepped collars & sleek levers
 * - `'traditional'`: Edwardian turned baluster collars & porcelain levers
 * - `'deco'`: 1920s Art Deco 8-faceted octagonal collars & stepped spouts
 */
export type PerrinRoweCollectionStyle = 'armstrong' | 'langbourn' | 'traditional' | 'deco';
export type PerrinRoweBasinTapCollection = PerrinRoweCollectionStyle;
export type PerrinRoweBasinTapMount = '3-hole-deck' | 'monobloc-deck' | '2-hole-wall';
export type PerrinRoweBasinLeverStyle =
  | 'metal'
  | 'whitePorcelain'
  | 'blackPorcelain'
  | 'crosshead'
  | 'porcelain';

export type PerrinRoweKitchenTapModel =
  | 'phoenician-bridge'
  | 'armstrong-bridge'
  | 'monobloc-swan'
  | 'wall-bridge';
export type PerrinRoweKitchenLeverStyle =
  | 'whitePorcelain'
  | 'blackPorcelain'
  | 'metal'
  | 'porcelain';

export interface PerrinRoweBasinTapOptions {
  /** Optional scene-graph prefix (default `'perrinRoweBasinTap'`). */
  readonly namePrefix?: string;
  /** Perrin & Rowe collection silhouette (`'armstrong' | 'traditional' | 'langbourn' | 'deco'`). */
  readonly collection: PerrinRoweBasinTapCollection;
  /** Mounting configuration (`'3-hole-deck' | 'monobloc-deck' | '2-hole-wall'`). */
  readonly mount: PerrinRoweBasinTapMount;
  /** Metal finish code across all 9 finishes. */
  readonly finish: BrasswareFinishCode;
  /** Handle style override (defaults per collection: `'whitePorcelain'` on `'traditional'`, `'crosshead'` on `'deco'`, `'metal'` on `'armstrong'`/`'langbourn'`). */
  readonly leverStyle?: PerrinRoweBasinLeverStyle;
  /** Centre-to-centre valve spread in metres (`0.200` default for `'3-hole-deck'`, `0.105` default for `'2-hole-wall'`). */
  readonly holeSpreadM?: number;
  /** Horizontal spout projection in metres (`0.135` default for deck mounts, `0.177` default for `'2-hole-wall'`). */
  readonly spoutReachM?: number;
  /** Include a matching `1 1/4"` click-clack / pop-up basin waste assembly (default `false`). */
  readonly includeWaste?: boolean;
  /** Whether the included basin waste is slotted (`true` default) or unslotted (`false`). */
  readonly slottedWaste?: boolean;
}

/**
 * Tap specification accepted by composable vanity, washstand, and basin `tap` slots.
 * `mount` defaults to `'3-hole-deck'` (or `'2-hole-wall'` on 0-tap-hole cloakroom surface basins)
 * and `finish` defaults to the host fixture's brassware finish when omitted.
 */
export interface PerrinRoweBasinTapSpec {
  readonly namePrefix?: string;
  readonly collection: PerrinRoweBasinTapCollection;
  readonly mount?: PerrinRoweBasinTapMount;
  readonly finish?: BrasswareFinishCode;
  readonly leverStyle?: PerrinRoweBasinLeverStyle;
  readonly holeSpreadM?: number;
  readonly spoutReachM?: number;
  readonly includeWaste?: boolean;
  readonly slottedWaste?: boolean;
}

export type BasinTapSpec = PerrinRoweBasinTapSpec;
export type BasinTapSlotValue = PerrinRoweBasinTapSpec | THREE.Object3D | 'default' | 'none';

export interface PerrinRoweKitchenTapOptions {
  /** Optional scene-graph prefix (default `'perrinRoweKitchenTap'`). */
  readonly namePrefix?: string;
  /** Perrin & Rowe kitchen mixer model (`'phoenician-bridge' | 'armstrong-bridge' | 'monobloc-swan' | 'wall-bridge'`). */
  readonly model: PerrinRoweKitchenTapModel;
  /** Metal finish code across all 9 finishes. */
  readonly finish: BrasswareFinishCode;
  /** Lever handle material/style (`'whitePorcelain'` default on `'phoenician-bridge'`/`'wall-bridge'`, `'metal'` default on `'armstrong-bridge'`/`'monobloc-swan'`). */
  readonly leverStyle?: PerrinRoweKitchenLeverStyle;
  /** Include side deck rinse spray wand (default `true` on deck bridge mixers `'phoenician-bridge'` & `'armstrong-bridge'`, `false` on `'wall-bridge'` & `'monobloc-swan'`). */
  readonly includeRinseSpray?: boolean;
  /** Bridge union centre-to-centre spread in metres (`0.200` default). */
  readonly holeSpreadM?: number;
  /** Swivel swan-neck spout reach in metres (`0.225` default). */
  readonly spoutReachM?: number;
}

export interface PerrinRoweKitchenTapSpec {
  readonly namePrefix?: string;
  readonly model?: PerrinRoweKitchenTapModel;
  /** Optional collection alias (`'phoenician' | 'armstrong' | 'traditional' | 'langbourn' | 'deco'`) mapped to `model` when `model` is omitted. */
  readonly collection?: PerrinRoweCollectionStyle | 'phoenician';
  /** Optional mount alias (`'bridge-deck' | 'monobloc-deck' | '2-hole-wall' | 'wall-bridge'`) mapped to `model` when `model` is omitted. */
  readonly mount?: 'bridge-deck' | 'monobloc-deck' | '2-hole-wall' | 'wall-bridge';
  readonly finish?: BrasswareFinishCode;
  readonly leverStyle?: PerrinRoweKitchenLeverStyle;
  readonly includeRinseSpray?: boolean;
  readonly holeSpreadM?: number;
  readonly spoutReachM?: number;
}

export type KitchenTapSpec = PerrinRoweKitchenTapSpec;
export type KitchenTapSlotValue = PerrinRoweKitchenTapSpec | THREE.Object3D | 'default' | 'none';

/**
 * Local-space mounting coordinates on a basin, washstand, vanity, or kitchen sink for
 * composable deck-mounted or wall-mounted taps and matching wastes.
 */
export interface TapMountAnchor {
  /** Primary deck tap mounting point `[x, y, z]` in the fixture's local frame (`y` on tap deck surface). */
  readonly deckPosition: [number, number, number];
  /** Additional deck tap mounting points (e.g. both left & right bowls on a double vanity). */
  readonly deckPositions?: ReadonlyArray<readonly [number, number, number]>;
  /** Recommended wall-mounted mixer point `[x, y, z]` in the fixture's local frame (`z` on rear wall/upstand plane). */
  readonly wallPosition?: [number, number, number];
  /** Primary bowl waste centre `[x, y, z]` in the fixture's local frame. */
  readonly wastePosition: [number, number, number];
  /** Drilled tap-hole count on the ceramic/stone deck (`0` for wall-mounted mixer, `1` for monobloc, `3` for 3-hole/bridge). */
  readonly holeCount: 0 | 1 | 3;
  /** Local Y yaw (radians) for a tap mounted on this fixture (`0` when spout projects along `+Z`). */
  readonly rotationY: number;
}

/** Cardinal direction the fixture faces into the room (local `+Z` maps to this world direction). */
export type BathroomWallFacing = 'north' | 'south' | 'east' | 'west';

export interface BathroomMetalMaterialPalette {
  readonly primary: THREE.MeshPhysicalMaterial;
  readonly knurled: THREE.MeshPhysicalMaterial;
  readonly darkShadow: THREE.MeshStandardMaterial;
}

export interface ArmstrongWallBasinMixerOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Metal finish code across all 9 finishes. */
  readonly finish: BrasswareFinishCode;
  /** Spout projection from wall face to nozzle centre in metres (default `0.177`, 207mm overall). */
  readonly spoutReachM?: number;
  /** Horizontal offset of the Ø46mm knurled single-lever mixer rose relative to spout at `x = 0` (default `0.105`). */
  readonly leverOffsetXM?: number;
  readonly style?: PerrinRoweCollectionStyle;
  readonly tipCapOffsetM?: number;
}

export interface ArmstrongDeck3HoleBasinMixerOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Metal finish code across all 9 finishes. */
  readonly finish: BrasswareFinishCode;
  /** Centre-to-centre spread between left Hot and right Cold deck valves in metres (default `0.200`). */
  readonly valveSpreadM?: number;
  readonly style?: PerrinRoweCollectionStyle;
}

export interface ArmstrongConcealedShowerSetOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Metal finish code across all 9 finishes. */
  readonly finish: BrasswareFinishCode;
  /** Centre height of the `5664` W90×H200mm concealed thermostatic 2-way plate above `y = 0` shower floor (default `1.08`). */
  readonly valveCenterYM?: number;
  /** Wall outlet height of the `5684` 400mm overhead shower arm above `y = 0` shower floor (default `1.98`). */
  readonly overheadArmYM?: number;
  /** Overhead arm reach in metres (`5684` = `0.400`). */
  readonly overheadArmReachM?: number;
  /** `5605` 8-inch Armstrong shower rose diameter in metres (default `0.198`). */
  readonly roseDiameterM?: number;
  /** Horizontal offset along wall (`local X`) for the `5640` 639mm slide rail & `5687` handshower (default `0.26`). */
  readonly slideRailOffsetXM?: number;
  /** Vertical centre of the `5640` 639mm slide rail above `y = 0` shower floor (default `1.28`). */
  readonly slideRailCenterYM?: number;
  readonly style?: PerrinRoweCollectionStyle;
}

export interface ArmstrongFreestandingBathMixerOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Metal finish code across all 9 finishes. */
  readonly finish: BrasswareFinishCode;
  /** Overall mixer top height above `y = 0` floor (`3660` = `0.958`). */
  readonly overallHeightM?: number;
  /** Spout outlet height above `y = 0` floor (`3660` = `0.827`). */
  readonly spoutOutletHeightM?: number;
  /** Spout reach along `local +Z` (`3660` = `0.210`). */
  readonly spoutReachM?: number;
  readonly style?: PerrinRoweCollectionStyle;
}

export interface ArmstrongRobeHookOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** `6221` (Armstrong), `6421` (Langbourn), or `6921` (Traditional). */
  readonly finish: BrasswareFinishCode;
  readonly style?: PerrinRoweCollectionStyle;
}

export interface PerrinRoweTowelRingOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** `6235` wall-mounted towel ring (`Ø180mm`). */
  readonly finish: BrasswareFinishCode;
  readonly style?: PerrinRoweCollectionStyle;
}

export interface PerrinRoweConcealedCisternLeverOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** `6772` / `6797` solid-brass extended concealed cistern lever. */
  readonly finish: BrasswareFinishCode;
  readonly style?: PerrinRoweCollectionStyle;
}

export interface ArmstrongPaperHolderOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** `6258` (`W147 × H98 × D46mm`). */
  readonly finish: BrasswareFinishCode;
  /** Whether to include a textured ivory toilet tissue roll on the holder arm (default `true`). */
  readonly includePaperRoll?: boolean;
  readonly style?: PerrinRoweCollectionStyle;
  readonly coreClearanceM?: number;
}

export type BcDesignsBoatBathExteriorFinish = 'copper' | 'tin' | 'polishedBrass' | 'painted';

export interface BcDesignsCopperBoatBathOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Overall double-ended roll-top length along `local X` in metres (default `1.700`). */
  readonly lengthM?: number;
  /** Overall width along `local Z` in metres (default `0.740`). */
  readonly widthM?: number;
  /** Sweeping raised boat-end rim height at `±lengthM/2` in metres (default `0.676`). */
  readonly endHeightM?: number;
  /** Central saddle rim height at `x = 0` in metres (default `0.640`). */
  readonly centerHeightM?: number;
  /** Brassware finish for the `WAS050G` click-clack waste & internal overflow rose (default `'BR'`). */
  readonly brassFinish?: BrasswareFinishCode;
  /** Exterior hull & moulded plinth finish (`'copper'` default, `'tin'`, `'polishedBrass'`, or `'painted'`). */
  readonly exteriorFinish?: BcDesignsBoatBathExteriorFinish;
  /** Exterior hull & plinth paint colour when `exteriorFinish === 'painted'` (default `#3B444B`). */
  readonly exteriorPaintColor?: THREE.ColorRepresentation;
  /** Which end/side carries the overflow rose (default `'west'`, i.e. `-X`). */
  readonly overflowEnd?: 'west' | 'east';
}

export interface LefroyBrooksCharterhouseWcOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Coordinated finish for `LB 1307` paddle lever, `LB 7241` bar hinges & flush/supply pipework. */
  readonly finish: BrasswareFinishCode;
  /**
   * Lefroy Brooks ceramic design profile:
   * - `'charterhouse1900'` (default): `1900 Classic Charterhouse` stepped rectangular cornice (`LB 7207` + `LB 7208` / `LB 7209` + `LB 7212`).
   * - `'laChapelle1910'`: `1910 La Chapelle` 45°-chamfered stepped octagonal front corners (`LB 7707` + `LB 7708`).
   * - `'lissaDoon'`: `Lissa Doon` softly rounded Edwardian contours (`LB 7507` + `LB 7508`).
   */
  readonly collection?: 'charterhouse1900' | 'laChapelle1910' | 'lissaDoon' | 'acantoVortex' | 'gsiClassicSwirlflush';
  /**
   * - `'closeCoupled'`: `LB 7207` pan + `LB 7208` stepped cistern (`W465 × D725 × H760mm`, pan rim `410mm`).
   * - `'lowLevel'`: `LB 7209` pan + `LB 7212` wall-hung stepped cistern connected by an exposed brass flush pipe.
   */
  readonly variant?: 'closeCoupled' | 'lowLevel' | 'backToWallVortex';
  /** Height of concealed cistern lever above floor when `variant === 'backToWallVortex'` (default `0.86`). */
  readonly concealedLeverYM?: number;
  /** Lateral X offset of concealed cistern lever when `variant === 'backToWallVortex'` (default `0.145`). */
  readonly concealedLeverXM?: number;
  /** Style of P&R concealed cistern lever (`6772` contemporary/metallic vs `6797` traditional porcelain). */
  readonly leverStyle?: PerrinRoweCollectionStyle;
  /** Optional rear low soil-boxing depth along `+Z` from the wall (`0` default). */
  readonly lowBoxingDepthM?: number;
  /** Optional rear low soil-boxing height above floor. */
  readonly lowBoxingHeightM?: number;
  /** Seat finish (`LB 7241`, default `'glossWhite'`). */
  readonly seatFinish?: 'glossWhite' | 'antiqueOak' | 'walnut' | 'darkOak';
}

export interface LefroyBrooksLaChapellePedestalBasinOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Coordinated finish for `6800` slotted click-clack waste & overflow trim. */
  readonly finish: BrasswareFinishCode;
  /** Optional override finish specifically for the `6800` basin waste & overflow trim (defaults to `finish`). */
  readonly wasteFinish?: BrasswareFinishCode;
  /** Optional composable tap slot (`PerrinRoweBasinTapSpec`, custom `THREE.Object3D`, `'default'`, or `'none'`). Omit/`'none'` for 0-tap-hole basin. */
  readonly tap?: BasinTapSlotValue;
  /** Overall basin width along `local X` in metres (default `0.680` — 680mm W). */
  readonly widthM?: number;
  /** Overall basin projection from `z = 0` wall along `local +Z` in metres (default `0.535` — 535mm D). */
  readonly depthM?: number;
  /** Front rim height above `y = 0` finished floor in metres (default `0.860` — 860mm H). */
  readonly rimHeightM?: number;
}

export interface LefroyBrooksLissaDoonWashstandOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Metalware finish for tubular console legs, ball joints, towel rails, mixer/waste & exposed `6303` bottle trap. */
  readonly finish: BrasswareFinishCode;
  /** Optional override finish specifically for the basin waste & overflow bezel (defaults to `finish`). */
  readonly wasteFinish?: BrasswareFinishCode;
  /** Optional composable tap slot (`PerrinRoweBasinTapSpec`, custom `THREE.Object3D`, `'default'`, or `'none'`). */
  readonly tap?: BasinTapSlotValue;
  /** Overall basin width along `local X` in metres (`LB 7503` default `0.700`). */
  readonly widthM?: number;
  /** Overall projection from wall `z = 0` along `local +Z` in metres (default `0.540`). */
  readonly depthM?: number;
  /** Front ceramic rim height above `y = 0` floor in metres (default `0.850`). */
  readonly rimHeightM?: number;
  /** Ceramic tap-hole drilling (`3` default for `LB 7503` + `3606` 3-hole deck mixer; `0` for wall mixer). */
  readonly tapHoles?: 0 | 3;
  /** Whether to mount the Perrin & Rowe `3606` Armstrong 3-hole deck mixer on the rear ceramic deck (default `true` when `tapHoles !== 0`). */
  readonly includeDeckMixer?: boolean;
  readonly mixerStyle?: PerrinRoweCollectionStyle;
  /** `'consoleLegs'` (open tubular stand w/ towel rails) or `'wallMountedBrackets'` (wall-hung ceramic cloakroom basin on cast solid-brass brackets + exposed 6303 trap). */
  readonly mountVariant?: 'consoleLegs' | 'wallMountedBrackets';
}

export interface PerrinRoweDeco3HoleBasinMixerOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Metal finish code across all 9 finishes. */
  readonly finish: BrasswareFinishCode;
  /** Centre-to-centre spread between Hot and Cold side valves (`3142` = `0.200` — 200mm CRS). */
  readonly valveSpreadM?: number;
  /** Horizontal spout reach from spout base centre to aerator centre (`3142` = `0.135` — 135mm). */
  readonly spoutReachM?: number;
}

export interface PerrinRoweDecoConcealedShowerSetOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Metal finish code across all 9 finishes (`5158` + `5193` + `5184` + `5135` + `5140` + `5195` + `5146`). */
  readonly finish: BrasswareFinishCode;
  /** Centre height of `5158` 200×200mm octagonal thermostatic mixer above `y = 0` shower floor (default `1.05`). */
  readonly valveCenterYM?: number;
  /** Vertical offset from `5158` centre up to `5193` 2-way diverter centre (default `0.195`). */
  readonly diverterOffsetYM?: number;
  /** Wall outlet height of `5184` 410mm overhead shower arm above `y = 0` shower floor (default `1.98`). */
  readonly overheadArmYM?: number;
  /** Overhead arm reach in metres (`5184` = `0.410` — 410mm). */
  readonly overheadArmReachM?: number;
  /** `5135` (`5105`) 8-inch Deco stepped deluge rose diameter in metres (`0.200` — Ø200 × 70mm H). */
  readonly roseDiameterM?: number;
  /** Horizontal offset along wall (`local X`) for `5140` 600mm CRS slide rail & `5195` handshower (default `0.26`). */
  readonly slideRailOffsetXM?: number;
  /** Vertical centre of `5140` 600mm CRS slide rail above `y = 0` shower floor (default `1.34`). */
  readonly slideRailCenterYM?: number;
}

export interface PerrinRoweDecoRobeHookOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** `6122` Deco Twin-Prong Robe Hook (`55mm` AF octagonal backplate, `75mm` wide, `48mm` projection). */
  readonly finish: BrasswareFinishCode;
}

export interface PerrinRoweDecoPaperHolderOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** `6148` Deco Wall-Mounted Toilet Roll Holder (`W160 × H100 × D75mm`, `55mm` AF octagonal backplate). */
  readonly finish: BrasswareFinishCode;
  /** Whether to include a textured ivory toilet tissue roll on the holder arm (default `true`). */
  readonly includePaperRoll?: boolean;
}

export interface LefroyBrooksLaChapelleWashstandOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Tubular console stand finish (`LB 3226BN` Silver Nickel default `'BN'`). */
  readonly standFinish?: BrasswareFinishCode;
  /** Brassware finish for `P&R Deco 3142` 3TH mixer, `6800` waste & `6303` exposed bottle trap (default `'PF'`). */
  readonly brasswareFinish?: BrasswareFinishCode;
  /** Optional override finish specifically for the `6800` domed basin waste (defaults to `brasswareFinish ?? 'PF'`). */
  readonly wasteFinish?: BrasswareFinishCode;
  /** Optional composable tap slot (`PerrinRoweBasinTapSpec`, custom `THREE.Object3D`, `'default'`, or `'none'` for wall-mounted mixer). */
  readonly tap?: BasinTapSlotValue;
  /** `LB 7723` narrow ceramic basin width in metres (default `0.575` — 575mm W). */
  readonly widthM?: number;
  /** `LB 7723` bow-front central projection from `z = 0` wall in metres (default `0.468` — 468mm D). */
  readonly depthM?: number;
  /** `LB 7723` front/side ceramic rim height above `y = 0` floor in metres (default `0.860` — 860mm; upstand top `0.895` — 895mm). */
  readonly rimHeightM?: number;
  /** `LB 7723` stepped rear splashback upstand top height above `y = 0` floor in metres (default `0.895` — 895mm). */
  readonly upstandTopHeightM?: number;
}

export type ThomasCrapperCeramicFinish = 'white' | 'antiqueWhite';

export interface ThomasCrapperDownhamBasinOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Coordinated brassware finish for the slotted 1 1/4" BSP waste (`TCWPUWPB` / `6800`). */
  readonly finish: BrasswareFinishCode;
  /** Optional override finish specifically for the `1 1/4"` BSP basin waste (defaults to `finish`). */
  readonly wasteFinish?: BrasswareFinishCode;
  /** Optional composable tap slot (`PerrinRoweBasinTapSpec`, custom `THREE.Object3D`, `'default'`, or `'none'`). Omit for 0-tap-hole surface basin. */
  readonly tap?: BasinTapSlotValue;
  /** Glazed fireclay finish (`'white'` for `TCDO400WH` default; `'antiqueWhite'` for warm off-white glaze). */
  readonly ceramicFinish?: ThomasCrapperCeramicFinish;
  /** Overall CAD width along `local X` in metres (`TCDO400` = `0.425` — 425mm W). */
  readonly widthM?: number;
  /** Overall CAD depth along `local Z` in metres (`TCDO400` = `0.330` — 330mm D). */
  readonly depthM?: number;
  /** Overall CAD height along `local Y` in metres (`TCDO400` = `0.180` — 180mm H). */
  readonly heightM?: number;
}

export interface ThomasCrapperLowLevelWcOptions {
  /** Hierarchical scene-graph prefix. */
  readonly namePrefix: string;
  /** Coordinated brassware finish for `TCWPLLFPPB` Ø38mm flush pipe, `TC200MEDPB` brackets, pull lever & `TC100OOAPB` bar hinge. */
  readonly finish: BrasswareFinishCode;
  /** Glazed vitreous china finish (`'white'` for `TCVE101WH` + `TCMB201LLWHPB` default; `'antiqueWhite'` for `...AW...`). */
  readonly ceramicFinish?: ThomasCrapperCeramicFinish;
  /** Solid timber seat & lid finish (`'darkOak'` default). */
  readonly seatFinish?: 'glossWhite' | 'antiqueOak' | 'walnut' | 'darkOak';
  /** Rear wall-to-pan setback along `+Z` (`0.180` default — within `170–290mm` CAD range). */
  readonly panRearSetbackM?: number;
  /** Installed cistern lid top height above FFL (`1.045` default — within `970–1,120mm` CAD range). */
  readonly cisternTopYM?: number;
  readonly mitreBracketFlange?: boolean;
}
