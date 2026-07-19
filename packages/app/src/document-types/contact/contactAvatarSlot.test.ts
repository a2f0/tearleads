import { expect, test } from "bun:test";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import {
  CONTACT_AVATAR_SLOT_ID,
  getContactAvatarRef,
  sameContactAvatarRef,
} from "./contactAvatarSlot";

const avatarAttachment: DocumentAttachment = {
  byteLength: 1024,
  mimeType: "image/png",
  name: "avatar.png",
  slotId: CONTACT_AVATAR_SLOT_ID,
};

test("returns null without an avatar slot attachment", () => {
  expect(getContactAvatarRef([], {})).toBeNull();
  expect(
    getContactAvatarRef([{ ...avatarAttachment, slotId: "other-slot" }], {
      "other-slot": "other-key",
    }),
  ).toBeNull();
});

test("returns the latest avatar attachment with its storage key", () => {
  const replacement: DocumentAttachment = {
    ...avatarAttachment,
    byteLength: 2048,
  };

  expect(
    getContactAvatarRef([avatarAttachment, replacement], {
      [CONTACT_AVATAR_SLOT_ID]: "avatar-key",
    }),
  ).toEqual({
    byteLength: 2048,
    mimeType: "image/png",
    storageKey: "avatar-key",
  });
});

test("reports a null storage key while the blob is not local yet", () => {
  expect(getContactAvatarRef([avatarAttachment], {})).toEqual({
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
