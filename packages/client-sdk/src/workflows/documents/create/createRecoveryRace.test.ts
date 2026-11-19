import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createResponseFromRequest,
} from "../../../../test/helpers/data/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/data/trustedUserIdentity";
import { createRemoteDocumentForTest as createRemoteDocument } from "../../../../test/helpers/workflows/remoteDocumentServiceFixture";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import { documentWriterProjectionFromCreateResponse } from "./index";

test.each(["unavailable", "integrity", "forged-recovery"] as const)(
  "a committed create handles %s during acknowledgement without submitting again",
  async (kind) => {
    const { author, signingPublicKey } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const parent = await createContainerWriterProjectionFixture({
      containerId: "create-race-parent",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const f = await createTestExecSql("create-response-history-race");
    const resolveIdentity = createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: keyPair.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    });
    let projection: DocumentWriterProjectionResponse | null = null;
    let submissions = 0;
    let reads = 0;
    let injected = false;
    const contentKey = new Uint8Array(32).fill(7);
    try {
      const doc = await createDocument("seed-peer");
      doc.getText("text").update("Original fixture");
      const fields = createPendingUpdateFields(exportAllUpdates(doc));
      if (!fields) throw new Error("Missing birth update");
      const seedUpdate = { ...fields, id: crypto.randomUUID() };
      const result = createRemoteDocument({
        requireSeededCreate: true,
        seedUpdate,
        apiClient: createMockApiClient({
          getContainerWriterProjection: async () => parent,
          createDocument: async (request) => {
            submissions += 1;
            const response = await createResponseFromRequest(request);
            projection = documentWriterProjectionFromCreateResponse({
              containerProjection: parent,
              response,
            });
            expect(request.initialSync?.outgoingUpdates[0]?.id).toBe(
              seedUpdate.id,
            );
            return {
              ...response,
              initialSync: {
                acceptedOutgoingUpdateIds: [seedUpdate.id],
                commitLsn: null,
                commitLsnMode: "untracked",
              },
            };
          },
          getDocumentWriterProjection: async () => {
            reads += 1;
            if (kind === "forged-recovery" && projection)
              projection.documentManifest.manifestHash = "f".repeat(64);
            return projection;
          },
          primeDocumentWriterProjection: () => {},
        }),
        author,
        containerId: parent.containerId,
        documentId: "create-race-document",
        contentKey,
        execSql: f.execSql,
        targetSecretKey: keyPair.secretKey,
        resolveProjectionUserKey: async (userId) => {
          if (submissions && !injected) {
            injected = true;
            if (kind === "integrity")
              throw new KeyingVerificationError(
                "equivocation",
                "Conflicting head",
              );
            throw new ProjectionDependencyUnavailableError(
              "Newer principal checkpoint needs fresh evidence",
            );
          }
          return resolveIdentity(userId);
        },
      });
      if (kind === "unavailable") {
        const created = await result;
        expect(created?.documentId).toBe("create-race-document");
        expect(created?.contentKey).toEqual(contentKey);
        expect(
          created?.response?.initialSync?.acceptedOutgoingUpdateIds,
        ).toEqual([seedUpdate.id]);
      } else if (kind === "integrity") {
        await expect(result).rejects.toMatchObject({ code: "equivocation" });
      } else {
        await expect(result).rejects.toBeInstanceOf(KeyingVerificationError);
      }
      expect(injected).toBe(true);
      expect(submissions).toBe(1);
      expect(reads).toBe(kind === "integrity" ? 0 : 1);
    } finally {
      f.close();
    }
  },
);
