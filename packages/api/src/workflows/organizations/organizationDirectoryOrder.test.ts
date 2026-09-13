import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { parseOrganizationAuthorityDescriptor } from "./organizationAuthorityDescriptor";

test("the API reads signed directory groups in locale-independent code-unit order", () => {
  const groupHeads = ["ä", "z", "a", "A"].map((principalId) => ({
    principalType: "group",
    principalId,
    version: 1,
    keyEpoch: 1,
    stateHash: "1".repeat(64),
    keyFingerprint: "2".repeat(64),
  }));
  const ciphertext = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({
        version: 2,
        organizationId: "organization",
        adminGroupId: "A",
        memberGroupId: "a",
        groupHeads,
      }),
    ),
  );
  const descriptor = parseOrganizationAuthorityDescriptor(ciphertext);
  expect(descriptor).not.toBeNull();
  if (!descriptor) throw new Error("Expected signed directory fixture");
  expect(descriptor.groupHeads.map((head) => head.principalId)).toEqual([
    "A",
    "a",
    "z",
    "ä",
  ]);
});
