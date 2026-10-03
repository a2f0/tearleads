import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  containers,
  documents,
  organizations,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq } from "drizzle-orm";
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
import { runUpdateOrganizationProfileWorkflow } from "./profileMutation";
import { lockOrganizationReadModelHeadForUpdateInTransaction } from "./readModelChanges";

// The organization profile twin of rosterProfilePurgeRace: a bound profile
// document cannot be purged, so its id cannot be recreated elsewhere while
// bound, and the bind and purge serialize on the organization read-model head.
async function createRaceFixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId,
  });
  // The fixture root stands in for the organization metadata container; the
  // registered one moves to an unused slot, since each slot is unique.
  await db
    .update(containers)
    .set({ systemSlot: `retired-${metadataSlot}` })
    .where(eq(containers.systemSlot, metadataSlot));
  await db
    .update(containers)
    .set({ systemSlot: metadataSlot })
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

type RaceFixture = Awaited<ReturnType<typeof createRaceFixture>>;

function runPurge(fixture: RaceFixture) {
  return runPurgeDocumentWorkflow(db, {
    documentId: fixture.profile.id,
    fingerprint: fixture.owner.fingerprint,
    request: fixture.purgeRequest,
    userId: fixture.owner.userId,
  });
}

function settle<T>(promise: Promise<T>) {
  return promise.then(
    () => ({ kind: "fulfilled" as const }),
    (error: unknown) => ({ error, kind: "rejected" as const }),
  );
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a profile binding that owns the organization lock makes a racing purge fail",
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
        .update(organizations)
        .set({ profileDocumentId: fixture.profile.id })
        .where(eq(organizations.id, fixture.organizationId));
    });

    const purge = settle(runPurge(fixture));
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
        message: "Bound organization profile documents cannot be purged",
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
  "a purge that owns the organization lock makes a racing profile bind fail",
  async () => {
    const fixture = await createRaceFixture();
    const documentLock = await holdAccessManifestHeadForUpdate({
      objectId: fixture.profile.id,
      objectKind: "document",
    });

    const purge = runPurge(fixture);
    let bind:
      | ReturnType<typeof runUpdateOrganizationProfileWorkflow>
      | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: documentLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
      bind = runUpdateOrganizationProfileWorkflow(
        db,
        fixture.organizationId,
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
    const bindResult = await settle(
      bind ?? Promise.reject(synchronizationError),
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
    const [organization] = await db
      .select({ profileDocumentId: organizations.profileDocumentId })
      .from(organizations)
      .where(eq(organizations.id, fixture.organizationId));
    expect(organization?.profileDocumentId).toBeNull();
  },
  30_000,
);
