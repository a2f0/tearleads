import { expect, mock, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { clearDocumentDiscoveryEvidenceOnRemoteReset } from "../../data/persistence/documents/documentDiscoveryReset";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
} from "./documentDiscovery";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";
import { createDiscoveredDocumentVerifier } from "./documentDiscoveryEvidence";
import type { DiscoverContainerDocumentsOptions } from "./documentDiscoveryTypes";

for (const scope of ["single", "all"] as const) {
  for (const phase of ["listing", "head", "commit"] as const) {
    test(`${scope} discovery canceled during ${phase} keeps the other organization's watermark`, async () => {
      const { execSql, close } = await createTestExecSql(
        `discovery-reset-${scope}-${phase}`,
      );
      try {
        const store = createDocumentDiscoveryEvidenceStore(execSql);
        let reset = true;
        const maybeReset = async (currentPhase: typeof phase) => {
          if (!reset || currentPhase !== phase) return;
          reset = false;
          await getClientSQLitePersistenceRuntime(execSql).db.transaction(
            (tx) =>
              clearDocumentDiscoveryEvidenceOnRemoteReset(tx, {
                containerIds: ["org-a-container"],
                documentIds: [],
              }),
          );
        };
        const acknowledge = store.acknowledge;
        store.acknowledge = async (inputs, generation) => {
          await maybeReset("commit");
          await acknowledge(inputs, generation);
        };
        const at = "2026-09-23T00:00:00.000Z";
        const onFullListing = mock(() => {});
        const saveWatermark = mock(async () => {});
        const upsert = mock<
          DiscoverContainerDocumentsOptions["upsertDiscoveredDocuments"]
        >(async (inputs) =>
          inputs.map((input) => ({
            id: input.documentId,
            documentId: input.documentId,
            containerId: input.containerId,
            title: "doc",
            updatedAt: at,
          })),
        );
        const replaceLinks = mock(async () => {});
        const options: DiscoverContainerDocumentsOptions = {
          ...nullContainerDocumentWatermarks,
          containerId: "org-b-container",
          beginDocumentDiscovery: () => store.begin(),
          listContainerDocuments: async () => {
            await maybeReset("listing");
            return {
              hasMore: false,
              nextWatermark: { id: "doc", updatedAt: at },
              tombstones: [],
              items: [
                {
                  id: "doc",
                  createdAt: at,
                  updatedAt: at,
                  currentAccessEpoch: 1,
                  currentAccessStateHash: "signed-head",
                  linkedContainerIds: ["org-b-container"],
                  referencedPrincipals: [],
                },
              ],
            };
          },
          verifyDiscoveredDocuments: createDiscoveredDocumentVerifier(
            async () => {
              await maybeReset("head");
              return {
                accessEpoch: 1,
                accessStateHash: "signed-head",
                linkedContainerIds: ["org-b-container"],
              };
            },
            async () => 0,
            store,
          ),
          upsertDiscoveredDocuments: upsert,
          replaceDocumentLinksBatch: replaceLinks,
          saveContainerDocumentWatermark: saveWatermark,
          onFullListing,
        };
        const discover = () =>
          scope === "single"
            ? discoverContainerDocuments(options)
            : discoverAllContainerDocuments({
                ...options,
                containerIds: [options.containerId],
              });
        expect(await discover()).toBeNull();
        expect(saveWatermark).not.toHaveBeenCalled();
        expect(onFullListing).not.toHaveBeenCalled();
        expect(upsert).toHaveBeenCalledTimes(phase === "commit" ? 1 : 0);
        expect(replaceLinks).toHaveBeenCalledTimes(phase === "commit" ? 1 : 0);
        // The next pass can still discover B after A's reset; its lane was not
        // advanced past unstaged inputs and the local sequence stays monotone.
        expect(await discover()).toHaveLength(1);
        expect(saveWatermark).toHaveBeenCalledTimes(1);
        expect(await store.hasPending(["org-b-container"])).toBe(false);
      } finally {
        close();
      }
    });
  }
}
