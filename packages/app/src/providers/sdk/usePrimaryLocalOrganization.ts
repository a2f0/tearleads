interface PrimaryLocalOrganizationState {
  readonly organizationId: string | null;
  readonly ready: boolean;
}

const READY_WITHOUT_PRIMARY: PrimaryLocalOrganizationState = {
  organizationId: null,
  ready: true,
};

const LOADING_PRIMARY: PrimaryLocalOrganizationState = {
  organizationId: null,
  ready: false,
};

// The authenticated identity's default organization is the authoritative
// personal organization: every session carries it. This hook only reports it
// (or that it has not arrived yet); incidental local-root ordering (for
// example, an older foreign root discovered through a share) never replaces it.
export function usePrimaryLocalOrganization(input: {
  readonly defaultOrganizationId?: string | null | undefined;
  readonly enabled: boolean;
}): PrimaryLocalOrganizationState {
  if (!input.enabled) {
    return READY_WITHOUT_PRIMARY;
  }
  return input.defaultOrganizationId
    ? { organizationId: input.defaultOrganizationId, ready: true }
    : LOADING_PRIMARY;
}

export function resolveContactsBootstrapPolicy(input: {
  readonly currentOrganizationId: string | null | undefined;
  readonly isAuthenticated: boolean;
  readonly primaryLocalOrganization: PrimaryLocalOrganizationState;
}): boolean | null {
  if (!input.isAuthenticated) {
    return true;
  }
  if (!input.primaryLocalOrganization.ready) {
    return null;
  }
  return (
    input.currentOrganizationId !== null &&
    input.currentOrganizationId !== undefined &&
    input.currentOrganizationId ===
      input.primaryLocalOrganization.organizationId
  );
}
