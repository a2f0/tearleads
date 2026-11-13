import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessEvents, accessManifests } from "@tearleads/api-shared/schema";
import type {
  AccessManifest,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { readKeyingCanonicalJson } from "@tearleads/crypto";
import { eq, inArray, type SQL } from "drizzle-orm";
import { uniqueSortedStrings as unique } from "../../../utils/array";
import { toStoredAccessEvent } from "./accessEventLookup";
import {
  type StoredAccessManifestBundle,
  transactionAccessManifestBundles,
} from "./accessManifestBundleCache";
import {
  isReferencedPrincipalHead,
  readAccessVersion,
  readJsonArray,
} from "./accessManifestJson";

function toStoredAccessManifest(
  row: typeof accessManifests.$inferSelect,
): AccessManifest {
  return {
    version: readAccessVersion(row.version, "stored access manifest"),
    objectKind: row.objectKind,
    objectId: row.objectId,
    organizationId: row.organizationId,
    epoch: row.epoch,
    previousManifestHash: row.previousManifestHash,
    eventHash: row.eventHash,
    structuralHash: row.structuralHash,
    grantRoot: row.grantRoot,
    referencedPrincipalHeads: readJsonArray<ReferencedPrincipalHead>(
      row.referencedPrincipalHeads,
      "access manifest referenced principal heads",
      isReferencedPrincipalHead,
    ),
    keyTargetHash: row.keyTargetHash,
  };
}

export function toStoredAccessManifestBundle(
  manifest: typeof accessManifests.$inferSelect,
  event: typeof accessEvents.$inferSelect | null,
): StoredAccessManifestBundle {
  if (!event) throw new Error("Access event not found");
  return {
    event: toStoredAccessEvent(event),
    manifest: toStoredAccessManifest(manifest),
    manifestHash: manifest.manifestHash,
    state: readKeyingCanonicalJson(
      manifest.state,
      "stored access manifest state",
    ),
    verificationMac: manifest.verificationMac,
  };
}

export async function getAccessManifestBundle(
  manifestHash: string,
  executor: DatabaseSession,
): Promise<StoredAccessManifestBundle | null> {
  const bundles = await getAccessManifestBundles([manifestHash], executor);
  return bundles.get(manifestHash) ?? null;
}

export async function getAccessManifestBundles(
  manifestHashes: readonly string[],
  executor: DatabaseSession,
  omitUnreadable = false,
): Promise<Map<string, StoredAccessManifestBundle>> {
  const uniqueManifestHashes = unique(manifestHashes);
  const bundles = new Map<string, StoredAccessManifestBundle>();
  const memo = transactionAccessManifestBundles(executor);
  const missingHashes: string[] = [];
  for (const manifestHash of uniqueManifestHashes) {
    const bundle = memo?.get(manifestHash);
    if (bundle) bundles.set(manifestHash, bundle);
    else missingHashes.push(manifestHash);
  }
  if (missingHashes.length === 0) {
    return bundles;
  }

  const loaded = await loadAccessManifestBundles(
    executor,
    inArray(accessManifests.manifestHash, missingHashes),
    omitUnreadable,
  );
  for (const [manifestHash, bundle] of loaded)
    bundles.set(manifestHash, bundle);
  return bundles;
}

/**
 * Manifests matching `where`, with their events, read from storage. Both hashes are unique, so
 * the join cannot multiply rows. Keep missing events visible: an incomplete
 * bundle is corruption, not an absent manifest.
 */
export async function loadAccessManifestBundles(
  executor: DatabaseSession,
  where: SQL | undefined,
  omitUnreadable = false,
): Promise<Map<string, StoredAccessManifestBundle>> {
  const rows = await executor
    .select({ manifest: accessManifests, event: accessEvents })
    .from(accessManifests)
    .leftJoin(
      accessEvents,
      eq(accessEvents.eventHash, accessManifests.eventHash),
    )
    .where(where);
  // Every converted row joins the transaction's memo; see
  // `transactionAccessManifestBundles`.
  const memo = transactionAccessManifestBundles(executor);
  const bundles = new Map<string, StoredAccessManifestBundle>();
  for (const { manifest, event } of rows) {
    try {
      const bundle = toStoredAccessManifestBundle(manifest, event);
      bundles.set(manifest.manifestHash, bundle);
      memo?.set(manifest.manifestHash, bundle);
    } catch (error) {
      if (!omitUnreadable) throw error;
    }
  }

  return bundles;
}
