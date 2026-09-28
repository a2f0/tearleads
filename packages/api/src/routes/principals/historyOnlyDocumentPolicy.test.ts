import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  createRemoteDocument,
  syncRemoteDocument,
  validateDocumentSyncUpdateImports,
} from "@tearleads/client-sdk";
import {
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  encryptWithDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { DocumentWriterProjectionResponseSchema } from "@tearleads/validators/response";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import {
  coldRematerializeEncryptedDocument,
  writerResolver,
} from "../../../test/helpers/coldSdkRematerialization";
import { grantContainerThroughReadGroup } from "../../../test/helpers/containerGroupGrant";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createChildContainerFixture } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { expectPublicProjectionPolicyEvidence } from "../../../test/helpers/projectionPolicyEvidenceAssertions";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { routeApp } from "../../routeApp";

test("an organization member verifies a document's inaccessible sibling-container citation", async () => {
  const owner = createTestUser();
  const reader = createTestUser();
  await registerAndAuthenticate(owner, reader);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const children = [];
  for (const member of [reader, undefined]) {
    const child = await createChildContainerFixture({
      parent: root,
      signer: owner,
    });
    const grant = await grantContainerThroughReadGroup({
      actor: owner,
      member,
      container: {
        bundle: accessManifestFromContainerResponse(child.response),
        kekState: kekStateFromContainerResponse(child.response),
        plaintextKek: child.plaintextKek,
      },
      parentKekState: root.kekState,
      parentPath: [root.bundle],
    });
    children.push({ ...grant, plaintextKek: child.plaintextKek });
  }
  const [readable, sibling] = children;
  if (!readable || !sibling)
    throw new Error("Expected two group-granted children");
  const context = await createAncestorSdkContext(owner, organizationId, reader);
  try {
    const created = await createRemoteDocument({
      ...context.common,
      containerId: sibling.response.containerId,
    });
    if (!created?.response) throw new Error("Expected sibling document");
    const document = await createDocument(
      `historical-citation-${crypto.randomUUID()}`,
    );
    const before = encodeVersionVector(document);
    document
      .getText("text")
      .update("content behind the historical sibling citation");
    const updateData = exportUpdatesSince(document, before);
    const vectors = getUpdateVersionVectors(updateData);
    const updateId = crypto.randomUUID();
    const written = await syncRemoteDocument({
      ...context.common,
      documentId: created.documentId,
      localVersionVector: null,
      resolveWriterPublicKey: writerResolver(owner),
      validateIncomingUpdates: ({ decryptedUpdates, response }) =>
        validateDocumentSyncUpdateImports({
          currentDocument: document,
          decryptedUpdates,
          responseUpdates: response.updates,
        }),
      writerProjection: created.writerProjection,
      pendingUpdates: [
        { id: updateId, ...vectors, updateData: bytesToBase64(updateData) },
      ],
    });
    expect(written?.settledPendingUpdateIds).toContain(updateId);
    const request = await buildDocumentLinkRequest({
      child: readable.response,
      createdDocument: created.response,
      owner,
      root,
      authorizingContainerPath: [root.bundle, sibling.response.accessManifest],
    });
    const wrapped = await encryptWithDek(
      created.contentKey,
      readable.plaintextKek,
    );
    const envelope = request.contentKeyBundle.targets.find(
      (target) => target.containerId === readable.response.containerId,
    );
    if (!envelope) throw new Error("Expected readable target");
    envelope.wrappedKey = bytesToBase64(wrapped.ciphertext);
    envelope.wrappingMetadata = {
      suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
      iv: bytesToBase64(wrapped.iv),
    };
    const linked = await routeApp.request(
      `/documents/${created.documentId}/link`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );
    expect(linked.status, await linked.clone().text()).toBe(200);
    // Active roster membership permits group policy reads, but never grants
    // access to this sibling container's content.
    expect((await getPolicy(reader, "group", sibling.groupId)).status).toBe(
      200,
    );
    const inaccessible = await routeApp.request(
      `/containers/${sibling.response.containerId}/writer-projection`,
      {
        headers: { Authorization: `Bearer ${reader.token}` },
      },
    );
    expect(inaccessible.status).toBe(403);
    const served = await routeApp.request(
      `/documents/${created.documentId}/writer-projection`,
      { headers: { Authorization: `Bearer ${reader.token}` } },
    );
    expect(served.status).toBe(200);
    const projection = DocumentWriterProjectionResponseSchema.parse(
      await served.json(),
    );
    expectPublicProjectionPolicyEvidence(projection.policyEvidence);
    expect(
      projection.policyEvidence.groups.some(
        (group) => group.currentState.principalId === sibling.groupId,
      ),
    ).toBe(true);
    for (const path of projection.authorizingContainerPaths)
      expect(path).not.toHaveProperty("policyEvidence");

    const recovered = await coldRematerializeEncryptedDocument({
      documentId: created.documentId,
      organizationId,
      owner,
      reader: reader,
    });
    expect(recovered.recoveredText).toBe(
      "content behind the historical sibling citation",
    );
    expect(recovered.updateIds).toEqual([updateId]);
    expect((await getPolicy(reader, "group", sibling.groupId)).status).toBe(
      200,
    );
  } finally {
    context.close();
  }
}, 30_000);
