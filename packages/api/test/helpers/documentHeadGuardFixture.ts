import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { getCurrentAccessManifestHead } from "../../src/access/read/accessManifestStore";
import { routeApp } from "../../src/routeApp";
import { loadCurrentDocumentManifest } from "../../src/workflows/documents/mutations/shared/verification";
import { authenticate } from "./authenticate";
import { withDocumentMutationArtifacts } from "./documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "./documentLinkMutation";
import { createChildContainer } from "./keyingWriterProjectionChild";
import { bootstrapRoot, createDocument } from "./keyingWriterProjectionKit";
import { registerUser } from "./registerUser";

/** Two independently verified stored heads of one real document, not fakes. */
export async function documentHeadGuardFixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const document = await createDocument({ owner, root });
  const previousManifest = await loadCurrentDocumentManifest(document.id, db);
  const previousHead = await getCurrentAccessManifestHead(
    "document",
    document.id,
    db,
  );
  invariant(previousHead, "expected initial head");
  const link = await buildDocumentLinkRequest({
    child,
    createdDocument: document,
    owner,
    root,
  });
  const headers = {
    Authorization: `Bearer ${owner.token}`,
    "Content-Type": "application/json",
  };
  const response = await routeApp.request(`/documents/${document.id}/link`, {
    method: "POST",
    headers,
    body: JSON.stringify(link),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json();
  invariant(
    isDocumentLinkSetMutationResponse(body),
    "expected linked document",
  );
  const currentManifest = await loadCurrentDocumentManifest(document.id, db);
  const currentHead = await getCurrentAccessManifestHead(
    "document",
    document.id,
    db,
  );
  invariant(currentHead, "expected advanced head");
  expect(currentManifest.manifestHash).not.toBe(previousManifest.manifestHash);
  const nextRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument: withDocumentMutationArtifacts(link, body),
    owner,
    root,
  });
  return {
    child,
    currentHead,
    currentManifest,
    document,
    nextRequest,
    previousHead,
    previousManifest,
    root,
    unlink: () =>
      Promise.resolve(
        routeApp.request(`/documents/${document.id}/unlink`, {
          method: "POST",
          headers,
          body: JSON.stringify(nextRequest),
        }),
      ),
  };
}
