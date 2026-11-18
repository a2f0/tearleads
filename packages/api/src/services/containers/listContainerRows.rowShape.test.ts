import { expect, test } from "bun:test";
import { readAccessibleContainerRows } from "./listContainerRows";

const timestamp = "2026-01-02T03:04:05.000Z";
const row = {
  discoveryOrder: "27",
  id: "container",
  systemSlot: null,
  metadataDocumentId: "document",
  organizationId: "organization",
  parentId: null,
  depth: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  metadataAccessEpoch: 2,
  metadataAccessStateHash: "hash",
  metadataVersion: { "17": 4 },
};

test("accessible container rows keep every selected column", () => {
  // A null epoch is passed through as read, exactly as before.
  expect<unknown>(
    readAccessibleContainerRows([
      row,
      {
        ...row,
        id: "child",
        parentId: "container",
        metadataDocumentId: null,
        systemSlot: "trash",
        metadataAccessEpoch: null,
        metadataAccessStateHash: "",
        depth: 1,
      },
    ]),
  ).toEqual([
    { ...row, discoveryOrder: 27n },
    {
      discoveryOrder: 27n,
      id: "child",
      systemSlot: "trash",
      metadataDocumentId: null,
      organizationId: "organization",
      parentId: "container",
      depth: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadataAccessEpoch: null,
      metadataAccessStateHash: "",
      metadataVersion: { "17": 4 },
    },
  ]);
});

test("accessible container rows reject a malformed shape", () => {
  const { parentId: _parentId, ...withoutParent } = row;
  const { metadataDocumentId: _document, ...withoutDocument } = row;
  for (const malformed of [
    null,
    undefined,
    "container",
    1,
    [],
    [row],
    {},
    withoutParent,
    withoutDocument,
    { ...row, id: null },
    { ...row, id: 1 },
    { ...row, organizationId: undefined },
    { ...row, organizationId: 1 },
    { ...row, metadataDocumentId: 1 },
    { ...row, parentId: 1 },
    { ...row, parentId: ["container"] },
  ]) {
    expect(() => readAccessibleContainerRows([row, malformed])).toThrow(
      "Unexpected row shape from accessible containers query",
    );
  }
});
