import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { createLinkSetResponseFromRequest } from "../../../../test/helpers/data/documentFixtures";
import {
  linkLegFixture,
  linkSetRefusal,
} from "../../../../test/helpers/workflows/linkSetLegFixture";
import { createRemoteDocumentServiceFixture } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentConstants";
import type { DocumentLinkSetMutationFailure } from "../../../data/documents/shared/types";
import { documentMayHaveAttachments } from "../../../data/persistence/documents/documentAttachmentPresence";
import { ensureDocumentsSchema } from "../../../data/persistence/documents/internal/ensureDocumentsSchema";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../../data/sqlite/schema/documentAttachmentSchema";
import { documents } from "../../../data/sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

type LocalView =
  | "absent"
  | "empty"
  | "held"
  | "detached"
  | "pending"
  | "metadata";

const ATTACHMENTS_CHANGED: DocumentLinkSetMutationFailure = {
  code: DOCUMENT_MUTATION_ERROR_CODES.linkAttachmentsChanged,
  message:
    "Document attachments changed; retry the link with current blob keys",
  status: 409,
};

async function seedLocalView(
  execSql: ExecSql,
  documentId: string,
  view: LocalView,
): Promise<void> {
  if (view === "absent") return;
  await ensureDocumentsSchema(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const localId = `${documentId}-local`;
  const now = new Date().toISOString();
  await db
    .insert(documents)
    .values({
      appKind: view === "metadata" ? "container-metadata" : DOCUMENTS_APP_KIND,
      documentId,
      localId,
      updatedAt: now,
    })
    .run();
  const attachment = {
    byteLength: 1,
    contentSha256: "digest",
    localId,
    mimeType: null,
    slotId: "slot",
    storageKey: `${localId}-bytes`,
  };
  if (view === "held" || view === "detached") {
    await db
      .insert(documentAttachmentBlobProjection)
      .values({
        ...attachment,
        blobId: "blob",
        detachedAt: view === "detached" ? now : null,
        updatedAt: now,
      })
      .run();
  }
  if (view === "pending") {
    await db
      .insert(documentPendingAttachments)
      .values({ ...attachment, createdAt: now, name: "file.txt" })
      .run();
  }
}

async function runLinkLeg(
  name: string,
  input: {
    readonly refusals: readonly DocumentLinkSetMutationFailure[];
    readonly view: LocalView;
  },
) {
  const leg = await linkLegFixture(name);
  const { close, execSql } = await createTestExecSql(name);
  const documentId = leg.writerProjection.documentId;
  await seedLocalView(execSql, documentId, input.view);
  const failures: DocumentLinkSetMutationFailure[] = [];
  const counts = { listings: 0, refreshedListings: 0, submissions: 0 };
  try {
    const result = await createRemoteDocumentServiceFixture({
      api: createMockApiClient({
        listDocumentAttachments: async (_documentId, options) => {
          counts.listings += 1;
          if (options?.refresh) counts.refreshedListings += 1;
          return [];
        },
        getContainerWriterProjection: async () => leg.sibling,
        getDocumentWriterProjection: async () => leg.writerProjection,
        primeDocumentWriterProjection: () => {},
        linkDocumentResult: async (requestDocumentId, request) => {
          const refusal = input.refusals[counts.submissions];
          counts.submissions += 1;
          return refusal
            ? linkSetRefusal(requestDocumentId, refusal)
            : {
                data: await createLinkSetResponseFromRequest(
                  requestDocumentId,
                  request,
                ),
                ok: true as const,
              };
        },
      }),
      encapsulationSecretKey: leg.keyPair.secretKey,
      execSql,
    }).relinkRemoteDocument({
      author: leg.author,
      documentId,
      onFailure: (failure) => failures.push(failure),
      operation: "link",
      resolveProjectionUserKey: leg.resolveProjectionUserKey,
      targetContainerId: leg.sibling.containerId,
    });
    return { ...counts, failures, result };
  } finally {
    close();
  }
}

test("only a held document without a local attachment row skips the listing", async () => {
  const { close, execSql } = await createTestExecSql("attachment-presence");
  try {
    const answers: Record<string, boolean> = {};
    for (const view of [
      "absent",
      "empty",
      "held",
      "detached",
      "pending",
      "metadata",
    ] as const) {
      const documentId = `presence-${view}`;
      await seedLocalView(execSql, documentId, view);
      answers[view] = await documentMayHaveAttachments(execSql, documentId);
    }
    expect(answers).toEqual({
      absent: true,
      detached: true,
      empty: false,
      held: true,
      metadata: true,
      pending: true,
    });
  } finally {
    close();
  }
});

test("a link of a document with no local attachment cites none without listing", async () => {
  const run = await runLinkLeg("skipped-listing", {
    refusals: [],
    view: "empty",
  });
  expect(run).toMatchObject({ failures: [], listings: 0, submissions: 1 });
  expect(run.result).not.toBeNull();
});

test.each(["absent", "held", "detached", "pending"] as const)(
  "a link lists the attachments when the local view is %s",
  async (view) => {
    const run = await runLinkLeg(`listed-${view}`, { refusals: [], view });
    expect(run).toMatchObject({
      failures: [],
      listings: 1,
      refreshedListings: 0,
      submissions: 1,
    });
    expect(run.result).not.toBeNull();
  },
);

test("a skipped listing the server refuses lists afresh and retries once", async () => {
  const run = await runLinkLeg("skipped-listing-refused", {
    refusals: [ATTACHMENTS_CHANGED],
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [],
    listings: 1,
    refreshedListings: 1,
    submissions: 2,
  });
  expect(run.result).not.toBeNull();
});

test("a refused retry is reported and not retried again", async () => {
  const run = await runLinkLeg("skipped-listing-refused-twice", {
    refusals: [ATTACHMENTS_CHANGED, ATTACHMENTS_CHANGED],
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [ATTACHMENTS_CHANGED],
    listings: 1,
    submissions: 2,
  });
  expect(run.result).toBeNull();
});

test("another refusal of a skipped listing keeps its own recovery path", async () => {
  const uncoded = { code: undefined, message: "Conflict", status: 409 };
  const run = await runLinkLeg("skipped-listing-other-refusal", {
    refusals: [uncoded],
    view: "empty",
  });
  expect(run).toMatchObject({
    failures: [uncoded],
    listings: 0,
    submissions: 1,
  });
  expect(run.result).toBeNull();
});
