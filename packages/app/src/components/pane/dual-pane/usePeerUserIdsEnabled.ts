import { useDualPane } from "./useDualPane";

// Whether the peer-user-id concept is active for the current pane. This is a
// demo-only feature (gated by the `panePeerUserIds` host profile flag), so the
// normal app reads `false` here and suppresses peer-only surfaces entirely
// rather than rendering them in a permanently empty state.
export function usePeerUserIdsEnabled(): boolean {
  return useDualPane().peerUserIdsEnabled;
}
