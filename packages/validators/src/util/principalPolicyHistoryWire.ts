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
 * A page carries only the requester's own direct user envelopes, and a state
 * holds at most one envelope per direct member, so at most one can match per
 * state. The cap is a structural backstop that cannot bite rather than a
 * truncation — a cap that could bite would drop the only resolvable envelope
 * whenever it happened to sort last, and a dropped envelope is
 * indistinguishable from an absent one.
 */
export const PRINCIPAL_POLICY_HISTORY_ENVELOPES_PER_STATE_LIMIT = 4;

/**
 * The longest principal state chain the protocol supports.
 *
 * A principal version is a positive integer that increments once per accepted
 * state, so this doubles as a cursor ceiling: it bounds a cursor before it
 * reaches the database, where a safe integer could still exceed an `integer`
 * column and turn a malformed request into a 500.
 *
 * It is also the number a recovery walk must be able to traverse. Declaring a
 * domain larger than the walk's request budget can reach would make older keys
 * silently unrecoverable inside the supported range, so the budget is derived
 * from this constant rather than chosen independently — see
 * `MAX_POLICY_HISTORY_FETCHES`.
 */
export const MAX_PRINCIPAL_STATE_VERSION = 16_384;
