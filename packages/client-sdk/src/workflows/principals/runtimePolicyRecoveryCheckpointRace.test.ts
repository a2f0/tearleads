import { beforeAll, expect, test } from "bun:test";
import {
  AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS,
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import {
  commitProjectionCheckpoints,
  createProjectionCheckpointContext,
} from "../../data/keyingProjectionVerification/checkpointContext";
import { resolveReferencedPrincipalPolicy } from "../../data/keyingProjectionVerification/resolvedPrincipalPolicy";
import type { PrincipalPolicyResolveRequest } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyResolver } from "./runtimePolicyRecovery";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS);

async function fixture(kind: "target" | "dependency", updateServer = true) {
  const f = await createAuthorityRecoveryFixture(history);
  const previous = kind === "target" ? history.group : history.admin;
  const advanced = await history.extend(previous, 67);
  const directory = await history.advanceDirectory(history.directory, advanced);
  const incidents: unknown[] = [];
  let resolutions = 0;
  const resolve = createRuntimePrincipalPolicyResolver({
    apiClient: f.options.apiClient,
    infra: { execSql: f.options.execSql },
    withPrincipalHistoryProtection: (operation) =>
      operation({
        protection: f.options.protection,
        stillCurrent: () => true,
      }),
    resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
    util: {
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    },
  });
  if (!resolve) throw new Error("Expected private paged recovery");
  const context = createProjectionCheckpointContext(f.options);
  const collect = () =>
    resolveReferencedPrincipalPolicy({
      recoveryBatch: {},
      checkpointContext: context,
      organizationId: history.organizationId,
      principalPolicyCache: new Map(),
      reference: principalPolicyHead(history.created),
      warmReferencedPrincipalPolicies: Object.assign(async () => undefined, {
        resolveReference: async (input: PrincipalPolicyResolveRequest) => {
          resolutions += 1;
          const recovered = await resolve(input);
          if (resolutions === 1) {
            // Another authenticated operation commits between recovery and
            // projection admission. Its signed successor remains available.
            if (updateServer) {
              f.policies.set(advanced.currentState.principalId, advanced);
              f.policies.set(history.organizationId, directory);
            }
            await f.db
              .insert(principalPolicyCheckpoints)
              .values({
                principalType: "group",
                principalId: advanced.currentState.principalId,
                version: advanced.currentState.version,
                stateHash: advanced.currentState.stateHash,
                updatedAt: advanced.currentState.createdAt,
              })
              .run();
          }
          return recovered;
        },
      }),
    });
  return {
    ...f,
    advanced,
    collect,
    context,
    incidents,
    resolutionCount: () => resolutions,
  };
}

test.each(["target", "dependency"] as const)(
  "projection recovery refreshes a concurrently advanced %s checkpoint",
  async (kind) => {
    const f = await fixture(kind);
    try {
      const recovered = await f.collect();
      expect(recovered?.version).toBe(kind === "target" ? 67 : 66);
      expect(
        f.context.policies.find(
          (policy) =>
            policy.principalId === f.advanced.currentState.principalId,
        )?.stateHash,
      ).toBe(f.advanced.currentState.stateHash);
      await commitProjectionCheckpoints(f.context);
      expect(f.incidents).toEqual([]);
      expect(f.resolutionCount()).toBe(2);
    } finally {
      f.close();
    }
  },
);

test.each(["target", "dependency"] as const)(
  "fresh recovery still refuses server rollback behind the advanced %s pin",
  async (kind) => {
    const f = await fixture(kind, false);
    try {
      await expect(f.collect()).rejects.toMatchObject({ code: "rollback" });
      expect(f.resolutionCount()).toBeLessThanOrEqual(2);
      expect(f.context.policies).toEqual([]);
      expect(
        await loadPrincipalPolicyCheckpoint(
          f.options.execSql,
          "group",
          f.advanced.currentState.principalId,
        ),
      ).toMatchObject({
        version: 67,
        stateHash: f.advanced.currentState.stateHash,
      });
    } finally {
      f.close();
    }
  },
);
