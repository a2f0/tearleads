import type { Tearleads } from "@tearleads/client-sdk";
import { useEffect, useState } from "react";

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

// Auth and the container tree can settle before a concurrent local-org read
// observes registration persistence. Keep bootstrap waiting through that short
// index-convergence window instead of permanently classifying the org as custom.
// Back off after the startup window, but keep checking for late persistence.
const PRIMARY_ORGANIZATION_FAST_RETRY_DELAY_MS = 500;
const PRIMARY_ORGANIZATION_SLOW_RETRY_DELAY_MS = 5_000;
const PRIMARY_ORGANIZATION_FAST_RETRY_LIMIT = 40;

export function usePrimaryLocalOrganization(input: {
  readonly enabled: boolean;
  readonly refreshKey: string;
  readonly tearleads: Tearleads;
}): PrimaryLocalOrganizationState {
  const [state, setState] = useState<PrimaryLocalOrganizationState>(
    input.enabled ? LOADING_PRIMARY : READY_WITHOUT_PRIMARY,
  );

  useEffect(() => {
    if (!input.enabled) {
      setState(READY_WITHOUT_PRIMARY);
      return;
    }

    let cancelled = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setState(LOADING_PRIMARY);

    function scheduleRetry(): void {
      const retryDelay =
        retryCount < PRIMARY_ORGANIZATION_FAST_RETRY_LIMIT
          ? PRIMARY_ORGANIZATION_FAST_RETRY_DELAY_MS
          : PRIMARY_ORGANIZATION_SLOW_RETRY_DELAY_MS;
      retryCount += 1;
      retryTimer = setTimeout(() => {
        void loadPrimaryOrganization();
      }, retryDelay);
    }

    async function loadPrimaryOrganization(): Promise<void> {
      try {
        const organizations =
          await input.tearleads.organizations.listLocalOrganizations();
        if (cancelled) {
          return;
        }

        const primaryOrganization = organizations[0];
        if (!primaryOrganization) {
          setState(LOADING_PRIMARY);
          scheduleRetry();
          return;
        }

        setState({
          organizationId: primaryOrganization.organizationId,
          ready: true,
        });
      } catch {
        if (!cancelled) {
          setState(LOADING_PRIMARY);
          scheduleRetry();
        }
      }
    }

    void loadPrimaryOrganization();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
      }
    };
  }, [input.enabled, input.refreshKey, input.tearleads]);

  return state;
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
