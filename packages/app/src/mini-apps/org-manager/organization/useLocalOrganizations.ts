import type {
  DomainScope,
  LocalOrganizationSummary,
} from "@symcrypt/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createBoundedRetrySchedule } from "../hooks/boundedRetry";
import { ORG_MANAGER_LABELS } from "../labels";
import type { LocalOrganizationsState } from "./orgSwitcherTypes";

type OrganizationsSetter = Dispatch<
  SetStateAction<readonly LocalOrganizationSummary[]>
>;

function retainOrganizationSummary(
  organizations: readonly LocalOrganizationSummary[],
  organization: LocalOrganizationSummary,
): readonly LocalOrganizationSummary[] {
  const existingIndex = organizations.findIndex(
    (candidate) => candidate.organizationId === organization.organizationId,
  );
  if (existingIndex === -1) {
    return [...organizations, organization];
  }
  const existing = organizations[existingIndex];
  const nextOrganization =
    organization.name === null && existing?.name !== null
      ? { ...organization, name: existing?.name ?? null }
      : organization;
  if (
    existing?.name === nextOrganization.name &&
    existing?.rootContainerId === nextOrganization.rootContainerId
  ) {
    return organizations;
  }

  return organizations.map((candidate, index) =>
    index === existingIndex ? nextOrganization : candidate,
  );
}

function reconcileRetainedOrganizations(
  nextOrganizations: readonly LocalOrganizationSummary[],
  retainedOrganizations: Map<string, LocalOrganizationSummary>,
): readonly LocalOrganizationSummary[] {
  let reconciledOrganizations = nextOrganizations;
  for (const [organizationId, retained] of retainedOrganizations) {
    const persisted = nextOrganizations.find(
      (organization) => organization.organizationId === organizationId,
    );
    if (!persisted) {
      reconciledOrganizations = retainOrganizationSummary(
        reconciledOrganizations,
        retained,
      );
      continue;
    }

    retainedOrganizations.delete(organizationId);
    if (persisted.name === null && retained.name !== null) {
      reconciledOrganizations = reconciledOrganizations.map((organization) =>
        organization.organizationId === organizationId
          ? { ...organization, name: retained.name }
          : organization,
      );
    }
  }
  return reconciledOrganizations;
}

interface OrganizationReloadOptions {
  databaseReady: boolean;
  enabled: boolean;
  latestRequestIdRef: { current: number };
  listLocalOrganizations: () => Promise<LocalOrganizationSummary[]>;
  mountedRef: { current: boolean };
  organizationsRef: { current: readonly LocalOrganizationSummary[] };
  retainedOrganizationsRef: {
    current: Map<string, LocalOrganizationSummary>;
  };
  setOrganizations: OrganizationsSetter;
  setOrganizationsError: Dispatch<SetStateAction<string | null>>;
  setOrganizationsLoading: Dispatch<SetStateAction<boolean>>;
}

function useOrganizationReload(input: OrganizationReloadOptions) {
  const {
    databaseReady,
    enabled,
    latestRequestIdRef,
    listLocalOrganizations,
    mountedRef,
    organizationsRef,
    retainedOrganizationsRef,
    setOrganizations,
    setOrganizationsError,
    setOrganizationsLoading,
  } = input;
  return useCallback(async (): Promise<boolean> => {
    if (!enabled || !databaseReady) {
      return false;
    }

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    // Only surface the loading status when there is nothing to show yet.
    // Refresh-key churn (e.g. organization-profile document emissions on the
    // organizations screen) re-runs this reload repeatedly; blinking the status
    // while a usable list is already on screen reads as flicker, and the list
    // itself is unchanged by those refreshes.
    if (organizationsRef.current.length === 0) {
      setOrganizationsLoading(true);
    }
    setOrganizationsError(null);

    try {
      const nextOrganizations = await listLocalOrganizations();
      if (!mountedRef.current || latestRequestIdRef.current !== requestId) {
        return false;
      }
      setOrganizations(
        reconcileRetainedOrganizations(
          nextOrganizations,
          retainedOrganizationsRef.current,
        ),
      );
      return true;
    } catch {
      if (mountedRef.current && latestRequestIdRef.current === requestId) {
        // Preserve the last usable list, including an optimistic created entry.
        setOrganizationsError(ORG_MANAGER_LABELS.failedLoadOrganizations);
      }
      return false;
    } finally {
      if (mountedRef.current && latestRequestIdRef.current === requestId) {
        setOrganizationsLoading(false);
      }
    }
  }, [
    databaseReady,
    enabled,
    latestRequestIdRef,
    listLocalOrganizations,
    mountedRef,
    organizationsRef,
    retainedOrganizationsRef,
    setOrganizations,
    setOrganizationsError,
    setOrganizationsLoading,
  ]);
}

interface OrganizationListLifecycleOptions {
  databaseReady: boolean;
  enabled: boolean;
  latestRequestIdRef: { current: number };
  mountedRef: { current: boolean };
  reload: () => Promise<boolean>;
  refreshKey: string;
  retainedOrganizationsRef: {
    current: Map<string, LocalOrganizationSummary>;
  };
  scopeKey: DomainScope;
  setOrganizations: OrganizationsSetter;
  setOrganizationsError: Dispatch<SetStateAction<string | null>>;
  setOrganizationsLoading: Dispatch<SetStateAction<boolean>>;
}

function useOrganizationListLifecycle(input: OrganizationListLifecycleOptions) {
  const {
    databaseReady,
    enabled,
    latestRequestIdRef,
    mountedRef,
    reload,
    refreshKey,
    retainedOrganizationsRef,
    scopeKey,
    setOrganizations,
    setOrganizationsError,
    setOrganizationsLoading,
  } = input;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      latestRequestIdRef.current += 1;
    };
  }, [latestRequestIdRef, mountedRef]);

  useEffect(() => {
    if (!enabled) {
      latestRequestIdRef.current += 1;
      retainedOrganizationsRef.current.clear();
      setOrganizations([]);
      setOrganizationsError(null);
      setOrganizationsLoading(false);
      return;
    }

    if (!databaseReady) {
      // SQLite unavailability is not evidence that there are zero local
      // organizations. Keep the last list and retry when readiness returns.
      latestRequestIdRef.current += 1;
      setOrganizationsError(null);
      setOrganizationsLoading(true);
      return;
    }

    void reload();
  }, [
    databaseReady,
    enabled,
    latestRequestIdRef,
    reload,
    refreshKey,
    retainedOrganizationsRef,
    scopeKey,
    setOrganizations,
    setOrganizationsError,
    setOrganizationsLoading,
  ]);
}

/**
 * Re-read the index on a bounded schedule while it is still catching up.
 *
 * Two things can lag behind the container tree the switcher already renders:
 *
 *  - the **active organization's own index row**, when the session context
 *    already points at an organization whose persisted root has not landed yet;
 *  - an organization's **display name**, which comes from its
 *    organization-profile document. That document's body can finish syncing well
 *    after the roots do — most visibly on a device that just re-hydrated an
 *    identity, where every document arrives after the container tree. The
 *    refresh key covers the profile emissions it can see, but a name that lands
 *    through another lane (or between the reload's query and its commit) would
 *    otherwise leave the switcher pinned to "Untitled organization" for the rest
 *    of the session.
 *
 * Both resolve by re-reading local state, so one retry loop serves them and
 * stops as soon as neither is outstanding. Only a missing active-organization
 * row is an error worth surfacing when the budget runs out: an organization can
 * legitimately have no name.
 */
function useOrganizationIndexCatchUpRetry(input: {
  activeOrganization: LocalOrganizationSummary | null;
  databaseReady: boolean;
  enabled: boolean;
  organizations: readonly LocalOrganizationSummary[];
  reload: () => Promise<boolean>;
  retainedOrganizationsRef: {
    current: Map<string, LocalOrganizationSummary>;
  };
  setOrganizationsError: Dispatch<SetStateAction<string | null>>;
}) {
  const activeOrganizationId = input.activeOrganization?.organizationId;
  const hasUnnamedOrganization = input.organizations.some(
    (organization) => organization.name === null,
  );
  useEffect(() => {
    if (
      !input.enabled ||
      !input.databaseReady ||
      (!activeOrganizationId && !hasUnnamedOrganization)
    ) {
      return;
    }

    const retry = createBoundedRetrySchedule(() => {
      const awaitingActiveIndex =
        activeOrganizationId !== undefined &&
        input.retainedOrganizationsRef.current.has(activeOrganizationId);
      if (
        retry.cancelled ||
        (!awaitingActiveIndex && !hasUnnamedOrganization)
      ) {
        return;
      }
      if (retry.exhausted) {
        if (awaitingActiveIndex) {
          input.setOrganizationsError(
            ORG_MANAGER_LABELS.failedLoadOrganizations,
          );
        }
        return;
      }
      void input.reload().finally(() => {
        if (!retry.cancelled) {
          retry.scheduleNext();
        }
      });
    });
    retry.start();
    return () => retry.cancel();
  }, [
    activeOrganizationId,
    hasUnnamedOrganization,
    input.databaseReady,
    input.enabled,
    input.reload,
    input.retainedOrganizationsRef,
    input.setOrganizationsError,
  ]);
}

function useRetainOrganization(
  retainedOrganizationsRef: {
    current: Map<string, LocalOrganizationSummary>;
  },
  setOrganizations: OrganizationsSetter,
) {
  return useCallback((organization: LocalOrganizationSummary) => {
    const retained = retainedOrganizationsRef.current.get(
      organization.organizationId,
    );
    const nextOrganization =
      organization.name === null && retained?.name !== null
        ? { ...organization, name: retained?.name ?? null }
        : organization;
    retainedOrganizationsRef.current.set(
      organization.organizationId,
      nextOrganization,
    );
    setOrganizations((current) =>
      retainOrganizationSummary(current, nextOrganization),
    );
  }, []);
}

export function useLocalOrganizations(input: {
  activeOrganization: LocalOrganizationSummary | null;
  databaseReady: boolean;
  enabled: boolean;
  listLocalOrganizations: () => Promise<LocalOrganizationSummary[]>;
  refreshKey: string;
  scopeKey: DomainScope;
}): LocalOrganizationsState {
  const [organizations, setOrganizations] = useState<
    readonly LocalOrganizationSummary[]
  >([]);
  const [organizationsError, setOrganizationsError] = useState<string | null>(
    null,
  );
  const [organizationsLoading, setOrganizationsLoading] = useState(
    input.enabled,
  );
  // Mirror the committed list so reload() can decide whether a refresh needs to
  // blink the loading status without re-creating the callback on every change.
  const organizationsRef = useRef(organizations);
  organizationsRef.current = organizations;
  const latestRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const retainedOrganizationsRef = useRef<
    Map<string, LocalOrganizationSummary>
  >(new Map());
  const committedScopeKeyRef = useRef(input.scopeKey);
  useLayoutEffect(() => {
    if (committedScopeKeyRef.current === input.scopeKey) {
      return;
    }
    committedScopeKeyRef.current = input.scopeKey;
    latestRequestIdRef.current += 1;
    retainedOrganizationsRef.current.clear();
    setOrganizations([]);
    setOrganizationsError(null);
    setOrganizationsLoading(input.enabled);
  }, [input.enabled, input.scopeKey]);
  const reload = useOrganizationReload({
    ...input,
    latestRequestIdRef,
    mountedRef,
    organizationsRef,
    retainedOrganizationsRef,
    setOrganizations,
    setOrganizationsError,
    setOrganizationsLoading,
  });
  useOrganizationListLifecycle({
    databaseReady: input.databaseReady,
    enabled: input.enabled,
    latestRequestIdRef,
    mountedRef,
    reload,
    refreshKey: input.refreshKey,
    retainedOrganizationsRef,
    scopeKey: input.scopeKey,
    setOrganizations,
    setOrganizationsError,
    setOrganizationsLoading,
  });

  const retainOrganization = useRetainOrganization(
    retainedOrganizationsRef,
    setOrganizations,
  );
  useEffect(() => {
    if (input.enabled && input.activeOrganization) {
      retainOrganization(input.activeOrganization);
    }
  }, [
    input.activeOrganization,
    input.enabled,
    input.scopeKey,
    retainOrganization,
  ]);
  useOrganizationIndexCatchUpRetry({
    activeOrganization: input.activeOrganization,
    databaseReady: input.databaseReady,
    enabled: input.enabled,
    organizations,
    reload,
    retainedOrganizationsRef,
    setOrganizationsError,
  });

  return {
    organizations,
    organizationsError,
    organizationsLoading,
    reload,
    retainOrganization,
  };
}
