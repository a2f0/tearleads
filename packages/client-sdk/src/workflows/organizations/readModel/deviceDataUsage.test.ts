import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  measureOrganizationDeviceDataUsage,
  type OrganizationDeviceDataUsage,
} from "./deviceDataUsage";
import { createDeviceUsageStore } from "./deviceDataUsage.testFixtures";

const ORG_A = "org-a";
const ORG_B = "org-b";

function breakdownOf(usage: OrganizationDeviceDataUsage) {
  return Object.fromEntries(
    usage.documents.breakdown.map((entry) => [
      entry.category,
      { byteLength: entry.byteLength, documentCount: entry.documentCount },
    ]),
  );
}

test("device usage counts only the measured organization's documents and files", async () => {
  const { close, execSql } = await createTestExecSql("device-usage-two-orgs");
  try {
    const store = await createDeviceUsageStore(execSql);
    await store.container("folder-a", ORG_A);
    await store.container("folder-b", ORG_B);
    // 4 + 2 + 3 record bytes, a 10-byte checkpoint, 3 + 5 tail bytes, and
    // 7 bytes of projected text.
    await store.document({
      checkpoint: "c".repeat(10),
      containerId: "folder-a",
      contentKeyBundle: "kk",
      kekTargets: "ttt",
      localId: "note-a",
      manifest: "mmmm",
      text: "t".repeat(7),
      updates: ["uuu", "uuuuu"],
    });
    await store.document({
      checkpoint: "c".repeat(40),
      containerId: "folder-b",
      localId: "note-b",
    });
    await store.pendingFile({
      byteLength: 100,
      localId: "note-a",
      slotId: "slot-1",
      storageKey: "note-a-slot-1",
    });
    await store.heldFile({
      byteLength: 30,
      localId: "note-b",
      slotId: "slot-1",
      storageKey: "blob-b",
    });

    const usageA = await measureOrganizationDeviceDataUsage({
      execSql,
      organizationId: ORG_A,
    });
    const usageB = await measureOrganizationDeviceDataUsage({
      execSql,
      organizationId: ORG_B,
    });

    expect(usageA).toEqual({
      blobs: { blobCount: 1, byteLength: 100 },
      documents: {
        breakdown: [
          { byteLength: 0, category: "containerMetadata", documentCount: 0 },
          { byteLength: 0, category: "rosterProfiles", documentCount: 0 },
          { byteLength: 0, category: "organizationMetadata", documentCount: 0 },
          { byteLength: 34, category: "user", documentCount: 1 },
        ],
        byteLength: 34,
        documentCount: 1,
      },
      organizationId: ORG_A,
      totalByteLength: 134,
    });
    expect(usageB.organizationId).toBe(ORG_B);
    expect(usageB.documents.documentCount).toBe(1);
    expect(usageB.documents.byteLength).toBe(40);
    expect(usageB.blobs).toEqual({ blobCount: 1, byteLength: 30 });
    expect(usageB.totalByteLength).toBe(70);

    await expect(
      measureOrganizationDeviceDataUsage({ execSql, organizationId: "org-c" }),
    ).resolves.toMatchObject({
      blobs: { blobCount: 0, byteLength: 0 },
      documents: { byteLength: 0, documentCount: 0 },
      totalByteLength: 0,
    });
  } finally {
    close();
  }
});

test("device usage partitions documents with the server's first-match categories", async () => {
  const { close, execSql } = await createTestExecSql("device-usage-categories");
  try {
    const store = await createDeviceUsageStore(execSql);
    await store.container("folder-a", ORG_A);
    await store.container("folder-b", ORG_B);
    // Folder metadata: a live folder's, and one kept dormant after access loss.
    await store.document({
      appKind: "container-metadata",
      checkpoint: "m".repeat(11),
      documentId: "doc-folder-a",
      localId: "folder-a",
    });
    await store.dormantMetadata("folder-gone", ORG_A);
    await store.document({
      appKind: "container-metadata",
      checkpoint: "m".repeat(13),
      documentId: "doc-folder-gone",
      localId: "folder-gone",
    });
    await store.document({
      appKind: "container-metadata",
      checkpoint: "m".repeat(17),
      documentId: "doc-folder-b",
      localId: "folder-b",
    });
    // Roster profiles from this organization's read model, keyed by server id.
    await store.rosterProfile({
      organizationId: ORG_A,
      profileDocumentId: "doc-roster",
      userId: "user-1",
    });
    await store.document({
      checkpoint: "r".repeat(20),
      containerId: "folder-a",
      documentId: "doc-roster",
      kind: "contact",
      localId: "doc-roster",
    });
    // Roster wins over the organization-profile kind.
    await store.rosterProfile({
      organizationId: ORG_A,
      profileDocumentId: "doc-roster-and-kind",
      userId: "user-2",
    });
    await store.document({
      checkpoint: "r".repeat(3),
      containerId: "folder-a",
      documentId: "doc-roster-and-kind",
      kind: "organization_profile",
      localId: "roster-and-kind",
    });
    // Organization profile: by the read model pointer under a local alias, and
    // by projected kind.
    await store.organizationProfile({
      organizationId: ORG_A,
      profileDocumentId: "doc-org-profile",
    });
    await store.document({
      checkpoint: "o".repeat(6),
      containerId: "folder-a",
      documentId: "doc-org-profile",
      localId: `org-profile:${ORG_A}`,
    });
    await store.document({
      checkpoint: "o".repeat(2),
      containerId: "folder-a",
      documentId: "doc-org-profile-kind",
      kind: "organization_profile",
      localId: "org-profile-kind",
    });
    // User data: another organization's roster pointer, a profile-looking
    // local alias that no read model names, and a document whose folder is
    // gone but whose projection kept the organization.
    await store.rosterProfile({
      organizationId: ORG_B,
      profileDocumentId: "doc-foreign-roster",
      userId: "user-1",
    });
    await store.document({
      checkpoint: "u".repeat(5),
      containerId: "folder-a",
      documentId: "doc-foreign-roster",
      localId: "foreign-roster",
    });
    await store.document({
      checkpoint: "u".repeat(7),
      containerId: "folder-a",
      localId: `org-profile:${ORG_A}:user-9`,
    });
    await store.document({
      checkpoint: "u".repeat(9),
      containerId: null,
      localId: "orphan",
      projectedOrganizationId: ORG_A,
    });

    const usage = await measureOrganizationDeviceDataUsage({
      execSql,
      organizationId: ORG_A,
    });

    expect(usage.documents.breakdown.map((entry) => entry.category)).toEqual([
      "containerMetadata",
      "rosterProfiles",
      "organizationMetadata",
      "user",
    ]);
    expect(breakdownOf(usage)).toEqual({
      containerMetadata: { byteLength: 24, documentCount: 2 },
      organizationMetadata: { byteLength: 8, documentCount: 2 },
      rosterProfiles: { byteLength: 23, documentCount: 2 },
      user: { byteLength: 21, documentCount: 3 },
    });
    expect(usage.documents.documentCount).toBe(9);
    expect(usage.documents.byteLength).toBe(76);
    expect(usage.totalByteLength).toBe(76);
  } finally {
    close();
  }
});

test("device usage counts each stored file once and skips detached slots", async () => {
  const { close, execSql } = await createTestExecSql("device-usage-files");
  try {
    const store = await createDeviceUsageStore(execSql);
    await store.container("folder-a", ORG_A);
    await store.document({ containerId: "folder-a", localId: "note-1" });
    await store.document({ containerId: "folder-a", localId: "note-2" });
    // A staged upload has both a pending row and a held row for one key.
    await store.pendingFile({
      byteLength: 100,
      localId: "note-1",
      slotId: "slot-1",
      storageKey: "note-1-slot-1",
    });
    await store.heldFile({
      byteLength: 100,
      localId: "note-1",
      slotId: "slot-1",
      storageKey: "note-1-slot-1",
    });
    // One downloaded blob backing two documents.
    await store.heldFile({
      byteLength: 50,
      localId: "note-1",
      slotId: "slot-2",
      storageKey: "blob-shared",
    });
    await store.heldFile({
      byteLength: 50,
      localId: "note-2",
      slotId: "slot-1",
      storageKey: "blob-shared",
    });
    // An unlinked slot waiting for its remote detach.
    await store.heldFile({
      byteLength: 70,
      detached: true,
      localId: "note-2",
      slotId: "slot-2",
      storageKey: "blob-detached",
    });

    const usage = await measureOrganizationDeviceDataUsage({
      execSql,
      organizationId: ORG_A,
    });

    expect(usage.blobs).toEqual({ blobCount: 2, byteLength: 150 });
    expect(usage.documents.documentCount).toBe(2);
    expect(usage.totalByteLength).toBe(
      usage.documents.byteLength + usage.blobs.byteLength,
    );
  } finally {
    close();
  }
});
