import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import { exportAllUpdates } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ContainerWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  createInitializedContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../../data/containers/containerMetadataDocument";
import type { ContainerContentsPersistence } from "../containerPersistence";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import {
  persistDuplicateContainerShare,
  persistSharedContainerState,
} from "./sharePersistence";
import type { ContainerWorkflowRuntime } from "./types";

for (const variant of ["new share", "duplicate share"] as const) {
  test(`${variant} preserves metadata completed during persistence`, async () => {
    const database = await createTestExecSql(
      `container-${variant.replace(" ", "-")}-metadata-race`,
    );
    try {
      await defaultContainerContentsPersistence.ensureSchema(database.execSql);
      const containerId = `container-${variant.replace(" ", "-")}`;
      const { doc, initialUpdate } =
        await createInitializedContainerMetadataDocument(containerId, {
          icon: null,
          name: "Before share",
        });
      const containerState: ContainerState = {
        container: {
          effectiveAccessLevel: "admin",
          icon: null,
          id: containerId,
          metadataDocumentId: `metadata-${containerId}`,
          name: "Before share",
          organizationId: "organization-1",
          parentId: null,
        },
        doc,
        record: {
          accessEpoch: 1,
          accessStateHash: "access-before-share",
          contentKeyBundle: "content-key-before-share",
          documentId: `metadata-${containerId}`,
          documentKekTargets: "targets-before-share",
          documentManifestBundle: "manifest-before-share",
          id: containerId,
          lastCommitLsn: null,
          metadataUpdates: bytesToBase64(initialUpdate),
          snapshotEndVersion: "",
        },
      };
      await defaultContainerContentsPersistence.saveContainer(
        database.execSql,
        containerState.container,
        containerState.record,
      );
      const liveDoc = containerState.doc;
      let concurrentUpdates = "";
      const persistence: ContainerContentsPersistence = {
        ...defaultContainerContentsPersistence,
        async commitMetadataMutation(execSql, input) {
          const committed =
            await defaultContainerContentsPersistence.commitMetadataMutation(
              execSql,
              input,
            );
          if (committed.committed) {
            writeContainerMetadataValue(containerState.doc, {
              icon: "archive",
              name: "Concurrent rename",
            });
            concurrentUpdates = bytesToBase64(
              exportAllUpdates(containerState.doc),
            );
            containerState.container = {
              ...containerState.container,
              icon: "archive",
              name: "Concurrent rename",
            };
            containerState.record = {
              ...containerState.record,
              metadataUpdates: concurrentUpdates,
            };
          }
          return committed;
        },
      };
      const projection = {
        containerId,
        organizationId: "organization-1",
      } as ContainerWriterProjectionResponse;
      const runtime = {
        apiClient: { getCurrentPrincipalPolicy: async () => null },
        infra: { execSql: database.execSql },
        resolveTrustedUserIdentity: async () => null,
        util: {
          log: () => undefined,
          reportSecurityIncident: async () => undefined,
        },
      } as unknown as ContainerWorkflowRuntime;

      const result =
        variant === "new share"
          ? await persistSharedContainerState({
              containerState,
              persistence,
              runtime,
              shared: {
                accessEpoch: 2,
                accessManifestHash: "access-after-share",
                createdAt: "2026-01-01T00:00:00.000Z",
                metadataDocumentId: `metadata-${containerId}`,
                referencedPrincipalHeads: [],
                updatedAt: "2026-01-02T00:00:00.000Z",
                writerProjection: projection,
              },
            })
          : await persistDuplicateContainerShare({
              containerState,
              grant: {
                accessEpoch: 2,
                accessStateHash: "access-after-share",
                createdAt: "2026-01-01T00:00:00.000Z",
                metadataDocumentId: `metadata-${containerId}`,
                referencedPrincipalHeads: [],
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
              persistence,
              projection,
              runtime,
            });

      if (result?.status !== "persisted") {
        throw new Error("Expected persisted share state");
      }
      expect(containerState.doc).toBe(liveDoc);
      expect(
        readContainerMetadataValue(containerState.doc, "fallback"),
      ).toEqual({ icon: "archive", name: "Concurrent rename" });
      expect(containerState.record).toMatchObject({
        accessEpoch: 2,
        accessStateHash: "access-after-share",
        metadataUpdates: concurrentUpdates,
      });
      expect(result.record).toBe(containerState.record);
    } finally {
      database.close();
    }
  });
}
