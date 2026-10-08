import { beforeAll, expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { testGroupMetadataAccess } from "../../../test/helpers/groupMetadata";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import {
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  policyReceiptFromBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { createCurrentOrganizationGroup } from "./createCurrentOrganizationGroup";
import { createOrganizationGroup } from "./groupCreation";
import { createRuntimeCurrentOrganizationMutation } from "./runtimeCurrentOrganizationMutation";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture(fallback = false) {
  const f = await createAuthorityRecoveryFixture(history);
  for (const bundle of history.projectionBundles)
    if (!f.policies.has(bundle.currentState.principalId))
      f.policies.set(bundle.currentState.principalId, bundle);
  const state = {
    current: true,
    expire: false,
    corrupt: false,
    wrongFingerprint: false,
    expireDuringNameRead: false,
    writes: 0,
    groupId: "",
  };
  f.options.apiClient.getCurrentPrincipalPolicy = async (_, principalId) => {
    if (fallback) return f.policies.get(principalId) ?? null;
    throw new Error("Unexpected full-bundle read");
  };
  f.options.apiClient.createOrganizationGroup = async (
    organizationId,
    request,
  ) => {
    state.writes += 1;
    state.groupId = request.groupId;
    const created = await policyBundleFromInitialRequest(request);
    const directory = await policyBundleAfterMutation({
      previous: history.directory,
      mutation: request.organizationPolicy,
    });
    if (state.corrupt) directory.currentState.signature = "invalid";
    if (state.expire) state.current = false;
    return {
      group: {
        organizationId,
        groupId: request.groupId,
        createdAt: created.currentState.createdAt,
        currentState: {
          ...created.currentState,
          keyFingerprint: state.wrongFingerprint
            ? "f".repeat(64)
            : created.currentState.keyFingerprint,
        },
        isBuiltin: false,
      },
      organizationPolicy: policyReceiptFromBundle(directory),
    };
  };
  const mutate = createRuntimeCurrentOrganizationMutation({
    apiClient: Object.assign(f.options.apiClient, {
      recoverPendingPrincipalMutation: async () => {},
    }),
    infra: { execSql: f.options.execSql },
    resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
    util: { reportSecurityIncident: async () => {} },
    withPrincipalHistoryProtection: async (work) =>
      work({
        protection: f.options.protection,
        stillCurrent: () => state.current,
      }),
  });
  if (!mutate) throw new Error("Missing mutation custody");
  const signingFingerprint = await toFingerprint(
    history.signingKeyPair.signingPublicKey,
  );
  const metadata = testGroupMetadataAccess(history.organizationId);
  const create = (name: string) => {
    const input = {
      apiClient: f.options.apiClient,
      creatorEncapsulationKeyPair: history.creatorEncapsulationKeyPair,
      execSql: f.options.execSql,
      metadataAccess: {
        ...metadata,
        readName: async (...args: Parameters<typeof metadata.readName>) => {
          const result = await metadata.readName(...args);
          if (state.expireDuringNameRead) state.current = false;
          return result;
        },
      },
      name,
      organizationId: history.organizationId,
      reportSecurityIncident: async () => {},
      resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
      signerUserId: history.signerUserId,
      signingFingerprint,
      signingKeyPair: history.signingKeyPair,
      stillCurrent: () => state.current,
    };
    if (fallback) return createOrganizationGroup(input);
    return mutate(
      {
        organizationId: history.organizationId,
        signerUserId: history.signerUserId,
        stillCurrent: () => state.current,
      },
      (context) =>
        createCurrentOrganizationGroup({
          ...input,
          context,
        }),
    );
  };
  return { ...f, state, create };
}

test("bounded group creation verifies every directory name and admits exact genesis plus directory", async () => {
  const f = await fixture();
  try {
    const result = await f.create(" Bounded new group ");
    expect(result.name).toBe("Bounded new group");
    expect(result.nameUnreadable).toBe(false);
    expect(f.state.writes).toBe(1);
    expect(f.requests.every((request) => request.count <= 32)).toBe(true);
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        result.groupId,
      ),
    ).toMatchObject({ version: 1, stateHash: result.currentState?.stateHash });
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
});

test.each(["admins", " PRIVATE support NAME "])(
  "creation refuses canonical signed name collision %s before dispatch",
  async (name) => {
    const f = await fixture();
    try {
      await expect(f.create(name)).rejects.toThrow(
        "Another signed group in this organization already carries this name",
      );
      expect(f.state.writes).toBe(0);
    } finally {
      f.close();
    }
  },
);

for (const fallback of [false, true]) {
  test.each(["expireDuringNameRead", "expire"] as const)(
    `group creation fallback=${fallback} refuses %s across asynchronous work`,
    async (mode) => {
      const f = await fixture(fallback);
      f.state[mode] = true;
      try {
        await expect(f.create("Scoped new group")).rejects.toThrow(
          "generation expired",
        );
        expect(f.state.writes).toBe(mode === "expire" ? 1 : 0);
        if (f.state.groupId)
          expect(
            await loadPrincipalPolicyCheckpoint(
              f.options.execSql,
              "group",
              f.state.groupId,
            ),
          ).toBeNull();
      } finally {
        f.close();
      }
    },
  );
}

test.each(["corrupt", "expire", "wrongFingerprint"] as const)(
  "creation refuses %s acknowledgement without a partial genesis",
  async (mode) => {
    const f = await fixture();
    f.state[mode] = true;
    try {
      await expect(f.create("Bounded new group")).rejects.toThrow(
        mode === "expire" ? "generation expired" : "acknowledgement mismatch",
      );
      expect(f.state.writes).toBe(1);
      expect(
        await loadPrincipalPolicyCheckpoint(
          f.options.execSql,
          "group",
          f.state.groupId,
        ),
      ).toBeNull();
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
