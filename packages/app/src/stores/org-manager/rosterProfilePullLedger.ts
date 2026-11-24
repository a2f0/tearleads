import { getRosterProfileDocumentBindingKey } from "./rosterProfileDisplayNames";

/** Failed pulls after which a roster profile waits for a new session. */
export const MAX_ROSTER_PROFILE_PULL_FAILURES = 3;

interface RosterProfilePull {
  readonly profileDocumentId: string;
  readonly userId: string;
}

// Failed pulls per roster profile, kept per SDK for the session. A load
// pulls at most a capped number of profiles, so without this the same
// failing profiles (offline, access revoked) would take every load's places
// and starve the rest.
const failuresBySdk = new WeakMap<object, Map<string, number>>();

function failuresFor(sdk: object): Map<string, number> {
  const existing = failuresBySdk.get(sdk);
  if (existing) return existing;
  const created = new Map<string, number>();
  failuresBySdk.set(sdk, created);
  return created;
}

function pullKey(pull: RosterProfilePull): string {
  return getRosterProfileDocumentBindingKey(pull) ?? pull.userId;
}

/**
 * The profiles one load pulls: those that never failed first, in roster
 * order, then those that failed fewer than `MAX_ROSTER_PROFILE_PULL_FAILURES`
 * times, up to `limit`.
 */
export function selectRosterProfilePulls<Pull extends RosterProfilePull>(
  sdk: object,
  pulls: ReadonlyArray<Pull>,
  limit: number,
): ReadonlyArray<Pull> {
  const failures = failuresFor(sdk);
  return pulls
    .map((pull, index) => ({
      failures: failures.get(pullKey(pull)) ?? 0,
      index,
      pull,
    }))
    .filter((entry) => entry.failures < MAX_ROSTER_PROFILE_PULL_FAILURES)
    .sort((a, b) => a.failures - b.failures || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.pull);
}

/** Records how one pull ended; a completed pull clears earlier failures. */
export function recordRosterProfilePull(
  sdk: object,
  pull: RosterProfilePull,
  completed: boolean,
): void {
  const failures = failuresFor(sdk);
  const key = pullKey(pull);
  if (completed) {
    failures.delete(key);
  } else {
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }
}
