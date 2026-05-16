# BlazePlot

BlazePlot is a real-time LOD time series rendering engine.

The package entrypoint is `src/index.ts` during development and `dist/index.js` after `bun run build`.

## Development

```bash
bun install
bun run dev
```

`bun run dev` serves the detached preview app from `preview/`.

## Package Build

```bash
bun run build
```

Build output:

```text
dist/index.js
dist/index.d.ts
```

## Validation

```bash
bun run typecheck
bun run test
```
