import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import {
  createAuthor,
  createMutationResponseFromRequest,
} from "../../../../test/helpers/containerFixtures";
import { createCurrentShareMetadataFixture } from "../../../../test/helpers/currentShareMetadata";
import { createShareTestRuntime } from "../../../../test/helpers/groupShareScenario";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { inheritPrincipalHistoryProtection } from "../../../data/principals/principalHistoryRuntime";
import { shareRemoteContainerWithGroup } from "./remote";

test("a container admin outside the group and org Admins can wrap an existing signed grant", async () => {
  const containerId = crypto.randomUUID();
  const f = await createCurrentShareMetadataFixture({
    grantedContainerId: containerId,
  });
  const { author, signingPublicKey } = await createAuthor({
    organizationId: f.organizationId,
  });
  const keyPair = generateKemSeedAndKeyPair();
  const identity = createTestTrustedUserIdentity({
    userId: author.signerUserId,
    encapsulationPublicKey: keyPair.publicKey,
    signingPublicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
  });
  const resolveUser = async (userId: string) =>
    userId === author.signerUserId
      ? identity
      : f.runtime.resolveTrustedUserIdentity(userId);
  const projection = await createContainerWriterProjectionFixture({
    containerId,
    organizationId: f.organizationId,
    userId: author.signerUserId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    encapsulationPublicKey: keyPair.publicKey,
  });
  const readProjection = f.options.apiClient.getContainerWriterProjection.bind(
    f.options.apiClient,
  );
  f.options.apiClient.getContainerWriterProjection = async (id) =>
    id === containerId ? projection : readProjection(id);
  let shareCalls = 0;
  let compoundCalls = 0;
  f.options.apiClient.shareContainer = async (_id, request) => {
    shareCalls += 1;
    return createMutationResponseFromRequest(request);
  };
  f.options.apiClient.commitOrganizationGroupPolicy = async () => {
    compoundCalls += 1;
    throw new Error("Existing grants require no group-admin mutation");
  };
  const runtime = inheritPrincipalHistoryProtection(
    f.runtime,
    createShareTestRuntime({
      apiClient: f.options.apiClient,
      author,
      crypto: {
        encapsulationKeyPair: keyPair,
        signingFingerprint: author.signerKeyFingerprint,
        signingKeyPair: {
          signingPrivateKey: author.signerPrivateKey,
          signingPublicKey,
        },
      },
      execSql: f.options.execSql,
      logs: [],
      resolveTrustedUserIdentity: resolveUser,
    }),
  );
  try {
    for (const policy of [f.group, f.admin])
      expect(
        policy.currentProjection.some(
          (member) => member.userId === author.signerUserId,
        ),
      ).toBe(false);
    const result = await shareRemoteContainerWithGroup({
      accessLevel: "read",
      containerId,
      previousProjection: projection,
      recipientGroupId: f.group.currentState.principalId,
      resolveProjectionUserKey: resolveUser,
      runtime,
    });
    expect(result).not.toBeNull();
    expect(shareCalls).toBe(1);
    expect(compoundCalls).toBe(0);
    expect(f.fullReads()).toBe(0);
  } finally {
    f.close();
  }
}, 15_000);
