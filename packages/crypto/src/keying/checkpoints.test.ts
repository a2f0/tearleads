import { expect, test } from "bun:test";
import type { IdentityStateHead } from "./index";
import { verifyIdentityStateCheckpoint } from "./index";
import { expectVerificationError, fixtureHash } from "./testFixtures";

test("verifyIdentityStateCheckpoint rejects rollback and equivocation against local checkpoints", async () => {
  const first: IdentityStateHead = {
    identityId: "user-1",
    version: 1,
    stateHash: await fixtureHash("identity-state-1"),
    previousStateHash: null,
  };
  const second: IdentityStateHead = {
    identityId: "user-1",
    version: 2,
    stateHash: await fixtureHash("identity-state-2"),
    previousStateHash: first.stateHash,
  };
  const verifiedSecond = await verifyIdentityStateCheckpoint({ head: second });

  if (!verifiedSecond.ok) {
    throw verifiedSecond.error;
  }

  const rollback = await verifyIdentityStateCheckpoint({
    head: first,
    localCheckpoint: verifiedSecond.value.checkpoint,
  });
  expectVerificationError(rollback, "rollback");

  const equivocation = await verifyIdentityStateCheckpoint({
    head: {
      ...first,
      stateHash: await fixtureHash("identity-state-1-alt"),
    },
    localCheckpoint: {
      identityId: first.identityId,
      version: first.version,
      stateHash: first.stateHash,
    },
  });
  expectVerificationError(equivocation, "equivocation");
});

test("verifyIdentityStateCheckpoint requires a predecessor chain to advance past a checkpoint gap", async () => {
  const first: IdentityStateHead = {
    identityId: "user-1",
    version: 1,
    stateHash: await fixtureHash("identity-state-gap-1"),
    previousStateHash: null,
  };
  const second: IdentityStateHead = {
    identityId: "user-1",
    version: 2,
    stateHash: await fixtureHash("identity-state-gap-2"),
    previousStateHash: first.stateHash,
  };
  const third: IdentityStateHead = {
    identityId: "user-1",
    version: 3,
    stateHash: await fixtureHash("identity-state-gap-3"),
    previousStateHash: second.stateHash,
  };
  const checkpoint = {
    identityId: first.identityId,
    version: first.version,
    stateHash: first.stateHash,
  };

  const missingProof = await verifyIdentityStateCheckpoint({
    head: third,
    localCheckpoint: checkpoint,
  });
  expectVerificationError(missingProof, "stale_predecessor");

  const withProof = await verifyIdentityStateCheckpoint({
    head: third,
    localCheckpoint: checkpoint,
    checkpointPredecessors: [second],
  });
  expect(withProof.ok).toBe(true);
  if (withProof.ok) {
    expect(withProof.value.checkpoint.stateHash).toBe(third.stateHash);
  }
});
