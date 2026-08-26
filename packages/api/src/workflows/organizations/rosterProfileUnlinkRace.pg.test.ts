import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import {
  containers,
  documentContainerLinks,
  organizationRosterEntries,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { and, eq } from "drizzle-orm";
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

function runLink(fixture: Awaited<ReturnType<typeof createRaceFixture>>) {
  return runDocumentLinkSetMutationWorkflow(db, {
    documentId: fixture.profile.id,
    eventType: "document.link",
    fingerprint: fixture.owner.fingerprint,
    request: fixture.linkRequest,
    userId: fixture.owner.userId,
  });
}

async function loadRaceState(
  fixture: Awaited<ReturnType<typeof createRaceFixture>>,
) {
  const [binding] = await db
    .select({ profileDocumentId: organizationRosterEntries.profileDocumentId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(organizationRosterEntries.organizationId, fixture.organizationId),
        eq(organizationRosterEntries.userId, fixture.owner.userId),
      ),
    );
  const links = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, fixture.profile.id));
  return {
    linkedContainerIds: links.map((link) => link.containerId).sort(),
    profileDocumentId: binding?.profileDocumentId ?? null,
  };
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a roster bind that owns the organization lock makes a racing link fail",
  async () => {
    const fixture = await createRaceFixture();
    const rosterEntryLock = await holdPostgresLock(async (tx) => {
      const query = tx
        .select({ id: organizationRosterEntries.id })
        .from(organizationRosterEntries)
        .where(
          and(
            eq(
              organizationRosterEntries.organizationId,
              fixture.organizationId,
            ),
            eq(organizationRosterEntries.userId, fixture.owner.userId),
          ),
        );
      await lockRowForUpdate(query);
    });

    const bind = runUpdateOrganizationRosterEntryWorkflow(
      db,
      fixture.organizationId,
      fixture.owner.userId,
      fixture.owner.userId,
      { profileDocumentId: fixture.profile.id },
    );

    let link: ReturnType<typeof runLink> | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: rosterEntryLock.backendPid,
        queryFragment: "organization_roster_entries",
      });
      link = runLink(fixture);
      await waitForPostgresLockWait({
        blockerPid: rosterEntryLock.backendPid,
        queryFragment: "organization_read_model_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await rosterEntryLock.release();
    }
    const linkResult = await (
      link ?? Promise.reject(synchronizationError)
    ).then(
      () => {
        return { kind: "fulfilled" as const };
      },
      (error: unknown) => {
        return { error, kind: "rejected" as const };
      },
    );
    await bind;
    if (synchronizationError) {
      throw synchronizationError;
    }
    expect(linkResult).toMatchObject({
      error: {
        message:
          "Bound roster profile documents must remain exclusively in the roster profile container",
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
  "a link that owns the document lock makes a racing roster bind fail",
  async () => {
    const fixture = await createRaceFixture();
    const documentLock = await holdAccessManifestHeadForUpdate({
      objectId: fixture.profile.id,
      objectKind: "document",
    });

    const link = runLink(fixture);

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
