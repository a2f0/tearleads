import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sameEpochAdd } from "../../../../test/helpers/workflows/sameEpochGroupAdd";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import {
  withHeldMemberEnvelopeChanges,
  withMemberEnvelopeChanges,
} from "../../../data/principals/memberEnvelopeReferences";

test("a same-epoch leg sends only its added envelope", async () => {
  const f = await sameEpochAdd();
  expect(f.successor.state.keyEpoch).toBe(f.predecessor.currentState.keyEpoch);
  const leg = withMemberEnvelopeChanges(f.successor, f.predecessor);
  expect(leg.memberEnvelopes).toEqual([]);
  expect(leg.memberEnvelopeChanges).toEqual({
    removeUserIds: [],
    upsert: f.successor.memberEnvelopes.filter(
      (envelope) => envelope.userId === f.added.userId,
    ),
  });
});

test("a leg outside the held predecessor or its epoch goes in full", async () => {
  const f = await sameEpochAdd();
  for (const state of [
    { ...f.successor.state, keyEpoch: f.successor.state.keyEpoch + 1 },
    { ...f.successor.state, prevStateHash: "0".repeat(64) },
  ]) {
    const leg = { ...f.successor, state };
    expect(withMemberEnvelopeChanges(leg, f.predecessor)).toBe(leg);
  }
});

test("a journaled mutation uses changes only against a held, rooted predecessor", async () => {
  const f = await sameEpochAdd();
  const { close, execSql } = await createTestExecSql("member-envelope-changes");
  const mutation = {
    kind: "organization" as const,
    groupId: null,
    request: f.successor,
  };
  try {
    // Nothing held: the leg goes in full.
    expect(await withHeldMemberEnvelopeChanges(execSql, mutation)).toEqual(
      mutation,
    );
    const repository = new PrincipalPolicyBundleRepository(execSql);
    await repository.savePrincipalPolicyBundle(f.predecessor, f.organizationId);
    const compact = await withHeldMemberEnvelopeChanges(execSql, mutation);
    if (compact.kind !== "organization") throw new Error("expected the leg");
    expect(compact.request.memberEnvelopes).toEqual([]);
    expect(compact.request.memberEnvelopeChanges?.upsert).toHaveLength(1);
  } finally {
    close();
  }
});

test("an envelope with fields beyond the signed four is sent whole", async () => {
  const f = await sameEpochAdd();
  const leg = {
    ...f.successor,
    memberEnvelopes: f.successor.memberEnvelopes.map((envelope) =>
      Object.assign({}, envelope, { annotation: "kept" }),
    ),
  };
  expect(
    withMemberEnvelopeChanges(leg, f.predecessor).memberEnvelopeChanges,
  ).toBeUndefined();
});

test("a set naming a user twice is sent whole", async () => {
  const f = await sameEpochAdd();
  const [first] = f.successor.memberEnvelopes;
  if (!first) throw new Error("expected an envelope");
  const leg = {
    ...f.successor,
    memberEnvelopes: [...f.successor.memberEnvelopes, first],
  };
  expect(withMemberEnvelopeChanges(leg, f.predecessor)).toBe(leg);
});
