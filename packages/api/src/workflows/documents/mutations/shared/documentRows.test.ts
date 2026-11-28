import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  containers,
  documents,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { organizationRosterProfileContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq } from "drizzle-orm";
import {
  touchContainersForDocument,
  touchDocumentAndLinkedContainers,
} from "./documentRows";

async function readAttributionRevision(documentId: string): Promise<number> {
  const [document] = await db
    .select({ attributionRevision: documents.attributionRevision })
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!document) {
    throw new Error("Document was not found");
  }
  return document.attributionRevision;
}

test("touching an accepted sync atomically advances attribution revision", async () => {
  const [document] = await db
    .insert(documents)
    .values({ createdByFingerprint: "revision-increment-test" })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create document");
  }

  const organizationId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await touchDocumentAndLinkedContainers(tx, {
      documentId: document.id,
      incrementAttributionRevision: true,
      linkedContainerIds: [],
      organizationId,
    });
    await touchDocumentAndLinkedContainers(tx, {
      documentId: document.id,
      incrementAttributionRevision: true,
      linkedContainerIds: [],
      organizationId,
    });
  });

  expect(await readAttributionRevision(document.id)).toBe(2);
});

test("ordinary metadata touches leave attribution revision unchanged", async () => {
  const [document] = await db
    .insert(documents)
    .values({
      attributionRevision: 5,
      createdByFingerprint: "revision-stability-test",
    })
    .returning({ id: documents.id });
  if (!document) {
    throw new Error("Failed to create document");
  }

  await db.transaction((tx) =>
    touchDocumentAndLinkedContainers(tx, {
      documentId: document.id,
      linkedContainerIds: [],
      organizationId: crypto.randomUUID(),
    }),
  );

  expect(await readAttributionRevision(document.id)).toBe(5);
});

test("roster profile writes suppress republishing the roster profile container, while container metadata writes still publish", async () => {
  const organizationId = crypto.randomUUID();
  const rosterContainerId = crypto.randomUUID();
  const regularContainerId = crypto.randomUUID();
  const rosterProfileDocId = crypto.randomUUID();
  const rosterMetadataDocId = crypto.randomUUID();
  const regularDocId = crypto.randomUUID();
  const initialStamp = new Date("2025-01-01T00:00:00.000Z");
  const nextStamp = new Date("2025-01-02T00:00:00.000Z");

  await db.insert(containers).values([
    {
      id: rosterContainerId,
      organizationId,
      systemSlot: organizationRosterProfileContainerSystemSlot(organizationId),
      updatedAt: initialStamp,
    },
    {
      id: regularContainerId,
      organizationId,
      systemSlot: null,
      updatedAt: initialStamp,
    },
  ]);
  await db.insert(documents).values([
    { createdByFingerprint: "roster-profile-touch", id: rosterProfileDocId },
    { createdByFingerprint: "roster-metadata-touch", id: rosterMetadataDocId },
    { createdByFingerprint: "regular-doc-touch", id: regularDocId },
  ]);
  await db.insert(containerMetadataDocuments).values({
    containerId: rosterContainerId,
    documentId: rosterMetadataDocId,
  });
  await db.insert(organizationRosterEntries).values({
    organizationId,
    profileDocumentId: rosterProfileDocId,
    userId: crypto.randomUUID(),
  });

  const readContainerUpdatedAt = async (containerId: string) => {
    const [row] = await db
      .select({ updatedAt: containers.updatedAt })
      .from(containers)
      .where(eq(containers.id, containerId));
    return row?.updatedAt.toISOString();
  };

  // Writing a roster profile document does not republish its roster container.
  await db.transaction((tx) =>
    touchContainersForDocument(tx, {
      documentId: rosterProfileDocId,
      linkedContainerIds: [rosterContainerId],
      organizationId,
      updatedAt: nextStamp,
    }),
  );
  expect(await readContainerUpdatedAt(rosterContainerId)).toBe(
    initialStamp.toISOString(),
  );

  // Writing an ordinary document republishes an ordinary container, not a roster slot.
  await db.transaction((tx) =>
    touchContainersForDocument(tx, {
      documentId: regularDocId,
      linkedContainerIds: [rosterContainerId, regularContainerId],
      organizationId,
      updatedAt: nextStamp,
    }),
  );
  expect(await readContainerUpdatedAt(rosterContainerId)).toBe(
    initialStamp.toISOString(),
  );
  expect(await readContainerUpdatedAt(regularContainerId)).toBe(
    nextStamp.toISOString(),
  );

  // Updating the roster container's own metadata document still republishes it.
  await db.transaction((tx) =>
    touchContainersForDocument(tx, {
      documentId: rosterMetadataDocId,
      linkedContainerIds: [rosterContainerId],
      organizationId,
      updatedAt: nextStamp,
    }),
  );
  expect(await readContainerUpdatedAt(rosterContainerId)).toBe(
    nextStamp.toISOString(),
  );
});
