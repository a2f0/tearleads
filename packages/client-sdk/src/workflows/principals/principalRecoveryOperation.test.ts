import { beforeAll, expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS,
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createProjectionCheckpointContext } from "../../data/keyingProjectionVerification/checkpointContext";
import { collectReferencedPrincipalPolicies } from "../../data/keyingProjectionVerification/principalPolicyVerification";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { invalidatePrincipalRecovery } from "../../data/principals/principalRecoveryEpoch";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import {
  createPrincipalRecoveryReader,
  type PrincipalRecoveryMemo,
} from "./principalRecoveryMemo";
import { createRuntimePrincipalPolicyWarmer } from "./runtimePolicyWarmer";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS);

async function fixture() {
  const source = await createAuthorityRecoveryFixture(history);
  // Initialize checkpoint tables before the first recovery reads them.
  await loadPrincipalPolicyCheckpoint(
    source.options.execSql,
    "group",
    history.group.currentState.principalId,
  );
  const incidents: unknown[] = [];
  // One warmer is one workflow operation.
  const operation = () =>
    createRuntimePrincipalPolicyWarmer({
      apiClient: createMockApiClient({
        getPrincipalPolicyPages:
          source.options.apiClient.getPrincipalPolicyPages.bind(
            source.options.apiClient,
          ),
      }),
      infra: { execSql: source.options.execSql },
      state: { online: true },
      withPrincipalHistoryProtection: (work) =>
        work({
          protection: source.options.protection,
          stillCurrent: () => true,
        }),
      resolveTrustedUserIdentity: source.options.resolveTrustedUserIdentity,
      util: {
        reportSecurityIncident: async (error) => {
          incidents.push(error);
        },
      },
    });
  const collect = async (warmer: ReferencedPrincipalPolicyWarmer) => {
    const context = createProjectionCheckpointContext(source.options);
    await collectReferencedPrincipalPolicies({
      checkpointContext: context,
      organizationId: history.organizationId,
      principalPolicyCache: new Map(),
      references: [principalPolicyHead(history.created)],
      resolveUserKey: source.options.resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies: warmer,
    });
    return context;
  };
  // Completed stages need no pinned read, so these are bare discovery reads.
  const discoveries = () =>
    source.requests.filter(
      (request) =>
        request.principalId === history.organizationId &&
        request.afterVersion === 0,
    ).length;
  const directoryHash = (context: Awaited<ReturnType<typeof collect>>) =>
    context.policies.find((policy) => policy.principalType === "organization")
      ?.stateHash;
  return {
    ...source,
    operation,
    collect,
    discoveries,
    directoryHash,
    incidents,
  };
}

test("collections in one operation share one directory discovery", async () => {
  const f = await fixture();
  try {
    const warmer = f.operation();
    await f.collect(warmer);
    const discovered = f.discoveries();
    await f.collect(warmer);
    await f.collect(warmer);
    expect(f.discoveries()).toBe(discovered);
    // Every operation still reads the server-current head itself.
    await f.collect(f.operation());
    expect(f.discoveries()).toBe(discovered + 1);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});

test("the next operation notices a directory successor committed after the last", async () => {
  const f = await fixture();
  try {
    const warmer = f.operation();
    await f.collect(warmer);
    // A rotation commits a group successor together with its directory.
    const admin = await history.extend(history.admin, 67);
    const directory = await history.advanceDirectory(history.directory, admin);
    f.policies.set(admin.currentState.principalId, admin);
    f.policies.set(history.organizationId, directory);
    // The in-flight operation keeps the view it discovered.
    expect(f.directoryHash(await f.collect(warmer))).toBe(
      history.directory.currentState.stateHash,
    );
    expect(f.directoryHash(await f.collect(f.operation()))).toBe(
      directory.currentState.stateHash,
    );
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});

test("an organization hint evicts the operation's directory", async () => {
  const f = await fixture();
  try {
    const warmer = f.operation();
    await f.collect(warmer);
    const admin = await history.extend(history.admin, 67);
    const directory = await history.advanceDirectory(history.directory, admin);
    f.policies.set(admin.currentState.principalId, admin);
    f.policies.set(history.organizationId, directory);
    const discovered = f.discoveries();
    invalidatePrincipalRecovery(f.options.execSql, history.organizationId);
    expect(f.directoryHash(await f.collect(warmer))).toBe(
      directory.currentState.stateHash,
    );
    expect(f.discoveries()).toBe(discovered + 1);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});

test("a durable pin past the operation's directory evicts it", async () => {
  const f = await fixture();
  try {
    const warmer = f.operation();
    await f.collect(warmer);
    const admin = await history.extend(history.admin, 67);
    const directory = await history.advanceDirectory(history.directory, admin);
    f.policies.set(admin.currentState.principalId, admin);
    f.policies.set(history.organizationId, directory);
    // Another operation admitted the Admins successor the memo predates.
    await f.db
      .insert(principalPolicyCheckpoints)
      .values({
        principalType: "group",
        principalId: admin.currentState.principalId,
        version: 67,
        stateHash: admin.currentState.stateHash,
        updatedAt: admin.currentState.createdAt,
      })
      .run();
    expect(f.directoryHash(await f.collect(warmer))).toBe(
      directory.currentState.stateHash,
    );
    // The operation's memo now holds the successor; later collections reuse it.
    const discovered = f.discoveries();
    await f.collect(warmer);
    expect(f.discoveries()).toBe(discovered);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});

test("a memoized directory below the organization pin is never returned", async () => {
  const f = await fixture();
  try {
    const memo: PrincipalRecoveryMemo = {
      directories: new Map(),
      admins: new Map(),
    };
    const reader = createPrincipalRecoveryReader(f.options, memo);
    expect((await reader.directory([])).policy.version).toBe(66);
    const admin = await history.extend(history.admin, 67);
    const directory = await history.advanceDirectory(history.directory, admin);
    f.policies.set(history.organizationId, directory);
    await f.db
      .insert(principalPolicyCheckpoints)
      .values({
        principalType: "organization",
        principalId: history.organizationId,
        version: directory.currentState.version,
        stateHash: directory.currentState.stateHash,
        updatedAt: directory.currentState.createdAt,
      })
      .run();
    expect((await reader.directory([])).policy.stateHash).toBe(
      directory.currentState.stateHash,
    );
  } finally {
    f.close();
  }
});
