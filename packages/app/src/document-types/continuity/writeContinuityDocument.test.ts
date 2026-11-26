import { expect, test } from "bun:test";
import { withContinuityAvatar } from "./writeContinuityDocument";

test("the avatar field selects the prepared slot of the marked photo", () => {
  const document = {
    key: "file/0",
    kind: "tool" as const,
    fields: { make: "Alderforge" },
    attachments: [
      { file: "a.jpg", mimeType: "image/jpeg", slot: "equipment-photos" },
      {
        file: "b.jpg",
        mimeType: "image/jpeg",
        slot: "equipment-photos",
        avatar: true as const,
      },
    ],
  };
  const prepared = ["equipment-photos:one", "equipment-photos:two"].map(
    (slotId) => ({
      bytes: new Uint8Array([1]),
      intent: {
        name: "x",
        mimeType: "image/jpeg",
        slotId,
        byteLength: 1,
        contentSha256: "00",
      },
    }),
  );
  expect(withContinuityAvatar(document, prepared).fields).toEqual({
    make: "Alderforge",
    avatarPhotoSlotId: "equipment-photos:two",
  });
  const plain = { ...document, attachments: document.attachments.slice(0, 1) };
  expect(withContinuityAvatar(plain, prepared)).toBe(plain);
});
