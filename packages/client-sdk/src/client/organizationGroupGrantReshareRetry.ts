import { isKeyingVerificationError } from "../data/keyingProjectionVerification/error";

/** Retry pacing mirrors the root re-share coordinator. */
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;
/**
 * How many attempts may run at the delay ceiling before the sweep stops.
 *
 * Retrying until success is right for a transient outage but wrong for a
 * failure this device can never satisfy — most concretely a signer who may
 * rotate group membership without holding access to the granted containers.
 * That case surfaces as an ordinary unapplied re-wrap, because the share path
 * converts an authorization failure into a null result rather than a status, so
 * it cannot be told apart from a transient one and bounding the total window is
 * what keeps it from spinning forever. The ceiling makes this roughly half an
 * hour of retries before it gives up and says what is still pinned.
 */
const MAX_ATTEMPTS_AT_CEILING = 30;

/**
 * Re-run the sweep until it reports completion, backing off between attempts.
 *
 * An incomplete sweep leaves containers pinned to the superseded epoch, so the
 * members this repair exists for stay locked out of them. A single best-effort
 * pass would strand exactly the transient cases a later attempt resolves — a
 * container not yet hydrated, a read-model pull that declined while offline —
 * and a fixed attempt cap would strand any outage longer than the cap. Pacing,
 * the 60s ceiling, and retrying until success mirror the root re-share
 * coordinator.
 *
 * Two things end it. An identity integrity failure is terminal, as it is for
 * the root and metadata coordinators: a verified projection disagreeing with a
 * trusted identity is not transient, and re-attempting it just repeats a
 * failing verification. Otherwise the caller's `shouldContinue` stops the loop
 * once the session leaves the organization, so a switch or a logout cannot
 * leave a sweep retrying against a scope that is no longer active.
 */
export interface GroupGrantReshareOutcome {
  /** Every granted container was resolved against a confirmed rotation. */
  readonly complete: boolean;
  /** The pulled read model shows the group actually at the committed head. */
  readonly headConfirmed: boolean;
  /** Every container still stale is one this signer may not re-wrap. */
  readonly onlyUnauthorizedRemains?: boolean;
  /** Containers left stale: unresolvable, or a re-wrap that did not apply. */
  readonly unresolvedContainerIds: readonly string[];
}

export async function runSweepWithRetry(input: {
  log: (message: string) => void;
  logError: (message: string, cause?: unknown) => void;
  mutatedGroupId: string;
  refresh: () => Promise<unknown>;
  scheduleRetry: (retry: () => void, delayMs: number) => void;
  shouldContinue: () => boolean;
  sweep: () => Promise<GroupGrantReshareOutcome>;
}): Promise<void> {
  const budget = createRetryBudget();
  while (input.shouldContinue()) {
    if (budget.exhausted()) {
      input.log(
        `Organizations: group grant re-share gave up for group ${input.mutatedGroupId}; this device may not be able to re-wrap them. Unresolved: ${budget.describeUnresolved()}`,
      );
      return;
    }
    const attempt = await runOneSweepAttempt(input);
    if (attempt.terminal) {
      return;
    }
    if (attempt.outcome?.complete) {
      return;
    }
    if (attempt.outcome?.onlyUnauthorizedRemains) {
      input.log(
        `Organizations: group grant re-share stopped for group ${input.mutatedGroupId}; this signer may not re-wrap the containers still pinned: ${attempt.outcome.unresolvedContainerIds.join(", ")}`,
      );
      return;
    }
    if (attempt.outcome) {
      budget.recordOutcome(attempt.outcome);
    }
    await new Promise<void>((resolve) => {
      input.scheduleRetry(resolve, budget.nextDelayMs());
    });
    // Re-check before touching anything: the scope can change while the timer
    // is pending, and re-listing then would refresh the org just switched to.
    if (!input.shouldContinue()) {
      break;
    }
    if (await relistFailedTerminally(input)) {
      return;
    }
  }
  input.log(
    `Organizations: group grant re-share stopped for group ${input.mutatedGroupId}; the organization is no longer active. Unresolved: ${budget.describeUnresolved()}`,
  );
}

/**
 * Loop bookkeeping: pacing, the two give-up conditions, and what stayed broken.
 *
 * Held apart from the loop so the pacing and the give-up rule each read on
 * their own. There is a single give-up rule: attempts spent at the delay
 * ceiling. An unconfirmed rotation and an unrepairable container are not told
 * apart, because neither can be distinguished from a transient failure — a
 * failed pull can resolve with retained cache, and the share path turns an
 * authorization refusal into a null result rather than a status.
 */
function createRetryBudget() {
  let delayMs = INITIAL_RETRY_DELAY_MS;
  let attemptsAtCeiling = 0;
  let unresolved: readonly string[] = [];

  return {
    describeUnresolved: () =>
      unresolved.length ? unresolved.join(", ") : "none recorded",
    exhausted: () => attemptsAtCeiling >= MAX_ATTEMPTS_AT_CEILING,
    nextDelayMs: () => {
      const current = delayMs;
      if (current >= MAX_RETRY_DELAY_MS) {
        attemptsAtCeiling += 1;
      }
      delayMs = Math.min(current * 2, MAX_RETRY_DELAY_MS);
      return current;
    },
    recordOutcome: (outcome: GroupGrantReshareOutcome) => {
      if (outcome.headConfirmed) {
        unresolved = outcome.unresolvedContainerIds;
      }
    },
  };
}

/**
 * One sweep, with an identity integrity failure reported as terminal.
 *
 * A verified projection disagreeing with a trusted identity is not transient,
 * so re-attempting it just repeats a failing verification — the root and
 * metadata coordinators stop on it for the same reason.
 */
async function runOneSweepAttempt(input: {
  logError: (message: string, cause?: unknown) => void;
  mutatedGroupId: string;
  sweep: () => Promise<GroupGrantReshareOutcome>;
}): Promise<{
  outcome: GroupGrantReshareOutcome | null;
  terminal: boolean;
}> {
  try {
    return { outcome: await input.sweep(), terminal: false };
  } catch (error) {
    if (isKeyingVerificationError(error)) {
      input.logError(
        `Organizations: group grant re-share stopped for group ${input.mutatedGroupId} after an identity integrity failure`,
        error,
      );
      return { outcome: null, terminal: true };
    }
    input.logError(
      `Organizations: group grant re-share failed for group ${input.mutatedGroupId}`,
      error,
    );
    return { outcome: null, terminal: false };
  }
}

/**
 * Re-list containers between attempts, reporting whether that failed fatally.
 *
 * A grant can name a container this device has never hydrated, which resolves
 * as unavailable rather than as a missing grant; re-listing is what lets a
 * later attempt see it, exactly as the root and metadata re-shares do. The
 * error is handled rather than rethrown because the caller discards this
 * promise with `void`, so a throw would surface as an unhandled rejection
 * instead of being reported anywhere.
 */
async function relistFailedTerminally(input: {
  log: (message: string) => void;
  logError: (message: string, cause?: unknown) => void;
  mutatedGroupId: string;
  refresh: () => Promise<unknown>;
}): Promise<boolean> {
  try {
    await input.refresh();
    return false;
  } catch (error) {
    if (isKeyingVerificationError(error)) {
      input.logError(
        `Organizations: group grant re-share stopped for group ${input.mutatedGroupId} after an identity integrity failure while re-listing containers`,
        error,
      );
      return true;
    }
    input.log(
      `Organizations: group grant re-share could not re-list containers for group ${input.mutatedGroupId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
