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
import { registerUser } from "../../../test/helpers/registerUser";
import { lockAccessManifestHeadsForUpdate } from "../../access/read/accessManifestStore";
import { lockRowForUpdate } from "../../utils/sqlDialect";
import { runDocumentLinkSetMutationWorkflow } from "../documents/mutations/mutateDocumentLinkSet";
import { runUpdateOrganizationRosterEntryWorkflow } from "./rosterMutation";

const INTERLEAVING_WAIT_MS = 300;

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

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
    const rosterEntryHeld = deferred();
    const releaseRosterEntry = deferred();
    const rosterEntryHolder = db.transaction(async (tx) => {
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
      rosterEntryHeld.resolve();
      await releaseRosterEntry.promise;
    });
    await rosterEntryHeld.promise;

    let bindSettled = false;
    const bind = runUpdateOrganizationRosterEntryWorkflow(
      db,
      fixture.organizationId,
      fixture.owner.userId,
      fixture.owner.userId,
      { profileDocumentId: fixture.profile.id },
    ).then(() => {
      bindSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
    expect(bindSettled).toBe(false);

    let unlinkSettled = false;
    const unlink = runUnlink(fixture).then(
      () => {
        unlinkSettled = true;
        return { kind: "fulfilled" as const };
      },
      (error: unknown) => {
        unlinkSettled = true;
        return { error, kind: "rejected" as const };
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
      expect(unlinkSettled).toBe(false);
      releaseRosterEntry.resolve();
      const [, , unlinkResult] = await Promise.all([
        rosterEntryHolder,
        bind,
        unlink,
      ]);
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
    } finally {
      releaseRosterEntry.resolve();
      await Promise.all([
        rosterEntryHolder.catch(() => undefined),
        bind.catch(() => undefined),
        unlink.catch(() => undefined),
      ]);
    }
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "an unlink that owns the organization lock makes a racing roster bind fail",
  async () => {
    const fixture = await createRaceFixture();
    const documentHeld = deferred();
    const releaseDocument = deferred();
    const documentHolder = db.transaction(async (tx) => {
      await lockAccessManifestHeadsForUpdate(
        "document",
        [fixture.profile.id],
        tx,
      );
      documentHeld.resolve();
      await releaseDocument.promise;
    });
    await documentHeld.promise;

    let unlinkSettled = false;
    const unlink = runUnlink(fixture).then((result) => {
      unlinkSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
    expect(unlinkSettled).toBe(false);

    let bindSettled = false;
    const bind = runUpdateOrganizationRosterEntryWorkflow(
      db,
      fixture.organizationId,
      fixture.owner.userId,
      fixture.owner.userId,
      { profileDocumentId: fixture.profile.id },
    ).then(
      () => {
        bindSettled = true;
        return { kind: "fulfilled" as const };
      },
      (error: unknown) => {
        bindSettled = true;
        return { error, kind: "rejected" as const };
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
      expect(bindSettled).toBe(false);
      releaseDocument.resolve();
      const [, unlinkResult, bindResult] = await Promise.all([
        documentHolder,
        unlink,
        bind,
      ]);
      expect(unlinkResult.response.id).toBe(fixture.profile.id);
      expect(bindResult).toMatchObject({
        error: { status: 400 },
        kind: "rejected",
      });
      expect(await loadRaceState(fixture)).toEqual({
        linkedContainerIds: [fixture.owner.rootContainerId],
        profileDocumentId: null,
      });
    } finally {
      releaseDocument.resolve();
      await Promise.all([
        documentHolder.catch(() => undefined),
        unlink.catch(() => undefined),
        bind.catch(() => undefined),
      ]);
    }
  },
  30_000,
);
