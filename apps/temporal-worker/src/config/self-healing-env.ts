/**
 * Environment-driven controls for self-healing (read in activities / Node only).
 */
export function getSelfHealingEnv(): {
  dryRun: boolean;
  autoMerge: boolean;
  patchBackend: 'github' | 'morph';
  maxRunsPerDay: number;
  selfHealingEnabled: boolean;
} {
  return {
    selfHealingEnabled: process.env['SELF_HEALING_ENABLED'] !== 'false',
    dryRun: process.env['SELF_HEALING_DRY_RUN'] === 'true',
    autoMerge: process.env['SELF_HEALING_AUTO_MERGE'] === 'true',
    patchBackend: process.env['PATCH_BACKEND'] === 'morph' ? 'morph' : 'github',
    maxRunsPerDay: parseInt(
      process.env['SELF_HEALING_MAX_RUNS_PER_DAY'] || '20',
      10
    ),
  };
}
