import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  containers,
  documents,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildDocumentPurgeRequest } from "../../../test/helpers/documentPurge";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdAccessManifestHeadForUpdate,
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { runPurgeDocumentWorkflow } from "../documents/mutations/purgeDocument";
import { lockOrganizationReadModelHeadForUpdateInTransaction } from "./readModelChanges";
import { runUpdateOrganizationRosterEntryWorkflow } from "./rosterMutation";

async function createRaceFixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  await db
    .update(containers)
    .set({
      systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
        organizationId,
      }),
    })
    .where(eq(containers.id, root.kekState.containerId));
  const profile = await createDocument({ owner, root });
  const purgeRequest = await buildDocumentPurgeRequest({
    documentId: profile.id,
    documentManifestHash: profile.accessManifest.manifestHash,
    owner,
    root,
  });
  return { organizationId, owner, profile, purgeRequest };
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a roster binding that owns the organization lock makes a racing purge fail",
  async () => {
    const fixture = await createRaceFixture();
    const bindingLock = await holdPostgresLock(async (tx) => {
      expect(
        await lockOrganizationReadModelHeadForUpdateInTransaction(
          tx,
          fixture.organizationId,
        ),
      ).toBe(true);
      await tx
        .update(organizationRosterEntries)
        .set({ profileDocumentId: fixture.profile.id })
        .where(
          and(
            eq(
              organizationRosterEntries.organizationId,
              fixture.organizationId,
            ),
            eq(organizationRosterEntries.userId, fixture.owner.userId),
          ),
        );
    });

    const purge = runPurgeDocumentWorkflow(db, {
      documentId: fixture.profile.id,
      fingerprint: fixture.owner.fingerprint,
      request: fixture.purgeRequest,
      userId: fixture.owner.userId,
    }).then(
      () => ({ kind: "fulfilled" as const }),
      (error: unknown) => {
        return { error, kind: "rejected" as const };
      },
    );
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: bindingLock.backendPid,
        queryFragment: "organization_read_model_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await bindingLock.release();
    }
    const purgeResult = await purge;
    if (synchronizationError) {
      throw synchronizationError;
    }
    expect(purgeResult).toMatchObject({
      error: {
        message: "Bound roster profile documents cannot be purged",
        status: 409,
      },
      kind: "rejected",
    });
    const [document] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, fixture.profile.id));
    expect(document?.id).toBe(fixture.profile.id);
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a purge that owns the organization lock makes a racing roster bind fail",
  async () => {
    const fixture = await createRaceFixture();
    const documentLock = await holdAccessManifestHeadForUpdate({
      objectId: fixture.profile.id,
      objectKind: "document",
    });

    const purge = runPurgeDocumentWorkflow(db, {
      documentId: fixture.profile.id,
      fingerprint: fixture.owner.fingerprint,
      request: fixture.purgeRequest,
      userId: fixture.owner.userId,
    });

    let bind:
      | ReturnType<typeof runUpdateOrganizationRosterEntryWorkflow>
      | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: documentLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
      bind = runUpdateOrganizationRosterEntryWorkflow(
        db,
        fixture.organizationId,
        fixture.owner.userId,
        fixture.owner.userId,
        { profileDocumentId: fixture.profile.id },
      );
      await waitForPostgresLockWait({
        blockerPid: documentLock.backendPid,
        queryFragment: "organization_read_model_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await documentLock.release();
    }
    const bindResult = await (
      bind ?? Promise.reject(synchronizationError)
    ).then(
      () => {
        return { kind: "fulfilled" as const };
      },
      (error: unknown) => {
        return { error, kind: "rejected" as const };
      },
    );
    const purgeResult = await purge;
    if (synchronizationError) {
      throw synchronizationError;
    }
    expect(purgeResult.response.documentId).toBe(fixture.profile.id);
    expect(bindResult).toMatchObject({
      error: { status: 400 },
      kind: "rejected",
    });
    const [bindingRow] = await db
      .select({
        profileDocumentId: organizationRosterEntries.profileDocumentId,
      })
      .from(organizationRosterEntries)
      .where(
        and(
          eq(organizationRosterEntries.organizationId, fixture.organizationId),
          eq(organizationRosterEntries.userId, fixture.owner.userId),
        ),
      );
    expect(bindingRow?.profileDocumentId).toBeNull();
  },
  30_000,
);
