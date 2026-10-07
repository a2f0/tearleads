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
import { commitCurrentShareGrant } from "../../containers/child/currentShareGrantMutation";
import { createRuntimeCurrentGroupMutation } from "../../organizations/runtimeCurrentGroupMutation";
import { shareRemoteContainerWithGroup } from "./remote";

test("a container admin outside group authority can rewrap a grant but cannot mint a broader one", async () => {
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
    const mutate = createRuntimeCurrentGroupMutation(
      inheritPrincipalHistoryProtection(runtime, {
        ...runtime,
        apiClient: Object.assign(f.options.apiClient, {
          recoverPendingPrincipalMutation: async () => {},
        }),
      }),
    );
    if (!mutate) throw new Error("Missing fixture Current mutation custody");
    // Exercise the mint boundary with the same genuine container administrator.
    // Authorization must fail before a fresh name read or any policy request.
    await expect(
      commitCurrentShareGrant({
        runtime,
        mutate,
        share: {
          accessLevel: "admin",
          apiClient: f.options.apiClient,
          author,
          containerId,
          execSql: f.options.execSql,
          expectedGroupName: f.name,
          previousProjection: projection,
          recipientGroupId: f.group.currentState.principalId,
          reportSecurityIncident: runtime.util.reportSecurityIncident,
          resolveProjectionUserKey: resolveUser,
          resolveTrustedUserIdentity: resolveUser,
          signingKeyPair: {
            signingPrivateKey: author.signerPrivateKey,
            signingPublicKey,
          },
          targetSecretKey: keyPair.secretKey,
        },
      }),
    ).rejects.toThrow("Organization admin authority is required");
    expect(compoundCalls).toBe(0);
    expect(f.fullReads()).toBe(0);
  } finally {
    f.close();
  }
}, 15_000);
