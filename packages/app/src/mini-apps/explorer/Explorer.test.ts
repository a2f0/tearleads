import { expect, test } from "bun:test";
import type { NoteSummary } from "../notes/notesPersistence";
import { buildNotesByContainerId } from "./Explorer";

test("buildNotesByContainerId falls back to the note container when document links are not projected yet", () => {
  const noteSummaries: NoteSummary[] = [
    {
      id: "note-1",
      containerId: "root-container",
      documentId: "document-1",
      title: "Fresh root note",
      updatedAt: "2026-04-11T12:00:00.000Z",
    },
  ];

  const notesByContainerId = buildNotesByContainerId(
    noteSummaries,
    new Map([["document-1", []]]),
    new Set(["root-container"]),
  );

  expect(notesByContainerId.get("root-container")).toEqual([
    {
      containerId: "root-container",
      noteId: "note-1",
      title: "Fresh root note",
      updatedAt: "2026-04-11T12:00:00.000Z",
    },
  ]);
});

test("buildNotesByContainerId prefers projected linked containers when they are available", () => {
  const noteSummaries: NoteSummary[] = [
    {
      id: "note-1",
      containerId: "root-container",
      documentId: "document-1",
      title: "Linked note",
      updatedAt: "2026-04-11T12:00:00.000Z",
    },
  ];

  const notesByContainerId = buildNotesByContainerId(
    noteSummaries,
    new Map([["document-1", ["child-container"]]]),
    new Set(["root-container", "child-container"]),
  );

  expect(notesByContainerId.get("root-container")).toBeUndefined();
  expect(notesByContainerId.get("child-container")).toEqual([
    {
      containerId: "child-container",
      noteId: "note-1",
      title: "Linked note",
      updatedAt: "2026-04-11T12:00:00.000Z",
    },
  ]);
});
