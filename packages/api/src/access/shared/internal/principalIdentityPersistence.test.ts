import { expect, test } from "bun:test";
import {
  projectionMemberKey,
  toStoredProjectionMember,
} from "./principalStateRecords";

test("persisted projection conversion retains the exact member identity commitment", () => {
  const row = {
    principalType: "group" as const,
    principalId: crypto.randomUUID(),
    stateHash: "state",
    userId: crypto.randomUUID(),
    role: "admin" as const,
    identityBundleFingerprint: "a".repeat(64),
    createdAt: new Date("2026-01-01"),
  };
  expect(toStoredProjectionMember(row)).toEqual(row);
  expect(projectionMemberKey(row)).not.toBe(
    projectionMemberKey({ ...row, identityBundleFingerprint: "b".repeat(64) }),
  );
});
