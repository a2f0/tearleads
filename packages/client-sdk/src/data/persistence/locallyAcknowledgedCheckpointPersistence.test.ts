import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { loadAccessManifestCheckpoint } from "./keyingCheckpointPersistence";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  type LocallyAcknowledgedAccessManifestHead,
} from "./locallyAcknowledgedCheckpointPersistence";

const manifestHash = (digit: string): string => digit.repeat(64);

function head(input: {
  epoch: number;
  manifestHash: string;
  objectId?: string | undefined;
  previousManifestHash: string | null;
}): LocallyAcknowledgedAccessManifestHead {
  return {
    checkpoint: {
      epoch: input.epoch,
      manifestHash: input.manifestHash,
      objectId: input.objectId ?? "container-1",
      objectKind: "container",
      organizationId: "organization-1",
    },
    previousManifestHash: input.previousManifestHash,
  };
}

test("locally acknowledged heads advance only through a direct chain", async () => {
  const { close, execSql } = await createTestExecSql(
    "locally-acknowledged-direct-chain",
  );
  const epoch1 = head({
    epoch: 1,
    manifestHash: manifestHash("1"),
    previousManifestHash: null,
  });
  const epoch2 = head({
    epoch: 2,
    manifestHash: manifestHash("2"),
    previousManifestHash: manifestHash("1"),
  });

  try {
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [epoch1],
    });
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [epoch1],
    });
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [epoch2],
    });

    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        "organization-1",
        "container-1",
      ),
    ).resolves.toMatchObject({ epoch: 2, manifestHash: manifestHash("2") });
  } finally {
    close();
  }
});

test.each([
  {
    code: "rollback",
    rejected: head({
      epoch: 1,
      manifestHash: manifestHash("1"),
      previousManifestHash: null,
    }),
  },
  {
    code: "equivocation",
    rejected: head({
      epoch: 2,
      manifestHash: manifestHash("3"),
      previousManifestHash: manifestHash("1"),
    }),
  },
  {
    code: "stale_predecessor",
    rejected: head({
      epoch: 4,
      manifestHash: manifestHash("4"),
      previousManifestHash: manifestHash("3"),
    }),
  },
])("locally acknowledged heads reject $code", async ({ code, rejected }) => {
  const { close, execSql } = await createTestExecSql(
    `locally-acknowledged-${code}`,
  );
  const epoch2 = head({
    epoch: 2,
    manifestHash: manifestHash("2"),
    previousManifestHash: manifestHash("1"),
  });

  try {
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [
        head({
          epoch: 1,
          manifestHash: manifestHash("1"),
          previousManifestHash: null,
        }),
      ],
    });
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [epoch2],
    });

    let thrown: unknown;
    try {
      await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
        execSql,
        heads: [rejected],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KeyingVerificationError);
    expect((thrown as KeyingVerificationError).code).toBe(code);
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        "organization-1",
        "container-1",
      ),
    ).resolves.toMatchObject({ epoch: 2, manifestHash: manifestHash("2") });
  } finally {
    close();
  }
});

test("locally acknowledged batches roll back every head on conflict", async () => {
  const { close, execSql } = await createTestExecSql(
    "locally-acknowledged-batch",
  );

  try {
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [
        head({
          epoch: 1,
          manifestHash: manifestHash("1"),
          objectId: "existing",
          previousManifestHash: null,
        }),
      ],
    });
    await expect(
      advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
        execSql,
        heads: [
          head({
            epoch: 1,
            manifestHash: manifestHash("2"),
            objectId: "new",
            previousManifestHash: null,
          }),
          head({
            epoch: 1,
            manifestHash: manifestHash("3"),
            objectId: "existing",
            previousManifestHash: null,
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: "equivocation" });
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        "organization-1",
        "new",
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
