import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import { accessManifestHeads } from "@symcrypt/api-shared/schema";
import {
  lockAccessManifestHeadsForShare,
  lockAccessManifestHeadsForUpdate,
} from "../../../access/read/accessManifestStore";
import {
  assertBlobTargetOrganizationMatches,
  assertRequestedBlobTargetHeadsAreKnown,
  createAttachmentAuthorizationLockPlan,
} from "./authorization";

test("attachment authorization locks every path and key-target head", () => {
  const documentId = crypto.randomUUID();
  const targetDocumentId = crypto.randomUUID();
  expect(
    createAttachmentAuthorizationLockPlan({
      authorizingContainerIds: ["ancestor", "linked-a"],
      documentId,
      existingBlobTargets: [
        { containerId: "target", documentId: targetDocumentId },
        { containerId: "linked-a", documentId },
      ],
      linkedContainerIds: ["linked-b", "linked-a"],
    }),
  ).toEqual({
    containerIds: ["ancestor", "linked-a", "linked-b", "target"],
    documentIds: [documentId, targetDocumentId].sort(),
  });
});

test("attachment locks reject client-selected target heads", () => {
  expect(() =>
    assertRequestedBlobTargetHeadsAreKnown({
      documentId: "document",
      existingBlobTargets: [
        { containerId: "existing-container", documentId: "existing-document" },
      ],
      linkedContainerIds: ["linked-container"],
      requestedTargets: [
        { containerId: "unrelated-container", documentId: "document" },
      ],
    }),
  ).toThrow("Blob content-key target heads are stale");
  expect(() =>
    assertRequestedBlobTargetHeadsAreKnown({
      documentId: "document",
      existingBlobTargets: [],
      linkedContainerIds: ["linked-container"],
      requestedTargets: [
        { containerId: "linked-container", documentId: "document" },
        { containerId: "linked-container", documentId: "document" },
      ],
    }),
  ).toThrow("Blob content-key target heads are stale");
});

test("attachment locks hide cross-organization blob ids", () => {
  expect(() =>
    assertBlobTargetOrganizationMatches({
      actualOrganizationId: "other-organization",
      expectedOrganizationId: "request-organization",
    }),
  ).toThrow("Blob not found");
  expect(() =>
    assertBlobTargetOrganizationMatches({
      actualOrganizationId: "request-organization",
      expectedOrganizationId: "request-organization",
    }),
  ).not.toThrow();
});

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "opposite manifest-head plans serialize without deadlocking",
  async () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    await db.insert(accessManifestHeads).values(
      [firstId, secondId].map((objectId) => ({
        epoch: 1,
        manifestHash: `manifest:${objectId}`,
        objectId,
        objectKind: "container" as const,
        organizationId,
      })),
    );

    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await lockAccessManifestHeadsForUpdate(
        "container",
        [firstId, secondId],
        tx,
      );
      markHeld();
      await hold;
    });

    await held;
    let contenderSettled = false;
    const contender = db
      .transaction((tx) =>
        lockAccessManifestHeadsForUpdate("container", [secondId, firstId], tx),
      )
      .then(() => {
        contenderSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settledWhileHeld = contenderSettled;
    releaseHold();
    await Promise.all([holder, contender]);

    expect(settledWhileHeld).toBe(false);
    expect(contenderSettled).toBe(true);
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "attachment locks block rekey on a non-authorizing linked target",
  async () => {
    const authorizingContainerId = crypto.randomUUID();
    const linkedTargetId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    await db.insert(accessManifestHeads).values([
      {
        epoch: 1,
        manifestHash: `manifest:${authorizingContainerId}`,
        objectId: authorizingContainerId,
        objectKind: "container",
        organizationId,
      },
      {
        epoch: 1,
        manifestHash: `manifest:${linkedTargetId}`,
        objectId: linkedTargetId,
        objectKind: "container",
        organizationId,
      },
    ]);
    const lockPlan = createAttachmentAuthorizationLockPlan({
      authorizingContainerIds: [authorizingContainerId],
      documentId: crypto.randomUUID(),
      existingBlobTargets: [],
      linkedContainerIds: [authorizingContainerId, linkedTargetId],
    });

    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await lockAccessManifestHeadsForShare(
        "container",
        lockPlan.containerIds,
        tx,
      );
      markHeld();
      await hold;
    });

    await held;
    let rekeySettled = false;
    const rekey = db
      .transaction((tx) =>
        lockAccessManifestHeadsForUpdate("container", [linkedTargetId], tx),
      )
      .then(() => {
        rekeySettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settledWhileHeld = rekeySettled;
    releaseHold();
    await Promise.all([holder, rekey]);

    expect(settledWhileHeld).toBe(false);
    expect(rekeySettled).toBe(true);
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "attachment locks block relink of another blob target document",
  async () => {
    const authorizingContainerId = crypto.randomUUID();
    const targetContainerId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const targetDocumentId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    await db.insert(accessManifestHeads).values(
      [authorizingContainerId, targetContainerId].map((objectId) => ({
        epoch: 1,
        manifestHash: `manifest:${objectId}`,
        objectId,
        objectKind: "container" as const,
        organizationId,
      })),
    );
    await db.insert(accessManifestHeads).values(
      [documentId, targetDocumentId].map((objectId) => ({
        epoch: 1,
        manifestHash: `manifest:${objectId}`,
        objectId,
        objectKind: "document" as const,
        organizationId,
      })),
    );
    const lockPlan = createAttachmentAuthorizationLockPlan({
      authorizingContainerIds: [authorizingContainerId],
      documentId,
      existingBlobTargets: [
        { containerId: targetContainerId, documentId: targetDocumentId },
      ],
      linkedContainerIds: [authorizingContainerId],
    });

    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await lockAccessManifestHeadsForShare(
        "container",
        lockPlan.containerIds,
        tx,
      );
      await lockAccessManifestHeadsForShare(
        "document",
        lockPlan.documentIds,
        tx,
      );
      markHeld();
      await hold;
    });

    await held;
    let relinkSettled = false;
    const relink = db
      .transaction((tx) =>
        lockAccessManifestHeadsForUpdate("document", [targetDocumentId], tx),
      )
      .then(() => {
        relinkSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settledWhileHeld = relinkSettled;
    releaseHold();
    await Promise.all([holder, relink]);

    expect(settledWhileHeld).toBe(false);
    expect(relinkSettled).toBe(true);
  },
  30_000,
);
