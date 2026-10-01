import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentContainerLinks } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { routeApp } from "../../routeApp";

async function linkedDocumentFixture(input: { readonly committed: boolean }) {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  if (input.committed) {
    const sync = await createSignedDocumentSyncRequest({
      created: createdDocument,
      owner,
      root,
    });
    expect(
      (await postDocumentSync(owner, createdDocument.id, sync.request)).status,
    ).toBe(200);
  }
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  // A link that advances the epoch carries no rotation baseline.
  const advancedLink = {
    ...linkRequest,
    contentKeyBundle: {
      ...linkRequest.contentKeyBundle,
      contentKeyEpoch: linkRequest.contentKeyBundle.contentKeyEpoch + 1,
    },
  };
  const response = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(advancedLink),
    },
  );
  return { child, createdDocument, response, root };
}

test("a link cannot advance the content-key epoch past committed updates", async () => {
  const { createdDocument, response, root } = await linkedDocumentFixture({
    committed: true,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error:
      "Document link cannot rotate the content key; committed updates need a rotation baseline",
  });
  const links = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, createdDocument.id));
  expect(links.map((link) => link.containerId)).toEqual([
    root.kekState.containerId,
  ]);
});

test("a document with no committed updates has no history to strand", async () => {
  const { response } = await linkedDocumentFixture({ committed: false });

  expect(response.status).toBe(200);
});
