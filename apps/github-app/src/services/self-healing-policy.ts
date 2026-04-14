/**
 * Rules for when a failed workflow_run should trigger self-healing (webhook path).
 */

const DEFAULT_NAME_TOKENS = ['ci', 'test', 'build', 'lint'];

/**
 * Parse `SELF_HEALING_WORKFLOW_ALLOWLIST` as comma-separated substrings (case-insensitive).
 * If unset or empty, use default tokens that must appear in the workflow name.
 */
export function getWorkflowNameAllowlistTokens(): string[] {
  const raw = process.env['SELF_HEALING_WORKFLOW_ALLOWLIST']?.trim();
  if (!raw) {
    return DEFAULT_NAME_TOKENS;
  }
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true if the workflow name matches the allowlist (any token is a substring of the name).
 */
export function workflowNameMatchesAllowlist(
  workflowName: string,
  tokens: string[] = getWorkflowNameAllowlistTokens()
): boolean {
  const lower = workflowName.toLowerCase();
  return tokens.some(t => lower.includes(t));
}
