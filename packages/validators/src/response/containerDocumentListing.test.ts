import { expect, test } from "bun:test";
import { isListContainerDocumentsResponse } from "./document";

test("isListContainerDocumentsResponse", () => {
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
          updatedAt: new Date().toISOString(),
        },
      ],
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
