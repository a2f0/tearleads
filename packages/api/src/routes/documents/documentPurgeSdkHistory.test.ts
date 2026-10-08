import { expect, spyOn, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestUser } from "@tearleads/bob-and-alice";
import { syncRemoteDocument } from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  isDocumentLinkSetMutationResponse,
  isDocumentPurgeProofResponse,
} from "@tearleads/validators/response";
import {
  documentAuthor,
  trustedResolver,
  writerResolver,
} from "../../../test/helpers/coldSdkRematerialization";
import { grantContainerThroughReadGroup } from "../../../test/helpers/containerGroupGrant";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import { createChildContainerFixture } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { createPagedColdPolicyWarmer } from "../../../test/helpers/pagedColdPolicyWarmer";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { routeApp } from "../../routeApp";

test("a fresh and then pinned SDK accepts API purge history with an old group-only citation", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const groupedChild = await createChildContainerFixture({
    parent: root,
    signer: owner,
  });
  const grouped = await grantContainerThroughReadGroup({
    actor: owner,
    container: {
      bundle: accessManifestFromContainerResponse(groupedChild.response),
      kekState: kekStateFromContainerResponse(groupedChild.response),
      plaintextKek: groupedChild.plaintextKek,
    },
    parentKekState: root.kekState,
    parentPath: [root.bundle],
  });
  const later = await createChildContainerFixture({
    parent: root,
    signer: owner,
  });
  const created = await createDocument({ owner, root });
  let current = created;
  // The second link/unlink pair leaves the group's container cited only by
  // older document events, never by the terminal head or purge path.
  for (const child of [grouped.response, later.response]) {
    const link = await routeApp.request(`/documents/${created.id}/link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildDocumentLinkRequest({
          child,
          createdDocument: current,
          owner,
          root,
        }),
      ),
    });
    expect(link.status, await link.clone().text()).toBe(200);
    const linked: unknown = await link.json();
    if (!isDocumentLinkSetMutationResponse(linked))
      throw new Error("Expected document link");
    const unlink = await routeApp.request(`/documents/${created.id}/unlink`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildDocumentUnlinkRequest({
          child,
          linkedDocument: linked,
          owner,
          root,
        }),
      ),
    });
    expect(unlink.status, await unlink.clone().text()).toBe(200);
    const unlinked: unknown = await unlink.json();
    if (!isDocumentLinkSetMutationResponse(unlinked))
      throw new Error("Expected document unlink");
    current = { ...unlinked, createdAt: created.createdAt };
  }
  const purged = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: current.accessManifest.manifestHash,
    owner,
    root,
  });
  expect(purged.status, await purged.clone().text()).toBe(200);

  const database = await createTestExecSql("api-purge-historical-policy");
  const apiClient = new ApiClient("http://purge-history.test");
  apiClient.setAuthToken(owner.token);
  const originalFetch = globalThis.fetch;
  const fetchHandler = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith("http://purge-history.test/")
      ? Promise.resolve(
          routeApp.request(
            input instanceof URL ? input.toString() : input,
            init,
          ),
        )
      : originalFetch(input, init);
  };
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fetchHandler, { preconnect: originalFetch.preconnect }),
  );
  const recovery = createPagedColdPolicyWarmer({
    apiClient,
    execSql: database.execSql,
    resolveTrustedUserIdentity: trustedResolver(owner),
    onResolve: () => {},
  });
  try {
    const proof = await apiClient.getDocumentPurgeProof(created.id);
    if (!isDocumentPurgeProofResponse(proof))
      throw new Error("Expected API purge proof");
    expect(proof.documentManifestPredecessors).toHaveLength(4);
    expect(
      proof.policyEvidence.groups.some(
        (policy) => policy.head.principalId === grouped.groupId,
      ),
    ).toBe(true);
    const terminalCitations = Reflect.get(
      proof.documentManifest.event.event,
      "dependencyManifestHashes",
    );
    expect(Array.isArray(terminalCitations)).toBe(true);
    expect(terminalCitations).not.toContain(
      grouped.response.accessManifest.manifestHash,
    );
    let deletions = 0;
    for (const expectedDeletions of [1, 2]) {
      const response = await syncRemoteDocument({
        apiClient,
        author: documentAuthor(owner, organizationId),
        documentId: created.id,
        execSql: database.execSql,
        resolveProjectionUserKey: trustedResolver(owner),
        warmReferencedPrincipalPolicies: recovery.warmer,
        localVersionVector: null,
        pendingUpdates: [],
        targetSecretKey: owner.kem.secretKey,
        resolveWriterPublicKey: writerResolver(owner),
        validateIncomingUpdates: () => {
          throw new Error("Purged document returned updates");
        },
        onRemoteDocumentDeleted: async ({ commitPurgeProof }) => {
          if (!commitPurgeProof)
            throw new Error("Deletion must carry verified proof");
          await commitPurgeProof(database.execSql);
          deletions += 1;
        },
      });
      expect(response).toBeNull();
      expect(deletions).toBe(expectedDeletions);
    }
  } finally {
    recovery.dispose();
    fetchMock.mockRestore();
    database.close();
  }
}, 30_000);
