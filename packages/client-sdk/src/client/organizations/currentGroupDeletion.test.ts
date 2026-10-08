import { beforeAll, expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { createWorkflowInputFixture } from "../../../test/helpers/internalRuntimeFixtures";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { policyBundleAfterMutation } from "../../../test/helpers/principalPolicyFixtures";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { parseOrganizationAuthorityDescriptor } from "../../data/principals/organizationAuthorityDescriptor";
import { deleteGroupForOrganization } from "./principalMutations";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture(custody = true) {
  const f = await createAuthorityRecoveryFixture(history);
  const state = {
    current: true,
    callerCurrent: true,
    corrupt: false,
    expire: false,
    expireCaller: false,
    wrongGroup: false,
    wrongOrganization: false,
    writes: 0,
    fullReads: 0,
    recovered: false,
    pendingFailure: false,
  };
  f.options.apiClient.getCurrentPrincipalPolicy = async (_kind, id) => {
    state.fullReads += 1;
    return f.policies.get(id) ?? null;
  };
  f.options.apiClient.deleteOrganizationGroup = async (
    organizationId,
    groupId,
    request,
  ) => {
    expect(state.recovered).toBe(true);
    state.writes += 1;
    const bundle = await policyBundleAfterMutation({
      previous: history.directory,
      mutation: request.organizationPolicy,
    });
    const { previousStates: _previousStates, ...organizationPolicy } = bundle;
    if (state.corrupt) organizationPolicy.currentProjection = [];
    if (state.expire) state.current = false;
    if (state.expireCaller) state.callerCurrent = false;
    return {
      deleted: true,
      organizationId: state.wrongOrganization
        ? "other-organization"
        : organizationId,
      groupId: state.wrongGroup ? "other-group" : groupId,
      organizationPolicy,
    };
  };
  const base = createWorkflowInputFixture({
    apiClient: f.options.apiClient,
    execSql: f.options.execSql,
    resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
    auth: {
      organizationId: history.organizationId,
      userId: history.signerUserId,
    },
  });
  Object.assign(base.apiClient, {
    recoverPendingPrincipalMutation: async () => {
      if (state.pendingFailure) throw new Error("prior outcome unknown");
      state.recovered = true;
    },
  });
  const runtime = {
    ...base,
    crypto: {
      signingKeyPair: history.signingKeyPair,
      signingFingerprint: await toFingerprint(
        history.signingKeyPair.signingPublicKey,
      ),
      encapsulationKeyPair: history.creatorEncapsulationKeyPair,
    },
    ...(custody
      ? {
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
        }
      : {}),
  };
  return {
    ...f,
    state,
    input: {
      runtime,
      groupId: history.group.currentState.principalId,
      stillCurrent: () => state.callerCurrent,
    },
  };
}

test("group deletion uses private bounded custody", async () => {
  const f = await fixture();
  try {
    const result = await deleteGroupForOrganization(f.input);
    expect(result.groupId).toBe(f.input.groupId);
    expect(result.organizationPolicy.currentState.version).toBe(67);
    expect(
      parseOrganizationAuthorityDescriptor(
        result.organizationPolicy.currentPayload.ciphertext,
      ).groupHeads.some((head) => head.principalId === f.input.groupId),
    ).toBe(false);
    expect(f.state.writes).toBe(1);
    expect(f.state.fullReads).toBe(0);
    expect(
      f.requests.some((request) => request.principalId === f.input.groupId),
    ).toBe(false);
    expect(f.requests.every((request) => request.count <= 32)).toBe(true);
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "organization",
        history.organizationId,
      ),
    ).toMatchObject({ version: 67 });
  } finally {
    f.close();
  }
}, 15_000);

test.each(["corrupt", "expire", "expireCaller"] as const)(
  "current group deletion rejects %s receipt before successor admission",
  async (mode) => {
    const f = await fixture();
    f.state[mode] = true;
    try {
      await expect(deleteGroupForOrganization(f.input)).rejects.toThrow(
        mode === "corrupt"
          ? "bundle acknowledgement mismatch"
          : "generation expired",
      );
      expect(f.state.writes).toBe(1);
      expect(
        await loadPrincipalPolicyCheckpoint(
          f.options.execSql,
          "organization",
          history.organizationId,
        ),
      ).toMatchObject({ version: 66 });
    } finally {
      f.close();
    }
  },
);

test("an unresolved prior policy write blocks current deletion before discovery", async () => {
  const f = await fixture();
  f.state.pendingFailure = true;
  try {
    await expect(deleteGroupForOrganization(f.input)).rejects.toThrow(
      "prior outcome unknown",
    );
    expect(f.requests).toHaveLength(0);
    expect(f.state.writes).toBe(0);
  } finally {
    f.close();
  }
});

test("current deletion rejects a non-admin and either built-in group before dispatch", async () => {
  const f = await fixture();
  try {
    await expect(
      deleteGroupForOrganization({
        ...f.input,
        runtime: {
          ...f.input.runtime,
          auth: { ...f.input.runtime.auth, userId: history.targetUserId },
        },
      }),
    ).rejects.toThrow("Organization admin authority is required");
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "organization",
        history.organizationId,
      ),
    ).toBeNull();
    const descriptor = parseOrganizationAuthorityDescriptor(
      history.directory.currentPayload.ciphertext,
    );
    for (const groupId of [descriptor.adminGroupId, descriptor.memberGroupId])
      await expect(
        deleteGroupForOrganization({ ...f.input, groupId }),
      ).rejects.toThrow("Built-in groups cannot be removed from the directory");
    await expect(
      deleteGroupForOrganization({ ...f.input, groupId: "missing-group" }),
    ).rejects.toThrow(
      "Organization directory does not commit the deleted group",
    );
    expect(f.state.writes).toBe(0);
  } finally {
    f.close();
  }
});

test.each(["wrongGroup", "wrongOrganization"] as const)(
  "current deletion rejects %s response target",
  async (mode) => {
    const f = await fixture();
    f.state[mode] = true;
    try {
      await expect(deleteGroupForOrganization(f.input)).rejects.toThrow(
        "response target mismatch",
      );
      expect(f.state.writes).toBe(1);
      expect(
        await loadPrincipalPolicyCheckpoint(
          f.options.execSql,
          "organization",
          history.organizationId,
        ),
      ).toMatchObject({ version: 66 });
    } finally {
      f.close();
    }
  },
);

test("deletion without private custody refuses before reading or writing policy", async () => {
  const f = await fixture(false);
  try {
    await expect(deleteGroupForOrganization(f.input)).rejects.toBeInstanceOf(
      ProjectionDependencyUnavailableError,
    );
    expect(f.state.writes).toBe(0);
    expect(f.state.fullReads).toBe(0);
    expect(f.requests).toHaveLength(0);
  } finally {
    f.close();
  }
});

test.each(["current", "callerCurrent"] as const)(
  "deletion refuses an expired %s lifetime before discovery or dispatch",
  async (lifetime) => {
    const f = await fixture();
    f.state[lifetime] = false;
    try {
      await expect(deleteGroupForOrganization(f.input)).rejects.toThrow(
        "generation expired",
      );
      expect(f.requests).toHaveLength(0);
      expect(f.state.writes).toBe(0);
      expect(f.state.recovered).toBe(false);
    } finally {
      f.close();
    }
  },
);
