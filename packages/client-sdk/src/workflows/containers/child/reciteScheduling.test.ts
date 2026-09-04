import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import type { ContainerReciteResponse } from "@tearleads/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createContainerReciteScenario } from "../../../../test/helpers/containerReciteFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { shareRemoteContainer } from "./share";

test("a completed share does not await a hanging descendant re-cite", async () => {
  const scenario = await createContainerReciteScenario();
  const pending = Promise.withResolvers<ContainerReciteResponse | null>();
  const started = Promise.withResolvers<void>();
  let active = true;
  try {
    const recipientKem = generateKemSeedAndKeyPair();
    const recipientSigning = generateSigningSeedAndKeyPair();
    const result = await shareRemoteContainer({
      accessLevel: "read",
      apiClient: {
        getContainerWriterProjection: async () => scenario.parent.projection,
        shareContainer: async (_id, request) =>
          createMutationResponseFromRequest(request),
        reciteContainer: async () => {
          started.resolve();
          return pending.promise;
        },
      },
      author: scenario.parent.author,
      containerId: scenario.parent.projection.containerId,
      execSql: scenario.execSql,
      recipientUserId: "recipient",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(
        scenario.parent,
      ),
      resolveTrustedUserIdentity: async (userId) =>
        createTestTrustedUserIdentity({
          userId,
          encapsulationPublicKey: recipientKem.publicKey,
          signingPublicKey: recipientSigning.signingPublicKey,
          signingKeyFingerprint: "recipient-signing-key",
        }),
      targetSecretKey: scenario.parent.secretKey,
      stillCurrent: () => active,
    });
    expect(result).not.toBeNull();
    await started.promise;
    expect(
      (
        await loadAccessManifestCheckpoint(
          scenario.execSql,
          "container",
          scenario.parent.author.organizationId,
          "held-child",
        )
      )?.epoch,
    ).toBe(1);
  } finally {
    active = false;
    pending.resolve(null);
    await scenario.close();
  }
});
