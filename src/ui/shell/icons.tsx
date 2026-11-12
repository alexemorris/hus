import type { JSX } from 'preact';

/** Minimal inline SVG icon set (24×24 stroke icons, currentColor). */
export type IconName =
  | 'cube'
  | 'plan'
  | 'walk'
  | 'share'
  | 'gear'
  | 'help'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'close'
  | 'hand'
  | 'ruler'
  | 'pin'
  | 'section'
  | 'bulb'
  | 'power'
  | 'sun'
  | 'sunset'
  | 'moon'
  | 'gate'
  | 'flame'
  | 'download'
  | 'copy'
  | 'trash'
  | 'code'
  | 'menu'
  | 'panel'
  | 'target'
  | 'house'
  | 'sparkle'
  | 'device'
  | 'check'
  | 'eye'
  | 'move'
  | 'crouch'
  | 'jump'
  | 'volume'
  | 'volume-mute'
  | 'cloud'
  | 'rain'
  | 'snow'
  | 'mist'
  | 'compass'
  | 'sculpt'
  | 'inspect'
  | 'external'
  | 'palette';

const PATHS: Readonly<Record<IconName, readonly string[]>> = {
  cube: ['M12 2 3 7v10l9 5 9-5V7z', 'M3 7l9 5 9-5', 'M12 12v10'],
  plan: ['M3 3h18v18H3z', 'M3 12h9', 'M12 3v18', 'M12 15h9'],
  walk: ['M13 4a1.5 1.5 0 1 0 0-.01', 'M9 21l2.5-6 2.5 2.5V21', 'M8 11l3-3 3 2 3 1', 'M11.5 15l-1-4'],
  share: ['M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7', 'M16 6l-4-4-4 4', 'M12 2v13'],
  gear: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  ],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
  'chevron-left': ['M15 18l-6-6 6-6'],
  'chevron-right': ['M9 18l6-6-6-6'],
  'chevron-down': ['M6 9l6 6 6-6'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  hand: [
    'M18 11V6a2 2 0 0 0-4 0v5',
    'M14 10V4a2 2 0 0 0-4 0v6',
    'M10 10.5V6a2 2 0 0 0-4 0v8',
    'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15',
  ],
  ruler: ['M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z', 'M7.5 10.5l2 2', 'M10.5 7.5l2 2', 'M13.5 4.5l2 2', 'M4.5 13.5l2 2'],
  pin: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  section: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M20 4 8.1 15.9', 'M14.5 14.5 20 20', 'M8.1 8.1 12 12'],
  bulb: ['M9 18h6', 'M10 22h4', 'M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z'],
  power: ['M18.4 6.6a9 9 0 1 1-12.8 0', 'M12 2v10'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4', 'M1 12h2', 'M21 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4'],
  sunset: ['M17 18a5 5 0 0 0-10 0', 'M12 9V2', 'M4.2 10.2l1.4 1.4', 'M1 18h2', 'M21 18h2', 'M18.4 11.6l1.4-1.4', 'M23 22H1', 'M16 5l-4 4-4-4'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z'],
  gate: ['M3 21V5', 'M21 21V5', 'M3 8h18', 'M3 16h18', 'M8 8v8', 'M13 8v8', 'M18 8v8'],
  flame: ['M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.6 1.4 2.8 2.5 2.8z'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  copy: ['M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
  code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  panel: ['M3 3h18v18H3z', 'M15 3v18'],
  target: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  house: ['M3 10.5 12 3l9 7.5', 'M5 9v12h14V9', 'M10 21v-6h4v6'],
  sparkle: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z'],
  device: ['M4 5h16v11H4z', 'M8 21h8', 'M12 16v5'],
  check: ['M20 6 9 17l-5-5'],
  eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  move: ['M5 9l-3 3 3 3', 'M9 5l3-3 3 3', 'M15 19l-3 3-3-3', 'M19 9l3 3-3 3', 'M2 12h20', 'M12 2v20'],
  jump: ['M12 19V5', 'M6 11l6-6 6 6', 'M5 21h14'],
  crouch: ['M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M7 21l3-6 4 2v4', 'M10 11l4-2 3 3'],
  volume: [
    'M11 5L6 9H2v6h4l5 4V5z',
    'M15.54 8.46a5 5 0 0 1 0 7.07',
    'M19.07 4.93a10 10 0 0 1 0 14.14',
  ],
  'volume-mute': ['M11 5L6 9H2v6h4l5 4V5z', 'M22 9l-6 6', 'M16 9l6 6'],
  cloud: ['M17.5 19H7a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.3 8.5a4 4 0 0 1-.8 10.5z'],
  rain: [
    'M17.5 15H7a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.8 6a3.5 3.5 0 0 1-.3 9z',
    'M8 18l-1 3',
    'M12 18l-1 3',
    'M16 18l-1 3',
  ],
  snow: [
    'M12 2v20',
    'M4.9 6.9l14.2 10.2',
    'M19.1 6.9L4.9 17.1',
    'M9 4l3 2 3-2',
    'M9 20l3-2 3 2',
  ],
  mist: ['M4 9h16', 'M2 13h18', 'M6 17h14', 'M9 5h8'],
  compass: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    'M16.2 7.8l-2.6 6.8-6.8 2.6 2.6-6.8z',
  ],
  inspect: [
    'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
    'M21 21l-4.35-4.35',
    'M11 8v3',
    'M11 14h.01',
  ],
  external: [
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    'M15 3h6v6',
    'M10 14 21 3',
  ],
  palette: [
    'M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-.5a1.5 1.5 0 0 1 1.5-1.5H17a5 5 0 0 0 5-5c0-6-4.5-11-10-11z',
    'M7.5 10.5h.01',
    'M10.5 7.5h.01',
    'M14.5 7.5h.01',
    'M16.5 11.5h.01',
  ],
  sculpt: [
    'M3 19l5.5-8.5 4 5.5 3.5-4.5L21 19H3z',
    'M15.5 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  ],
};

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}

export function Icon({ name, size = 18, className }: IconProps): JSX.Element {
  return (
    <svg
      className={`shell-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export interface HusBrandMarkProps {
  readonly size?: number;
  readonly className?: string;
}

/** Official @hus 3D architectural ribbon mark (exact 64×64 geometry & gradient stops). */
export function HusBrandMark({ size = 20, className }: HusBrandMarkProps): JSX.Element {
  return (
    <svg
      className={`shell-brand-mark${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="hus-tb-g" gradientUnits="userSpaceOnUse" />
        <linearGradient id="hus-tb-r" x1="22" y1="6" x2="58" y2="36" href="#hus-tb-g">
          <stop stop-color="#FFB482" />
          <stop offset=".38" stop-color="#F25A2E" />
          <stop offset="1" stop-color="#B8260B" />
        </linearGradient>
        <linearGradient id="hus-tb-w" x1="40" y1="26" x2="58" y2="56" href="#hus-tb-g">
          <stop stop-color="#9E220B" />
          <stop offset="1" stop-color="#611003" />
        </linearGradient>
        <linearGradient id="hus-tb-i" x1="10" y1="18" x2="36" y2="52" href="#hus-tb-g">
          <stop stop-color="#C43B14" />
          <stop offset="1" stop-color="#7D1906" />
        </linearGradient>
        <linearGradient id="hus-tb-l" x1="18" y1="40" x2="52" y2="56" href="#hus-tb-g">
          <stop stop-color="#FFE694" />
          <stop offset="1" stop-color="#EB8123" />
        </linearGradient>
        <linearGradient id="hus-tb-f" x1="6" y1="14" x2="46" y2="58" href="#hus-tb-g">
          <stop stop-color="#FFD688" />
          <stop offset=".52" stop-color="#F59438" />
          <stop offset="1" stop-color="#DB5B1C" />
        </linearGradient>
      </defs>
      <path
        d="M9.5 55.7L9.5 34.9A3.9 3.9 0 0 1 10.6 32.2L22.3 20.5L37.1 11.9L25.4 23.6A3.9 3.9 0 0 0 24.2 26.4L24.2 47.2Z"
        fill="url(#hus-tb-i)"
      />
      <path d="M36.1 53L18.6 53L33.4 44.5L50.8 44.5Z" fill="url(#hus-tb-l)" />
      <path
        d="M44.9 32.6A9.4 9.4 0 0 1 45.2 34.9L45.2 49.3A9.2 9.2 0 0 1 40.6 57.2L55.4 48.7A9.2 9.2 0 0 0 60 40.8L60 26.4A9.4 9.4 0 0 0 59.7 24.1Z"
        fill="url(#hus-tb-w)"
        stroke="url(#hus-tb-w)"
        stroke-width=".2"
      />
      <path
        d="M20.2 15.2A8.7 8.7 0 0 1 30.8 16.6L42.5 28.3A9.4 9.4 0 0 1 44.9 32.6L59.7 24.1A9.4 9.4 0 0 0 57.3 19.8L45.6 8.1A8.7 8.7 0 0 0 35 6.7Z"
        fill="url(#hus-tb-r)"
      />
      <path
        d="M5 55.7A1 1 0 0 1 4 54.7L4 34.9A9.4 9.4 0 0 1 6.7 28.3L18.4 16.6A8.7 8.7 0 0 1 30.8 16.6L42.5 28.3A9.4 9.4 0 0 1 45.2 34.9L45.2 49.3A9.2 9.2 0 0 1 36.1 58.5L19.6 58.5A1 1 0 0 1 18.6 57.5L18.6 54A1 1 0 0 1 19.6 53L36.1 53A3.7 3.7 0 0 0 39.8 49.3L39.8 34.9A3.9 3.9 0 0 0 38.6 32.2L26.9 20.5A3.3 3.3 0 0 0 22.3 20.5L10.6 32.2A3.9 3.9 0 0 0 9.5 34.9L9.5 54.7A1 1 0 0 1 8.5 55.7Z"
        fill="url(#hus-tb-f)"
      />
    </svg>
  );
}
