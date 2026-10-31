// Link-set acknowledgements carry hashes only; each tampered hash refuses.
import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type {
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
  writerProjectionEvidence,
} from "../../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { buildMaterializedDocumentCreatePlan } from "../create";
import { relinkRemoteDocument } from "./linkSetRemote";

const linkSetAcknowledgementTampers: readonly {
  readonly label: string;
  readonly message: string;
  readonly tamper: (
    response: DocumentLinkSetMutationResponse,
  ) => DocumentLinkSetMutationResponse;
}[] = [
  {
    label: "event hash",
    message: "Document link-set response manifest hash mismatch",
    tamper: (response) => ({ ...response, eventHash: "0".repeat(64) }),
  },
  {
    label: "manifest hash",
    message: "Document link-set response manifest hash mismatch",
    tamper: (response) => ({ ...response, manifestHash: "0".repeat(64) }),
  },
  {
    label: "target hash",
    message: "Document link-set response target hash mismatch",
    tamper: (response) => ({ ...response, targetHash: "0".repeat(64) }),
  },
  {
    label: "content-key epoch",
    message: "Document link-set response content-key epoch mismatch",
    tamper: (response) => ({
      ...response,
      contentKeyEpoch: response.contentKeyEpoch + 1,
    }),
  },
];

for (const { label, message, tamper } of linkSetAcknowledgementTampers) {
  test(`relinkRemoteDocument refuses a link acknowledgement with a tampered ${label}`, async () => {
    const { author, signingPublicKey } = await createAuthor();
    const resourceOrganizationId = "shared-organization";
    const keyPair = generateKemSeedAndKeyPair();
    const projection = await createContainerWriterProjectionFixture({
      containerId: "remote-link-root-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: resourceOrganizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const siblingProjection = await createContainerWriterProjectionFixture({
      containerId: "remote-link-sibling-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: resourceOrganizationId,
      parentProjection: projection,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: keyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    });
    const created = await buildMaterializedDocumentCreatePlan({
      author,
      containerProjection: projection,
      documentId: "document-remote-link",
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
    const { close, execSql } = await createTestExecSql(
      "remote-document-link-tampered-ack",
    );

    const primedProjections: DocumentWriterProjectionResponse[] = [];
    try {
      await expect(
        relinkRemoteDocument({
          apiClient: createMockApiClient({
            listDocumentAttachments: async () => [],
            getContainerWriterProjection: async (containerId) =>
              containerId === siblingProjection.containerId
                ? siblingProjection
                : null,
            getDocumentWriterProjection: async (documentId) =>
              documentId === writerProjection.documentId
                ? writerProjection
                : null,
            primeDocumentWriterProjection: (_documentId, primed) => {
              primedProjections.push(primed);
            },
            linkDocument: async (documentId, request) =>
              tamper(
                await createLinkSetResponseFromRequest(documentId, request),
              ),
            unlinkDocument: async () => {
              throw new Error("Unexpected unlink call");
            },
          }),
          author,
          documentId: writerProjection.documentId,
          execSql,
          operation: "link",
          resolveProjectionUserKey,
          targetContainerId: siblingProjection.containerId,
          targetSecretKey: keyPair.secretKey,
        }),
      ).rejects.toThrow(message);
      expect(primedProjections).toEqual([]);
    } finally {
      close();
    }
  });
}
