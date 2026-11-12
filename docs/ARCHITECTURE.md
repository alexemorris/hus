# Architecture

`tools/check-boundaries.mjs` enforces a one-way dependency graph across `src/` and `examples/`:

```
core          -> (no internal dependencies)
engine        -> core
objects       -> engine, core
integrations  -> core
state         -> core
ui            -> core, state
husjs         -> core, engine, objects, integrations, state, ui
examples      -> husjs (public entrypoints only)
```
