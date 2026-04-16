import { expect, test } from "bun:test";
import { getLatestDocumentAttachmentBySlotId } from "./documentAttachmentUtils";

test("attachment lookup returns the latest slot binding", () => {
  const attachment = getLatestDocumentAttachmentBySlotId(
    [
      {
        byteLength: 10,
        mimeType: "image/jpeg",
        name: "front-original.jpg",
        slotId: "front",
      },
      {
        byteLength: 20,
        mimeType: "image/jpeg",
        name: "front-updated.jpg",
        slotId: "front",
      },
    ],
    "front",
  );

  expect(attachment).toEqual({
    byteLength: 20,
    mimeType: "image/jpeg",
    name: "front-updated.jpg",
    slotId: "front",
  });
});
