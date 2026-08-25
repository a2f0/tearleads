import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import {
  containers,
  documents,
  organizationRosterEntries,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { lockAccessManifestHeadsForUpdate } from "../../access/read/accessManifestStore";
import { runPurgeDocumentWorkflow } from "../documents/mutations/purgeDocument";
import { lockOrganizationReadModelHeadForUpdateInTransaction } from "./readModelChanges";
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
  await db
    .update(containers)
    .set({
      systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
        organizationId,
      }),
    })
    .where(eq(containers.id, root.kekState.containerId));
  const profile = await createDocument({ owner, root });
  return { organizationId, owner, profile };
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a roster binding that owns the organization lock makes a racing purge fail",
  async () => {
    const fixture = await createRaceFixture();
    const bindingHeld = deferred();
    const releaseBinding = deferred();
    const binding = db.transaction(async (tx) => {
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
      bindingHeld.resolve();
      await releaseBinding.promise;
    });
    await bindingHeld.promise;

    let purgeSettled = false;
    const purge = runPurgeDocumentWorkflow(db, {
      documentId: fixture.profile.id,
      userId: fixture.owner.userId,
    }).then(
      () => {
        purgeSettled = true;
        return { kind: "fulfilled" as const };
      },
      (error: unknown) => {
        purgeSettled = true;
        return { error, kind: "rejected" as const };
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
      expect(purgeSettled).toBe(false);
      releaseBinding.resolve();
      const [, purgeResult] = await Promise.all([binding, purge]);
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
    } finally {
      releaseBinding.resolve();
      await Promise.all([
        binding.catch(() => undefined),
        purge.catch(() => undefined),
      ]);
    }
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a purge that owns the organization lock makes a racing roster bind fail",
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

    let purgeSettled = false;
    const purge = runPurgeDocumentWorkflow(db, {
      documentId: fixture.profile.id,
      userId: fixture.owner.userId,
    }).then((result) => {
      purgeSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, INTERLEAVING_WAIT_MS));
    expect(purgeSettled).toBe(false);

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
      const [, purgeResult, bindResult] = await Promise.all([
        documentHolder,
        purge,
        bind,
      ]);
      expect(purgeResult.response.documentId).toBe(fixture.profile.id);
      expect(bindResult).toMatchObject({
        error: { status: 400 },
        kind: "rejected",
      });
      const [binding] = await db
        .select({
          profileDocumentId: organizationRosterEntries.profileDocumentId,
        })
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
      expect(binding?.profileDocumentId).toBeNull();
    } finally {
      releaseDocument.resolve();
      await Promise.all([
        documentHolder.catch(() => undefined),
        purge.catch(() => undefined),
        bind.catch(() => undefined),
      ]);
    }
  },
  30_000,
);
