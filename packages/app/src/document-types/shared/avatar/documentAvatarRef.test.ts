import { expect, test } from "bun:test";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import type { DocumentPhotoCapability } from "../documentPhotos";
import {
  getDocumentAvatarRef,
  sameDocumentAvatarRef,
} from "./documentAvatarRef";

const photos: DocumentPhotoCapability = {
  avatarFallbackIcon: WrenchIcon,
  slotId: "equipment-photos",
};

const readAvatarRef = (snapshot: Parameters<typeof getDocumentAvatarRef>[1]) =>
  getDocumentAvatarRef(photos, snapshot);

const avatarAttachment: DocumentAttachment = {
  contentSha256: "1".repeat(64),
  byteLength: 1024,
  mimeType: "image/png",
  name: "avatar.png",
  slotId: "equipment-photos:one",
};

function snapshot(
  attachments: DocumentAttachment[],
  keys: Record<string, string> = {},
) {
  return {
    attachments,
    attachmentStorageKeyBySlotId: keys,
    structuredFields: { avatarPhotoSlotId: "equipment-photos:one" },
  };
}

test("returns null without an avatar slot attachment", () => {
  expect(readAvatarRef(snapshot([]))).toBeNull();
  expect(
    readAvatarRef({
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
    readAvatarRef(
      snapshot([avatarAttachment, replacement], {
        "equipment-photos:one": "avatar-key",
      }),
    ),
  ).toEqual({
    byteLength: 2048,
    mimeType: "image/png",
    storageKey: "avatar-key",
  });
});

test("reports a null storage key while the blob is not local yet", () => {
  expect(readAvatarRef(snapshot([avatarAttachment]))).toEqual({
    byteLength: 1024,
    mimeType: "image/png",
    storageKey: null,
  });
});

test("compares avatar refs by byte length, mime type, and storage key", () => {
  const ref = { byteLength: 1, mimeType: "image/png", storageKey: "a" };

  expect(sameDocumentAvatarRef(null, undefined)).toBe(true);
  expect(sameDocumentAvatarRef(ref, null)).toBe(false);
  expect(sameDocumentAvatarRef(ref, { ...ref })).toBe(true);
  expect(sameDocumentAvatarRef(ref, { ...ref, storageKey: "b" })).toBe(false);
  expect(sameDocumentAvatarRef(ref, { ...ref, byteLength: 2 })).toBe(false);
});
