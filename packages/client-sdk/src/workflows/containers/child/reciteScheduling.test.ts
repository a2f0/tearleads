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
import { createContainerMutationServiceFixture } from "../../../../test/helpers/containerMutationServiceFixture";
import { createContainerReciteScenario } from "../../../../test/helpers/containerReciteFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlSchema";
import { scheduleHeldDescendantRecitations } from "./recite";

test("a completed share does not await a hanging descendant re-cite", async () => {
  const scenario = await createContainerReciteScenario();
  const pending = Promise.withResolvers<ContainerReciteResponse | null>();
  const started = Promise.withResolvers<void>();
  let active = true;
  try {
    const recipientKem = generateKemSeedAndKeyPair();
    const recipientSigning = generateSigningSeedAndKeyPair();
    const result = await createContainerMutationServiceFixture({
      reportSecurityIncident: async () => {},
      api: {
        getContainerWriterProjection: async () => scenario.parent.projection,
        shareContainer: async (_id, request) =>
          createMutationResponseFromRequest(request),
        reciteContainer: async () => {
          started.resolve();
          return pending.promise;
        },
      },
      execSql: scenario.execSql,
      resolveTrustedUserIdentity: async (userId) =>
        createTestTrustedUserIdentity({
          userId,
          encapsulationPublicKey: recipientKem.publicKey,
          signingPublicKey: recipientSigning.signingPublicKey,
          signingKeyFingerprint: "recipient-signing-key",
        }),
      encapsulationSecretKey: scenario.parent.secretKey,
    }).shareRemoteContainer({
      accessLevel: "read",
      author: scenario.parent.author,
      containerId: scenario.parent.projection.containerId,
      recipientUserId: "recipient",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(
        scenario.parent,
      ),
      stillCurrent: () => active,
    });
    expect(result).not.toBeNull();
    await started.promise;
    if (!result) throw new Error("Expected acknowledged share");
    let overlappingRequests = 0;
    await runSerializedSqlMutation(scenario.execSql, async (locked) => {
      scheduleHeldDescendantRecitations({
        apiClient: {
          reciteContainer: async () => {
            overlappingRequests += 1;
            return null;
          },
        },
        author: scenario.parent.author,
        execSql: locked,
        plans: [result.plan],
        reportSecurityIncident: async () => {},
        stillCurrent: () => active,
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(overlappingRequests).toBe(0);
    expect(
      (
        await new KeyingCheckpointRepository(
          scenario.execSql,
        ).loadAccessManifestCheckpoint(
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
