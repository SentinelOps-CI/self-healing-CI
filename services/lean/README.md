# `@self-healing-ci/lean`

Lean proof validation workspace logic. Used when the worker runs proofs in **local** mode (`LEAN_PROOFS_EXECUTION_MODE=local` or `auto` without HTTP credentials). Requires appropriate Lean toolchain on the worker host if you execute local validation.

## Build

```bash
pnpm --filter @self-healing-ci/lean run build
```

## Configuration

See root [.env.example](../../.env.example): `LEAN_PROOFS_EXECUTION_MODE`, `LEAN_LOCAL_WORKSPACE`, `LEAN_LOCAL_TIMEOUT_MS`, `LEAN_API_URL`, `LEAN_API_KEY`.
