# Temporal worker (`@self-healing-ci/temporal-worker`)

Orchestrates **SelfHealingWorkflow** and activities: collect failure data, diagnose with Claude, apply patches, run tests, validate proofs, merge, update status, and emit CloudEvents.

Configuration is shared with the rest of the monorepo: copy the root [.env.example](../../.env.example) to `.env` and set Temporal, GitHub App, Anthropic, Redis, and self-healing variables there.

## Requirements

- Node.js 20+
- pnpm (monorepo uses `pnpm` from the repository root)
- Built workspace packages used by the worker, in particular:
  - `pnpm --filter @self-healing-ci/claude run build`
  - `pnpm --filter @self-healing-ci/freestyle run build`
  - `pnpm --filter @self-healing-ci/lean run build`

CI builds these before typechecking the worker (see [.github/workflows/ci.yml](../../.github/workflows/ci.yml)).

## Commands (from repo root)

```bash
pnpm --filter @self-healing-ci/temporal-worker run build
pnpm --filter @self-healing-ci/temporal-worker run dev
pnpm --filter @self-healing-ci/temporal-worker test
pnpm --filter @self-healing-ci/temporal-worker run lint
pnpm --filter @self-healing-ci/temporal-worker run type-check
```

## Environment (high level)

| Area           | Variables                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporal       | `TEMPORAL_SERVER_URL`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, TLS options                                                                                               |
| GitHub         | `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` (worker uses installation-scoped API as configured in activities)                                                                       |
| Claude         | `ANTHROPIC_API_KEY`, `SELF_HEALING_DRY_RUN`                                                                                                                                   |
| Redis          | `REDIS_URL` (optional)                                                                                                                                                        |
| Patch backend  | `PATCH_BACKEND`, `MORPH_API_URL`, `MORPH_API_KEY` when using Morph HTTP                                                                                                       |
| Tests          | `SELF_HEALING_TEST_EXECUTION_MODE`, `SELF_HEALING_TEST_COMMAND`, `SELF_HEALING_TEST_TIMEOUT_MS`, `SELF_HEALING_TEST_WORKDIR`, Freestyle HTTP or Docker vars (see root README) |
| Proofs         | `LEAN_PROOFS_EXECUTION_MODE`, `LEAN_API_URL`, `LEAN_API_KEY`, `LEAN_LOCAL_WORKSPACE`                                                                                          |
| CloudEvents    | `CLOUDEVENTS_INGEST_URL`, `CLOUDEVENTS_INGEST_TOKEN`                                                                                                                          |
| Metrics server | `METRICS_PORT` (default `9090`)                                                                                                                                               |

## Activities (non-exhaustive)

| Activity                 | Role                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `collect-failure-data`   | GitHub + logs context for diagnosis                                   |
| `diagnose-failure`       | Claude via `@self-healing-ci/claude`                                  |
| `apply-patch`            | GitHub branch/PR or Morph HTTP                                        |
| `run-tests`              | Freestyle HTTP, Docker (`@self-healing-ci/freestyle`), or local shell |
| `validate-proofs`        | Lean HTTP or `@self-healing-ci/lean` local                            |
| `merge-changes`          | Merge PR when policy allows                                           |
| `update-workflow-status` | GitHub status API                                                     |
| `emit-cloud-event`       | Structured log + optional HTTP ingest                                 |

## Metrics HTTP server

When started (see worker entrypoint and `metrics-server.ts`), the process can expose:

- `GET /health` — liveness-style JSON
- `GET /ready` — readiness JSON
- `GET /metrics` — Prometheus text
- `GET /alerts/stats`, `GET /alerts/active` — alerting helpers
- Additional routes for alert ack/resolve/cleanup and `GET /slo/:repository` (placeholder SLO payload unless wired to real metrics)

Bind port via `METRICS_PORT`.

## Further reading

- [docs/architecture/system.md](../../docs/architecture/system.md)
- Root [README.md](../../README.md)
