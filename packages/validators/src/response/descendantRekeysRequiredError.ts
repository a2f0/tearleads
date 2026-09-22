/**
 * A rotation would leave a level above a directly granted container pinned to
 * a retired epoch. The body names the descendant rekeys the batch must carry,
 * parent-first. Emitted by container rotations and, since a group policy
 * change rematerializes its granted containers, by policy commits. Declared
 * on its own so both envelopes can cite it without importing each other.
 */
export const CONTAINER_DESCENDANT_REKEYS_REQUIRED_ERROR_CODE =
  "container_descendant_rekeys_required";
