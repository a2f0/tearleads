import { expect, test } from "bun:test";
import {
  encodeBuiltinGroupMetadata,
  encryptGroupMetadata,
} from "@tearleads/crypto";
import { testGroupMetadataKey } from "../../../test/helpers/groupMetadata";
import { principalPolicy } from "../../../test/helpers/organizationReadModelFixtures";
import type { OrganizationAuthorityDescriptor } from "../../data/principals/organizationAuthorityDescriptor";
import { assertGroupMetadataBinding } from "./groupMetadataBinding";

const descriptor: OrganizationAuthorityDescriptor = {
  organizationId: "org-1",
  adminGroupId: "random-admin-id",
  memberGroupId: "random-member-id",
  groupHeads: [],
  version: 2,
};
function bundle(principalId: string, ciphertext: string) {
  return {
    ...principalPolicy,
    currentState: { ...principalPolicy.currentState, principalId },
    currentPayload: { ...principalPolicy.currentPayload, ciphertext },
  };
}

test("reserved labels follow the signed role IDs, regardless of ID shape", () => {
  const admins = encodeBuiltinGroupMetadata("admins");
  expect(() =>
    assertGroupMetadataBinding(
      bundle(descriptor.adminGroupId, admins),
      descriptor,
    ),
  ).not.toThrow();
  expect(() =>
    assertGroupMetadataBinding(
      bundle(descriptor.memberGroupId, admins),
      descriptor,
    ),
  ).toThrow();
  expect(() =>
    assertGroupMetadataBinding(bundle("custom-id", admins), descriptor),
  ).toThrow();
});

test("encrypted names cannot be transplanted into another group, organization, or reserved role", async () => {
  const encrypted = await encryptGroupMetadata({
    key: testGroupMetadataKey(descriptor.organizationId),
    groupId: "custom-id",
    name: "Operators",
  });
  expect(() =>
    assertGroupMetadataBinding(bundle("custom-id", encrypted), descriptor),
  ).not.toThrow();
  expect(() =>
    assertGroupMetadataBinding(bundle("other-id", encrypted), descriptor),
  ).toThrow();
  expect(() =>
    assertGroupMetadataBinding(bundle("custom-id", encrypted), {
      ...descriptor,
      organizationId: "other-org",
    }),
  ).toThrow();
  expect(() =>
    assertGroupMetadataBinding(bundle("custom-id", encrypted), {
      ...descriptor,
      adminGroupId: "custom-id",
    }),
  ).toThrow();
});
