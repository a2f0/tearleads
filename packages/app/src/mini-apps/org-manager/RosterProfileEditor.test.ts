import { expect, test } from "bun:test";
import type { OrganizationDirectoryUser } from "@tearleads/client-sdk";
import {
  getMissingProfileIdentityPatch,
  getRosterProfileDocumentRelinkInput,
} from "./RosterProfileEditor";

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

test("roster profile editor relinks cached profile records to the profile container", () => {
  expect(
    getRosterProfileDocumentRelinkInput({
      localId: "org-profile:org-1:user-1",
      profileContainerId: "roster-profile-container",
      profileDocumentId: "profile-document",
    }),
  ).toEqual({
    accessEpoch: 1,
    containerId: "roster-profile-container",
    documentId: "profile-document",
    localId: "org-profile:org-1:user-1",
  });
});
