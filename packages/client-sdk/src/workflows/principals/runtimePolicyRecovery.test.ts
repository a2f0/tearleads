import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import {
  commitProjectionCheckpoints,
  createProjectionCheckpointContext,
} from "../../data/keyingProjectionVerification/checkpointContext";
import { collectReferencedPrincipalPolicies } from "../../data/keyingProjectionVerification/principalPolicyVerification";
import {
  isProjectionVerificationCancelledError,
  type PrincipalPolicyCache,
  type ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
import {
  loadOrganizationFounder,
  rememberOrganizationFounder,
} from "../../data/persistence/organizationFounderPersistence";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyWarmer } from "./runtimePolicyWarmer";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
});

async function fixture() {
  const source = await createAuthorityRecoveryFixture(history);
  const state = { online: true, current: true, fullReads: 0 };
  const ownedKeys: Uint8Array[] = [];
  const incidents: unknown[] = [];
  const lease: PrincipalHistoryProtectionLease = async (operation) => {
    const key = new Uint8Array(source.options.protection.localKey);
    ownedKeys.push(key);
    try {
      return await operation({
        protection: { ...source.options.protection, localKey: key },
        stillCurrent: () => state.current,
      });
    } finally {
      key.fill(0);
    }
  };
  const warmer = createRuntimePrincipalPolicyWarmer({
    apiClient: {
      getPrincipalPolicyPages:
        source.options.apiClient.getPrincipalPolicyPages.bind(
          source.options.apiClient,
        ),
      getCurrentPrincipalPolicy: async () => {
        state.fullReads += 1;
        throw new Error("Full history is unavailable");
      },
    },
    infra: { execSql: source.options.execSql },
    state,
    withPrincipalHistoryProtection: lease,
    resolveTrustedUserIdentity: source.options.resolveTrustedUserIdentity,
    util: {
      log: () => undefined,
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    },
  });
  const collect = async (
    cache: PrincipalPolicyCache = new Map(),
    selectedWarmer: ReferencedPrincipalPolicyWarmer = warmer,
    stillCurrent: () => boolean = () => state.current,
  ) => {
    const context = createProjectionCheckpointContext(source.options);
    const policies = await collectReferencedPrincipalPolicies({
      checkpointContext: context,
      organizationId: history.organizationId,
      principalPolicyCache: cache,
      references: [principalPolicyHead(history.created)],
      resolveUserKey: source.options.resolveTrustedUserIdentity,
      stillCurrent,
      warmReferencedPrincipalPolicies: selectedWarmer,
    });
    return { context, policies };
  };
  return { ...source, state, collect, warmer, ownedKeys, incidents };
}

test("runtime projection recovery carries bounded history and dependencies through atomic admission and offline reuse", async () => {
  const f = await fixture();
  try {
    const cache: PrincipalPolicyCache = new Map();
    const first = await f.collect(cache);
    expect(first.context.policies).toHaveLength(3);
    const directory = first.context.policies[0];
    if (!directory) throw new Error("Missing directory evidence");
    await rememberOrganizationFounder({
      execSql: f.options.execSql,
      organization: directory,
    });
    expect(
      await loadOrganizationFounder(f.options.execSql, history.organizationId),
    ).toMatchObject({
      userId: history.signerUserId,
      genesisStateHash: history.initial.currentState.stateHash,
    });
    expect(first.policies[0]).toMatchObject({ version: 66 });
    expect(first.policies[0]).not.toHaveProperty("history");
    expect(
      first.context.policies.every(
        (policy) =>
          "retainedHistory" in policy && policy.retainedHistory.length <= 2,
      ),
    ).toBe(true);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    await commitProjectionCheckpoints(first.context);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toHaveLength(
      3,
    );
    const requests = f.requests.length;
    const keys = f.ownedKeys.length;
    const cached = await f.collect(cache);
    expect(cached.context.policies).toHaveLength(3);
    expect(f.requests).toHaveLength(requests);
    expect(f.ownedKeys).toHaveLength(keys);
    f.state.online = false;
    const offline = await f.collect();
    expect(offline.context.policies).toHaveLength(3);
    await commitProjectionCheckpoints(offline.context);
    expect(f.requests).toHaveLength(requests);
    expect(f.state.fullReads).toBe(0);
    expect(f.ownedKeys.every((key) => key.every((byte) => byte === 0))).toBe(
      true,
    );
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
});

test("a cached dependency behind a new durable pin triggers fresh scoped recovery", async () => {
  const f = await fixture();
  try {
    const cache: PrincipalPolicyCache = new Map();
    await f.collect(cache);
    const admin = await history.extend(history.admin, 67);
    const directory = await history.advanceDirectory(history.directory, admin);
    f.policies.set(admin.currentState.principalId, admin);
    f.policies.set(directory.currentState.principalId, directory);
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
    const recovered = await f.collect(cache);
    expect(recovered.context.policies.map((policy) => policy.version)).toEqual([
      67, 67, 66,
    ]);
    await commitProjectionCheckpoints(recovered.context);
    expect(f.state.fullReads).toBe(0);
  } finally {
    f.close();
  }
});

test.each(["target", "dependency"] as const)(
  "cached %s checkpoint conflicts remain terminal",
  async (kind) => {
    const f = await fixture();
    try {
      const cache: PrincipalPolicyCache = new Map();
      await f.collect(cache);
      const policy = kind === "target" ? history.group : history.admin;
      await f.db
        .insert(principalPolicyCheckpoints)
        .values({
          principalType: "group",
          principalId: policy.currentState.principalId,
          version: 66,
          stateHash: "f".repeat(64),
          updatedAt: policy.currentState.createdAt,
        })
        .run();
      const requests = f.requests.length;
      await expect(f.collect(cache)).rejects.toMatchObject({
        code: "equivocation",
      });
      expect(f.requests).toHaveLength(requests);
    } finally {
      f.close();
    }
  },
);

test("runtime cancellation releases the key and admits no policy", async () => {
  const f = await fixture();
  try {
    f.controls.mutate = () => {
      f.state.current = false;
    };
    const error = await f.collect().catch((error: unknown) => error);
    expect(isProjectionVerificationCancelledError(error)).toBe(true);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    expect(f.ownedKeys.every((key) => key.every((byte) => byte === 0))).toBe(
      true,
    );
    expect(f.incidents).toEqual([]);
    expect(f.state.fullReads).toBe(0);
  } finally {
    f.close();
  }
});

test.each(["organization", "citation"] as const)(
  "resolved evidence must match its %s",
  async (kind) => {
    const f = await fixture();
    try {
      const resolve = f.warmer.resolveReference;
      if (!resolve) throw new Error("Missing paged resolver");
      const wrong = Object.assign(async () => undefined, {
        resolveReference: async (input: Parameters<typeof resolve>[0]) => {
          const result = await resolve({
            ...input,
            ...(kind === "citation"
              ? { reference: principalPolicyHead(history.group) }
              : {}),
          });
          return kind === "organization"
            ? { ...result, organizationId: "other-org" }
            : result;
        },
      });
      await expect(f.collect(new Map(), wrong)).rejects.toMatchObject({
        code: "object_mismatch",
      });
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test("a newly admitted intermediate dependency pin is retained on cache refresh", async () => {
  const f = await fixture();
  try {
    const cache: PrincipalPolicyCache = new Map();
    await f.collect(cache);
    const state = history.admin.previousStates[31]?.state;
    if (!state) throw new Error("Missing signed intermediate state");
    await f.db
      .insert(principalPolicyCheckpoints)
      .values({
        principalType: "group",
        principalId: state.principalId,
        version: state.version,
        stateHash: state.stateHash,
        updatedAt: state.createdAt,
      })
      .run();
    f.state.online = false;
    const count = f.requests.length;
    const result = await f.collect(cache);
    expect(result.context.policies[1]).toMatchObject({
      retainedHistory: [{ state: { version: 32 } }, { state: { version: 66 } }],
    });
    await commitProjectionCheckpoints(result.context);
    expect(f.requests).toHaveLength(count);
  } finally {
    f.close();
  }
});

test("concurrent runtime readers share the organization recovery writer", async () => {
  const f = await fixture();
  try {
    const [first, second] = await Promise.all([f.collect(), f.collect()]);
    expect(first.policies[0]?.stateHash).toBe(second.policies[0]?.stateHash);
    expect(first.context.policies).toHaveLength(3);
    expect(second.context.policies).toHaveLength(3);
    expect(f.state.fullReads).toBe(0);
  } finally {
    f.close();
  }
});

test("a new stale caller cannot reuse a live caller's recovered evidence", async () => {
  const f = await fixture();
  try {
    const cache: PrincipalPolicyCache = new Map();
    await f.collect(cache);
    const requests = f.requests.length;
    const error = await f
      .collect(cache, f.warmer, () => false)
      .catch((error: unknown) => error);
    expect(isProjectionVerificationCancelledError(error)).toBe(true);
    expect(f.requests).toHaveLength(requests);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("a cold offline cache miss is availability loss without a security incident", async () => {
  const f = await fixture();
  try {
    f.state.online = false;
    await expect(f.collect()).rejects.toMatchObject({
      name: "ProjectionDependencyUnavailableError",
    });
    expect(f.incidents).toEqual([]);
    expect(f.requests).toEqual([]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});
