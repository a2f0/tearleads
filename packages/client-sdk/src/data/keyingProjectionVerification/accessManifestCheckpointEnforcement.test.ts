import { expect, test } from "bun:test";
import {
  type AnyVerifiedAccessManifest,
  type KeyingVerificationCode,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { loadAccessManifestCheckpoint } from "../persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { enforceAccessManifestCheckpoints } from "./accessManifestCheckpointEnforcement";

const ORG = "org-1";
const OBJECT = "container-1";

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
  objectId?: string;
  prev: string | null;
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

async function enforce(input: {
  evidence: readonly AnyVerifiedAccessManifest[];
  execSql: ExecSql;
  heads: readonly AnyVerifiedAccessManifest[];
}): Promise<void> {
  await enforceAccessManifestCheckpoints({
    execSql: input.execSql,
    policies: [],
    verifiedHeads: input.heads,
    verifiedManifests: input.evidence,
  });
}

async function expectCheckpointCode(
  run: () => Promise<unknown>,
  code: KeyingVerificationCode,
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

test("first sight pins only explicitly declared heads", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    const head = manifestDouble({ epoch: 1, hash: "a1", prev: null });
    const evidenceOnly = manifestDouble({
      epoch: 7,
      hash: "b7",
      objectId: "former-parent",
      prev: "b6",
    });
    await enforce({
      evidence: [head, evidenceOnly],
      execSql,
      heads: [head],
    });

    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, OBJECT),
    ).resolves.toMatchObject({ epoch: 1, manifestHash: hex("a1") });
    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, "former-parent"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("hidden future history cannot satisfy a rolled-back declared head", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    const epoch2 = manifestDouble({ epoch: 2, hash: "h2", prev: "h1" });
    await enforce({ evidence: [epoch2], execSql, heads: [epoch2] });
    const epoch1 = manifestDouble({ epoch: 1, hash: "h1", prev: null });

    await expectCheckpointCode(
      () => enforce({ evidence: [epoch1, epoch2], execSql, heads: [epoch1] }),
      "rollback",
    );
    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, OBJECT),
    ).resolves.toMatchObject({ epoch: 2, manifestHash: hex("h2") });
  } finally {
    close();
  }
});

test("future history is rejected on first sight instead of becoming the pin", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    const epoch1 = manifestDouble({ epoch: 1, hash: "h1", prev: null });
    const epoch2 = manifestDouble({ epoch: 2, hash: "h2", prev: "h1" });
    await expectCheckpointCode(
      () => enforce({ evidence: [epoch1, epoch2], execSql, heads: [epoch1] }),
      "stale_predecessor",
    );
    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, OBJECT),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("gap extension requires a contiguous predecessor chain", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    const epoch1 = manifestDouble({ epoch: 1, hash: "h1", prev: null });
    await enforce({ evidence: [epoch1], execSql, heads: [epoch1] });
    const epoch2 = manifestDouble({ epoch: 2, hash: "h2", prev: "h1" });
    const epoch3 = manifestDouble({ epoch: 3, hash: "h3", prev: "h2" });
    const epoch4 = manifestDouble({ epoch: 4, hash: "h4", prev: "h3" });

    await enforce({
      evidence: [epoch4, epoch2, epoch3],
      execSql,
      heads: [epoch4],
    });
    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, OBJECT),
    ).resolves.toMatchObject({ epoch: 4, manifestHash: hex("h4") });
  } finally {
    close();
  }
});

test("a missing checkpoint predecessor hard-fails", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    const epoch1 = manifestDouble({ epoch: 1, hash: "h1", prev: null });
    await enforce({ evidence: [epoch1], execSql, heads: [epoch1] });
    const epoch2 = manifestDouble({ epoch: 2, hash: "h2", prev: "h1" });
    const epoch4 = manifestDouble({ epoch: 4, hash: "h4", prev: "h3" });

    await expectCheckpointCode(
      () => enforce({ evidence: [epoch2, epoch4], execSql, heads: [epoch4] }),
      "stale_predecessor",
    );
  } finally {
    close();
  }
});

test("conflicting explicit heads hard-fail as equivocation", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    const first = manifestDouble({ epoch: 2, hash: "h2", prev: "h1" });
    const second = manifestDouble({
      epoch: 2,
      hash: "h2-alt",
      prev: "h1",
    });
    await expectCheckpointCode(
      () =>
        enforce({ evidence: [first, second], execSql, heads: [first, second] }),
      "equivocation",
    );
  } finally {
    close();
  }
});

test("concurrent divergent first heads yield exactly one success", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    const first = manifestDouble({ epoch: 1, hash: "h1-a", prev: null });
    const second = manifestDouble({ epoch: 1, hash: "h1-b", prev: null });
    const results = await Promise.allSettled([
      enforce({ evidence: [first], execSql, heads: [first] }),
      enforce({ evidence: [second], execSql, heads: [second] }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(KeyingVerificationError);
      expect((rejected.reason as KeyingVerificationError).code).toBe(
        "equivocation",
      );
    }
  } finally {
    close();
  }
});

test("a failing batch leaves every candidate unchanged", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-enforce-test");
  try {
    const pinnedB = manifestDouble({
      epoch: 2,
      hash: "b2",
      objectId: "container-b",
      prev: "b1",
    });
    await enforce({ evidence: [pinnedB], execSql, heads: [pinnedB] });
    const newA = manifestDouble({
      epoch: 1,
      hash: "a1",
      objectId: "container-a",
      prev: null,
    });
    const staleB = manifestDouble({
      epoch: 1,
      hash: "b1",
      objectId: "container-b",
      prev: null,
    });

    await expectCheckpointCode(
      () =>
        enforce({ evidence: [newA, staleB], execSql, heads: [newA, staleB] }),
      "rollback",
    );
    await expect(
      loadAccessManifestCheckpoint(execSql, "container", ORG, "container-a"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
