import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../test/helpers/documentFixtures";
import { isDocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import { DocumentHistoryUnavailableError } from "../../data/documents/shared/projection";
import {
  DocumentRawHistoryUnavailableError,
  throwDocumentSyncContentKeyFailure,
  unwrapDocumentSyncResponseContentKeys,
} from "./syncContentKeys";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

function responseUpdate(id: string, writerUserId: string): SyncResponseUpdate {
  return {
    id,
    writeHeader: { contentKeyEpoch: 3, writerUserId },
  } as unknown as SyncResponseUpdate;
}

test("content-key epoch failures do not blame one of multiple writers", () => {
  const updateIds = [
    "550e8400-e29b-41d4-a716-4466554400aa",
    "550e8400-e29b-41d4-a716-4466554400ab",
  ];
  const updates = [
    responseUpdate(updateIds[0] ?? "missing", "writer-a"),
    responseUpdate(updateIds[1] ?? "missing", "writer-b"),
  ];

  let isolated: unknown;
  try {
    throwDocumentSyncContentKeyFailure({
      cause: new Error("Content-key epoch could not be unwrapped"),
      updates,
    });
  } catch (error) {
    isolated = error;
  }

  expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
  if (!isDocumentSyncUpdateIsolationError(isolated)) return;
  expect(isolated.attribution).toBe("batch");
  expect(isolated.batchUpdateIds).toEqual(updateIds);
  expect(isolated.stage).toBe("content_key");
  expect(isolated.updateId).toBeNull();
  expect(isolated.writerUserId).toBeNull();
});

test("damaged predecessor history preserves its nested verification error", () => {
  const verificationError = new KeyingVerificationError(
    "missing_dependency",
    "Damaged predecessor keyring omitted a committed epoch",
  );
  const historyError = new DocumentHistoryUnavailableError(verificationError);

  let thrown: unknown;
  try {
    throwDocumentSyncContentKeyFailure({
      cause: historyError,
      updates: [
        responseUpdate("550e8400-e29b-41d4-a716-4466554400aa", "writer-a"),
      ],
    });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBe(verificationError);
});

test("raw history reports the lowest unavailable epoch regardless of response order", async () => {
  const fixture = await createMaterializedSyncFixture();
  const materializedPlan = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [
      createPendingUpdateRecord({
        id: "550e8400-e29b-41d4-a716-446655440451",
      }),
      createPendingUpdateRecord({
        id: "550e8400-e29b-41d4-a716-446655440452",
      }),
    ],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  const response = await createSyncResponse(materializedPlan.plan);
  const [epochTwoUpdate, epochOneUpdate] = response.updates;
  if (!epochTwoUpdate || !epochOneUpdate) {
    throw new Error("Expected two response updates");
  }
  const currentBundle = {
    ...response.contentKeyBundle,
    contentKeyEpoch: 3,
  };
  const reversedEpochResponse = {
    ...response,
    contentKeyBundle: currentBundle,
    contentKeyBundles: [currentBundle],
    updates: [
      {
        ...epochTwoUpdate,
        writeHeader: { ...epochTwoUpdate.writeHeader, contentKeyEpoch: 2 },
      },
      {
        ...epochOneUpdate,
        writeHeader: { ...epochOneUpdate.writeHeader, contentKeyEpoch: 1 },
      },
    ],
  };

  const error = await unwrapDocumentSyncResponseContentKeys({
    currentContentKey: fixture.contentKey,
    currentContentKeyEpoch: 3,
    historyMode: "raw",
    response: reversedEpochResponse,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  }).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  expect(error).toBeInstanceOf(DocumentRawHistoryUnavailableError);
  expect((error as DocumentRawHistoryUnavailableError).contentKeyEpoch).toBe(1);
});
