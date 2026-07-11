import type {
  LocalOrganizationSummary,
  SessionCreateOrganizationResult,
} from "@tearleads/client-sdk";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ORG_MANAGER_LABELS } from "../labels";
import type { CreateOrganizationDialogState } from "./orgSwitcherTypes";

interface CreateOrganizationDialogOptions {
  interactionDisabled: boolean;
  isScopeGenerationActive: (generation: object) => boolean;
  provisionOrganization: (
    organizationProfileName: string,
  ) => Promise<SessionCreateOrganizationResult | null>;
  reload: () => Promise<boolean>;
  retainOrganization: (organization: LocalOrganizationSummary) => void;
  scopeGeneration: object;
  selectCreatedOrganization: (result: SessionCreateOrganizationResult) => void;
}

interface CreateOrganizationActionOptions
  extends CreateOrganizationDialogOptions {
  activeCreateTokenRef: { current: object | null };
  creatingRef: { current: boolean };
  setCreateOrganizationError: (error: string | null) => void;
  setCreating: (creating: boolean) => void;
  setIsCreateOrganizationDialogOpen: (open: boolean) => void;
}

function useCreateOrganizationAction(options: CreateOrganizationActionOptions) {
  return useCallback(
    async (organizationName: string) => {
      const organizationProfileName = organizationName.trim();
      if (
        organizationProfileName.length === 0 ||
        options.interactionDisabled ||
        options.creatingRef.current
      ) {
        return;
      }

      options.creatingRef.current = true;
      const createToken = {};
      const capturedScopeGeneration = options.scopeGeneration;
      options.activeCreateTokenRef.current = createToken;
      const isCreateActive = () =>
        options.activeCreateTokenRef.current === createToken &&
        options.isScopeGenerationActive(capturedScopeGeneration);
      options.setCreating(true);
      options.setCreateOrganizationError(null);
      try {
        const result = await options.provisionOrganization(
          organizationProfileName,
        );
        if (!isCreateActive()) {
          return;
        }
        if (!result) {
          options.setCreateOrganizationError(
            ORG_MANAGER_LABELS.failedCreateOrganization,
          );
          return;
        }

        options.retainOrganization({
          name: organizationProfileName,
          organizationId: result.organizationId,
          rootContainerId: result.containerId,
        });
        if (!isCreateActive()) {
          return;
        }
        options.selectCreatedOrganization(result);
        if (!isCreateActive()) {
          return;
        }
        options.setIsCreateOrganizationDialogOpen(false);
        await options.reload();
      } catch (error) {
        if (!isCreateActive()) {
          return;
        }
        console.error("Failed to create organization:", error);
        options.setCreateOrganizationError(
          ORG_MANAGER_LABELS.failedCreateOrganization,
        );
      } finally {
        if (isCreateActive()) {
          options.activeCreateTokenRef.current = null;
          options.creatingRef.current = false;
          options.setCreating(false);
        }
      }
    },
    [options],
  );
}

export function useCreateOrganizationDialog({
  interactionDisabled,
  isScopeGenerationActive,
  provisionOrganization,
  reload,
  retainOrganization,
  scopeGeneration,
  selectCreatedOrganization,
}: CreateOrganizationDialogOptions): CreateOrganizationDialogState {
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const activeCreateTokenRef = useRef<object | null>(null);
  const previousScopeGenerationRef = useRef(scopeGeneration);
  const [isCreateOrganizationDialogOpen, setIsCreateOrganizationDialogOpen] =
    useState(false);
  const [createOrganizationError, setCreateOrganizationError] = useState<
    string | null
  >(null);
  useLayoutEffect(() => {
    if (previousScopeGenerationRef.current === scopeGeneration) {
      return;
    }
    previousScopeGenerationRef.current = scopeGeneration;
    activeCreateTokenRef.current = null;
    creatingRef.current = false;
    setCreating(false);
    setCreateOrganizationError(null);
    setIsCreateOrganizationDialogOpen(false);
  }, [scopeGeneration]);

  const openCreateOrganizationDialog = useCallback(() => {
    if (interactionDisabled) {
      return;
    }
    setCreateOrganizationError(null);
    setIsCreateOrganizationDialogOpen(true);
  }, [interactionDisabled]);

  const closeCreateOrganizationDialog = useCallback(() => {
    if (creatingRef.current) {
      return;
    }
    setCreateOrganizationError(null);
    setIsCreateOrganizationDialogOpen(false);
  }, []);

  const createOrganization = useCreateOrganizationAction({
    activeCreateTokenRef,
    creatingRef,
    interactionDisabled,
    isScopeGenerationActive,
    provisionOrganization,
    reload,
    retainOrganization,
    scopeGeneration,
    selectCreatedOrganization,
    setCreateOrganizationError,
    setCreating,
    setIsCreateOrganizationDialogOpen,
  });

  return useMemo(
    () => ({
      closeCreateOrganizationDialog,
      createOrganization,
      createOrganizationError,
      creating,
      isCreateOrganizationDialogOpen,
      openCreateOrganizationDialog,
    }),
    [
      closeCreateOrganizationDialog,
      createOrganization,
      createOrganizationError,
      creating,
      isCreateOrganizationDialogOpen,
      openCreateOrganizationDialog,
    ],
  );
}
