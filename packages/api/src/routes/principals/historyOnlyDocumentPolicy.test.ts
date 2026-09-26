import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { createRemoteDocument } from "@tearleads/client-sdk";
import {
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  encryptWithDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { coldRematerializeEncryptedDocument } from "../../../test/helpers/coldSdkRematerialization";
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
  stripOrganizationMembership,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { routeApp } from "../../routeApp";

test("a non-roster guest verifies a document's inaccessible sibling-group citation", async () => {
  const owner = createTestUser();
  const guest = createTestUser();
  await registerAndAuthenticate(owner, guest);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const children = [];
  for (const member of [guest, undefined]) {
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
  const context = await createAncestorSdkContext(owner, organizationId, guest);
  try {
    const created = await createRemoteDocument({
      ...context.common,
      containerId: sibling.response.containerId,
    });
    if (!created?.response) throw new Error("Expected sibling document");
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
    await stripOrganizationMembership(organizationId, guest.userId);
    expect((await getPolicy(guest, "group", sibling.groupId)).status).toBe(403);
    const inaccessible = await routeApp.request(
      `/containers/${sibling.response.containerId}/writer-projection`,
      {
        headers: { Authorization: `Bearer ${guest.token}` },
      },
    );
    expect(inaccessible.status).toBe(403);
    const recovered = await coldRematerializeEncryptedDocument({
      documentId: created.documentId,
      organizationId,
      owner,
      reader: guest,
    });
    expect(recovered.recoveredText).toBe("");
    expect(recovered.updateIds).toEqual([]);
    expect((await getPolicy(guest, "group", sibling.groupId)).status).toBe(403);
  } finally {
    context.close();
  }
}, 30_000);
