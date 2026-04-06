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
