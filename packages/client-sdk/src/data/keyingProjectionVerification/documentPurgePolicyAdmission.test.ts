import { expect, test } from "bun:test";
import { signedRecoveryHistory } from "../../../test/helpers/principalHistoryRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import { recoverPublicPrincipalHistory } from "../../workflows/principals/recoverPublicPrincipalHistory";
import { selectPublicPrincipalHistory } from "../../workflows/principals/selectPublicPrincipalHistory";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { ensurePrincipalPolicyTables } from "../persistence/principalPolicyPersistence";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { admitDocumentPurgePolicyCheckpoints } from "./documentPurgePolicyCheckpoints";

for (const existing of [false, true]) {
  test(`terminal admission selects its source within newer verified history (existing pin: ${existing})`, async () => {
    const history = await signedRecoveryHistory(3);
    const fixture = await createPublicHistoryFixture(history);
    const source = history.bundle.previousStates[0]?.state;
    if (!source) throw new Error("Missing historical source");
    const reference = {
      ...principalPolicyHead(history.bundle),
      version: source.version,
      stateHash: source.stateHash,
      keyEpoch: source.keyEpoch,
      keyFingerprint: source.keyFingerprint,
    };
    try {
      const recovered = await recoverPublicPrincipalHistory(fixture.options);
      const policies = await selectPublicPrincipalHistory({
        execSql: fixture.options.execSql,
        recovered,
        references: [reference],
        checkpoint: null,
        stillCurrent: () => true,
      });
      expect(policies[0]?.version).toBe(3);
      expect(
        await loadPrincipalPolicyCheckpoint(
          fixture.options.execSql,
          reference.principalType,
          reference.principalId,
        ),
      ).toBeNull();
      await ensurePrincipalPolicyTables(fixture.options.execSql);
      const runtime = getClientSQLitePersistenceRuntime(
        fixture.options.execSql,
      );
      if (existing)
        await runtime.transaction((transaction) =>
          admitDocumentPurgePolicyCheckpoints({
            transaction,
            organizationId: fixture.options.organizationId,
            policies,
            heads: [principalPolicyHead(history.bundle)],
          }),
        );
      await runtime.transaction((transaction) =>
        admitDocumentPurgePolicyCheckpoints({
          transaction,
          organizationId: fixture.options.organizationId,
          policies,
          heads: [reference],
        }),
      );
      expect(
        await loadPrincipalPolicyCheckpoint(
          fixture.options.execSql,
          reference.principalType,
          reference.principalId,
        ),
      ).toMatchObject({
        version: existing ? 3 : 1,
        stateHash: existing
          ? history.bundle.currentState.stateHash
          : source.stateHash,
      });
      await expect(
        runtime.transaction((transaction) =>
          admitDocumentPurgePolicyCheckpoints({
            transaction,
            organizationId: fixture.options.organizationId,
            policies,
            heads: [{ ...reference, stateHash: "f".repeat(64) }],
          }),
        ),
      ).rejects.toMatchObject({ code: "missing_dependency" });
    } finally {
      fixture.close();
    }
  });
}
