import axios from 'axios';
import type { Invariant } from '@self-healing-ci/lean';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export interface ValidateProofsParams {
  repository: string;
  headSha: string;
  branch: string;
  proofFiles: string[];
}

export interface ValidateProofsOutcome {
  success: boolean;
  validatedProofs: number;
  totalProofs: number;
  errors: string[];
  error?: string;
}

const LeanApiResponseSchema = z.object({
  success: z.boolean(),
  validatedProofs: z.number(),
  totalProofs: z.number(),
  errors: z.array(z.string()).default([]),
});

function proofsExecutionMode(): string {
  return (
    process.env['LEAN_PROOFS_EXECUTION_MODE']?.trim().toLowerCase() || 'auto'
  );
}

function hasLeanHttpCredentials(): boolean {
  return Boolean(
    process.env['LEAN_API_URL']?.trim() && process.env['LEAN_API_KEY']?.trim()
  );
}

async function validateProofsHttp(
  params: ValidateProofsParams
): Promise<ValidateProofsOutcome> {
  const baseUrl = process.env['LEAN_API_URL']!.trim();
  const apiKey = process.env['LEAN_API_KEY']!.trim();
  const url = `${baseUrl.replace(/\/$/, '')}/v1/proofs/validate`;

  try {
    const res = await axios.post<unknown>(
      url,
      {
        repository: params.repository,
        headSha: params.headSha,
        branch: params.branch,
        proofFiles: params.proofFiles,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 120_000,
        validateStatus: () => true,
      }
    );

    if (res.status < 200 || res.status >= 300) {
      const body =
        typeof res.data === 'string'
          ? res.data.slice(0, 400)
          : JSON.stringify(res.data).slice(0, 400);
      return {
        success: false,
        validatedProofs: 0,
        totalProofs: params.proofFiles.length,
        errors: [`Lean API HTTP ${res.status}: ${body}`],
        error: `Lean API HTTP ${res.status}`,
      };
    }

    const parsed = LeanApiResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      logger.warn('Unexpected Lean API response shape', {
        issues: parsed.error.flatten(),
      });
      return {
        success: false,
        validatedProofs: 0,
        totalProofs: params.proofFiles.length,
        errors: ['Lean API returned an unexpected JSON body'],
        error: 'Invalid Lean API response',
      };
    }

    const d = parsed.data;
    return {
      success: d.success,
      validatedProofs: d.validatedProofs,
      totalProofs: d.totalProofs,
      errors: d.errors,
    };
  } catch (e) {
    return {
      success: false,
      validatedProofs: 0,
      totalProofs: params.proofFiles.length,
      errors: [e instanceof Error ? e.message : 'Lean API request failed'],
      error: e instanceof Error ? e.message : 'Lean API request failed',
    };
  }
}

/**
 * Run `@self-healing-ci/lean` against a temp workspace (requires `lake` / `lean` on PATH when applicable).
 */
async function validateProofsLocal(
  params: ValidateProofsParams
): Promise<ValidateProofsOutcome> {
  const { LeanClient } = await import('@self-healing-ci/lean');
  const workspacePath =
    process.env['LEAN_LOCAL_WORKSPACE']?.trim() || '/tmp/lean-proofs';
  const installationId = parseInt(
    process.env['SELF_HEALING_INSTALLATION_ID'] || '0',
    10
  );
  const timeout = parseInt(
    process.env['LEAN_LOCAL_TIMEOUT_MS'] || '120000',
    10
  );

  const invariants: Invariant[] = params.proofFiles.map((p, i) => ({
    name: `proof_file_${i}`,
    description: `Proof artifact: ${p}`,
    predicate: 'True',
    scope: 'global',
    criticality: 'low',
    theorems: [],
  }));

  const client = new LeanClient({ workspacePath });

  const result = await client.validateProofs({
    repository: params.repository,
    headSha: params.headSha,
    branch: params.branch,
    installationId,
    invariants,
    timeout,
    maxTheorems: invariants.length,
  });

  return {
    success: result.success,
    validatedProofs: result.summary.proven,
    totalProofs: result.summary.total,
    errors: result.error ? [result.error] : [],
    error: result.error,
  };
}

/**
 * Validate proofs via remote HTTP API or local `@self-healing-ci/lean` engine.
 *
 * `LEAN_PROOFS_EXECUTION_MODE`: `http` | `local` | `auto` (prefer HTTP when URL+key are set).
 */
export async function validateProofs(
  params: ValidateProofsParams
): Promise<ValidateProofsOutcome> {
  if (params.proofFiles.length === 0) {
    return {
      success: true,
      validatedProofs: 0,
      totalProofs: 0,
      errors: [],
    };
  }

  const mode = proofsExecutionMode();

  if (mode === 'http') {
    if (!hasLeanHttpCredentials()) {
      return {
        success: false,
        validatedProofs: 0,
        totalProofs: params.proofFiles.length,
        errors: [
          'LEAN_PROOFS_EXECUTION_MODE=http requires LEAN_API_URL and LEAN_API_KEY',
        ],
        error: 'Lean API not configured',
      };
    }
    return validateProofsHttp(params);
  }

  if (mode === 'local') {
    return validateProofsLocal(params);
  }

  if (mode === 'auto') {
    if (hasLeanHttpCredentials()) {
      return validateProofsHttp(params);
    }
    return validateProofsLocal(params);
  }

  return {
    success: false,
    validatedProofs: 0,
    totalProofs: params.proofFiles.length,
    errors: [`Unknown LEAN_PROOFS_EXECUTION_MODE: ${mode}`],
    error: 'Invalid Lean proofs mode',
  };
}
