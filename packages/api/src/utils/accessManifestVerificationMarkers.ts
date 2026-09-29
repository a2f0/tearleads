import { Buffer } from "node:buffer";
import {
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessManifestVerifications } from "@tearleads/api-shared/schema";
import {
  ACCESS_MANIFEST_VERIFICATION_REVISION,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { eq, inArray, sql } from "drizzle-orm";
import { isKeyingCanonicalJson } from "./canonicalJson";
import { readConfiguredDocumentSyncCursorHmacKey } from "./serverSecrets";
import { sha256Hex } from "./sha256";

/** Markers are keyed to the crypto verifiers' rule revision. */
const ACCESS_MANIFEST_VERIFIER_VERSION = ACCESS_MANIFEST_VERIFICATION_REVISION;

const MARKER_DOMAIN = "tearleads.access-manifest-verification.v1";
// Keeps each IN list well inside every supported dialect's bind limit.
const BATCH_SIZE = 500;

// Without a configured secret (development, previews) markers use a key that
// lives only in this process, so nobody who can edit the database can forge
// one; they simply stop matching after a restart.
const processMarkerKey = randomBytes(32);
let derivedMarkerKey: { readonly secret: string; readonly key: Buffer } | null =
  null;

/** Re-derived when the secret changes, so a rotation retires every marker. */
function markerKey(): Buffer {
  const secret = readConfiguredDocumentSyncCursorHmacKey();
  if (secret === null) return processMarkerKey;
  if (derivedMarkerKey?.secret !== secret) {
    derivedMarkerKey = {
      secret,
      key: Buffer.from(
        hkdfSync("sha256", secret, Buffer.alloc(0), MARKER_DOMAIN, 32),
      ),
    };
  }
  return derivedMarkerKey.key;
}

function markerMac(
  bundle: AccessManifestBundleWireResponse,
  verifierVersion: number,
): string | null {
  // A bundle that is not canonical JSON cannot be bound, so it is never marked
  // and always verifies in full.
  if (!isKeyingCanonicalJson(bundle)) return null;
  const message = serializeKeyingCanonicalJson([
    MARKER_DOMAIN,
    verifierVersion,
    bundle.manifestHash,
    sha256Hex(serializeKeyingCanonicalJson(bundle)),
  ]);
  return createHmac("sha256", markerKey()).update(message).digest("base64");
}

function sameMac(stored: string, expected: string): boolean {
  const storedBytes = Buffer.from(stored, "base64");
  const expectedBytes = Buffer.from(expected, "base64");
  return (
    storedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(storedBytes, expectedBytes)
  );
}

interface AccessManifestVerificationMarkerRow {
  readonly mac: string;
  readonly verifierVersion: number;
}

/** Where markers live; the database in production. */
export interface AccessManifestVerificationMarkerStore {
  load(
    manifestHash: string,
  ): Promise<AccessManifestVerificationMarkerRow | null>;
  /** Batch-load markers a request is about to read. */
  prefetch?(manifestHashes: readonly string[]): Promise<void>;
  /** Write recorded markers; a no-op for stores that only read. */
  flush?(): Promise<void>;
  save(
    manifestHash: string,
    marker: AccessManifestVerificationMarkerRow,
  ): Promise<void>;
}

/**
 * Markers in the database. Reads only consult them: a store that records is
 * created solely where a manifest is stored, inside its organization-locked
 * transaction, so marker rows are never written by concurrent readers and a
 * marker exists only if that transaction commits.
 */
export function databaseVerificationMarkerStore(
  executor: DatabaseSession,
  options: { readonly record?: boolean } = {},
): AccessManifestVerificationMarkerStore {
  // Request-scoped: the store is created with each verification context.
  const loaded = new Map<string, AccessManifestVerificationMarkerRow | null>();
  const pending = new Map<string, AccessManifestVerificationMarkerRow>();
  return {
    async load(manifestHash) {
      const cached = loaded.get(manifestHash);
      if (cached !== undefined) return cached;
      const [marker] = await executor
        .select({
          mac: accessManifestVerifications.mac,
          verifierVersion: accessManifestVerifications.verifierVersion,
        })
        .from(accessManifestVerifications)
        .where(eq(accessManifestVerifications.manifestHash, manifestHash))
        .limit(1);
      loaded.set(manifestHash, marker ?? null);
      return marker ?? null;
    },
    async prefetch(manifestHashes) {
      const pending = manifestHashes.filter((hash) => !loaded.has(hash));
      for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
        const batch = pending.slice(offset, offset + BATCH_SIZE);
        const rows = await executor
          .select()
          .from(accessManifestVerifications)
          .where(inArray(accessManifestVerifications.manifestHash, batch));
        for (const hash of batch) loaded.set(hash, null);
        for (const row of rows)
          loaded.set(row.manifestHash, {
            mac: row.mac,
            verifierVersion: row.verifierVersion,
          });
      }
    },
    async save(manifestHash, marker) {
      if (!options.record) return;
      pending.set(manifestHash, marker);
      loaded.set(manifestHash, marker);
    },
    async flush() {
      // One sorted pass, so overlapping flushes lock rows in the same order.
      const rows = [...pending]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([manifestHash, marker]) => ({ manifestHash, ...marker }));
      pending.clear();
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        await executor
          .insert(accessManifestVerifications)
          .values(rows.slice(offset, offset + BATCH_SIZE))
          .onConflictDoUpdate({
            target: accessManifestVerifications.manifestHash,
            set: {
              mac: sql`excluded.mac`,
              verifierVersion: sql`excluded.verifier_version`,
            },
          });
      }
    },
  };
}

/**
 * Whether stored-history verification already accepted this exact stored
 * bundle and its dependencies under the current rules and server secret.
 */
export async function hasAccessManifestVerificationMarker(
  store: AccessManifestVerificationMarkerStore,
  bundle: AccessManifestBundleWireResponse,
): Promise<boolean> {
  const marker = await store.load(bundle.manifestHash);
  if (
    marker === null ||
    marker.verifierVersion !== ACCESS_MANIFEST_VERIFIER_VERSION
  ) {
    return false;
  }
  const expected = markerMac(bundle, marker.verifierVersion);
  return expected !== null && sameMac(marker.mac, expected);
}

/**
 * Record that stored-history verification accepted this bundle after verifying
 * every dependency. A marker from older rules or another secret is replaced.
 */
export async function recordAccessManifestVerificationMarker(
  store: AccessManifestVerificationMarkerStore,
  bundle: AccessManifestBundleWireResponse,
): Promise<void> {
  const mac = markerMac(bundle, ACCESS_MANIFEST_VERIFIER_VERSION);
  if (mac === null) return;
  await store.save(bundle.manifestHash, {
    mac,
    verifierVersion: ACCESS_MANIFEST_VERIFIER_VERSION,
  });
}
