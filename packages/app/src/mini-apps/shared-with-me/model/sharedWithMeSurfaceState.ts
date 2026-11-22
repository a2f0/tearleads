import type { AccountBootstrapCopy } from "../../../identity/accountBootstrapPhase";
import { SHARED_WITH_ME_LABELS } from "../labels";

export interface SharedWithMeSurfaceState {
  readonly busy: boolean;
  readonly description: string | undefined;
  readonly title: string;
}

/**
 * What fills the Shared with Me surface instead of the list, or null once
 * there are rows to show. Account setup outranks loading, which outranks
 * "nothing shared", so a device still creating its account never flashes the
 * empty state.
 */
export function resolveSharedWithMeSurfaceState(input: {
  readonly progress: AccountBootstrapCopy | null;
  readonly ready: boolean;
  readonly rowCount: number;
}): SharedWithMeSurfaceState | null {
  if (input.ready && input.rowCount > 0) return null;
  if (input.progress) {
    return {
      busy: true,
      description: input.progress.description,
      title: input.progress.title,
    };
  }
  if (!input.ready) {
    return {
      busy: true,
      description: undefined,
      title: SHARED_WITH_ME_LABELS.loading,
    };
  }
  return {
    busy: false,
    description: SHARED_WITH_ME_LABELS.emptyDescription,
    title: SHARED_WITH_ME_LABELS.empty,
  };
}
