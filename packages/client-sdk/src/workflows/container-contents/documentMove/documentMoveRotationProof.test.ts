import { expect, test } from "bun:test";
import {
  createDocument,
  emptyVersionVector,
  exportFullHistorySnapshot,
  getImportBlobMetadata,
  versionVectorsEqual,
} from "@tearleads/loro";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import type { DocumentMoveIntentRecord } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import type {
  DocumentLinkSetMutationFailure,
  DocumentRotationProofMode,
} from "../../documents";
import { moveWithRotationProof } from "./documentMoveRotationProof";

// The accepted unlink proved an empty history, so its cached snapshot yields a
// baseline-less unlink. A peer commits before the replay; the server's
// empty-frontier guard refuses with the stale-baseline code, and the replay
// proves again and retries with a real baseline.
test("a cached empty-history proof is re-proved after a peer commits", async () => {
  const emptyHistory = exportFullHistorySnapshot(
    await createDocument("empty-history-unlink"),
  );
  const peerEdited = await createDocument("empty-history-unlink");
  peerEdited.getText("text").update("peer content");
  peerEdited.commit();
  const proofs: DocumentRotationProofMode[] = [];
  const failures: DocumentLinkSetMutationFailure[] = [];
  const submitted: ("baseline" | "baseline-less")[] = [];

  const result = await moveWithRotationProof({
    attempt: async (rotationSnapshot, onFailure) => {
      const baselineLess = versionVectorsEqual(
        getImportBlobMetadata(rotationSnapshot).partialEndVersionVector,
        emptyVersionVector(),
      );
      submitted.push(baselineLess ? "baseline-less" : "baseline");
      if (!baselineLess) return "moved";
      onFailure({
        code: DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
        message:
          "Document unlink requires a rotation baseline covering committed updates",
        status: 409,
      });
      return null;
    },
    existingContainerId: "source",
    host: {
      openDocumentStore: () => ({
        assertCanRotateContentKey: async (proof) => {
          proofs.push(proof);
          return proof === "reuse"
            ? emptyHistory
            : exportFullHistorySnapshot(peerEdited);
        },
        ensureInitialized: async () => true,
      }),
    },
    intent: {
      documentId: "empty-history-document",
      localId: "empty-history-local",
      targetContainerId: "target",
    } as DocumentMoveIntentRecord,
    isCurrent: () => true,
    log: () => undefined,
    onFailure: (failure) => {
      failures.push(failure);
    },
  });

  expect(result).toBe("moved");
  expect(proofs).toEqual(["reuse", "prove"]);
  expect(submitted).toEqual(["baseline-less", "baseline"]);
  expect(failures).toEqual([]);
});
