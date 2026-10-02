import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  containers,
  documentContainerLinks,
  organizations,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
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
import { lockRowForUpdate } from "../../utils/sqlDialect";
import { runDocumentLinkSetMutationWorkflow } from "../documents/mutations/mutateDocumentLinkSet";
import { runUpdateOrganizationProfileWorkflow } from "./profileMutation";

// The organization profile twin of rosterProfileUnlinkRace: a pointer bind
// and a link that would move the bound document out of the metadata container
// serialize on the organization read-model head, so whichever commits second
// sees the first.
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
  const secondContainer = await createChildContainer({
    parent: root,
    signer: owner,
  });
  const profile = await createDocument({ owner, root });
  const linkRequest = await buildDocumentLinkRequest({
    child: secondContainer,
    createdDocument: profile,
    owner,
    root,
  });
  return { linkRequest, organizationId, owner, profile, secondContainer };
}

type RaceFixture = Awaited<ReturnType<typeof createRaceFixture>>;

function runLink(fixture: RaceFixture) {
  return runDocumentLinkSetMutationWorkflow(db, {
    documentId: fixture.profile.id,
    eventType: "document.link",
    fingerprint: fixture.owner.fingerprint,
    request: fixture.linkRequest,
    userId: fixture.owner.userId,
  });
}

function runBind(fixture: RaceFixture) {
  return runUpdateOrganizationProfileWorkflow(
    db,
    fixture.organizationId,
    fixture.owner.userId,
    { profileDocumentId: fixture.profile.id },
  );
}

async function loadRaceState(fixture: RaceFixture) {
  const [organization] = await db
    .select({ profileDocumentId: organizations.profileDocumentId })
    .from(organizations)
    .where(eq(organizations.id, fixture.organizationId));
  const links = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, fixture.profile.id));
  return {
    linkedContainerIds: links.map((link) => link.containerId).sort(),
    profileDocumentId: organization?.profileDocumentId ?? null,
  };
}

function settle<T>(promise: Promise<T>) {
  return promise.then(
    () => ({ kind: "fulfilled" as const }),
    (error: unknown) => ({ error, kind: "rejected" as const }),
  );
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a profile bind that owns the organization lock makes a racing link fail",
  async () => {
    const fixture = await createRaceFixture();
    // Stall the bind after it takes the organization lock, at its pointer
    // write.
    const organizationRowLock = await holdPostgresLock(async (tx) => {
      await lockRowForUpdate(
        tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, fixture.organizationId)),
      );
    });

    const bind = runBind(fixture);
    let link: ReturnType<typeof runLink> | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: organizationRowLock.backendPid,
        queryFragment: "organizations",
      });
      link = runLink(fixture);
      await waitForPostgresLockWait({
        blockerPid: organizationRowLock.backendPid,
        queryFragment: "organization_read_model_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await organizationRowLock.release();
    }
    const linkResult = await settle(
      link ?? Promise.reject(synchronizationError),
    );
    await bind;
    if (synchronizationError) {
      throw synchronizationError;
    }
    expect(linkResult).toMatchObject({
      error: {
        message:
          "Bound organization profile documents must remain exclusively in the organization metadata container",
        status: 409,
      },
      kind: "rejected",
    });
    expect(await loadRaceState(fixture)).toEqual({
      linkedContainerIds: [fixture.owner.rootContainerId],
      profileDocumentId: fixture.profile.id,
    });
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a link that owns the document lock makes a racing profile bind fail",
  async () => {
    const fixture = await createRaceFixture();
    const documentLock = await holdAccessManifestHeadForUpdate({
      objectId: fixture.profile.id,
      objectKind: "document",
    });

    const link = runLink(fixture);
    let bind: ReturnType<typeof runBind> | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: documentLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
      bind = runBind(fixture);
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
    const linkResult = await link;
    if (synchronizationError) {
      throw synchronizationError;
    }
    expect(linkResult.response.id).toBe(fixture.profile.id);
    expect(bindResult).toMatchObject({
      error: { status: 400 },
      kind: "rejected",
    });
    expect(await loadRaceState(fixture)).toEqual({
      linkedContainerIds: [
        fixture.owner.rootContainerId,
        fixture.secondContainer.containerId,
      ].sort(),
      profileDocumentId: null,
    });
  },
  30_000,
);
