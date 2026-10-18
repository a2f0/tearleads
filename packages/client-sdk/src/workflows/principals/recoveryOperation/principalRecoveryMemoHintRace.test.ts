import { beforeAll, expect, test } from "bun:test";
import {
  AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS,
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { getOrCreatePrincipalPolicyCoordinator } from "../../../data/principals/principalPolicyCoordinator";
import { createExecSql } from "../../../data/sqlite/sqlSchema";
import {
  createPrincipalRecoveryReader,
  type PrincipalRecoveryMemo,
} from "./principalRecoveryMemo";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS);

const CHECKPOINT_READ = 'from "principal_policy_checkpoints"';

/** Deliver an organization hint during the nth later durable-pin read. */
async function fixture() {
  const source = await createAuthorityRecoveryFixture(history);
  const hint = { remaining: 0 };
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      const rows =
        rowMode === "array"
          ? await source.options.execSql(sql, bind, { rowMode: "array" })
          : await source.options.execSql(sql, bind);
      if (hint.remaining > 0 && sql.includes(CHECKPOINT_READ)) {
        hint.remaining -= 1;
        if (hint.remaining === 0)
          getOrCreatePrincipalPolicyCoordinator(execSql).invalidateRecovery(
            history.organizationId,
          );
      }
      return { rows };
    },
  });
  const memo: PrincipalRecoveryMemo = {
    directories: new Map(),
    admins: new Map(),
  };
  const options = { ...source.options, execSql };
  const entry = history.directory.previousStates[31];
  if (!entry) throw new Error("Missing directory predecessor");
  const reference = principalPolicyHead({
    ...history.directory,
    currentState: entry.state,
  });
  // A rotation commits a directory successor; only rediscovery observes it.
  const advance = async () => {
    const admin = await history.extend(history.admin, 67);
    const directory = await history.advanceDirectory(history.directory, admin);
    source.policies.set(admin.currentState.principalId, admin);
    source.policies.set(history.organizationId, directory);
    return directory.currentState.stateHash;
  };
  return { ...source, hint, memo, options, reference, advance };
}

test("a hint while a reused directory is validated evicts it", async () => {
  const f = await fixture();
  try {
    const reader = createPrincipalRecoveryReader(f.options, f.memo);
    await reader.directory([]);
    const successor = await f.advance();
    // The first pin read validates the reused directory.
    f.hint.remaining = 1;
    expect((await reader.directory([f.reference])).policy.stateHash).toBe(
      successor,
    );
    expect((await reader.directory([f.reference])).policy.stateHash).toBe(
      successor,
    );
  } finally {
    f.close();
  }
});

test("a citation derived from a pre-hint directory keeps the source epoch", async () => {
  const f = await fixture();
  try {
    const reader = createPrincipalRecoveryReader(f.options, f.memo);
    const first = await reader.directory([]);
    await reader.directory([f.reference]);
    const successor = await f.advance();
    // The source directory validates before the hint; the hint then lands
    // while the stored citation is validated, so the citation is derived
    // again from the pre-hint source and must keep that source's epoch.
    f.hint.remaining = 1 + first.descriptor.groupHeads.length + 1;
    const inFlight = await reader.directory([f.reference]);
    expect(inFlight.policy.stateHash).toBe(first.policy.stateHash);
    expect((await reader.directory([f.reference])).policy.stateHash).toBe(
      successor,
    );
  } finally {
    f.close();
  }
});
