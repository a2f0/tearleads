import type {
  LocalOrganizationSummary,
  SessionContext,
  SessionCreateOrganizationResult,
} from "@symcrypt/client-sdk";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type {
  OrgSwitcherControllerInput,
  OrgSwitcherState,
} from "./orgSwitcherTypes";
import { useCreateOrganizationDialog } from "./useCreateOrganizationDialog";
import { useLocalOrganizations } from "./useLocalOrganizations";

export function resolveOrgSwitcherSessionContext(
  organizations: readonly LocalOrganizationSummary[],
  organizationId: string,
): SessionContext | null {
  const organization = organizations.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  if (!organization) {
    return null;
  }

  return {
    containerId: organization.rootContainerId,
    organizationId,
  };
}

function useOrganizationSelection(input: {
  activeOrganizationId: string | null;
  interactionDisabled: boolean;
  organizations: readonly LocalOrganizationSummary[];
  setSessionContext: (context: SessionContext) => void;
}) {
  return useCallback(
    (organizationId: string) => {
      if (
        input.interactionDisabled ||
        organizationId === input.activeOrganizationId
      ) {
        return;
      }
      const context = resolveOrgSwitcherSessionContext(
        input.organizations,
        organizationId,
      );
      if (context) {
        input.setSessionContext(context);
      }
    },
    [
      input.activeOrganizationId,
      input.interactionDisabled,
      input.organizations,
      input.setSessionContext,
    ],
  );
}

function useCreateScopeGeneration(input: OrgSwitcherControllerInput) {
  const generation = useMemo(
    () => ({}),
    [
      input.activeContainerId,
      input.activeOrganizationId,
      input.databaseReady,
      input.enabled,
      input.operationScopeKey,
      input.scopeKey,
    ],
  );
  const committedGenerationRef = useRef(generation);
  useLayoutEffect(() => {
    committedGenerationRef.current = generation;
    return () => {
      if (committedGenerationRef.current === generation) {
        committedGenerationRef.current = {};
      }
    };
  }, [generation]);
  const isActive = useCallback(
    (candidate: object) => committedGenerationRef.current === candidate,
    [],
  );
  return { generation, isActive };
}

/**
 * State controller kept separate from the SDK context so reload/readiness races
 * can be exercised with deterministic deferred promises in focused tests.
 */
export function useOrgSwitcherController(
  input: OrgSwitcherControllerInput,
): OrgSwitcherState {
  const baseInteractionsDisabled =
    !input.enabled ||
    !input.databaseReady ||
    Boolean(input.interactionDisabled);
  const activeOrganization = useMemo(
    () =>
      input.activeOrganizationId && input.activeContainerId
        ? {
            name: null,
            organizationId: input.activeOrganizationId,
            rootContainerId: input.activeContainerId,
          }
        : null,
    [input.activeContainerId, input.activeOrganizationId],
  );
  const localOrganizations = useLocalOrganizations({
    activeOrganization,
    databaseReady: input.databaseReady,
    enabled: input.enabled,
    listLocalOrganizations: input.listLocalOrganizations,
    refreshKey: input.organizationIndexRefreshKey,
    scopeKey: input.scopeKey,
  });
  const createScope = useCreateScopeGeneration(input);

  const selectCreatedOrganization = useCallback(
    (result: SessionCreateOrganizationResult) => {
      input.setSessionContext({
        containerId: result.containerId,
        organizationId: result.organizationId,
      });
    },
    [input.setSessionContext],
  );
  const createOrganizationDialog = useCreateOrganizationDialog({
    interactionDisabled: baseInteractionsDisabled,
    isScopeGenerationActive: createScope.isActive,
    provisionOrganization: input.provisionOrganization,
    reload: localOrganizations.reload,
    retainOrganization: localOrganizations.retainOrganization,
    scopeGeneration: createScope.generation,
    selectCreatedOrganization,
  });
  const interactionsDisabled =
    baseInteractionsDisabled || createOrganizationDialog.creating;
  const selectOrganization = useOrganizationSelection({
    activeOrganizationId: input.activeOrganizationId,
    interactionDisabled: interactionsDisabled,
    organizations: localOrganizations.organizations,
    setSessionContext: input.setSessionContext,
  });

  return useMemo(
    () => ({
      activeOrganizationId: input.activeOrganizationId,
      ...createOrganizationDialog,
      interactionDisabled: interactionsDisabled,
      organizations: localOrganizations.organizations,
      organizationsError: localOrganizations.organizationsError,
      organizationsLoading: localOrganizations.organizationsLoading,
      selectOrganization,
    }),
    [
      createOrganizationDialog,
      input.activeOrganizationId,
      interactionsDisabled,
      localOrganizations.organizations,
      localOrganizations.organizationsError,
      localOrganizations.organizationsLoading,
      selectOrganization,
    ],
  );
}
