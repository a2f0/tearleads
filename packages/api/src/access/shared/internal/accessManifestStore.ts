import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
} from "@tearleads/api-shared/schema";
import type {
  AnyVerifiedAccessManifest,
  VerifiedAccessEvent,
} from "@tearleads/crypto";
import { eq, lt } from "drizzle-orm";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";
import { recordTransactionLock } from "../../../utils/transactionLocks";
import { insertAccessEvent } from "./accessEventStore";
import {
  accessManifestHeadLockKey,
  type StoredAccessManifestHead,
  toStoredAccessManifestHead,
} from "./accessManifestHeadLocks";
import { loadCurrentAccessManifestHead } from "./accessManifestHeadReads";
import {
  accessManifestReferencedHeads,
  accessManifestState,
  referencedPrincipalHeadsCanonicalJson,
} from "./accessManifestJson";
import {
  insertAccessManifestPrincipalProjection,
  regenerateAccessManifestContainerGrantProjection,
  regenerateAccessManifestPrincipalProjection,
  replaceAccessManifestContainerGrantProjection,
  replaceAccessManifestDocumentLinkProjection,
} from "./accessManifestProjections";
import { selectOneOrThrow } from "./selectOneOrThrow";

interface StoreVerifiedAccessManifestInput {
  readonly verifiedManifest: AnyVerifiedAccessManifest;
}

export async function storeVerifiedAccessEventInTransaction(
  verifiedEvent: VerifiedAccessEvent,
  tx: DatabaseTransaction,
): Promise<VerifiedAccessEvent> {
  await insertAccessEvent(verifiedEvent, tx);
  return verifiedEvent;
}

/** The inserted row, or null when the same manifest was already stored. */
async function insertAccessManifest(
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: DatabaseSession,
): Promise<typeof accessManifests.$inferSelect | null> {
  const manifest = verifiedManifest.manifest;

  const [insertedManifest] = await executor
    .insert(accessManifests)
    .values({
      version: manifest.version,
      objectKind: manifest.objectKind,
      objectId: manifest.objectId,
      organizationId: manifest.organizationId,
      epoch: manifest.epoch,
      previousManifestHash: manifest.previousManifestHash,
      eventHash: manifest.eventHash,
      structuralHash: manifest.structuralHash,
      grantRoot: manifest.grantRoot,
      referencedPrincipalHeads: accessManifestReferencedHeads(verifiedManifest),
      keyTargetHash: manifest.keyTargetHash,
      manifestHash: verifiedManifest.manifestHash,
      state: accessManifestState(verifiedManifest),
    })
    .onConflictDoNothing({ target: accessManifests.manifestHash })
    .returning();

  if (!insertedManifest) {
    await ensureStoredAccessManifestMatches(verifiedManifest, executor);
    return null;
  }

  return insertedManifest;
}

async function ensureStoredAccessManifestMatches(
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: DatabaseSession,
): Promise<void> {
  const storedManifest = await selectOneOrThrow(
    executor
      .select()
      .from(accessManifests)
      .where(eq(accessManifests.manifestHash, verifiedManifest.manifestHash))
      .limit(1),
    "Failed to load stored access manifest",
  );

  const manifest = verifiedManifest.manifest;
  if (
    storedManifest.version !== manifest.version ||
    storedManifest.objectKind !== manifest.objectKind ||
    storedManifest.objectId !== manifest.objectId ||
    storedManifest.organizationId !== manifest.organizationId ||
    storedManifest.epoch !== manifest.epoch ||
    storedManifest.previousManifestHash !== manifest.previousManifestHash ||
    storedManifest.eventHash !== manifest.eventHash ||
    storedManifest.structuralHash !== manifest.structuralHash ||
    storedManifest.grantRoot !== manifest.grantRoot ||
    !canonicalJsonEquals(
      referencedPrincipalHeadsCanonicalJson(
        storedManifest.referencedPrincipalHeads,
      ),
      referencedPrincipalHeadsCanonicalJson(
        accessManifestReferencedHeads(verifiedManifest),
      ),
    ) ||
    storedManifest.keyTargetHash !== manifest.keyTargetHash ||
    !canonicalJsonEquals(
      storedManifest.state,
      accessManifestState(verifiedManifest),
    )
  ) {
    throw new Error("Access manifest conflict");
  }
}

async function loadAccessManifestRow(
  manifestHash: string,
  executor: DatabaseSession,
): Promise<typeof accessManifests.$inferSelect> {
  return selectOneOrThrow(
    executor
      .select()
      .from(accessManifests)
      .where(eq(accessManifests.manifestHash, manifestHash))
      .limit(1),
    "Access manifest not found",
  );
}

export async function regenerateAccessManifestProjections(
  manifestHash: string,
  database: ApiDatabase,
): Promise<void> {
  return database.transaction((tx) =>
    regenerateAccessManifestProjectionsInTransaction(manifestHash, tx),
  );
}

async function regenerateAccessManifestProjectionsInTransaction(
  manifestHash: string,
  tx: DatabaseTransaction,
): Promise<void> {
  const manifest = await loadAccessManifestRow(manifestHash, tx);

  await regenerateAccessManifestPrincipalProjection(manifest, tx);
  await regenerateAccessManifestContainerGrantProjection(manifest, tx);
}

async function advanceAccessManifestHead(
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: DatabaseSession,
): Promise<StoredAccessManifestHead> {
  const manifest = verifiedManifest.manifest;

  const [advancedHead] = await executor
    .insert(accessManifestHeads)
    .values({
      objectKind: manifest.objectKind,
      objectId: manifest.objectId,
      organizationId: manifest.organizationId,
      epoch: manifest.epoch,
      manifestHash: verifiedManifest.manifestHash,
    })
    .onConflictDoUpdate({
      target: [accessManifestHeads.objectKind, accessManifestHeads.objectId],
      set: {
        organizationId: manifest.organizationId,
        epoch: manifest.epoch,
        manifestHash: verifiedManifest.manifestHash,
        updatedAt: new Date(),
      },
      setWhere: lt(accessManifestHeads.epoch, manifest.epoch),
    })
    .returning();

  if (advancedHead) {
    // The row this transaction inserted or updated stays locked to everyone
    // else until it ends, as a FOR UPDATE lock would hold it.
    recordTransactionLock(
      executor,
      accessManifestHeadLockKey(manifest.objectKind, manifest.objectId),
      "exclusive",
    );
    return toStoredAccessManifestHead(advancedHead);
  }

  const currentHead = await loadCurrentAccessManifestHead(
    manifest.objectKind,
    manifest.objectId,
    executor,
  );

  if (!currentHead) {
    throw new Error("Failed to load stored access manifest head");
  }

  if (
    manifest.epoch === currentHead.epoch &&
    verifiedManifest.manifestHash !== currentHead.manifestHash
  ) {
    throw new Error("Access manifest head epoch conflict");
  }

  return currentHead;
}

export async function storeVerifiedAccessManifest(
  input: StoreVerifiedAccessManifestInput,
  database: ApiDatabase,
): Promise<StoredAccessManifestHead> {
  return database.transaction((tx) =>
    storeVerifiedAccessManifestInTransaction(input, tx),
  );
}

export async function storeVerifiedAccessManifestInTransaction(
  input: StoreVerifiedAccessManifestInput,
  tx: DatabaseTransaction,
): Promise<StoredAccessManifestHead> {
  await insertAccessEvent(input.verifiedManifest.event, tx);
  const insertedManifest = await insertAccessManifest(
    input.verifiedManifest,
    tx,
  );
  // A newly inserted hash has no projection rows: every path that deletes a
  // manifest deletes its projections in the same transaction. Only a replay
  // of a stored manifest replaces them.
  const freshManifest = insertedManifest !== null;
  if (insertedManifest) {
    await insertAccessManifestPrincipalProjection(insertedManifest, tx);
  }
  // Link-set membership and direct grants are verifier state, so write them
  // from the branded manifest rather than inferring them from generic rows.
  await replaceAccessManifestDocumentLinkProjection(
    input.verifiedManifest,
    tx,
    freshManifest,
  );
  await replaceAccessManifestContainerGrantProjection(
    input.verifiedManifest,
    tx,
    freshManifest,
  );

  return advanceAccessManifestHead(input.verifiedManifest, tx);
}
