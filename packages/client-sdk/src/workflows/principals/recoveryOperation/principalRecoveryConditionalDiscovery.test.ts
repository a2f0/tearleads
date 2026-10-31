import { beforeAll, expect, test } from "bun:test";
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
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { createRuntimePrincipalPolicyWarmer } from "../runtimePolicyWarmer";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS);

async function fixture() {
  const source = await createAuthorityRecoveryFixture(history);
  source.controls.conditional = true;
  await loadPrincipalPolicyCheckpoint(
    source.options.execSql,
    "group",
    history.group.currentState.principalId,
  );
  const incidents: unknown[] = [];
  // Each warmer is one operation and discovers the directory once.
  const operation = () =>
    createRuntimePrincipalPolicyWarmer({
      apiClient: source.apiClient,
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
  const collect = async () => {
    const context = createProjectionCheckpointContext(source.options);
    await collectReferencedPrincipalPolicies({
      checkpointContext: context,
      organizationId: history.organizationId,
      principalPolicyCache: new Map(),
      references: [principalPolicyHead(history.created)],
      resolveUserKey: source.options.resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies: operation(),
    });
    return directoryHash(context);
  };
  const directoryReads = () =>
    source.requests.filter(
      (request) => request.principalId === history.organizationId,
    );
  return { ...source, collect, directoryReads, incidents };
}

function directoryHash(context: ProjectionCheckpointContext) {
  return context.policies.find(
    (policy) => policy.principalType === "organization",
  )?.stateHash;
}

/** A rotation commits an Admins successor together with its directory. */
async function advanceDirectory(f: Awaited<ReturnType<typeof fixture>>) {
  const admin = await history.extend(history.admin, 67);
  const directory = await history.advanceDirectory(history.directory, admin);
  f.policies.set(admin.currentState.principalId, admin);
  f.policies.set(history.organizationId, directory);
  return directory;
}

test("a held directory head is rediscovered as a bare head", async () => {
  const f = await fixture();
  try {
    expect(await f.collect()).toBe(history.directory.currentState.stateHash);
    const first = f.directoryReads().length;
    // Nothing held yet: the first discovery is an unconditional page read.
    expect(f.directoryReads().some((read) => "unchanged" in read)).toBe(false);

    expect(await f.collect()).toBe(history.directory.currentState.stateHash);
    // The next operation names its held head and reads no page at all.
    expect(f.directoryReads().slice(first)).toEqual([
      {
        principalId: history.organizationId,
        afterVersion: 0,
        count: 0,
        unchanged: true,
      },
    ]);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
}, 30_000);

test("an advanced directory answers a conditional read with its page", async () => {
  const f = await fixture();
  try {
    await f.collect();
    const successor = await advanceDirectory(f);
    const before = f.directoryReads().length;
    expect(await f.collect()).toBe(successor.currentState.stateHash);
    const reads = f.directoryReads().slice(before);
    expect(reads[0]).toMatchObject({ unchanged: false });
    expect(reads.some((read) => read.count > 0)).toBe(true);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
}, 30_000);

test("a bare head the client does not hold falls back to an unconditional read", async () => {
  const f = await fixture();
  try {
    await f.collect();
    const successor = await advanceDirectory(f);
    // A reply naming a head other than the held one is not a match: the held
    // directory is never reused on its strength.
    f.controls.forcedUnchangedHead = principalPolicyHead(successor);
    const before = f.directoryReads().length;
    expect(await f.collect()).toBe(successor.currentState.stateHash);
    const reads = f.directoryReads().slice(before);
    expect(reads[0]).toMatchObject({ unchanged: true });
    expect(reads.slice(1).some((read) => !("unchanged" in read))).toBe(true);
    expect(f.incidents).toEqual([]);
  } finally {
    f.close();
  }
}, 30_000);
