# Environment HDRI Suites

`public/textures/hdr/` contains the CC0 and world-anchored Radiance `.hdr` + `.webp` environment maps bundled with `husjs`:

- **`english-countryside`** — `english_countryside_{day,dusk,night}_{2k.hdr,512.hdr,4k.webp}` (CC0 Poly Haven).
- **`hollywood-hills`** — `hollywood_hills_{dawn_clear,day_clear,day_overcast,dusk_clear,night_clear}_{8k.webp,2k.hdr,512.hdr}` (used by `examples/stahl-house`).

Custom `HouseEnvironmentHdrSpec` suites can be passed on `defineHouse({ environment })` or generated via `npx husjs hdri`.
