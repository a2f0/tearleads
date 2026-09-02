import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { ContainerContentsPersistence } from "./containerPersistence";
import type { ContainerState } from "./remoteHydration";
import { recoverStaleSessionRoot } from "./staleRootRecovery";

test("stale root recovery cannot adopt after its generation changes", async () => {
  let current = true;
  let capturedGuard: (() => boolean) | undefined;
  let adoptionCount = 0;
  const state = {
    containersById: new Map<string, ContainerState>([
      [
        "remote-root",
        {
          container: {
            effectiveAccessLevel: "admin",
            id: "remote-root",
            metadataDocumentId: "remote-root-metadata",
            organizationId: "organization",
            parentId: null,
            systemSlot: null,
          },
          record: {
            accessStateHash: "remote-root-access",
            documentId: "remote-root-metadata",
          },
        } as ContainerState,
      ],
    ]),
    persistence: {
      containerExists: async () => false,
      reassignContainerDocuments: async (_execSql, input) => {
        capturedGuard = input.stillCurrent;
        current = false;
      },
    } as Pick<
      ContainerContentsPersistence,
      "containerExists" | "reassignContainerDocuments"
    >,
    rootLaneHydrated: true,
    runtime: {
      adoptRootContainer: () => {
        adoptionCount += 1;
        return true;
      },
      auth: {
        defaultOrganizationId: "organization",
        isAuthenticated: true,
        organizationId: "organization",
        userId: "user",
      },
      infra: { execSql: (async () => []) as ExecSql },
      state: {
        containerId: "stale-root",
        domainScope: createDomainScope(),
      },
    },
  };

  await expect(recoverStaleSessionRoot(state, () => current)).resolves.toEqual({
    candidateCount: 1,
    reassigned: false,
    status: "context-changed",
  });
  expect(capturedGuard?.()).toBe(false);
  expect(adoptionCount).toBe(0);
});
