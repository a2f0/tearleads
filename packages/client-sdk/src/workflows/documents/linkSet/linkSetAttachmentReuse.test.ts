import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
  writerProjectionEvidence,
} from "../../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import type { DocumentLinkSetMutationFailure } from "../../../data/documents/shared/types";
import { buildMaterializedDocumentCreatePlan } from "../create";
import {
  createLinkSetAttachmentReuse,
  reuseCommittedBlobRewraps,
} from "./linkSetBlobRewraps";
import { relinkRemoteDocument } from "./linkSetRemote";

const target = (containerId: string) => ({
  containerId,
  containerKeyEpoch: 1,
  containerKeyEpochId: `${containerId}-epoch`,
  containerManifestHash: `${containerId}-manifest`,
});
const envelope = (bindingId: string, containerId: string) => ({
  ...target(containerId),
  bindingId,
  documentId: "document",
  wrappedKey: `${bindingId}-${containerId}-key`,
  wrappingMetadata: { iv: "iv", suite: "suite" },
});

test("a later leg re-cites the envelopes the previous leg committed", () => {
  const committed = [
    {
      blobId: "blob-b",
      contentKeyEpoch: 2,
      targets: [envelope("binding-b", "trash"), envelope("binding-b", "root")],
    },
    {
      blobId: "blob-a",
      contentKeyEpoch: 1,
      targets: [envelope("binding-a", "trash"), envelope("binding-a", "root")],
    },
  ];
  const reused = reuseCommittedBlobRewraps({
    committed,
    documentId: "document",
    targets: [target("trash")],
  });
  expect(reused).toEqual([
    {
      blobId: "blob-a",
      contentKeyEpoch: 1,
      targets: [envelope("binding-a", "trash")],
    },
    {
      blobId: "blob-b",
      contentKeyEpoch: 2,
      targets: [envelope("binding-b", "trash")],
    },
  ]);
  expect(
    reuseCommittedBlobRewraps({
      committed: [],
      documentId: "document",
      targets: [target("trash")],
    }),
  ).toEqual([]);
});

test("a target the previous leg never wrapped falls back to listing", () => {
  const committed = [
    { blobId: "blob", contentKeyEpoch: 1, targets: [envelope("b", "root")] },
  ];
  // A new destination, and an envelope scoped to another document, both need
  // the authenticated path: reuse never propagates a key to a new scope.
  expect(
    reuseCommittedBlobRewraps({
      committed,
      documentId: "document",
      targets: [target("trash")],
    }),
  ).toBeNull();
  expect(
    reuseCommittedBlobRewraps({
      committed,
      documentId: "other-document",
      targets: [target("root")],
    }),
  ).toBeNull();
});

async function linkLegFixture(name: string) {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const fixture = {
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: "reuse-organization",
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  };
  const projection = await createContainerWriterProjectionFixture({
    ...fixture,
    containerId: `${name}-root`,
  });
  const sibling = await createContainerWriterProjectionFixture({
    ...fixture,
    containerId: `${name}-sibling`,
    parentProjection: projection,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: `${name}-document`,
    targetSecretKey: keyPair.secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    ...writerProjectionEvidence([projection], []),
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  return {
    author,
    keyPair,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: keyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    sibling,
    writerProjection,
  };
}

async function runReusedLeg(
  name: string,
  refusal: DocumentLinkSetMutationFailure,
) {
  const leg = await linkLegFixture(name);
  const { close, execSql } = await createTestExecSql(name);
  const reuse = createLinkSetAttachmentReuse();
  reuse.committed = [];
  const failures: DocumentLinkSetMutationFailure[] = [];
  let listings = 0;
  let submissions = 0;
  const result = await relinkRemoteDocument({
    apiClient: createMockApiClient({
      listDocumentAttachments: async () => {
        listings += 1;
        return [];
      },
      getContainerWriterProjection: async () => leg.sibling,
      getDocumentWriterProjection: async () => leg.writerProjection,
      primeDocumentWriterProjection: () => {},
      linkDocumentResult: async (documentId, request) => {
        submissions += 1;
        return submissions === 1
          ? {
              ...refusal,
              kind: "http" as const,
              method: "POST" as const,
              ok: false as const,
              path: `/documents/${documentId}/link`,
              report: () => {},
              statusText: "Conflict",
            }
          : {
              data: await createLinkSetResponseFromRequest(documentId, request),
              ok: true as const,
            };
      },
    }),
    attachmentReuse: reuse,
    author: leg.author,
    documentId: leg.writerProjection.documentId,
    execSql,
    onFailure: (failure) => failures.push(failure),
    operation: "link",
    resolveProjectionUserKey: leg.resolveProjectionUserKey,
    targetContainerId: leg.sibling.containerId,
    targetSecretKey: leg.keyPair.secretKey,
  });
  close();
  return { failures, listings, result, reuse, submissions };
}

test("a reused leg the server refuses re-lists the attachments and retries once", async () => {
  const run = await runReusedLeg("attachment-reuse-retry", {
    code: undefined,
    message:
      "Document attachments changed; retry the link with current blob keys",
    status: 409,
  });
  expect(run.submissions).toBe(2);
  expect(run.listings).toBe(1);
  expect(run.failures).toEqual([]);
  expect(run.result).not.toBeNull();
  expect(run.reuse.committed).toEqual([]);
});

test("a coded refusal of a reused leg keeps its own recovery path", async () => {
  const refusal = {
    code: "container_unavailable",
    message: "targetContainerPathRefs[0] container unavailable",
    status: 409,
  } as const;
  const run = await runReusedLeg("attachment-reuse-coded", refusal);
  expect(run.submissions).toBe(1);
  expect(run.listings).toBe(0);
  expect(run.failures).toEqual([refusal]);
  expect(run.result).toBeNull();
  expect(run.reuse.committed).toBeNull();
});
