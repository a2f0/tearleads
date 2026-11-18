import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import { authenticate } from "../../test/helpers/authenticate";
import { currentDocumentLinkRows } from "../../test/helpers/currentDocumentLinks";
import { withDocumentMutationArtifacts } from "../../test/helpers/documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

const FORGED_HASH = "f".repeat(64);

/**
 * A link-set request carries only the hash of the manifest it commits to; the
 * API derives the manifest from the signed event and its stored heads. A hash
 * that derivation does not produce is refused before anything is written.
 */
test("a link or unlink naming a hash its event does not derive is refused and changes nothing", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const post = (path: string, request: DocumentLinkSetMutationRequest) =>
    routeApp.request(`/documents/${createdDocument.id}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  const linkedIds = async () =>
    (await currentDocumentLinkRows(createdDocument.id))
      .map((row) => row.containerId)
      .sort();
  const expectRefused = async (response: Response) => {
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toContain(
      "document link-set manifest hash does not match derived state",
    );
  };

  const link = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  await expectRefused(
    await post("link", { ...link, expectedManifestHash: FORGED_HASH }),
  );
  expect(await linkedIds()).toEqual([root.kekState.containerId]);

  const linked = await post("link", link);
  expect(linked.status).toBe(200);
  const linkedDocument = withDocumentMutationArtifacts(
    link,
    await linked.json(),
  );
  const both = [root.kekState.containerId, child.containerId].sort();
  expect(await linkedIds()).toEqual(both);

  const unlink = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  await expectRefused(
    await post("unlink", { ...unlink, expectedManifestHash: FORGED_HASH }),
  );
  expect(await linkedIds()).toEqual(both);
  expect((await post("unlink", unlink)).status).toBe(200);
  expect(await linkedIds()).toEqual([root.kekState.containerId]);
});
