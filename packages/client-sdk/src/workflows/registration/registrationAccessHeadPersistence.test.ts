import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  type LocallyAcknowledgedAccessManifestHead,
} from "../../data/persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { seedRegistrationAccessHeads } from "./registrationAccessHeadPersistence";

async function seedHeads(
  execSql: ExecSql,
  heads: readonly LocallyAcknowledgedAccessManifestHead[],
) {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    const { result } = await getClientSQLitePersistenceRuntime(
      lockedExecSql,
    ).guardedTransaction(
      () =>
        seedRegistrationAccessHeads({
          execSql: lockedExecSql,
          heads,
          organizationId,
        }),
      () => true,
    );
    if (!result) throw new Error("Expected registration transaction to commit");
    return result;
  });
}

const organizationId = "registration-organization";
const genesis: LocallyAcknowledgedAccessManifestHead = {
  checkpoint: {
    epoch: 1,
    manifestHash: "1".repeat(64),
    objectId: "existing-container",
    objectKind: "container",
    organizationId,
  },
  previousManifestHash: null,
};
const sibling: LocallyAcknowledgedAccessManifestHead = {
  ...genesis,
  checkpoint: { ...genesis.checkpoint, objectId: "missing-sibling" },
};

const cases = [
  {
    name: "repeated access head",
    heads: [genesis, genesis],
    code: "equivocation",
    message: "Registration repeats an access head",
  },
  {
    name: "non-genesis epoch",
    heads: [{ ...genesis, checkpoint: { ...genesis.checkpoint, epoch: 2 } }],
    code: "invalid_shape",
    message: "Registration must acknowledge this organization's genesis heads",
  },
  {
    name: "genesis with a predecessor",
    heads: [{ ...genesis, previousManifestHash: "f".repeat(64) }],
    code: "invalid_shape",
    message: "Registration must acknowledge this organization's genesis heads",
  },
  {
    name: "foreign organization",
    heads: [
      {
        ...genesis,
        checkpoint: { ...genesis.checkpoint, organizationId: "foreign-org" },
      },
    ],
    code: "invalid_shape",
    message: "Registration must acknowledge this organization's genesis heads",
  },
];

test.each(cases)(
  "registration rejects $name before seeding any sibling",
  async ({ heads, code, message }) => {
    const { close, execSql } = await createTestExecSql(
      "registration-head-guard",
    );
    try {
      await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
        execSql,
        heads: [genesis],
      });
      for (const epoch of [2, 3]) {
        await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
          execSql,
          heads: [
            {
              checkpoint: {
                ...genesis.checkpoint,
                epoch,
                manifestHash: String(epoch).repeat(64),
              },
              previousManifestHash: String(epoch - 1).repeat(64),
            },
          ],
        });
      }
      // Retained heads bypass ordinary advancement, including its duplicate
      // and predecessor checks. The registration guards must still run.
      const canSeed = await seedHeads(execSql, [genesis]);
      expect(canSeed("container", genesis.checkpoint.objectId)).toBe(false);
      expect(canSeed("container", sibling.checkpoint.objectId)).toBe(true);
      const before = await execSql("SELECT * FROM access_manifest_checkpoints");
      expect(before).toMatchObject([
        { epoch: 3, manifest_hash: "3".repeat(64) },
      ]);

      const error = await seedHeads(execSql, [sibling, ...heads]).then(
        () => null,
        (cause: unknown) => cause,
      );
      expect(error).toMatchObject({
        name: "KeyingVerificationError",
        code,
        message,
      });
      expect(
        await execSql("SELECT * FROM access_manifest_checkpoints"),
      ).toEqual(before);
    } finally {
      close();
    }
  },
);
