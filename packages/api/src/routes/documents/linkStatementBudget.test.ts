import { expect, test } from "bun:test";
import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import { readKeyingCanonicalJson } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function counted<T>(work: () => Promise<T>) {
  const counter = { statements: 0 };
  const result = await withDatabaseStatementCounter(counter, work);
  return { result, statements: counter.statements };
}

test("linking a document with k attachments stays within its statement budget", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const childKek = await kekStateFromContainerResponse(child);

  const linkWithAttachments = async (attachments: number) => {
    const document = await createDocument({ owner, root });
    const blobRewraps = [];
    for (let index = 0; index < attachments; index += 1) {
      const blobId = crypto.randomUUID();
      const { request } = await buildBind({
        blobId,
        document,
        owner,
        root,
        slotId: `slot-${index}`,
        stagedBlob: await stageBlob(owner, blobId),
      });
      await bindForTest({ blobId, owner, request });
      const rawTarget = request.contentKeyBundle.targets[0];
      if (!rawTarget) throw new Error("Expected initial blob target");
      const target = {
        ...rawTarget,
        wrappingMetadata: readKeyingCanonicalJson(
          rawTarget.wrappingMetadata,
          "test wrap",
        ),
      };
      blobRewraps.push({
        blobId,
        contentKeyEpoch: 1,
        targets: [
          target,
          {
            ...target,
            containerId: child.containerId,
            containerManifestHash: childKek.accessManifestHash,
            containerKeyEpochId: childKek.containerKeyEpochId,
            containerKeyEpoch: childKek.containerKeyEpoch,
            wrappedKey: contentKeyEnvelopeFixture("Blob", `child-wrap-${index}`)
              .wrappedKey,
          },
        ],
      });
    }
    const link = await buildDocumentLinkRequest({
      child,
      createdDocument: document,
      owner,
      root,
      blobRewraps,
    });
    return counted(async () => {
      const response = await routeApp.request(
        `/documents/${document.id}/link`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${owner.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(link),
        },
      );
      return { body: await response.text(), status: response.status };
    });
  };

  // Warm the process-wide verification markers the first link records.
  await linkWithAttachments(0);
  const sweep = [];
  for (const attachments of [0, 1, 3]) {
    const linked = await linkWithAttachments(attachments);
    expect(linked.result).toMatchObject({ status: 200 });
    sweep.push(linked.statements);
  }
  // Measured with PGlite / SQLite (Postgres equals SQLite) at 0 / 1 / 3
  // attachments: 71 / 86 / 114 and 73 / 88 / 116 while each blob reread its
  // epoch rows and resolved its targets alone (+14 per blob); 66 / 79 / 87 and
  // 68 / 81 / 89 once the content-key stores stopped re-reading rows they held
  // and a link set-loads its rewrap preconditions (+4 per blob).
  expect(sweep).toHaveLength(3);
  expect(sweep[0]).toBeLessThanOrEqual(68);
  expect(sweep[1]).toBeLessThanOrEqual(81);
  expect(sweep[2]).toBeLessThanOrEqual(89);
}, 180_000);

test("a blob download stays within its statement budget", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  await bindForTest({ blobId, owner, request });
  const download = () =>
    counted(async () => {
      const response = await routeApp.request(`/blobs/${blobId}/download`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      return { body: await response.text(), status: response.status };
    });
  // Warm the process-wide verification markers the first read records.
  await download();
  const read = await download();
  expect(read.result).toMatchObject({ status: 200 });
  // Measured with PGlite, SQLite, and Postgres: 13 while the blob row was read
  // after access resolved; 12 once it loads with the bindings.
  expect(read.statements).toBeLessThanOrEqual(12);
}, 180_000);
