# Security documentation

This document summarizes security-related behavior implemented in this repository and how to operate it safely.

## Overview

The Self-Healing CI codebase includes several defensive layers: webhook authenticity, input handling, rate limiting concepts, and operational scripts. It does **not** replace a full organizational security program, penetration testing, or production hardening checklist for your environment.

## Implemented features

### Input validation and sanitization

`SecurityUtils` in the GitHub App (`apps/github-app/src/utils/security.ts`) provides:

- Sanitization for suspicious patterns (scripts, common injection idioms, control characters via filtering).
- Helpers used where untrusted strings are processed.

Example (import path from another package may differ; use the app source as reference):

```typescript
import { SecurityUtils } from './utils/security.js';

const sanitizedInput = SecurityUtils.validateAndSanitizeInput(userInput);
```

### Security-related HTTP behavior

Where the Fastify/Probot stack applies them, responses can include standard security headers and CORS restrictions derived from configuration. See application bootstrap in `apps/github-app` for what is actually wired.

### Rate limiting

Rate limiting is configurable in spirit (`config/security.example.json`); ensure your deployment connects any limiter to real storage and thresholds for production.

### GitHub webhook validation

Webhooks should be verified with the shared secret:

```typescript
const isValid = SecurityUtils.validateGitHubWebhook(
  payload,
  signature,
  webhookSecret
);
```

### Environment and secrets

- Use `.env` locally (never commit it). Start from [.env.example](../../.env.example).
- The custom audit script [`scripts/security-audit.js`](../../scripts/security-audit.js) checks common issues (dependencies, `.env` tracking, placeholder env files, etc.). Run `pnpm security:audit` from the repository root.

### Error handling

Prefer generic messages to clients and detailed structured logs server-side. Redact secrets in logs where Claude and GitHub clients already apply redaction helpers.

## Configuration

Example security-related JSON lives at [`config/security.example.json`](../../config/security.example.json). Copy or merge patterns into your deployment configuration as appropriate; not every field may be read by the current server code—verify against `apps/github-app` before assuming a key takes effect.

### Environment variables (security-relevant)

See [.env.example](../../.env.example) for the canonical list. Minimum for GitHub integration:

```bash
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
```

Optional HTTPS and operational keys are documented in `.env.example` where applicable.

## Security audit (repository scripts)

```bash
pnpm security:audit
pnpm audit
pnpm security:check
```

The audit script prints ASCII status lines (`[PASS]`, `[WARN]`, `[FAIL]`) and exits non-zero on critical findings.

## Best practices

1. Never commit secrets; rotate GitHub App keys and webhook secrets if exposed.
2. Run `pnpm audit` regularly and upgrade transitive dependencies deliberately.
3. Restrict network access to the GitHub App and worker in production (firewall, private Temporal, Redis auth).
4. Use least privilege for GitHub App permissions and installation scope.

## Threat model (short)

| Concern                        | Mitigation in repo                                                        |
| ------------------------------ | ------------------------------------------------------------------------- |
| Forged webhooks                | HMAC validation with `GITHUB_WEBHOOK_SECRET`                              |
| Injection via webhook payloads | Validation/sanitization utilities; prefer strict schemas on new endpoints |
| Dependency vulnerabilities     | `pnpm audit`, CI informational audit step                                 |
| Leaked `.env`                  | `.gitignore`, security-audit script checks                                |

## Incident response

For **reporting vulnerabilities in this open-source project**, follow [SECURITY.md](../../SECURITY.md). For production incidents, use your own runbooks.

## Compliance language

References to SOC 2, GDPR, or other frameworks in marketing-style text are **aspirational** unless your deployment independently attests to them. This repository provides tooling hooks, not a certified compliance package.

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [GitHub: Securing webhooks](https://docs.github.com/en/webhooks/using-webhooks/securing-your-webhooks)
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)

Last reviewed: April 2026.
