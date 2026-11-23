import { expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../test/helpers/data/blobUploadFixtures";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import type { BlobBytes } from "../../../data/blobs/blobContracts";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { readProcessedCursorForVersion } from "../../documents/sync/processedCursor";
import { MAX_DOCUMENT_VERSION_REFRESHES } from "./bindAtDocumentVersion";

// Only its presence on the wire matters here; the API validates the content.
const documentSync = {
  outgoingUpdates: [{ id: "550e8400-e29b-41d4-a716-446655440778" }],
} as unknown as DocumentSyncRequest;

const documentChanged = {
  code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
  kind: "http",
  message: "Document changed after the attachment slot was checked",
  status: 409,
} as const;

/** The binding generation moved: a refusal that is not retried. */
const bindingChanged = {
  kind: "http",
  message: "Attachment binding changed",
  status: 409,
} as const;

/**
 * Uploads with an API that refuses the first `refusals` binds because the
 * document advanced, and a caller whose slot check yields versions in turn.
 */
async function uploadAtDocumentVersions(input: {
  readonly carry?: boolean;
  /** A processed cursor this device recorded for the document. */
  readonly cursor?: {
    readonly throughUpdateId: string;
    readonly throughVersion: string;
  };
  readonly currentForBinds?: number;
  readonly refusal?: typeof documentChanged | typeof bindingChanged;
  readonly refusals: number;
  /** Binds past this many return null without recording a failure. */
  readonly silentAfter?: number;
  readonly versions: readonly (string | null)[];
}) {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = crypto.randomUUID();
  const multipart = createMultipartBlobStageFixture({
    stageId: `stage-${blobId}`,
  });
  const { getAssembledBytes: _bytes, ...multipartApi } = multipart;
  const binds: BlobAttachmentBindRequest[] = [];
  const checks: boolean[] = [];
  const reported: string[] = [];
  let recordedFailure:
    | ((typeof documentChanged | typeof bindingChanged) & {
        readonly report: () => void;
      })
    | null = null;
  const { close, execSql } = await createTestExecSql(`version-${blobId}`);
  try {
    if (input.cursor) {
      await ensureDocumentTables(execSql);
      await execSql(
        `INSERT INTO document_sync_progress (app_kind, local_id, document_id,
           through_update_id, through_version, judge)
         VALUES ('documents', 'local', ?, ?, ?, ?)`,
        [
          writerProjection.documentId,
          input.cursor.throughUpdateId,
          input.cursor.throughVersion,
          documentVerdictJudge(),
        ],
      );
    }
    const uploaded = await createBlobAttachmentServiceFixture({
      api: {
        ...multipartApi,
        bindBlobAttachment: async (requestBlobId, request) => {
          binds.push(request);
          if (binds.length > (input.silentAfter ?? Infinity)) return null;
          if (binds.length <= input.refusals) {
            const refusal = input.refusal ?? documentChanged;
            recordedFailure = {
              ...refusal,
              report: () => reported.push(refusal.message),
            };
            return null;
          }
          return createBlobAttachmentBindResponse({
            blobId: requestBlobId,
            documentManifest: writerProjection.documentManifest,
            request,
          });
        },
        getDocumentWriterProjection: async () => writerProjection,
        getRequestFailure: ({ method, path }) =>
          method === "POST" && path === `/blobs/${blobId}/attachment-bindings`
            ? recordedFailure
            : null,
      },
      encapsulationSecretKey: secretKey,
      execSql,
      processedCursorFor: (cursorInput) =>
        readProcessedCursorForVersion(execSql, cursorInput),
    }).uploadDocumentAttachment({
      author,
      blobId,
      bytes: new Uint8Array([4, 5, 6]) as BlobBytes,
      documentId: writerProjection.documentId,
      ...(input.carry ? { documentSync } : {}),
      expectedBindingId: null,
      resolveProjectionUserKey,
      slotId: "preview",
      stillCurrent: () => binds.length < (input.currentForBinds ?? Infinity),
      verifiedDocumentVersion: async ({ refresh }) => {
        checks.push(refresh);
        return input.versions[checks.length - 1] ?? null;
      },
    });
    return { binds, checks, reported, uploaded };
  } finally {
    close();
  }
}

test("a bind refused for a newer document re-checks the slot and binds at the newer version", async () => {
  const { binds, checks, uploaded } = await uploadAtDocumentVersions({
    refusals: 1,
    versions: ["checked", "pulled"],
  });

  expect(checks).toEqual([false, true]);
  expect(binds.map((bind) => bind.documentVersionVector)).toEqual([
    "checked",
    "pulled",
  ]);
  // The same signed bind is retried on the kept stage (the stage fixture
  // refuses a second initiation): only the version changes.
  const [first, second] = binds;
  if (!first || !second) throw new Error("Expected two binds");
  expect({ ...second, documentVersionVector: "checked" }).toEqual(first);
  expect(uploaded?.request.documentVersionVector).toBe("pulled");
});

test("a re-check that finds the slot changed abandons the bind", async () => {
  const { binds, checks, uploaded } = await uploadAtDocumentVersions({
    refusals: 1,
    versions: ["checked", null],
  });

  expect(checks).toEqual([false, true]);
  expect(binds).toHaveLength(1);
  expect(uploaded).toBeNull();
});

test("a document that keeps changing stops the attempt after bounded pulls", async () => {
  const versions = Array.from(
    { length: MAX_DOCUMENT_VERSION_REFRESHES + 5 },
    (_, index) => `version-${index}`,
  );
  const { binds, checks, uploaded } = await uploadAtDocumentVersions({
    refusals: versions.length,
    versions,
  });

  expect(checks).toHaveLength(MAX_DOCUMENT_VERSION_REFRESHES + 1);
  expect(binds).toHaveLength(MAX_DOCUMENT_VERSION_REFRESHES + 1);
  expect(uploaded).toBeNull();
});

test("a bind refused for a newer document keeps the update it carries", async () => {
  const { binds, uploaded } = await uploadAtDocumentVersions({
    carry: true,
    refusals: 1,
    versions: ["checked", "pulled"],
  });

  expect(binds.map((bind) => bind.documentSync)).toEqual([
    documentSync,
    documentSync,
  ]);
  expect(uploaded?.request.documentSync).toEqual(documentSync);
});

test("a bind that stops being current never reads an earlier refusal", async () => {
  // The API client keeps reporting a document-changed refusal, but once the
  // call is stale no further bind is sent, so nothing asks for a pull.
  const { binds, checks, uploaded } = await uploadAtDocumentVersions({
    currentForBinds: 1,
    refusals: 1,
    versions: ["checked", "pulled"],
  });

  expect(checks).toEqual([false]);
  expect(binds).toHaveLength(1);
  expect(uploaded).toBeNull();
});

test("a bind that records no failure never reads an earlier refusal", async () => {
  // The retry is retired without a response (as during session renewal), so
  // the client still holds the first bind's refusal.
  const { binds, checks, uploaded } = await uploadAtDocumentVersions({
    refusals: 1,
    silentAfter: 1,
    versions: ["checked", "pulled", "again"],
  });

  expect(checks).toEqual([false, true]);
  expect(binds).toHaveLength(2);
  expect(uploaded).toBeNull();
});

test("only a refusal the call does not retry is reported", async () => {
  const retried = await uploadAtDocumentVersions({
    refusals: 1,
    versions: ["checked", "pulled"],
  });
  expect(retried.uploaded?.request.documentVersionVector).toBe("pulled");
  expect(retried.reported).toEqual([]);

  const refused = await uploadAtDocumentVersions({
    refusal: bindingChanged,
    refusals: 1,
    versions: ["checked", "pulled"],
  });
  expect(refused.checks).toEqual([false]);
  expect(refused.uploaded).toBeNull();
  expect(refused.reported).toEqual([bindingChanged.message]);
});

test("each bind carries the processed cursor its version covers, and only that one", async () => {
  const throughUpdateId = "550e8400-e29b-41d4-a716-446655440779";
  const judged = encodeVersionVectorCounters({ "1": 4, "2": 2 });
  const { binds, uploaded } = await uploadAtDocumentVersions({
    cursor: { throughUpdateId, throughVersion: judged },
    refusals: 2,
    versions: [
      // Recorded before the cursor's pull finished: it lacks updates the
      // cursor stands for, so the bind is checked by version alone.
      encodeVersionVectorCounters({ "1": 4 }),
      judged,
      encodeVersionVectorCounters({ "1": 5, "2": 2, "3": 1 }),
    ],
  });

  expect(binds.map((bind) => bind.processedThroughUpdateId)).toEqual([
    undefined,
    throughUpdateId,
    throughUpdateId,
  ]);
  expect(uploaded?.request.processedThroughUpdateId).toBe(throughUpdateId);
});
