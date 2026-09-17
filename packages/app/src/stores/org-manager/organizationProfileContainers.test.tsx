import { afterEach, expect, mock, test } from "bun:test";
import {
  type ContainerContentsStore,
  type ContainerNode,
  createDomainScope,
  deriveOrganizationMetadataContainerSystemSlot,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import { useOrganizationProfileContainers } from "./organizationProfileContainers";
import type { OrgManagerOperationScope } from "./orgManagerOperationScope";

afterEach(cleanup);

function createScope(): OrgManagerOperationScope {
  return {
    containerId: "personal-root",
    domainScope: createDomainScope(),
    generation: {},
    organizationId: "org-1",
    signingFingerprint: "signer",
    userId: "user-1",
  };
}

async function metadataNode(): Promise<ContainerNode> {
  return {
    effectiveAccessLevel: "admin",
    id: "provisioned-metadata",
    kind: "container",
    metadataDocumentId: "metadata-document",
    name: "Organization metadata",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: "org-1",
    }),
  };
}

test.each([
  "before-hydration",
  "foreign-root",
  "invalid-child",
  "cached-root",
] as const)(
  "organization profile editing resolves the scoped metadata root (%s)",
  async (scenario) => {
    const scope = createScope();
    const metadata = await metadataNode();
    const nodes =
      scenario === "before-hydration"
        ? []
        : [
            {
              ...metadata,
              organizationId:
                scenario === "foreign-root" ? "org-2" : metadata.organizationId,
              parentId: scenario === "invalid-child" ? "personal-root" : null,
            },
          ];
    const ensureSystemContainer = mock(async () => metadata);
    const { result } = renderHook(() =>
      useOrganizationProfileContainers({
        captureOperationScope: () => scope,
        isOperationScopeActive: () => true,
        containerContentsStore: {
          getSnapshot: () => ({ nodes }),
          ensureSystemContainer,
        } as unknown as ContainerContentsStore,
      }),
    );
    expect(await result.current.ensureOrganizationMetadataContainer()).toEqual(
      metadata,
    );
    expect(ensureSystemContainer).toHaveBeenCalledTimes(
      scenario === "cached-root" ? 0 : 1,
    );
  },
);

test("profile editing discards metadata discovered after its organization scope changed", async () => {
  const scope = createScope();
  const metadata = await metadataNode();
  let active = true;
  const { result } = renderHook(() =>
    useOrganizationProfileContainers({
      captureOperationScope: () => scope,
      isOperationScopeActive: () => active,
      containerContentsStore: {
        getSnapshot: () => ({ nodes: [] }),
        ensureSystemContainer: async () => {
          active = false;
          return metadata;
        },
      } as unknown as ContainerContentsStore,
    }),
  );
  expect(await result.current.ensureOrganizationMetadataContainer()).toBeNull();
});
