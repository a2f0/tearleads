import { expect, test } from "bun:test";
import { isListContainerDocumentsResponse } from "./document";

function listedDocument(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date().toISOString(),
    currentAccessEpoch: 2,
    currentAccessStateHash: "access-state-hash",
    effectiveAccessLevel: "write",
    id: "doc-123",
    linkedContainerIds: ["ctr-root"],
    referencedPrincipals: [
      {
        principalType: "group",
        principalId: "group-123",
        version: 1,
        keyEpoch: 1,
        stateHash: "state-hash",
        keyFingerprint: "key-fingerprint",
      },
    ],
    updateCount: 3,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function listing(item: Record<string, unknown>) {
  return { hasMore: false, items: [item], nextWatermark: null, tombstones: [] };
}

test("isListContainerDocumentsResponse", () => {
  expect(
    isListContainerDocumentsResponse({
      hasMore: false,
      items: [listedDocument()],
      nextWatermark: {
        id: "doc-123",
        updatedAt: new Date().toISOString(),
      },
      tombstones: [
        {
          containerId: "ctr-root",
          documentId: "doc-removed",
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
  ).toBe(true);
  // A document with no update yet counts none.
  expect(
    isListContainerDocumentsResponse(
      listing(listedDocument({ updateCount: 0 })),
    ),
  ).toBe(true);
  for (const updateCount of [undefined, -1, 1.5, "3"]) {
    expect(
      isListContainerDocumentsResponse(
        listing(listedDocument({ updateCount })),
      ),
    ).toBe(false);
  }
  expect(
    isListContainerDocumentsResponse({
      hasMore: false,
      items: [
        {
          createdAt: new Date().toISOString(),
          currentAccessEpoch: 2,
          currentAccessStateHash: "access-state-hash",
          effectiveAccessLevel: "write",
          id: "doc-123",
          linkedContainerIds: ["ctr-root"],
          updatedAt: new Date().toISOString(),
        },
      ],
      nextWatermark: null,
      tombstones: [],
    }),
  ).toBe(false);
  expect(
    isListContainerDocumentsResponse({
      hasMore: false,
      items: [
        {
          currentAccessEpoch: 2,
          id: "doc-123",
          linkedContainerIds: ["ctr-root"],
        },
      ],
      nextWatermark: null,
      tombstones: [],
    }),
  ).toBe(false);
  expect(isListContainerDocumentsResponse(null)).toBe(false);
});
