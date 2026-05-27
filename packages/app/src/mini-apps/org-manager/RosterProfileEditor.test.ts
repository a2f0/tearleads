import { expect, test } from "bun:test";
import type { OrganizationDirectoryUser } from "@tearleads/client-sdk";
import { getMissingProfileIdentityPatch } from "./RosterProfileEditor";

const user: OrganizationDirectoryUser = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isSelf: true,
  joinedAt: "2026-05-20T12:00:00.000Z",
  profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
  status: "active",
  userId: "550e8400-e29b-41d4-a716-446655440000",
};

test("roster profile editor seeds missing identity fields", () => {
  expect(getMissingProfileIdentityPatch(user, {})).toEqual({
    encapsulationPublicKey: user.encapsulationPublicKey,
    isSelf: "1",
    userId: user.userId,
  });
});

test("roster profile editor leaves existing identity fields unchanged", () => {
  expect(
    getMissingProfileIdentityPatch(user, {
      encapsulationPublicKey: "edited-encapsulation-public-key",
      isSelf: "0",
      userId: "edited-user-id",
    }),
  ).toBeNull();
});
