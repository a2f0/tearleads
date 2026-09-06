import { expect, test } from "bun:test";
import type {
  ContainerSummary,
  ContainerSyncTombstone,
} from "@tearleads/validators/response";
import { getApplicableDocumentTombstones } from "./documentDiscoveryInputs";
import { getApplicableRemoteContainerItems } from "./remoteHydration/tombstoneApplication";

const millisecond = "2026-01-01T00:00:00.123Z";
const equivalent = "2026-01-01T00:00:00.123000Z";
const later = "2026-01-01T00:00:00.123001Z";
const item: ContainerSummary = {
  id: "child",
  parentId: "root",
  depth: 1,
  organizationId: "org",
  createdAt: millisecond,
  updatedAt: millisecond,
  effectiveAccessLevel: "read",
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "hash",
  metadataDocumentId: "metadata",
  metadataReferencedPrincipals: [],
};
const tombstone: ContainerSyncTombstone = {
  containerId: item.id,
  parentId: item.parentId,
  depth: 1,
  reason: "access_revoked",
  updatedAt: later,
};

test("microsecond revocation supersedes a millisecond item and stale duplicate hints", () => {
  const response = {
    hasMore: false,
    nextWatermark: null,
    items: [item],
    tombstones: [tombstone, { ...tombstone, updatedAt: millisecond }],
  };
  expect(getApplicableRemoteContainerItems(response)).toEqual([]);
  expect(
    getApplicableRemoteContainerItems({
      ...response,
      items: [{ ...item, updatedAt: "2026-01-01T00:00:00.124Z" }],
    }),
  ).toHaveLength(1);
});

test("equivalent precision retains revocation and deletion tie rules", () => {
  const response = {
    hasMore: false,
    nextWatermark: null,
    items: [item],
    tombstones: [{ ...tombstone, updatedAt: equivalent }],
  };
  expect(getApplicableRemoteContainerItems(response)).toEqual([item]);
  expect(
    getApplicableRemoteContainerItems({
      ...response,
      tombstones: [{ ...tombstone, updatedAt: equivalent, reason: "deleted" }],
    }),
  ).toEqual([]);
});

test("document unlink selects the newest item and preserves microsecond tombstones", () => {
  const document = {
    id: "doc",
    createdAt: millisecond,
    updatedAt: millisecond,
    currentAccessEpoch: 1,
    currentAccessStateHash: "hash",
    linkedContainerIds: ["child"],
    referencedPrincipals: [],
  };
  const removal = { containerId: "child", documentId: "doc", updatedAt: later };
  const listing = {
    isFullListing: true,
    hasMore: false,
    nextWatermark: null,
    items: [document],
    tombstones: [removal],
  };
  expect(getApplicableDocumentTombstones(listing)).toEqual([removal]);
  expect(
    getApplicableDocumentTombstones({
      ...listing,
      items: [
        { ...document, updatedAt: "2026-01-01T00:00:00.123002Z" },
        document,
      ],
    }),
  ).toEqual([]);
});
