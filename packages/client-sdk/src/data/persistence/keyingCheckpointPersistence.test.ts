import { expect, test } from "bun:test";
import {
  type AnyVerifiedAccessManifest,
  KeyingVerificationError,
  type VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import { advanceKeyingCheckpointsAtomically } from "./keyingCheckpointAdvancePersistence";
import {
  loadAccessManifestCheckpoint,
  loadPrincipalPolicyCheckpoint,
} from "./keyingCheckpointPersistence";

function hash(seed: string): string {
  return seed.padEnd(64, "0").slice(0, 64);
}

function manifestDouble(input: {
  epoch: number;
  hash: string;
  objectId?: string;
  prev: string | null;
}): AnyVerifiedAccessManifest {
  const manifestHash = hash(input.hash);
  return {
    checkpoint: {
      epoch: input.epoch,
      manifestHash,
      objectId: input.objectId ?? "container-1",
      objectKind: "container",
      organizationId: "org-1",
    },
    manifest: {
      previousManifestHash: input.prev === null ? null : hash(input.prev),
    },
    manifestHash,
  } as unknown as AnyVerifiedAccessManifest;
}

function policyDouble(input: {
  principalId?: string;
  stateHashes: readonly string[];
}): VerifiedPrincipalPolicy {
  const version = input.stateHashes.length;
  const stateHash = hash(input.stateHashes.at(-1) ?? "missing");
  const principalId = input.principalId ?? "group-1";
  const history = input.stateHashes.map((value, index) => ({
    state: {
      principalId,
      principalType: "group" as const,
      stateHash: hash(value),
      version: index + 1,
    },
  }));
  return {
    checkpoint: {
      principalId,
      principalType: "group",
      stateHash,
      version,
    },
    history,
    principalId,
    principalType: "group",
    state: history.at(-1)?.state,
    stateHash,
    version,
  } as unknown as VerifiedPrincipalPolicy;
}

test("atomic advance stores and reloads access and policy pins", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-persistence");
  try {
    const manifest = manifestDouble({ epoch: 1, hash: "a1", prev: null });
    const policy = policyDouble({ stateHashes: ["p1"] });
    await advanceKeyingCheckpointsAtomically({
      access: [{ head: manifest, predecessors: [] }],
      execSql,
      policies: [policy],
    });

    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        "org-1",
        "container-1",
      ),
    ).resolves.toEqual(manifest.checkpoint);
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"),
    ).resolves.toEqual(policy.checkpoint);
  } finally {
    close();
  }
});

test("concurrent divergent policy pins yield exactly one success", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-persistence");
  try {
    const first = policyDouble({ stateHashes: ["first"] });
    const second = policyDouble({ stateHashes: ["second"] });
    const results = await Promise.allSettled(
      [first, second].map((policy) =>
        advanceKeyingCheckpointsAtomically({
          access: [],
          execSql,
          policies: [policy],
        }),
      ),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status !== "rejected") {
      throw new Error("Expected one rejected policy checkpoint advance");
    }
    expect(rejected.reason).toBeInstanceOf(KeyingVerificationError);
    expect((rejected.reason as KeyingVerificationError).code).toBe(
      "equivocation",
    );
  } finally {
    close();
  }
});

test("a policy rollback prevents access pins in the same batch", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-persistence");
  try {
    const policy2 = policyDouble({ stateHashes: ["p1", "p2"] });
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql,
      policies: [policy2],
    });
    const access = manifestDouble({ epoch: 1, hash: "a1", prev: null });
    const policy1 = policyDouble({ stateHashes: ["p1"] });

    await expect(
      advanceKeyingCheckpointsAtomically({
        access: [{ head: access, predecessors: [] }],
        execSql,
        policies: [policy1],
      }),
    ).rejects.toMatchObject({ code: "rollback" });
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        "org-1",
        "container-1",
      ),
    ).resolves.toBeNull();
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"),
    ).resolves.toEqual(policy2.checkpoint);
  } finally {
    close();
  }
});

test("an observed predecessor does not reject a batch whose declared policy head matches the durable pin", async () => {
  const { close, execSql } = await createTestExecSql("checkpoint-persistence");
  try {
    const policy1 = policyDouble({ stateHashes: ["p1"] });
    const policy2 = policyDouble({ stateHashes: ["p1", "p2"] });
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql,
      policies: [policy2],
    });

    await expect(
      advanceKeyingCheckpointsAtomically({
        access: [],
        execSql,
        policies: [policy1, policy2],
      }),
    ).resolves.toBeUndefined();
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"),
    ).resolves.toEqual(policy2.checkpoint);
  } finally {
    close();
  }
});
