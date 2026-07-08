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
    setState((previous) =>
      previous.ready && previous.organizationId ? previous : LOADING_PRIMARY,
    );
    void input.tearleads.organizations
      .listLocalOrganizations()
      .then((organizations) => {
        if (!cancelled) {
          setState({
            organizationId: organizations[0]?.organizationId ?? null,
            ready: true,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState(READY_WITHOUT_PRIMARY);
        }
      });

    return () => {
      cancelled = true;
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
