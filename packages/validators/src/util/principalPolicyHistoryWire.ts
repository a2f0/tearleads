/**
 * Shared wire bounds for paged principal policy history.
 *
 * Policy history is the recovery counterpart to the container kek-log: a
 * principal accumulates one signed state per membership or key change, and a
 * long-lived group's chain has no natural ceiling. Serving it needs the same
 * discipline the kek-log settled on — page it, scope it to the requester, and
 * bound each page before any cryptographic work.
 */

/**
 * Maximum historical states one policy-history page may serve. Recovery walks
 * the chain from the newest page backward, so the page bound — not the
 * principal's lifetime version count — determines a response's size.
 */
export const PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT = 64;

/**
 * Maximum member envelopes one historical state may serve.
 *
 * A page is already scoped to envelopes the requester could open, so this is
 * the backstop against a principal whose direct membership is unusually wide,
 * not the primary bound. Recovery needs ONE openable envelope per state, so a
 * cap here cannot cost a reachable key.
 */
export const PRINCIPAL_POLICY_HISTORY_ENVELOPES_PER_STATE_LIMIT = 16;

/**
 * A principal version is a positive integer that increments once per accepted
 * state. This ceiling bounds a cursor before it reaches the database, where a
 * safe integer could still exceed an `integer` column and turn a malformed
 * request into a 500.
 */
export const MAX_PRINCIPAL_STATE_VERSION = 1_000_000;
