import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import {
  isDocumentEditAttributionResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
  isListContainerDocumentsResponse,
  isPrincipalPolicyBundleResponse,
} from "@symcrypt/validators/response";
import invariant from "invariant";
import { authenticate } from "../../test/helpers/authenticate";
import {
  readContainerParentLanePage,
  requestContainerParentLanes,
} from "../../test/helpers/containerParentLaneQuery";
import { createSignedDocumentSyncRequest } from "../../test/helpers/documentUpdateRequests";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  buildRootGrantRequest,
  createDocument,
  type StoredRootFixture,
} from "../../test/helpers/keyingWriterProjectionKit";
import { addUserToAdminGroup } from "../../test/helpers/organizationAdmin";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

type GrantKind = "direct user" | "rotated group";

async function registerAndAuthenticate(user: TestUser): Promise<void> {
  await registerUser(user);
  await authenticate(user);
}

async function postJson(path: string, token: string, body: unknown) {
  return routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function grantColdReader(input: {
  grantKind: GrantKind;
  owner: TestUser;
  reader: TestUser;
  root: StoredRootFixture;
}): Promise<void> {
  if (input.grantKind === "rotated group") {
    await addUserToAdminGroup({
      actor: input.owner,
      member: input.reader,
      organizationId: asVerifiedContainerManifest(input.root.bundle).state
        .organizationId,
    });
    return;
  }

  const grantRequest = await buildRootGrantRequest({
    accessLevel: "read",
    previous: input.root.bundle,
    previousKekState: input.root.kekState,
    recipient: input.reader,
    signer: input.owner,
  });
  const response = await postJson(
    `/containers/${input.root.kekState.containerId}/share`,
    input.owner.token,
    grantRequest,
  );
  expect(response.status, await response.clone().text()).toBe(200);
}

for (const grantKind of ["direct user", "rotated group"] as const) {
  test(`a cold reader can discover, sync, and attribute a document through a ${grantKind} grant`, async () => {
    const owner = createTestUser();
    const reader = createTestUser();
    await registerAndAuthenticate(owner);
    await registerAndAuthenticate(reader);
    const root = await bootstrapRoot(owner);
    const created = await createDocument({ owner, root });
    const { request: writeRequest, updateId } =
      await createSignedDocumentSyncRequest({ created, owner, root });
    const writeResponse = await postJson(
      `/documents/${created.id}/sync`,
      owner.token,
      writeRequest,
    );
    expect(writeResponse.status).toBe(200);

    await grantColdReader({ grantKind, owner, reader, root });

    const rootLaneResponse = await requestContainerParentLanes(reader.token, [
      { laneId: "root", parentId: null },
    ]);
    expect(rootLaneResponse.status).toBe(200);
    const rootLane = await readContainerParentLanePage(
      rootLaneResponse,
      "root",
    );
    const discoveredRoot = rootLane.items.find(
      (container) => container.id === root.kekState.containerId,
    );
    invariant(discoveredRoot, "expected the granted root in cold discovery");
    for (const reference of discoveredRoot.metadataReferencedPrincipals) {
      const policyResponse = await routeApp.request(
        `/principals/${reference.principalType}/${reference.principalId}/policy`,
        { headers: { Authorization: `Bearer ${reader.token}` } },
      );
      expect(policyResponse.status).toBe(200);
      const policy: unknown = await policyResponse.json();
      invariant(
        isPrincipalPolicyBundleResponse(policy),
        "expected a referenced principal policy",
      );
      expect(policy.currentState).toEqual(
        expect.objectContaining({
          keyEpoch: reference.keyEpoch,
          principalId: reference.principalId,
          stateHash: reference.stateHash,
          version: reference.version,
        }),
      );
      if (
        grantKind === "rotated group" &&
        reference.principalType === "group"
      ) {
        expect(
          policy.currentMemberEnvelopes.envelopes.map(
            (envelope) => envelope.userId,
          ),
        ).toContain(reader.userId);
      }
    }
    if (grantKind === "rotated group") {
      expect(
        discoveredRoot.metadataReferencedPrincipals.some(
          (reference) =>
            reference.principalType === "group" && reference.keyEpoch > 1,
        ),
      ).toBe(true);
    }

    const documentsResponse = await routeApp.request(
      `/containers/${root.kekState.containerId}/documents`,
      { headers: { Authorization: `Bearer ${reader.token}` } },
    );
    expect(documentsResponse.status).toBe(200);
    const listedDocuments: unknown = await documentsResponse.json();
    invariant(
      isListContainerDocumentsResponse(listedDocuments),
      "expected a container document listing",
    );
    expect(listedDocuments.items.map((document) => document.id)).toContain(
      created.id,
    );

    const projectionResponse = await routeApp.request(
      `/documents/${created.id}/writer-projection`,
      { headers: { Authorization: `Bearer ${reader.token}` } },
    );
    expect(projectionResponse.status).toBe(200);
    const projection: unknown = await projectionResponse.json();
    invariant(
      isDocumentWriterProjectionResponse(projection),
      "expected a document reader projection",
    );
    const rootProjection = projection.authorizingContainerPaths.find(
      (path) => path.containerId === root.kekState.containerId,
    );
    invariant(rootProjection, "expected the granted root projection");
    const currentRootKek = rootProjection.containerKeks.find(
      (kek) => kek.containerId === root.kekState.containerId,
    );
    invariant(currentRootKek, "expected the granted root KEK");
    if (grantKind === "rotated group") {
      expect(currentRootKek.containerKeyEpoch).toBeGreaterThan(
        root.kekState.containerKeyEpoch,
      );
      expect(currentRootKek.keyring).not.toBeNull();
    }

    const syncResponse = await postJson(
      `/documents/${created.id}/sync`,
      reader.token,
      {
        contentKeyEpoch: projection.contentKeyBundle.contentKeyEpoch,
        expectedLinkSetManifestHash:
          projection.contentKeyBundle.linkSetManifestHash,
        expectedTargetHash: projection.contentKeyBundle.targetHash,
        localVersionVector: null,
        outgoingUpdates: [],
      } satisfies DocumentSyncRequest,
    );
    expect(syncResponse.status).toBe(200);
    const sync: unknown = await syncResponse.json();
    invariant(isDocumentSyncResponse(sync), "expected a document sync");
    expect(sync.updates.map((update) => update.id)).toContain(updateId);

    const attributionResponse = await routeApp.request(
      `/documents/${created.id}/attribution`,
      { headers: { Authorization: `Bearer ${reader.token}` } },
    );
    expect(attributionResponse.status).toBe(200);
    const attribution: unknown = await attributionResponse.json();
    invariant(
      isDocumentEditAttributionResponse(attribution),
      "expected document attribution",
    );
    expect(attribution.segments).toEqual([
      expect.objectContaining({
        authorityKind: "direct",
        writerKeyFingerprint: owner.fingerprint,
        writerUserId: owner.userId,
      }),
    ]);
  }, 20_000);
}
