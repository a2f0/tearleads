import { beforeAll, expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import { createShareTestRuntime } from "../../../../test/helpers/groupShareScenario";
import { createLocalAuthorityRecoveryFixture } from "../../../../test/helpers/principalAuthorityLocal";
import { signedAuthorityRecoveryHistory } from "../../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { inheritPrincipalHistoryProtection } from "../../../data/principals/principalHistoryRuntime";
import { createTestContainerState } from "./containerState.testFixtures";
import { containerStateHasCurrentGroupGrant } from "./groupGrantVerification";
import { resolveCurrentGroupKeyEpoch } from "./groupShareEpoch";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture() {
  const f = await createLocalAuthorityRecoveryFixture(history);
  // A container administrator can read/re-wrap an existing group grant without
  // being an organization administrator or holding the group's signing keys.
  const owner = await createAuthor({
    organizationId: history.organizationId,
    userId: "container-admin-only",
  });
  const keyPair = generateKemSeedAndKeyPair();
  const identity = createTestTrustedUserIdentity({
    userId: owner.author.signerUserId,
    signingPublicKey: owner.signingPublicKey,
    signingKeyFingerprint: owner.author.signerKeyFingerprint,
    encapsulationPublicKey: keyPair.publicKey,
  });
  let fullReads = 0;
  f.options.apiClient.getCurrentPrincipalPolicy = async () => {
    fullReads += 1;
    throw new Error("Unexpected Full fallback");
  };
  const runtime = inheritPrincipalHistoryProtection(
    {
      withPrincipalHistoryProtection: async <T>(
        work: (input: {
          protection: typeof f.options.protection;
          stillCurrent: () => boolean;
        }) => Promise<T>,
      ) =>
        work({
          protection: f.options.protection,
          stillCurrent: () => true,
        }),
    },
    createShareTestRuntime({
      apiClient: f.options.apiClient,
      author: owner.author,
      execSql: f.options.execSql,
      logs: [],
      resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
    }),
  );
  return {
    ...f,
    owner,
    keyPair,
    identity,
    runtime,
    fullReads: () => fullReads,
  };
}

test("duplicate share epoch checks use current evidence for a non-admin reader", async () => {
  const f = await fixture();
  try {
    expect(
      await resolveCurrentGroupKeyEpoch({
        groupId: history.group.currentState.principalId,
        organizationId: history.organizationId,
        runtime: f.runtime,
      }),
    ).toBe(history.group.currentState.keyEpoch);
    expect(f.fullReads()).toBe(0);
    expect(f.requests.length).toBeGreaterThan(0);
  } finally {
    f.close();
  }
}, 15_000);

test("failed current epoch recovery never falls back to Full policy reads", async () => {
  const f = await fixture();
  f.controls.error = new Error("principal page source unavailable");
  try {
    await expect(
      resolveCurrentGroupKeyEpoch({
        groupId: history.group.currentState.principalId,
        organizationId: history.organizationId,
        runtime: f.runtime,
      }),
    ).rejects.toThrow();
    expect(f.fullReads()).toBe(0);
  } finally {
    f.close();
  }
});

for (const head of ["current", "wrong"] as const) {
  test(`group grant confirmation checks the ${head} directory head without Full reads`, async () => {
    const f = await fixture();
    const containerId = crypto.randomUUID();
    const projection = await createContainerWriterProjectionFixture({
      containerId,
      organizationId: history.organizationId,
      userId: f.owner.author.signerUserId,
      signerKeyFingerprint: f.owner.author.signerKeyFingerprint,
      signerPrivateKey: f.owner.author.signerPrivateKey,
      encapsulationPublicKey: f.keyPair.publicKey,
    });
    f.runtime.apiClient.getContainerWriterProjection = async () => projection;
    const expectedGroupHead = principalPolicyHead(history.group);
    if (head === "wrong") expectedGroupHead.stateHash = "f".repeat(64);
    try {
      const result = containerStateHasCurrentGroupGrant({
        accessLevel: "read",
        containerState: createTestContainerState({
          id: containerId,
          parentId: null,
          organizationId: history.organizationId,
        }),
        expectedContainerId: containerId,
        expectedGroupHead,
        expectedOrganizationId: history.organizationId,
        groupId: history.group.currentState.principalId,
        resolveProjectionUserKey: async () => f.identity,
        runtime: f.runtime,
      });
      if (head === "wrong")
        await expect(result).rejects.toMatchObject({ code: "object_mismatch" });
      // A valid user-only projection is not proof of a group grant.
      else expect(await result).toBe(false);
      expect(f.fullReads()).toBe(0);
      expect(f.requests.length).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  }, 15_000);
}
