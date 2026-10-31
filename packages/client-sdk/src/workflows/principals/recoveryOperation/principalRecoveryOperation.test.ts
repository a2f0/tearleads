import { beforeAll, expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS,
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../../test/helpers/principalAuthorityRecovery";
import { pinPrincipalPolicyCheckpoint } from "../../../../test/helpers/principalPolicyCheckpointPins";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import {
  commitProjectionCheckpoints,
  createProjectionCheckpointContext,
} from "../../../data/keyingProjectionVerification/checkpoints/checkpointContext";
import { collectReferencedPrincipalPolicies } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyVerification";
import {
  isProjectionVerificationCancelledError,
  type PrincipalPolicyCache,
  type ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { getOrCreatePrincipalPolicyCoordinator } from "../../../data/principals/principalPolicyCoordinator";
import { principalPolicyCheckpoints } from "../../../data/sqlite/schema/principalPolicySchema";
import { createRuntimePrincipalPolicyWarmer } from "../runtimePolicyWarmer";
import {
  createPrincipalRecoveryReader,
  type PrincipalRecoveryMemo,
} from "./principalRecoveryMemo";

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
        getPrincipalPolicyPages: source.apiClient.getPrincipalPolicyPages.bind(
          source.apiClient,
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
  const collect = async (
    warmer: ReferencedPrincipalPolicyWarmer,
    principalPolicyCache: PrincipalPolicyCache = new Map(),
    stillCurrent?: () => boolean,
    reference = principalPolicyHead(history.created),
  ) => {
    const context = createProjectionCheckpointContext(source.options);
    await collectReferencedPrincipalPolicies({
      checkpointContext: context,
      organizationId: history.organizationId,
      principalPolicyCache,
      references: [reference],
      resolveUserKey: source.options.resolveTrustedUserIdentity,
      stillCurrent,
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

/** A rotation commits an Admins successor together with its directory. */
async function advanceAdmins(f: Awaited<ReturnType<typeof fixture>>) {
  const admin = await history.extend(history.admin, 67);
  const directory = await history.advanceDirectory(history.directory, admin);
  f.policies.set(admin.currentState.principalId, admin);
  f.policies.set(history.organizationId, directory);
  return directory.currentState.stateHash;
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
    getOrCreatePrincipalPolicyCoordinator(f.options.execSql).invalidateRecovery(
      history.organizationId,
    );
    expect(f.directoryHash(await f.collect(warmer))).toBe(
      directory.currentState.stateHash,
    );
    expect(f.discoveries()).toBe(discovered + 1);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});

test("a shared policy cache does not carry evidence into the next operation", async () => {
  const f = await fixture();
  try {
    const cache: PrincipalPolicyCache = new Map();
    await f.collect(f.operation(), cache);
    const successor = await advanceAdmins(f);
    const discovered = f.discoveries();
    expect(f.directoryHash(await f.collect(f.operation(), cache))).toBe(
      successor,
    );
    expect(f.discoveries()).toBe(discovered + 1);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});

test("a hint evicts the operation's view behind a shared policy cache", async () => {
  const f = await fixture();
  try {
    const cache: PrincipalPolicyCache = new Map();
    const warmer = f.operation();
    await f.collect(warmer, cache);
    const discovered = f.discoveries();
    // The same operation reuses its memoized view without a read.
    await f.collect(warmer, cache);
    expect(f.discoveries()).toBe(discovered);
    const successor = await advanceAdmins(f);
    getOrCreatePrincipalPolicyCoordinator(f.options.execSql).invalidateRecovery(
      history.organizationId,
    );
    expect(f.directoryHash(await f.collect(warmer, cache))).toBe(successor);
    expect(f.discoveries()).toBe(discovered + 1);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});

test.each(["memo", "policy cache"] as const)(
  "evidence reused through the %s expires with its producer",
  async (path) => {
    const f = await fixture();
    try {
      const warmer = f.operation();
      const cache: PrincipalPolicyCache = new Map();
      let producerCurrent = true;
      await f.collect(warmer, cache, () => producerCurrent);
      // A second collection of the same operation reuses the producer's
      // evidence while both are live.
      const consumer = await f.collect(
        warmer,
        path === "memo" ? new Map() : cache,
      );
      producerCurrent = false;
      const error = await commitProjectionCheckpoints(consumer).catch(
        (error: unknown) => error,
      );
      expect(isProjectionVerificationCancelledError(error)).toBe(true);
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test.each(["admin", "group"] as const)(
  "a shared policy cache never admits a directory behind a named %s pin",
  async (kind) => {
    const f = await fixture();
    try {
      const warmer = f.operation();
      const cache: PrincipalPolicyCache = new Map();
      const directoryReference = principalPolicyHead(history.directory);
      await f.collect(warmer, cache, undefined, directoryReference);
      // Another operation admits a named group's successor, committed with a
      // directory successor; only the group's durable pin advances here.
      const named = await history.extend(history[kind], 67);
      const directory = await history.advanceDirectory(
        history.directory,
        named,
      );
      f.policies.set(named.currentState.principalId, named);
      f.policies.set(history.organizationId, directory);
      await pinPrincipalPolicyCheckpoint(f.db, {
        principalType: "group",
        principalId: named.currentState.principalId,
        version: 67,
        stateHash: named.currentState.stateHash,
        updatedAt: named.currentState.createdAt,
        organizationId: history.organizationId,
      });
      const context = await f.collect(
        warmer,
        cache,
        undefined,
        directoryReference,
      );
      expect(f.directoryHash(context)).toBe(directory.currentState.stateHash);
      expect(f.incidents).toEqual([]);
    } finally {
      f.close();
    }
  },
);

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
    await pinPrincipalPolicyCheckpoint(f.db, {
      principalType: "group",
      principalId: admin.currentState.principalId,
      version: 67,
      stateHash: admin.currentState.stateHash,
      updatedAt: admin.currentState.createdAt,
      organizationId: history.organizationId,
    });
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
    await pinPrincipalPolicyCheckpoint(f.db, {
      principalType: "organization",
      principalId: history.organizationId,
      version: directory.currentState.version,
      stateHash: directory.currentState.stateHash,
      updatedAt: directory.currentState.createdAt,
    });
    expect((await reader.directory([])).policy.stateHash).toBe(
      directory.currentState.stateHash,
    );
  } finally {
    f.close();
  }
});
