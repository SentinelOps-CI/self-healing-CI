# `@self-healing-ci/freestyle`

Docker-based test execution with deterministic containers and flakiness-related helpers. Consumed by the Temporal worker when `SELF_HEALING_TEST_EXECUTION_MODE` is `docker` (or `auto` with `FREESTYLE_USE_DOCKER` and a host workspace path).

A **remote** HTTP contract (`POST /v1/test-runs`) is also implemented by the worker for `http` mode; point `FREESTYLE_API_URL` at a compatible service.

## Build

```bash
pnpm --filter @self-healing-ci/freestyle run build
```

## Configuration

See root [.env.example](../../.env.example): `FREESTYLE_*`, `SELF_HEALING_TEST_*`, `DOCKER_HOST` / `FREESTYLE_DOCKER_SOCKET` as needed.
