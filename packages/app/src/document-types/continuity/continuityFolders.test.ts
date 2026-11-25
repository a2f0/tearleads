import { expect, test } from "bun:test";
import { appendNoteAddition, continuityFolders } from "./continuityFolders";
import { withContinuityAvatar } from "./writeContinuityDocument";

test("a note addition goes on its own line, once", () => {
  expect(appendNoteAddition("Plan\n- Maya: flan", "- Rosa: turkey")).toBe(
    "Plan\n- Maya: flan\n- Rosa: turkey",
  );
  expect(appendNoteAddition("Plan\n", "- Rosa: turkey")).toBe(
    "Plan\n- Rosa: turkey",
  );
  expect(appendNoteAddition("", "- Rosa: turkey")).toBe("- Rosa: turkey");
  // A rerun finds the line wherever later edits moved it.
  expect(
    appendNoteAddition(
      "Plan\n- Rosa: turkey\n- Daniel: cider",
      "- Rosa: turkey",
    ),
  ).toBeNull();
  // A line that only starts the same is not the addition.
  expect(
    appendNoteAddition("Plan\n- Rosa: turkey and pie", "- Rosa: turkey"),
  ).toBe("Plan\n- Rosa: turkey and pie\n- Rosa: turkey");
  expect(appendNoteAddition("a\nb\nc", "b\nc")).toBeNull();
  expect(appendNoteAddition("a\nb\nx\nc", "b\nc")).toBe("a\nb\nx\nc\nb\nc");
});

test("folder notes are keyed by folder and position, with defaults", () => {
  expect(
    continuityFolders({
      schemaVersion: 4,
      identitySeedPhrase: "phrase",
      folders: [
        { name: "Empty" },
        {
          name: "Family",
          grants: [{ group: "Family", access: "write" }],
          notes: [{ text: "One" }, { text: "Two", additions: [] }],
        },
      ],
    }),
  ).toEqual([
    { name: "Empty", grants: [], notes: [] },
    {
      name: "Family",
      grants: [{ group: "Family", access: "write" }],
      notes: [
        {
          document: {
            key: "folder/1/note/0",
            kind: "note",
            text: "One",
            attachments: [],
          },
          additions: [],
        },
        {
          document: {
            key: "folder/1/note/1",
            kind: "note",
            text: "Two",
            attachments: [],
          },
          additions: [],
        },
      ],
    },
  ]);
});

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
