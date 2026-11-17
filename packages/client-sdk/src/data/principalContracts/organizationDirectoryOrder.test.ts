import { expect, test } from "bun:test";
import { normalizeOrganizationGroupHeads } from "./organizationAuthorityDescriptor";

test("signed directory group order uses code units, independent of runtime locale", () => {
  const heads = ["ä", "z", "a", "A"].map((principalId) => ({
    principalType: "group" as const,
    principalId,
    version: 1,
    keyEpoch: 1,
    stateHash: "1".repeat(64),
    keyFingerprint: "2".repeat(64),
  }));
  expect(
    normalizeOrganizationGroupHeads(heads).map((head) => head.principalId),
  ).toEqual(["A", "a", "z", "ä"]);
});
