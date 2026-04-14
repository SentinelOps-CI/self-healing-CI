# Security policy

## Reporting a vulnerability

We take security seriously. If you believe you have found a security vulnerability in this project, please report it responsibly.

### Process

1. **Do not** open a public GitHub issue for undisclosed vulnerabilities.
2. Email details to the address listed in your organization’s security contact, or open a **private** security advisory on GitHub if enabled for this repository.
3. Include: type of issue, steps to reproduce, impact, and suggested fix if you have one.

### What to expect

- Acknowledgment as soon as practical (goal: within a few business days for actively maintained forks).
- Coordination on fix and disclosure timeline.

### Responsible disclosure

Give maintainers time to release a fix before public discussion. Exact timelines depend on severity and maintainer availability.

### Scope

- Application code in this repository
- Documented default deployments and configuration
- Dependencies (also report upstream where appropriate)

### Security-related capabilities in this codebase

What is **actually implemented** today includes, among other things:

- GitHub webhook signature verification (see GitHub App code paths).
- Input sanitization helpers for webhook-adjacent handling.
- Environment-based configuration; no secrets should be committed (see `.env.example`).
- Scripts: `pnpm security:audit`, `pnpm audit`, and CI steps that run tests and typecheck.

Items such as organization-wide OIDC for every integration, egress proxies for all LLM calls, or automated SLSA attestation in CI may be **partially** reflected in `services/*` or docs but are not guaranteed as production-complete unless you implement and verify them.

### Best practices for contributors

1. Do not commit secrets or real tokens.
2. Run `pnpm validate` before submitting changes.
3. Prefer least-privilege GitHub App permissions.
4. Use HTTPS for external endpoints in production.

### Bug bounty

There is no formal bug bounty program tied to this template repository unless your organization announces one.

### Compliance

Framework references (SOC 2, NIST, GDPR) describe common goals; they are **not** certifications included with this repository.

Last updated: April 2026.
