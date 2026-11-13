<p align="center">
  <img src="./public/favicon.svg" width="72" height="72" alt="Hus" />
</p>

<h1 align="center">Hus</h1>

<p align="center">
  3D home and architectural models in TypeScript and Three.js.
  <br />
  <a href="https://alexemorris.github.io/hus/">Live Demo</a> &middot;
  <a href="https://github.com/alexemorris/hus/actions/workflows/ci.yml">CI</a> &middot;
  <a href="./LICENSE">MIT License</a>
</p>

Hus (`husjs`) is a TypeScript library for modelling buildings, rooms, lighting, vegetation, and interiors in code and exploring them in the browser.

[![Georgian Country House](./docs/images/georgian-house.webp)](https://alexemorris.github.io/hus/)

| [Georgian Country House](https://alexemorris.github.io/hus/) | [Stahl House (Case Study #22)](https://alexemorris.github.io/hus/?house=stahl-house) | [Pied-à-terre Apartment](https://alexemorris.github.io/hus/?house=simple-flat) |
| :---: | :---: | :---: |
| [![Georgian Country House](./docs/images/georgian-house.webp)](https://alexemorris.github.io/hus/) | [![Stahl House](./docs/images/stahl-house.webp)](https://alexemorris.github.io/hus/?house=stahl-house) | [![Apartment](./docs/images/apartment.webp)](https://alexemorris.github.io/hus/?house=simple-flat) |
| `examples/simple-house` | `examples/stahl-house` | `examples/simple-flat` |

## Getting started

```bash
git clone https://github.com/alexemorris/hus.git
cd hus
npm install
npm run dev
```

## Usage

A house is defined with floors, rooms, and lighting zones, then mounted into the page:

```ts
import 'husjs/styles.css';
import { defineHouse, mountHouse } from 'husjs';

export const house = defineHouse({
  id: 'courtyard-house',
  name: 'Courtyard House',
  location: { lat: 51.84, lon: -1.79, timezone: 'Europe/London' },
  floors: [
    { id: 'ground', label: 'Ground Floor', shortLabel: 'G', order: 0, elevationY: 0, ceilingCutawayY: 2.8 },
  ],
  rooms: {
    manifest: [{ zoneId: 'hall', label: 'Entrance Hall', floor: 'ground', group: 'Ground Floor' }],
    navTree: [{ id: 'ground', label: 'Ground Floor', roomIds: ['hall'] }],
  },
  zones: {
    circuitMaxIntensity: { hallPendant: 8.0 },
    modules: [],
  },
});

await mountHouse(house, document);
```

## What's included

- **Architecture & CAD**: helpers for walls, openings, pitched and hipped roofs, slabs, solid-section cutaway wall caps, stairs, joinery, and metric masonry UV layout (`husjs/objects`).
- **Materials & micro-surfaces**: procedural PBR brick bonds, cobblestones, stone masonry, Welsh slate, physical paint sheen and LRV evaluation, and micro-surface normal and roughness maps (`husjs/materials`).
- **Vegetation & phenology**: procedural trees, hedges, topiary, climbers, shrubs, flowerbeds, xerophytes, and houseplants with seasonal phenology (bud, leaf, flower, fruit, autumn senescence, bare) driven on the GPU by date, latitude, and weather exposure (`husjs/vegetation`).
- **Furniture & fixtures catalog**: modular catalog modules for appliances, architectural elements, bathroom, electrical, hardware, joinery, kitchen, lighting, radiators, sanitaryware, soft furnishings, and vehicles (`husjs/catalog/*`).
- **Viewer & walkthrough**: orbit, floor-plan, and first-person walkthrough modes, automatic cutaways, horizon GTAO, screen-space contact shadows, spatial audio occlusion, and room annotations (`husjs/viewer`, `husjs/audio`, `husjs/ui`).
- **Environment & automation**: sun and moon ephemeris by date and coordinates, sky and weather presets, terrain heightmaps, and room switching with optional KNX and UniFi network adapters (`husjs/knx`, `husjs/unifi`).
- **CLI & diagnostics**:
  - `husjs audit` checks for coplanar z-fighting, blocked door swings, cutaway containment, and first-person walkthrough reachability (`husjs/testing`).
  - `husjs zfight` inspects coplanar triangle overlaps across scene geometries.
  - `husjs schedule` exports FF&E, sanitaryware, joinery, and appliance schedules to Markdown, CSV, or JSON.
  - `husjs export` converts scenes to binary glTF (`.glb`) or Blender (`.blend`).
  - `husjs terrain` fetches elevation tiles and writes `.husgrid.json` terrain heightmaps.
  - `husjs hdri` generates 360-degree environment panoramas.

## Development

```bash
npm test              # unit & example tests
npm run typecheck     # TypeScript check
npx husjs audit --all-examples
npm run build         # production bundle
```

## License

[MIT](./LICENSE)
