import { expect, test } from "bun:test";
import {
  db,
  getDefaultApiDatabaseKind,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { withDocumentMutationArtifacts } from "../../../test/helpers/documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentAccessManifestHead } from "../../access/read/accessManifestStore";
import { listDocumentsCurrentlyLinkedToContainers } from "../../access/read/currentDocumentLinks";
import { routeApp } from "../../routeApp";

function post(token: string, path: string, body: unknown) {
  return routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test.each(["link", "unlink"] as const)(
  "%s reuses the rows selected by its unchanged head lock plan",
  async (operation) => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const child = await createChildContainer({ parent: root, signer: owner });
    const document = await createDocument({ owner, root });
    const link = await buildDocumentLinkRequest({
      child,
      createdDocument: document,
      owner,
      root,
    });
    let request = link;
    if (operation === "unlink") {
      const response = await post(
        owner.token,
        `/documents/${document.id}/link`,
        link,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = await response.json();
      invariant(
        isDocumentLinkSetMutationResponse(body),
        "expected link response",
      );
      request = await buildDocumentUnlinkRequest({
        child,
        linkedDocument: withDocumentMutationArtifacts(link, body),
        owner,
        root,
      });
    }
    const counter = { statements: 0 };
    const response = await withDatabaseStatementCounter(counter, () =>
      post(owner.token, `/documents/${document.id}/${operation}`, request),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    invariant(
      isDocumentLinkSetMutationResponse(body),
      "expected mutation response",
    );
    expect(body.id).toBe(document.id);
    expect(body.manifestHash).toBe(request.expectedManifestHash);
    expect(body.targetHash).toBe(request.contentKeyBundle.targetHash);
    expect(
      (await getCurrentAccessManifestHead("document", document.id, db))
        ?.manifestHash,
    ).toBe(request.expectedManifestHash);
    expect(
      await listDocumentsCurrentlyLinkedToContainers([child.containerId], db),
    ).toEqual(operation === "link" ? [document.id] : []);
    // Preauthorization stops at the first sorted readable target. Visiting the
    // child first loads its parent in a second round trip; this is independent
    // of the four head reads removed after the lock frontier.
    const childFirst =
      operation === "unlink" && child.containerId < root.kekState.containerId;
    console.info(
      "locked-head-link-set",
      JSON.stringify({
        operation,
        childFirst,
        statements: counter.statements,
      }),
    );
    expect(counter.statements).toBeLessThanOrEqual(
      (operation === "link" ? 45 : 49) +
        Number(childFirst) +
        (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
    );
  },
  30_000,
);
