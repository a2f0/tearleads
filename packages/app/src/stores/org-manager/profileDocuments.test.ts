import { expect, test } from "bun:test";
import type { OrganizationDirectoryUser } from "@tearleads/client-sdk";
import {
  getRosterProfileDocumentLocalId,
  getRosterProfileDocumentPatch,
} from "./profileDocuments";

const user: OrganizationDirectoryUser = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isSelf: true,
  joinedAt: "2026-05-20T12:00:00.000Z",
  profileDocumentId: null,
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
  status: "active",
  userId: "550e8400-e29b-41d4-a716-446655440000",
};

test("roster profile documents use stable org-scoped local ids", () => {
  expect(
    getRosterProfileDocumentLocalId({
      organizationId: "organization-1",
      userId: user.userId,
    }),
  ).toBe(`org-profile:organization-1:${user.userId}`);
});

test("roster profile documents seed contact identity fields", () => {
  expect(getRosterProfileDocumentPatch(user)).toEqual({
    encapsulationPublicKey: user.encapsulationPublicKey,
    isSelf: "1",
    userId: user.userId,
  });
});
