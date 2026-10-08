import { beforeAll, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createWorkflowInputFixture } from "../../../test/helpers/internalRuntimeFixtures";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { policyBundleAfterMutation } from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalGrantRetirements } from "../../data/sqlite/principalGrantRetirementSchema";
import { createCurrentPrincipalMutation } from "./currentPrincipalMutations";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture() {
  const targetSigning = generateSigningSeedAndKeyPair();
  const targetKem = generateKemSeedAndKeyPair();
  const target = createTestTrustedUserIdentity({
    userId: history.targetUserId,
    encapsulationPublicKey: targetKem.publicKey,
    encapsulationKeyFingerprint: await toFingerprint(targetKem.publicKey),
    signingPublicKey: targetSigning.signingPublicKey,
    signingKeyFingerprint: await toFingerprint(targetSigning.signingPublicKey),
  });
  const resolveTrustedUserIdentity = async (userId: string) =>
    userId === history.targetUserId
      ? target
      : history.resolveTrustedUserIdentity(userId);
  const f = await createAuthorityRecoveryFixture({
    ...history,
    resolveTrustedUserIdentity,
  });
  const state = {
    current: true,
    corruptReceipt: false,
    expireOnReceipt: false,
    writes: 0,
    fullReads: 0,
  };
  const apiClient = f.options.apiClient;
  apiClient.getCurrentPrincipalPolicy = async () => {
    state.fullReads += 1;
    throw new Error("Unexpected full policy read");
  };
  apiClient.commitOrganizationGroupPolicyResult = async (
    organizationId,
    groupId,
    request,
  ) => {
    expect(organizationId).toBe(history.organizationId);
    const group = f.policies.get(groupId);
    const directory = f.policies.get(organizationId);
    if (!group || !directory) throw new Error("Missing committed predecessor");
    const next = await policyBundleAfterMutation({
      previous: group,
      mutation: request.groupPolicy,
    });
    const nextDirectory = await policyBundleAfterMutation({
      previous: directory,
      mutation: request.organizationPolicy,
    });
    f.policies.set(groupId, next);
    f.policies.set(organizationId, nextDirectory);
    state.writes += 1;
    const { previousStates: _groupHistory, ...groupPolicy } =
      structuredClone(next);
    const { previousStates: _directoryHistory, ...organizationPolicy } =
      structuredClone(nextDirectory);
    if (state.corruptReceipt) groupPolicy.currentProjection = [];
    if (state.expireOnReceipt) state.current = false;
    return { ok: true, data: { groupPolicy, organizationPolicy } };
  };
  const signingFingerprint = await toFingerprint(
    history.signingKeyPair.signingPublicKey,
  );
  const base = createWorkflowInputFixture({
    apiClient,
    execSql: f.options.execSql,
    resolveTrustedUserIdentity,
    auth: {
      organizationId: history.organizationId,
      userId: history.signerUserId,
    },
  });
  const runtime = {
    ...base,
    crypto: {
      signingFingerprint,
      signingKeyPair: history.signingKeyPair,
      encapsulationKeyPair: history.creatorEncapsulationKeyPair,
    },
    withPrincipalHistoryProtection: async <T>(
      work: (lease: {
        protection: typeof f.options.protection;
        stillCurrent: () => boolean;
      }) => Promise<T>,
    ) =>
      work({
        protection: f.options.protection,
        stillCurrent: () => state.current,
      }),
  };
  const mutate = createCurrentPrincipalMutation({
    runtime,
    organizationId: history.organizationId,
    signerUserId: history.signerUserId,
    signingFingerprint,
    signingKeyPair: history.signingKeyPair,
    stillCurrent: () => state.current,
  });
  if (!mutate) throw new Error("Missing current mutation factory");
  return {
    ...f,
    state,
    mutate,
    groupId: history.admin.currentState.principalId,
  };
}

test("built-in current mutation adds then removes an Admin with only paged reads and exact receipts", async () => {
  const f = await fixture();
  try {
    const added = await f.mutate(f.groupId, {
      kind: "add",
      expectedGroupName: "Admins",
      targetUserId: history.targetUserId,
    });
    expect(added.response).not.toHaveProperty("previousStates");
    expect(added.response.currentProjection).toContainEqual({
      userId: history.targetUserId,
      role: "admin",
    });
    const removed = await f.mutate(f.groupId, {
      kind: "remove",
      expectedGroupName: "Admins",
      removedUserId: history.targetUserId,
    });
    expect(removed.response.currentProjection).toEqual(
      history.admin.currentProjection,
    );
    expect(removed.response.currentState.version).toBe(68);
    expect(removed.response.currentState.keyEpoch).toBe(
      added.response.currentState.keyEpoch + 1,
    );
    expect(f.state.writes).toBe(2);
    expect(f.state.fullReads).toBe(0);
    expect(f.requests.every((request) => request.count <= 32)).toBe(true);
    for (const [kind, id] of [
      ["group", f.groupId],
      ["organization", history.organizationId],
    ] as const)
      expect(
        await loadPrincipalPolicyCheckpoint(f.options.execSql, kind, id),
      ).toMatchObject({ version: 68 });
  } finally {
    f.close();
  }
}, 20_000);

test.each(["corruptReceipt", "expireOnReceipt"] as const)(
  "current mutation rejects %s without admitting either successor",
  async (mode) => {
    const f = await fixture();
    f.state[mode] = true;
    try {
      await expect(
        f.mutate(f.groupId, {
          kind: "add",
          expectedGroupName: "Admins",
          targetUserId: history.targetUserId,
        }),
      ).rejects.toThrow();
      expect(f.state.writes).toBe(1);
      for (const [kind, id] of [
        ["group", f.groupId],
        ["organization", history.organizationId],
      ] as const)
        expect(
          await loadPrincipalPolicyCheckpoint(f.options.execSql, kind, id),
        ).toMatchObject({ version: 66 });
      expect(f.state.fullReads).toBe(0);
    } finally {
      f.close();
    }
  },
  15_000,
);

test("current grant revocation rotates an externally administered group and retains a retired grant", async () => {
  const f = await fixture();
  const containerId = crypto.randomUUID();
  try {
    const group = await history.advanceGroup(
      history.group,
      history.group.currentProjection,
      [{ containerId, accessLevel: "read" }],
    );
    f.policies.set(group.currentState.principalId, group);
    f.policies.set(
      history.organizationId,
      await history.advanceDirectory(history.directory, group),
    );
    f.options.apiClient.getContainerWriterProjectionResult = async () => ({
      ok: false,
      kind: "http",
      status: 404,
      code: "container_not_found",
      message: "Container not found",
      method: "GET",
      path: "/fixture",
      statusText: "Not Found",
      report() {},
    });
    const { response } = await f.mutate(group.currentState.principalId, {
      kind: "revoke",
      revokedContainerId: containerId,
    });
    expect(response.currentGrants).toEqual([]);
    expect(response.currentState.keyEpoch).toBe(
      group.currentState.keyEpoch + 1,
    );
    expect(response.currentState.externalAuthority?.version).toBe(66);
    expect(f.state.fullReads).toBe(0);
    expect(f.state.writes).toBe(1);
    expect(await f.db.select().from(principalGrantRetirements)).toMatchObject([
      { containerId, policyStateHash: response.currentState.stateHash },
    ]);
  } finally {
    f.close();
  }
}, 15_000);
