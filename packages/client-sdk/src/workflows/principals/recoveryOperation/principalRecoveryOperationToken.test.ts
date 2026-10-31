import { beforeAll, expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS,
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import {
  createProjectionCheckpointContext,
  type ProjectionCheckpointContext,
} from "../../../data/keyingProjectionVerification/checkpoints/checkpointContext";
import { collectReferencedPrincipalPolicies } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyVerification";
import type { ReferencedPrincipalPolicyWarmer } from "../../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { getOrCreatePrincipalPolicyCoordinator } from "../../../data/principals/principalPolicyCoordinator";
import {
  createPrincipalPolicyOperation,
  createRuntimePrincipalPolicyWarmer,
  type PrincipalPolicyOperation,
} from "../runtimePolicyWarmer";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS);

async function fixture() {
  const source = await createAuthorityRecoveryFixture(history);
  await loadPrincipalPolicyCheckpoint(
    source.options.execSql,
    "group",
    history.group.currentState.principalId,
  );
  const incidents: unknown[] = [];
  // Each step of a pass builds its own warmer, as production call sites do;
  // only the pass's token can make them share a discovery.
  const warmer = (operation?: PrincipalPolicyOperation) =>
    createRuntimePrincipalPolicyWarmer(
      {
        apiClient: createMockApiClient({
          getPrincipalPolicyPages:
            source.apiClient.getPrincipalPolicyPages.bind(source.apiClient),
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
      },
      { operation },
    );
  const collect = async (warm: ReferencedPrincipalPolicyWarmer) => {
    const context = createProjectionCheckpointContext(source.options);
    await collectReferencedPrincipalPolicies({
      checkpointContext: context,
      organizationId: history.organizationId,
      principalPolicyCache: new Map(),
      references: [principalPolicyHead(history.created)],
      resolveUserKey: source.options.resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies: warm,
    });
    return directoryHash(context);
  };
  const discoveries = () =>
    source.requests.filter(
      (request) =>
        request.principalId === history.organizationId &&
        request.afterVersion === 0,
    ).length;
  return { ...source, warmer, collect, discoveries, incidents };
}

function directoryHash(context: ProjectionCheckpointContext) {
  return context.policies.find(
    (policy) => policy.principalType === "organization",
  )?.stateHash;
}

async function advanceDirectory(f: Awaited<ReturnType<typeof fixture>>) {
  const admin = await history.extend(history.admin, 67);
  const directory = await history.advanceDirectory(history.directory, admin);
  f.policies.set(admin.currentState.principalId, admin);
  f.policies.set(history.organizationId, directory);
  return directory.currentState.stateHash;
}

test("warmers built for one pass share its directory discovery", async () => {
  const f = await fixture();
  try {
    const pass = createPrincipalPolicyOperation();
    await f.collect(f.warmer(pass));
    const discovered = f.discoveries();
    await f.collect(f.warmer(pass));
    await f.collect(f.warmer(pass));
    expect(f.discoveries()).toBe(discovered);
    // Warmers without the pass's token are separate operations.
    await f.collect(f.warmer());
    await f.collect(f.warmer());
    expect(f.discoveries()).toBe(discovered + 2);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
}, 30_000);

test("a pass's directory dies with the pass, and with any organization hint", async () => {
  const f = await fixture();
  try {
    const pass = createPrincipalPolicyOperation();
    await f.collect(f.warmer(pass));
    const successor = await advanceDirectory(f);
    // The pass keeps the view it discovered; the next pass discovers again.
    expect(await f.collect(f.warmer(pass))).toBe(
      history.directory.currentState.stateHash,
    );
    expect(await f.collect(f.warmer(createPrincipalPolicyOperation()))).toBe(
      successor,
    );

    const next = createPrincipalPolicyOperation();
    await f.collect(f.warmer(next));
    const discovered = f.discoveries();
    getOrCreatePrincipalPolicyCoordinator(f.options.execSql).invalidateRecovery(
      history.organizationId,
    );
    await f.collect(f.warmer(next));
    expect(f.discoveries()).toBe(discovered + 1);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
}, 30_000);
