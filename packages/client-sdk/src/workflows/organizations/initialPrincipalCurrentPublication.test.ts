import { beforeAll, expect, test } from "bun:test";
import { initialCurrentPublicationFixture } from "../../../test/helpers/initialCurrentPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  principalHistoryEntries,
  principalHistoryPrefixes,
} from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { recoverPrincipalPolicyHistory } from "../principals/recoverPrincipalPolicyHistory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test("genesis and its directory successor publish atomically without a predecessor or HTTP", async () => {
  const f = await initialCurrentPublicationFixture(history);
  try {
    const reads = f.requests.length;
    const before = await f.db.select().from(principalHistoryEntries);
    const policies = await retainAcknowledgedPrincipalCurrents(f.publication);
    expect(policies.map((policy) => policy.version)).toEqual([1, 67]);
    expect(policies[0]?.retainedHistory).toHaveLength(1);
    expect(await f.db.select().from(principalHistoryEntries)).toHaveLength(
      before.length + 2,
    );
    const first = f.publication.entries[0];
    if (!first) throw new Error("Missing genesis");
    const recovered = await recoverPrincipalPolicyHistory({
      ...first.recovery,
      execSql: f.options.execSql,
      organizationId: history.organizationId,
      offline: true,
      stillCurrent: () => true,
    });
    expect(recovered.policy.stateHash).toBe(f.initial.currentState.stateHash);
    expect(recovered.current).not.toHaveProperty("previousStates");
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        f.initial.currentState.principalId,
      ),
    ).toEqual(recovered.policy.checkpoint);
    expect(f.requests).toHaveLength(reads);
  } finally {
    f.close();
  }
});

test.each([
  "directoryReceipt",
  "signature",
  "notGenesis",
  "missingDirectory",
  "strictMode",
  "expired",
] as const)(
  "invalid initial publication (%s) admits neither group nor directory successor",
  async (mode) => {
    const f = await initialCurrentPublicationFixture(
      history,
      mode === "signature",
    );
    try {
      const [group, directory] = f.publication.entries;
      if (!group || !directory) throw new Error("Missing coupled publication");
      const before = await f.db.select().from(principalHistoryPrefixes);
      if (mode === "directoryReceipt")
        directory.response.currentState.signature = "invalid";
      if (mode === "notGenesis") group.request.state.version = 2;
      if (mode === "missingDirectory") f.publication.entries.pop();
      if (mode === "strictMode")
        f.publication.entries[0] = {
          ...group,
          recovery: { ...group.recovery, historyVerification: "direct-admins" },
        };
      if (mode === "expired") f.lifetime.current = false;
      const pending = retainAcknowledgedPrincipalCurrents(f.publication);
      if (mode === "signature")
        await expect(pending).rejects.toMatchObject({
          code: "signature_mismatch",
        });
      else await expect(pending).rejects.toThrow();
      expect(await f.db.select().from(principalHistoryPrefixes)).toEqual(
        before,
      );
      expect(
        await loadPrincipalPolicyCheckpoint(
          f.options.execSql,
          "group",
          f.initial.currentState.principalId,
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

test.each([1, 2])(
  "genesis refuses an existing conflicting pin at version %s",
  async (version) => {
    const f = await initialCurrentPublicationFixture(history);
    try {
      const prior = {
        principalType: "group",
        principalId: f.initial.currentState.principalId,
        version,
        stateHash: "f".repeat(64),
        updatedAt: new Date().toISOString(),
      };
      await f.db.insert(principalPolicyCheckpoints).values(prior).run();
      const prefixes = await f.db.select().from(principalHistoryPrefixes);
      await expect(
        retainAcknowledgedPrincipalCurrents(f.publication),
      ).rejects.toMatchObject({
        code: version === 1 ? "equivocation" : "rollback",
      });
      expect(await f.db.select().from(principalHistoryPrefixes)).toEqual(
        prefixes,
      );
      expect(
        await loadPrincipalPolicyCheckpoint(
          f.options.execSql,
          "group",
          prior.principalId,
        ),
      ).toMatchObject({ version, stateHash: prior.stateHash });
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

test("failure publishing the directory rolls back a newly admitted genesis", async () => {
  const f = await initialCurrentPublicationFixture(history);
  try {
    const before = await f.db.select().from(principalHistoryEntries);
    const prefixes = await f.db.select().from(principalHistoryPrefixes);
    await f.options.execSql(`CREATE TRIGGER reject_genesis_directory
      BEFORE INSERT ON principal_policy_checkpoints
      WHEN NEW.principal_type = 'organization'
      BEGIN SELECT RAISE(ABORT, 'injected genesis directory failure'); END`);
    await expect(
      retainAcknowledgedPrincipalCurrents(f.publication),
    ).rejects.toThrow('insert into "principal_policy_checkpoints"');
    expect(await f.db.select().from(principalHistoryEntries)).toEqual(before);
    expect(await f.db.select().from(principalHistoryPrefixes)).toEqual(
      prefixes,
    );
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        f.initial.currentState.principalId,
      ),
    ).toBeNull();
  } finally {
    f.close();
  }
});
