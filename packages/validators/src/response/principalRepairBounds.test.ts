import { expect, test } from "bun:test";
import { ContainerMutationFailureResponseSchema } from "./containerMutationError";
import { DocumentSyncErrorResponseSchema } from "./documentSyncError";

const head = {
  principalType: "group",
  principalId: "group-1",
  version: 1,
  stateHash: "a".repeat(64),
  keyEpoch: 1,
  keyFingerprint: "b".repeat(64),
};
for (const [schema, code] of [
  [ContainerMutationFailureResponseSchema, "principal_policy_stale"],
  [DocumentSyncErrorResponseSchema, "document_sync_state_stale"],
] as const) {
  test(`${code} accepts sixteen compact repair heads and rejects oversized or malformed pages`, () => {
    const error = { code, error: "Stale policy" };
    expect(
      schema.safeParse({
        ...error,
        principalHeads: Array.from({ length: 16 }, () => head),
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...error,
        principalHeads: Array.from({ length: 17 }, () => head),
      }).success,
    ).toBe(false);
    for (const principalHeads of [
      null,
      {},
      [{}],
      [{ ...head, version: 0 }],
      [{ currentState: head, previousStates: [] }],
    ]) {
      expect(schema.safeParse({ ...error, principalHeads }).success).toBe(
        false,
      );
    }
  });
}
