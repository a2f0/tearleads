import { expect, test } from "bun:test";
import { getAttachmentStatuses } from "./attachmentSnapshot";

const attachment = (slotId: string, contentSha256: string) => ({
  byteLength: 4,
  contentSha256,
  mimeType: "image/png",
  name: `${slotId}.png`,
  slotId,
});

test("a held copy whose digest differs from the document intent is flagged", () => {
  expect(
    getAttachmentStatuses({
      attachments: [
        attachment("matching", "1".repeat(64)),
        attachment("served", "1".repeat(64)),
        attachment("queued", "1".repeat(64)),
        attachment("absent", "1".repeat(64)),
      ],
      contentSha256BySlotId: {
        matching: "1".repeat(64),
        queued: "2".repeat(64),
        served: "2".repeat(64),
      },
      pendingSlotIds: new Set(["queued"]),
    }),
  ).toEqual({ queued: "syncing", served: "intent-mismatch" });
});

test("the flag clears once the document records the held digest", () => {
  const contentSha256BySlotId = { preview: "2".repeat(64) };
  expect(
    getAttachmentStatuses({
      attachments: [attachment("preview", "1".repeat(64))],
      contentSha256BySlotId,
      pendingSlotIds: new Set(),
    }),
  ).toEqual({ preview: "intent-mismatch" });
  expect(
    getAttachmentStatuses({
      attachments: [attachment("preview", "2".repeat(64))],
      contentSha256BySlotId,
      pendingSlotIds: new Set(),
    }),
  ).toEqual({});
});
