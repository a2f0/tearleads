import { expect, test } from "bun:test";
import {
  addDocumentAttachments,
  ensureDocumentAttachmentStructure,
  getDocumentAttachments,
} from "@symcrypt/client-sdk";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
} from "@symcrypt/loro";

interface MutableOrderMap {
  set: (key: string, value: number) => void;
}

function isMutableOrderMap(value: unknown): value is MutableOrderMap {
  return (
    typeof value === "object" &&
    value !== null &&
    "set" in value &&
    typeof value.set === "function"
  );
}

test("concurrent attachment additions merge by slot id", async () => {
  const baseDoc = await createDocument("notes-base");
  ensureDocumentAttachmentStructure(baseDoc);
  const baseUpdate = exportAllUpdates(baseDoc);

  const leftDoc = await createDocument("notes-left");
  const rightDoc = await createDocument("notes-right");

  importUpdates(leftDoc, [baseUpdate]);
  importUpdates(rightDoc, [baseUpdate]);

  const leftVersion = encodeVersionVector(leftDoc);
  const rightVersion = encodeVersionVector(rightDoc);

  addDocumentAttachments(leftDoc, [
    {
      byteLength: 10,
      mimeType: "image/jpeg",
      name: "front.jpg",
      slotId: "slot-front",
    },
  ]);
  addDocumentAttachments(rightDoc, [
    {
      byteLength: 12,
      mimeType: "image/jpeg",
      name: "back.jpg",
      slotId: "slot-back",
    },
  ]);

  const leftUpdate = exportUpdatesSince(leftDoc, leftVersion);
  const rightUpdate = exportUpdatesSince(rightDoc, rightVersion);

  importUpdates(leftDoc, [rightUpdate]);
  importUpdates(rightDoc, [leftUpdate]);

  expect(
    getDocumentAttachments(leftDoc)
      .map((attachment) => attachment.slotId)
      .sort(),
  ).toEqual(["slot-back", "slot-front"]);
  expect(
    getDocumentAttachments(rightDoc)
      .map((attachment) => attachment.slotId)
      .sort(),
  ).toEqual(["slot-back", "slot-front"]);
});

test("new attachment order follows the highest existing order value", async () => {
  const doc = await createDocument("notes-order");
  ensureDocumentAttachmentStructure(doc);

  addDocumentAttachments(doc, [
    {
      byteLength: 10,
      mimeType: "image/jpeg",
      name: "front.jpg",
      slotId: "slot-front",
    },
  ]);

  const attachmentMap = doc.getMap("content").get("attachment:slot-front");
  if (!isMutableOrderMap(attachmentMap)) {
    throw new Error("Expected slot-front attachment map to be mutable.");
  }
  attachmentMap.set("order", 10);

  addDocumentAttachments(doc, [
    {
      byteLength: 12,
      mimeType: "image/jpeg",
      name: "back.jpg",
      slotId: "slot-back",
    },
  ]);

  expect(
    getDocumentAttachments(doc).map((attachment) => attachment.slotId),
  ).toEqual(["slot-front", "slot-back"]);
});
