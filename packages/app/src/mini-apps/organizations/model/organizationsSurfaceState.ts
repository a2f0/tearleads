import type { AccountBootstrapCopy } from "../../../identity/accountBootstrapPhase";
import { ORGANIZATIONS_LABELS } from "../labels";

export interface OrganizationsSurfaceState {
  readonly busy: boolean;
  readonly description: string | undefined;
  readonly title: string;
}

/**
 * What fills the Organizations surface instead of the list, or null once
 * there are organizations to show. Account setup outranks loading, which
 * outranks "no organizations", so a device still creating its account never
 * flashes the empty state.
 */
export function resolveOrganizationsSurfaceState(input: {
  readonly cardCount: number;
  readonly progress: AccountBootstrapCopy | null;
  readonly ready: boolean;
}): OrganizationsSurfaceState | null {
  if (input.ready && input.cardCount > 0) return null;
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
      title: ORGANIZATIONS_LABELS.loading,
    };
  }
  return {
    busy: false,
    description: ORGANIZATIONS_LABELS.emptyDescription,
    title: ORGANIZATIONS_LABELS.empty,
  };
}
