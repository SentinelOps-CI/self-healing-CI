import { RootCause } from '../workflows/self-healing-workflow.js';

const ROOT_CAUSE_MAP: Record<string, RootCause> = {
  DEP_UPGRADE: RootCause.DEP_UPGRADE,
  API_CHANGE: RootCause.API_CHANGE,
  FLAKY_TEST: RootCause.FLAKY_TEST,
  CONFIG_ERROR: RootCause.CONFIG_ERROR,
  ENV_ISSUE: RootCause.ENV_ISSUE,
  PERMISSION_ERROR: RootCause.PERMISSION_ERROR,
  TIMEOUT: RootCause.TIMEOUT,
  UNKNOWN: RootCause.UNKNOWN,
};

export function mapRootCauseString(raw: string): RootCause {
  return ROOT_CAUSE_MAP[raw] ?? RootCause.UNKNOWN;
}
