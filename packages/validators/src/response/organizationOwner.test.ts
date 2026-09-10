import { expect, test } from "bun:test";
import { OrganizationDirectoryUserResponseSchema } from "./organization";

const user = {
  userId: "owner",
  createdAt: "2026-09-10T00:00:00.000Z",
  joinedAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  profileDocumentId: null,
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-key",
  encapsulationKeyFingerprint: "kem-fingerprint",
  encapsulationPublicKey: "kem-key",
  isSelf: false,
  status: "active",
};

test("directory ownership accepts booleans and older payloads without the field", () => {
  for (const isPersonalOrganizationOwner of [true, false, undefined]) {
    const result = OrganizationDirectoryUserResponseSchema.parse({
      ...user,
      isPersonalOrganizationOwner,
    });
    expect(result.isPersonalOrganizationOwner).toBe(
      isPersonalOrganizationOwner,
    );
  }
});

test("directory ownership rejects malformed flags", () => {
  for (const isPersonalOrganizationOwner of ["true", "false", 0, 1, null]) {
    expect(
      OrganizationDirectoryUserResponseSchema.safeParse({
        ...user,
        isPersonalOrganizationOwner,
      }).success,
    ).toBe(false);
  }
});
