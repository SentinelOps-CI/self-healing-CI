# GitHub App (`@self-healing-ci/github-app`)

Probot/Fastify application that receives GitHub webhooks, enforces self-healing feature flags and allowlists, and starts **SelfHealingWorkflow** on Temporal when a failed workflow run should trigger healing.

## Setup

From the repository root:

```bash
pnpm install
cp .env.example .env
# Set GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET, Temporal and Redis as needed

pnpm --filter @self-healing-ci/github-app run dev
```

## Security

Webhook verification and input helpers live under `src/utils/` (see `security.ts`). Overview: [docs/security/README.md](../../docs/security/README.md).

## Related docs

- Root [README.md](../../README.md)
- [docs/architecture/system.md](../../docs/architecture/system.md)
