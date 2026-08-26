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
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
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
  const rosterContainer = await createChildContainer({
    parent: root,
    signer: owner,
  });
  await db
    .update(containers)
    .set({
      systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
        organizationId,
      }),
    })
    .where(eq(containers.id, rosterContainer.containerId));
  const profile = await createDocument({ owner, root });
  const linked = await runDocumentLinkSetMutationWorkflow(db, {
    documentId: profile.id,
    eventType: "document.link",
    fingerprint: owner.fingerprint,
    request: await buildDocumentLinkRequest({
      child: rosterContainer,
      createdDocument: profile,
      owner,
      root,
    }),
    userId: owner.userId,
  });
  const unlinkRequest = await buildDocumentUnlinkRequest({
    child: rosterContainer,
    linkedDocument: linked.response,
    owner,
    root,
  });
  return { organizationId, owner, profile, rosterContainer, unlinkRequest };
}

function runUnlink(fixture: Awaited<ReturnType<typeof createRaceFixture>>) {
  return runDocumentLinkSetMutationWorkflow(db, {
    documentId: fixture.profile.id,
    eventType: "document.unlink",
    fingerprint: fixture.owner.fingerprint,
    request: fixture.unlinkRequest,
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
  "a roster bind that owns the organization lock makes a racing unlink fail",
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

    let unlink: ReturnType<typeof runUnlink> | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: rosterEntryLock.backendPid,
        queryFragment: "organization_roster_entries",
      });
      unlink = runUnlink(fixture);
      await waitForPostgresLockWait({
        blockerPid: rosterEntryLock.backendPid,
        queryFragment: "organization_read_model_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await rosterEntryLock.release();
    }
    const unlinkResult = await (
      unlink ?? Promise.reject(synchronizationError)
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
    expect(unlinkResult).toMatchObject({
      error: {
        message:
          "Bound roster profile documents must remain in the roster profile container",
        status: 409,
      },
      kind: "rejected",
    });
    expect(await loadRaceState(fixture)).toEqual({
      linkedContainerIds: [
        fixture.owner.rootContainerId,
        fixture.rosterContainer.containerId,
      ].sort(),
      profileDocumentId: fixture.profile.id,
    });
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "an unlink that owns the organization lock makes a racing roster bind fail",
  async () => {
    const fixture = await createRaceFixture();
    const documentLock = await holdAccessManifestHeadForUpdate({
      objectId: fixture.profile.id,
      objectKind: "document",
    });

    const unlink = runUnlink(fixture);

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
    const unlinkResult = await unlink;
    if (synchronizationError) {
      throw synchronizationError;
    }
    expect(unlinkResult.response.id).toBe(fixture.profile.id);
    expect(bindResult).toMatchObject({
      error: { status: 400 },
      kind: "rejected",
    });
    expect(await loadRaceState(fixture)).toEqual({
      linkedContainerIds: [fixture.owner.rootContainerId],
      profileDocumentId: null,
    });
  },
  30_000,
);
