import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
} from "@tearleads/loro";
import {
  addNoteAttachments,
  ensureNoteAttachmentStructure,
  getNoteAttachments,
} from "./noteDocument";

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
  ensureNoteAttachmentStructure(baseDoc);
  const baseUpdate = exportAllUpdates(baseDoc);

  const leftDoc = await createDocument("notes-left");
  const rightDoc = await createDocument("notes-right");

  importUpdates(leftDoc, [baseUpdate]);
  importUpdates(rightDoc, [baseUpdate]);

  const leftVersion = encodeVersionVector(leftDoc);
  const rightVersion = encodeVersionVector(rightDoc);

  addNoteAttachments(leftDoc, [
    {
      byteLength: 10,
      mimeType: "image/jpeg",
      name: "front.jpg",
      slotId: "slot-front",
    },
  ]);
  addNoteAttachments(rightDoc, [
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
    getNoteAttachments(leftDoc)
      .map((attachment) => attachment.slotId)
      .sort(),
  ).toEqual(["slot-back", "slot-front"]);
  expect(
    getNoteAttachments(rightDoc)
      .map((attachment) => attachment.slotId)
      .sort(),
  ).toEqual(["slot-back", "slot-front"]);
});

test("new attachment order follows the highest existing order value", async () => {
  const doc = await createDocument("notes-order");
  ensureNoteAttachmentStructure(doc);

  addNoteAttachments(doc, [
    {
      byteLength: 10,
      mimeType: "image/jpeg",
      name: "front.jpg",
      slotId: "slot-front",
    },
  ]);

  const attachmentMap = doc.getMap("note").get("attachment:slot-front");
  if (!isMutableOrderMap(attachmentMap)) {
    throw new Error("Expected slot-front attachment map to be mutable.");
  }
  attachmentMap.set("order", 10);

  addNoteAttachments(doc, [
    {
      byteLength: 12,
      mimeType: "image/jpeg",
      name: "back.jpg",
      slotId: "slot-back",
    },
  ]);

  expect(
    getNoteAttachments(doc).map((attachment) => attachment.slotId),
  ).toEqual(["slot-front", "slot-back"]);
});
