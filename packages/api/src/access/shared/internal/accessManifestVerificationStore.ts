import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessManifests } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { noteAccessManifestVerificationMac } from "./accessManifestBundleCache";

/** The stored verification MAC of one manifest, or `null` when unmarked. */
export async function selectAccessManifestVerificationMac(
  manifestHash: string,
  executor: DatabaseSession,
): Promise<string | null> {
  const [row] = await executor
    .select({ mac: accessManifests.verificationMac })
    .from(accessManifests)
    .where(eq(accessManifests.manifestHash, manifestHash))
    .limit(1);
  return row?.mac ?? null;
}

/**
 * Write verification MACs onto their stored manifests, replacing any from
 * older rules or another secret. One sorted pass of single-row updates, so
 * overlapping writers lock manifest rows in the same order. A manifest that is
 * not stored gains no marker.
 */
export async function updateAccessManifestVerificationMacs(
  macs: ReadonlyMap<string, string>,
  executor: DatabaseSession,
): Promise<void> {
  const rows = [...macs].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [manifestHash, mac] of rows) {
    await executor
      .update(accessManifests)
      .set({ verificationMac: mac })
      .where(eq(accessManifests.manifestHash, manifestHash));
    noteAccessManifestVerificationMac(executor, manifestHash, mac);
  }
}
