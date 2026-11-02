import { expect, test } from "bun:test";
import type { ApiServiceRuntime } from "../runtime";
import { listAccessibleContainersForUser } from "./listContainerRows";

const userId = "8f14e45f-ceea-467f-a0e6-1f0b3e3c4d5a";
const timestamp = "2026-01-02T03:04:05.000Z";

function runtimeReturning(rows: readonly unknown[]): ApiServiceRuntime {
  const runtime = { db: { execute: async () => ({ rows }) } };
  return runtime as unknown as ApiServiceRuntime;
}

function list(rows: readonly unknown[]) {
  return listAccessibleContainersForUser({
    limit: 10,
    parentId: null,
    runtime: runtimeReturning(rows),
    userId,
    watermark: null,
  });
}

const row = {
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
};

test("accessible container rows keep every selected column", async () => {
  // A null epoch is passed through as read, exactly as before.
  expect<unknown>(
    await list([
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
    row,
    {
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
    },
  ]);
});

test("accessible container rows reject a malformed shape", async () => {
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
    await expect(list([row, malformed])).rejects.toThrow(
      "Unexpected row shape from accessible containers query",
    );
  }
});
