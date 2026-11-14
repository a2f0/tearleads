import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { computeBlobContentKeyTargetHash } from "@tearleads/crypto";
import {
  bindForTest,
  buildBind,
} from "../../../test/helpers/blobAttachmentKit";
import {
  blobRewrapFixture,
  postBlobRewrap,
} from "../../../test/helpers/blobRewrapReadbackKit";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import { withDocumentMutationArtifacts } from "../../../test/helpers/documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createDocument } from "../../../test/helpers/keyingWriterProjectionKit";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { probeTransactions } from "../../../test/helpers/transactionProgress";
import { getLatestBlobContentKeyBundle } from "../../access/read/blobContentKeyStore";
import { storeBlobContentKeyBundleInTransaction } from "../../access/write/blobContentKeyStore";
import { createRouteApp } from "../../routeApp";

async function retiredSharedBlob() {
  const fixture = await blobRewrapFixture();
  const link = await buildDocumentLinkRequest({
    ...fixture,
    createdDocument: fixture.document,
    blobRewraps: [
      {
        blobId: fixture.blobId,
        contentKeyEpoch: 1,
        targets: [fixture.rootTarget, fixture.childTarget],
      },
    ],
  });
  const linked = await postBlobRewrap(fixture, "link", link);
  expect(linked.status).toBe(200);
  const unlink = await buildDocumentUnlinkRequest({
    ...fixture,
    linkedDocument: withDocumentMutationArtifacts(link, linked.body),
    blobRewraps: [
      {
        blobId: fixture.blobId,
        contentKeyEpoch: 1,
        targets: [fixture.rootTarget],
      },
    ],
  });
  const unlinked = await postBlobRewrap(fixture, "unlink", unlink);
  expect(unlinked.status).toBe(200);
  const second = await createDocument({
    owner: fixture.owner,
    root: fixture.root,
  });
  const shared = await buildBind({ ...fixture, document: second });
  await bindForTest({
    blobId: fixture.blobId,
    owner: fixture.owner,
    request: shared.request,
  });
  const before = await getLatestBlobContentKeyBundle(fixture.blobId, db);
  if (!before) throw new Error("Expected shared root targets");
  expect(before.targets).toHaveLength(2);
  return {
    fixture,
    second,
    before,
    document: withDocumentMutationArtifacts(unlink, {
      ...unlinked.body,
      createdAt: fixture.document.createdAt,
    }),
  };
}

test("consumed reconciliation returns authentic retired wraps rather than proposed material", async () => {
  const { fixture, second, before, document } = await retiredSharedBlob();
  const freshChild = {
    ...fixture.childTarget,
    wrappedKey: contentKeyEnvelopeFixture("Blob", "fresh-retired-child-wrap")
      .wrappedKey,
  };
  expect(freshChild.wrappedKey).not.toBe(fixture.childTarget.wrappedKey);
  const targets = [fixture.rootTarget, freshChild];
  const targetHash = await computeBlobContentKeyTargetHash(
    targets.map(
      ({ wrappedKey: _key, wrappingMetadata: _metadata, ...target }) => target,
    ),
  );
  const request = await buildDocumentLinkRequest({
    ...fixture,
    createdDocument: document,
    blobRewraps: [{ blobId: fixture.blobId, contentKeyEpoch: 1, targets }],
  });
  let consumed:
    | Awaited<ReturnType<typeof storeBlobContentKeyBundleInTransaction>>
    | undefined;
  let reached = 0;
  const observed = probeTransactions(db, {
    before: async (query, tx) => {
      if (!query.startsWith('update "blob_content_key_epochs"')) return;
      reached += 1;
      // The real signed link has updated its document head and acquired its
      // locks. Exercise the returning consumer on that same executor before
      // the ordinary rewrap persists; never fabricate a manifest or a row.
      consumed = await storeBlobContentKeyBundleInTransaction(
        {
          blobId: fixture.blobId,
          bindingId: fixture.rootTarget.bindingId,
          documentId: fixture.document.id,
          contentKeyEpoch: 1,
          targetHash,
          targets,
        },
        tx,
      );
    },
  });
  const response = await postBlobRewrap(
    fixture,
    "link",
    request,
    createRouteApp({ runtime: createServiceTestRuntime(observed.database) }),
  );
  expect(response.status).toBe(200);
  expect(reached).toBe(1);
  const stored = await getLatestBlobContentKeyBundle(fixture.blobId, db);
  const expected = [...before.targets, fixture.childTarget];
  expect(consumed?.targets).toHaveLength(3);
  expect(consumed?.targets).toEqual(expect.arrayContaining(expected));
  expect(stored?.targets).toEqual(consumed?.targets);
  expect(
    stored?.targets.filter((target) => target.documentId === second.id),
  ).toEqual(before.targets.filter((target) => target.documentId === second.id));
  expect(stored?.targetHash).toBe(consumed?.targetHash);
  expect(stored?.targetHash).not.toBe(before.targetHash);
});
