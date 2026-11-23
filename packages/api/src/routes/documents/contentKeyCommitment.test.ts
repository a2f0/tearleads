import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentContentKeyEpochs,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { asc, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { withDocumentMutationArtifacts } from "../../../test/helpers/documentAcknowledgementFixture";
import { CONTENT_KEY_COMMITMENT_FIXTURE } from "../../../test/helpers/documentEnvelopeFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { routeApp } from "../../routeApp";

const OTHER_COMMITMENT = "d".repeat(64);
const ROTATED_COMMITMENT = "e".repeat(64);
const ENVELOPE_MISMATCH =
  "Document update envelope does not commit to its epoch's content key";

async function ownedDocument() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  return { created, owner, root };
}

async function postJson(token: string, path: string, body: unknown) {
  return routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function storedCommitments(documentId: string) {
  return db
    .select({
      contentKeyCommitment: documentContentKeyEpochs.contentKeyCommitment,
      contentKeyEpoch: documentContentKeyEpochs.contentKeyEpoch,
    })
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, documentId))
    .orderBy(asc(documentContentKeyEpochs.contentKeyEpoch));
}

async function storedUpdateIds(documentId: string) {
  const rows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId));
  return rows.map((row) => row.id);
}

test("a document's first epoch stores the commitment its create declared", async () => {
  const { created } = await ownedDocument();
  expect(await storedCommitments(created.id)).toEqual([
    {
      contentKeyCommitment: CONTENT_KEY_COMMITMENT_FIXTURE,
      contentKeyEpoch: 1,
    },
  ]);
});

test("an update committing to another key than its epoch's is refused", async () => {
  const { created, owner, root } = await ownedDocument();
  const mismatched = await createSignedDocumentSyncRequest({
    contentKeyCommitment: OTHER_COMMITMENT,
    created,
    owner,
    root,
  });
  const refused = await postDocumentSync(owner, created.id, mismatched.request);
  expect(refused.status).toBe(400);
  expect((await refused.json()).error).toBe(ENVELOPE_MISMATCH);
  expect(await storedUpdateIds(created.id)).not.toContain(mismatched.updateId);

  const honest = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  expect(
    (await postDocumentSync(owner, created.id, honest.request)).status,
  ).toBe(200);
});

test("a link must repeat the commitment of the epoch it carries", async () => {
  const { created, owner, root } = await ownedDocument();
  const child = await createChildContainer({ parent: root, signer: owner });
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument: created,
    owner,
    root,
  });
  const refused = await postJson(owner.token, `/documents/${created.id}/link`, {
    ...linkRequest,
    contentKeyBundle: {
      ...linkRequest.contentKeyBundle,
      contentKeyCommitment: OTHER_COMMITMENT,
    },
  });
  expect(refused.status).toBe(400);
  expect((await refused.json()).error).toBe(
    "Document content-key commitment does not match its epoch",
  );
  expect(await storedCommitments(created.id)).toEqual([
    {
      contentKeyCommitment: CONTENT_KEY_COMMITMENT_FIXTURE,
      contentKeyEpoch: 1,
    },
  ]);

  const linked = await postJson(
    owner.token,
    `/documents/${created.id}/link`,
    linkRequest,
  );
  expect(linked.status).toBe(200);
});

test("an unlink opens its epoch under a new commitment its baseline must carry", async () => {
  const { created, owner, root } = await ownedDocument();
  const honest = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  expect(
    (await postDocumentSync(owner, created.id, honest.request)).status,
  ).toBe(200);
  const child = await createChildContainer({ parent: root, signer: owner });
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument: created,
    owner,
    root,
  });
  const linkResponse = await postJson(
    owner.token,
    `/documents/${created.id}/link`,
    linkRequest,
  );
  expect(linkResponse.status).toBe(200);
  const linkedDocument = withDocumentMutationArtifacts(
    linkRequest,
    await linkResponse.json(),
  );
  const unlink = (rotationBaselineContentKeyCommitment?: string) =>
    buildDocumentUnlinkRequest({
      child,
      contentKeyCommitment: ROTATED_COMMITMENT,
      linkedDocument,
      owner,
      root,
      rotationBaselineContentKeyCommitment,
    });

  // A baseline still encrypted under the old key would leave every reader of
  // the new epoch unable to open the history it carries.
  const refused = await postJson(
    owner.token,
    `/documents/${created.id}/unlink`,
    await unlink(CONTENT_KEY_COMMITMENT_FIXTURE),
  );
  expect(refused.status).toBe(400);
  expect((await refused.json()).error).toBe(ENVELOPE_MISMATCH);

  const unlinked = await postJson(
    owner.token,
    `/documents/${created.id}/unlink`,
    await unlink(),
  );
  expect(unlinked.status).toBe(200);
  expect(await storedCommitments(created.id)).toEqual([
    {
      contentKeyCommitment: CONTENT_KEY_COMMITMENT_FIXTURE,
      contentKeyEpoch: 1,
    },
    { contentKeyCommitment: ROTATED_COMMITMENT, contentKeyEpoch: 2 },
  ]);
});
