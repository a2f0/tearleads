import { expect, test } from "bun:test";
import {
  type AccessEvent,
  type AccessManifest,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type KeyingCanonicalJson,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { shareRemoteContainer } from "./share";

test("repeated shares submit every same-container manifest needed by retained wraps", async () => {
  const parent = await createParentProjection();
  const initialManifest = parent.projection.path[0];
  if (!initialManifest) {
    throw new Error("Expected initial container manifest");
  }
  const initialVerifiedManifest =
    initialManifest as unknown as VerifiedContainerAccessManifest;
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>([
    [initialManifest.manifestHash, initialVerifiedManifest],
  ]);
  let currentManifest = initialVerifiedManifest;
  const requests: ContainerMutationRequest[] = [];
  let projection: ContainerWriterProjectionResponse = parent.projection;
  const parentResolver = createParentProjectionUserKeyResolver(parent);
  const recipientKeys = new Map<
    string,
    { encapsulationPublicKey: Uint8Array; signingPublicKey: Uint8Array }
  >();
  const resolveProjectionUserKey = async (userId: string) => {
    const parentKey = await parentResolver(userId);
    if (parentKey) {
      return parentKey;
    }
    const recipientKey = recipientKeys.get(userId);
    return recipientKey
      ? createTestTrustedUserIdentity({
          ...recipientKey,
          signingKeyFingerprint: "recipient-signing-fingerprint",
          userId,
        })
      : null;
  };
  const { close, execSql } = await createTestExecSql(
    "container-repeated-share-history",
  );

  try {
    const shareContainer = async (
      _containerId: string,
      request: ContainerMutationRequest,
    ): Promise<ContainerMutationResponse> => {
      requests.push(request);
      const verifiedEvent = await verifySignedAccessEvent({
        body: request.body as KeyingCanonicalJson,
        event: request.event as unknown as AccessEvent,
        signerPublicKey: parent.signingPublicKey,
      });
      if (!verifiedEvent.ok) {
        throw verifiedEvent.error;
      }
      const verifiedManifest = await verifyContainerAccessManifest({
        event: verifiedEvent.value,
        expectedManifestHash: request.expectedManifestHash,
        manifest: request.manifest as unknown as AccessManifest,
        previousContainerPath: [currentManifest],
        previousManifest: currentManifest,
      });
      if (!verifiedManifest.ok) {
        throw verifiedManifest.error;
      }
      const history = (request.containerManifestHistory ?? []).map((bundle) => {
        const verified = verifiedByHash.get(bundle.manifestHash);
        if (!verified) {
          throw new Error(`Unverified manifest history ${bundle.manifestHash}`);
        }
        return verified;
      });
      const verifiedKek = await verifyContainerKekState({
        containerManifest: verifiedManifest.value,
        containerManifestHistory: history,
        keyEpoch: request.keyEpoch as unknown as ContainerKeyEpoch,
        userRecipientKeys:
          request.userRecipientKeys as unknown as ContainerUserRecipientKey[],
        wraps: request.wraps as unknown as ContainerKeyWrap[],
      });
      if (!verifiedKek.ok) {
        throw verifiedKek.error;
      }
      currentManifest = verifiedManifest.value;
      verifiedByHash.set(currentManifest.manifestHash, currentManifest);
      return createMutationResponseFromRequest(request);
    };
    const apiClient = {
      getContainerWriterProjection: async () => projection,
      shareContainer,
    };

    for (const [index, recipientUserId] of ["user-2", "user-3"].entries()) {
      const recipient = generateKemSeedAndKeyPair();
      recipientKeys.set(recipientUserId, {
        encapsulationPublicKey: recipient.publicKey,
        signingPublicKey: generateSigningSeedAndKeyPair().signingPublicKey,
      });
      const shared = await shareRemoteContainer({
        accessLevel: "read",
        apiClient,
        author: parent.author,
        containerId: parent.projection.containerId,
        execSql,
        previousProjection: projection,
        recipientUserId,
        resolveProjectionUserKey,
        resolveTrustedUserIdentity: resolveProjectionUserKey,
        signedAt: SIGNED_AT,
        targetSecretKey: parent.secretKey,
      });
      if (!shared) {
        throw new Error(`Expected share result ${index + 1}`);
      }
      projection = {
        containerId: shared.response.containerId,
        organizationId: shared.response.organizationId,
        path: [shared.response.accessManifest],
        containerKeks: [shared.response.containerKek],
      };
    }

    expect(requests).toHaveLength(2);
    const firstRequest = requests[0];
    const secondRequest = requests[1];
    if (!firstRequest || !secondRequest) {
      throw new Error("Expected two share requests");
    }
    expect(
      secondRequest.containerManifestHistory?.map(
        (bundle) => bundle.manifestHash,
      ),
    ).toEqual([
      firstRequest.expectedManifestHash,
      initialManifest.manifestHash,
    ]);
  } finally {
    close();
  }
});
