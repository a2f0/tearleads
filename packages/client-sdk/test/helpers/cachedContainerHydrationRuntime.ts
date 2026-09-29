import { createMockApiClient } from "@tearleads/test-utils";
import { createDomainScope } from "../../src/data/domainScope";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { createContainerContentsTestRuntime } from "../../src/stores/container-contents/runtime.testFixtures";
import { rememberDestinationRole } from "../../src/workflows/container-contents/remoteHydration/destinationRoleCache";
import type { RemoteContainer } from "../../src/workflows/container-contents/remoteHydration/types";

/** Lifecycle/persistence fixtures begin after binding verification. Signed
 * metadata-binding tests exercise the cold verification path separately. */
export function cachedContainerHydrationRuntime(
  containers: readonly Pick<
    RemoteContainer,
    "id" | "organizationId" | "metadataDocumentId"
  >[],
  execSql: ExecSql = async () => {
    throw new Error("Unexpected fixture SQL");
  },
) {
  for (const container of containers) {
    rememberDestinationRole(execSql, container, {
      createSignerUserId: "fixture-user",
      metadataDocumentId: container.metadataDocumentId,
      systemSlot: null,
    });
  }
  return createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    organizationId: containers[0]?.organizationId,
    execSql,
    apiClient: createMockApiClient({
      getContainerWriterProjection: async () => {
        throw new Error("Expected a cached binding");
      },
    }),
  });
}
