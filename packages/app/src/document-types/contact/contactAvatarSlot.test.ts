import { expect, test } from "bun:test";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import { getContactAvatarRef, sameContactAvatarRef } from "./contactAvatarSlot";

const avatarAttachment: DocumentAttachment = {
  contentSha256: "1".repeat(64),
  byteLength: 1024,
  mimeType: "image/png",
  name: "avatar.png",
  slotId: "contact-photos:one",
};

function snapshot(
  attachments: DocumentAttachment[],
  keys: Record<string, string> = {},
) {
  return {
    attachments,
    attachmentStorageKeyBySlotId: keys,
    structuredFields: { avatarPhotoSlotId: "contact-photos:one" },
  };
}

test("returns null without an avatar slot attachment", () => {
  expect(getContactAvatarRef(snapshot([]))).toBeNull();
  expect(
    getContactAvatarRef({
      ...snapshot([{ ...avatarAttachment, slotId: "other-slot" }]),
      structuredFields: { avatarPhotoSlotId: "other-slot" },
    }),
  ).toBeNull();
});

test("returns the latest avatar attachment with its storage key", () => {
  const replacement: DocumentAttachment = {
    ...avatarAttachment,
    byteLength: 2048,
  };

  expect(
    getContactAvatarRef(
      snapshot([avatarAttachment, replacement], {
        "contact-photos:one": "avatar-key",
      }),
    ),
  ).toEqual({
    byteLength: 2048,
    mimeType: "image/png",
    storageKey: "avatar-key",
  });
});

test("reports a null storage key while the blob is not local yet", () => {
  expect(getContactAvatarRef(snapshot([avatarAttachment]))).toEqual({
    byteLength: 1024,
    mimeType: "image/png",
    storageKey: null,
  });
});

test("compares avatar refs by byte length, mime type, and storage key", () => {
  const ref = { byteLength: 1, mimeType: "image/png", storageKey: "a" };

  expect(sameContactAvatarRef(null, undefined)).toBe(true);
  expect(sameContactAvatarRef(ref, null)).toBe(false);
  expect(sameContactAvatarRef(ref, { ...ref })).toBe(true);
  expect(sameContactAvatarRef(ref, { ...ref, storageKey: "b" })).toBe(false);
  expect(sameContactAvatarRef(ref, { ...ref, byteLength: 2 })).toBe(false);
});
