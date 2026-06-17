/**
 * Sentinel `mutatingSessionId` value for the current session's logout, so the
 * current-session row and the toolbar/dialog share one busy signal distinct
 * from per-session revoke ids.
 */
export const CURRENT_SESSION_MUTATION_ID = "current-session";
