# `@self-healing-ci/morph`

Patch application helpers with compilation validation (TypeScript, Rust, JavaScript validators). The worker may call a **remote** Morph HTTP API for `PATCH_BACKEND=morph`; this package supplies the richer local validation path when integrated.

## Build

```bash
pnpm --filter @self-healing-ci/morph run build
```

## Configuration

See root [.env.example](../../.env.example): `MORPH_API_KEY`, `MORPH_API_URL`, `PATCH_BACKEND`.
