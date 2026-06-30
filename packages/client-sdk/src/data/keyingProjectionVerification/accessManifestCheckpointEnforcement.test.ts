import { expect, test } from "bun:test";
import {
  type AnyVerifiedAccessManifest,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { enforceAccessManifestCheckpoints } from "./accessManifestCheckpointEnforcement";

const ORG = "org-1";
const OBJECT = "container-1";

// Manifest hashes are SHA-256 in production; the crypto checkpoint verifier
// rejects anything that is not a 64-character lowercase hex string. Derive a
// deterministic hex hash per seed label so chained predecessors line up.
function hex(seed: string): string {
  const chars = "0123456789abcdef";
  let out = "";
  for (let index = 0; index < 64; index += 1) {
    out += chars[(seed.charCodeAt(index % seed.length) * (index + 7)) % 16];
  }
  return out;
}

function manifestDouble(input: {
  epoch: number;
  hash: string;
  prev: string | null;
  objectId?: string;
}): AnyVerifiedAccessManifest {
  const objectId = input.objectId ?? OBJECT;
  const manifestHash = hex(input.hash);
  return {
    manifestHash,
    manifest: {
      previousManifestHash: input.prev === null ? null : hex(input.prev),
    },
    checkpoint: {
      objectKind: "container",
      objectId,
      organizationId: ORG,
      epoch: input.epoch,
      manifestHash,
    },
  } as unknown as AnyVerifiedAccessManifest;
}

async function expectCheckpointCode(
  run: () => Promise<unknown>,
  code: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KeyingVerificationError);
  expect((thrown as KeyingVerificationError).code).toBe(code);
}

test("first sight pins the head epoch with no checkpoint to compare against", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    await enforceAccessManifestCheckpoints({
      execSql,
      verifiedManifests: [manifestDouble({ epoch: 1, hash: "h1", prev: null })],
    });

    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, OBJECT),
    ).resolves.toEqual({
      objectKind: "container",
      objectId: OBJECT,
      organizationId: ORG,
      epoch: 1,
      manifestHash: hex("h1"),
    });
  } finally {
    close();
  }
});

test("re-serving the pinned head is accepted (same epoch, same hash)", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    const head = manifestDouble({ epoch: 2, hash: "h2", prev: "h1" });
    await enforceAccessManifestCheckpoints({
      execSql,
      verifiedManifests: [head],
    });
    await enforceAccessManifestCheckpoints({
      execSql,
      verifiedManifests: [head],
    });

    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, OBJECT),
    ).resolves.toMatchObject({ epoch: 2, manifestHash: hex("h2") });
  } finally {
    close();
  }
});

test("rollback to an older epoch hard-fails and leaves the pin untouched", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    await enforceAccessManifestCheckpoints({
      execSql,
      verifiedManifests: [manifestDouble({ epoch: 2, hash: "h2", prev: "h1" })],
    });

    await expectCheckpointCode(
      () =>
        enforceAccessManifestCheckpoints({
          execSql,
          verifiedManifests: [
            manifestDouble({ epoch: 1, hash: "h1", prev: null }),
          ],
        }),
      "rollback",
    );

    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, OBJECT),
    ).resolves.toMatchObject({ epoch: 2, manifestHash: hex("h2") });
  } finally {
    close();
  }
});

test("a conflicting hash at the pinned epoch hard-fails as equivocation", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    await enforceAccessManifestCheckpoints({
      execSql,
      verifiedManifests: [manifestDouble({ epoch: 2, hash: "h2", prev: "h1" })],
    });

    await expectCheckpointCode(
      () =>
        enforceAccessManifestCheckpoints({
          execSql,
          verifiedManifests: [
            manifestDouble({ epoch: 2, hash: "h2-alt", prev: "h1" }),
          ],
        }),
      "equivocation",
    );
  } finally {
    close();
  }
});

test("gap extension with a contiguous predecessor chain is accepted and re-pins the head", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    await enforceAccessManifestCheckpoints({
      execSql,
      verifiedManifests: [manifestDouble({ epoch: 1, hash: "h1", prev: null })],
    });

    await enforceAccessManifestCheckpoints({
      execSql,
      verifiedManifests: [
        manifestDouble({ epoch: 4, hash: "h4", prev: "h3" }),
        manifestDouble({ epoch: 2, hash: "h2", prev: "h1" }),
        manifestDouble({ epoch: 3, hash: "h3", prev: "h2" }),
      ],
    });

    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, OBJECT),
    ).resolves.toMatchObject({ epoch: 4, manifestHash: hex("h4") });
  } finally {
    close();
  }
});

test("gap extension with a missing predecessor hard-fails as stale_predecessor", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    await enforceAccessManifestCheckpoints({
      execSql,
      verifiedManifests: [manifestDouble({ epoch: 1, hash: "h1", prev: null })],
    });

    await expectCheckpointCode(
      () =>
        enforceAccessManifestCheckpoints({
          execSql,
          verifiedManifests: [
            // epoch 3 is missing, so the head cannot chain back to the pin.
            manifestDouble({ epoch: 4, hash: "h4", prev: "h3" }),
            manifestDouble({ epoch: 2, hash: "h2", prev: "h1" }),
          ],
        }),
      "stale_predecessor",
    );
  } finally {
    close();
  }
});

test("two distinct manifests at the head epoch are rejected as in-projection equivocation", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    await expect(
      enforceAccessManifestCheckpoints({
        execSql,
        verifiedManifests: [
          manifestDouble({ epoch: 2, hash: "h2", prev: "h1" }),
          manifestDouble({ epoch: 2, hash: "h2-alt", prev: "h1" }),
        ],
      }),
    ).rejects.toThrow(/equivocates at epoch 2/);
  } finally {
    close();
  }
});

test("each object is pinned independently within one projection", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    await enforceAccessManifestCheckpoints({
      execSql,
      verifiedManifests: [
        manifestDouble({
          epoch: 5,
          hash: "a5",
          prev: "a4",
          objectId: "container-a",
        }),
        manifestDouble({
          epoch: 2,
          hash: "b2",
          prev: "b1",
          objectId: "container-b",
        }),
      ],
    });

    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, "container-a"),
    ).resolves.toMatchObject({ epoch: 5, manifestHash: hex("a5") });
    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, "container-b"),
    ).resolves.toMatchObject({ epoch: 2, manifestHash: hex("b2") });
  } finally {
    close();
  }
});

test("without a database handle enforcement is a no-op", async () => {
  await expect(
    enforceAccessManifestCheckpoints({
      execSql: undefined,
      verifiedManifests: [manifestDouble({ epoch: 1, hash: "h1", prev: null })],
    }),
  ).resolves.toBeUndefined();
});
