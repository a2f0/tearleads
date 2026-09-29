import { Buffer } from "node:buffer";
import {
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  ACCESS_MANIFEST_VERIFICATION_REVISION,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { selectAccessManifestVerificationMacs } from "../../../access/read/accessManifestStore";
import { upsertAccessManifestVerificationMacs } from "../../../access/write/accessManifestStore";
import { reportBackgroundFailure } from "../../../diagnostics/reportBackgroundFailure";
import { isKeyingCanonicalJson } from "../../../utils/canonicalJson";
import { readConfiguredDocumentSyncCursorHmacKey } from "../../../utils/serverSecrets";
import { sha256Hex } from "../../../utils/sha256";

/**
 * Revision of the API's own stored-history rules, bound into every marker with
 * the crypto verifiers' `ACCESS_MANIFEST_VERIFICATION_REVISION`. Bump it when
 * stored verification stops accepting something it accepts today: dependency
 * and cited-path checks (`storedManifestVerification.ts`,
 * `storedDocumentManifestVerification.ts`), lineage rules
 * (`storedManifestLineage.ts`, `storedDocumentPathLineage.ts`), graph traversal
 * (`utils/storedManifestGraph.ts`) or signer resolution. Bumping retires every
 * marker, so histories re-verify under the new rules.
 */
const STORED_HISTORY_VERIFICATION_REVISION = 1;

const MARKER_DOMAIN = "tearleads.access-manifest-verification.v1";

// Without a configured secret (development, previews) markers use a key that
// lives only in this process, so nobody who can edit the database can forge
// one. They stop matching after a restart, and processes overwrite each
// other's; production requires the secret.
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
  signerPublicKey: Uint8Array,
): string | null {
  // A bundle that is not canonical JSON cannot be bound, so it is never marked
  // and always verifies in full.
  if (!isKeyingCanonicalJson(bundle)) return null;
  const message = serializeKeyingCanonicalJson([
    MARKER_DOMAIN,
    ACCESS_MANIFEST_VERIFICATION_REVISION,
    STORED_HISTORY_VERIFICATION_REVISION,
    bundle.manifestHash,
    sha256Hex(serializeKeyingCanonicalJson(bundle)),
    Buffer.from(signerPublicKey).toString("base64"),
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

/** Where markers live; the database in production. */
export interface AccessManifestVerificationMarkerStore {
  /** The stored MAC for a manifest, or null when it is unmarked. */
  load(manifestHash: string): Promise<string | null>;
  /** Batch-load markers a request is about to read. */
  prefetch?(manifestHashes: readonly string[]): Promise<void>;
  /** Remember a marker; nothing is written until `flush`. */
  save(manifestHash: string, mac: string): Promise<void>;
  /** Write the markers saved since the last flush. */
  flush(options?: MarkerFlushOptions): Promise<void>;
}

interface MarkerFlushOptions {
  /** Defaults to the executor the store reads with. */
  readonly executor?: DatabaseSession;
  /** Defaults to the largest batch the dialects accept. */
  readonly rowsPerStatement?: number;
}

/**
 * Markers in the database, cached for one request. Saved markers are buffered
 * and written only by an explicit `flush`: a mutation flushes the markers for
 * what it stored inside its transaction, and a projection read flushes after
 * its transaction commits (`flushVerificationMarkersAfterRead`).
 */
export function databaseVerificationMarkerStore(
  executor: DatabaseSession,
): AccessManifestVerificationMarkerStore {
  const loaded = new Map<string, string | null>();
  const saved = new Map<string, string>();
  return {
    async load(manifestHash) {
      const cached = loaded.get(manifestHash);
      if (cached !== undefined) return cached;
      const mac =
        (
          await selectAccessManifestVerificationMacs([manifestHash], executor)
        ).get(manifestHash) ?? null;
      loaded.set(manifestHash, mac);
      return mac;
    },
    async prefetch(manifestHashes) {
      const missing = manifestHashes.filter((hash) => !loaded.has(hash));
      const macs = await selectAccessManifestVerificationMacs(
        missing,
        executor,
      );
      for (const hash of missing) loaded.set(hash, macs.get(hash) ?? null);
    },
    async save(manifestHash, mac) {
      saved.set(manifestHash, mac);
      loaded.set(manifestHash, mac);
    },
    async flush(options = {}) {
      const macs = new Map(saved);
      saved.clear();
      await upsertAccessManifestVerificationMacs(
        macs,
        options.executor ?? executor,
        options.rowsPerStatement,
      );
    },
  };
}

/**
 * Write back the markers a read's full verification earned, after its
 * transaction committed, so a history re-verified after a rotated secret or
 * new rules is verified once rather than on every read. Each marker is its own
 * autocommit upsert, so the reader never holds one marker row while waiting
 * for another: a writer that marks more than once in its transaction cannot
 * deadlock with it. Losing one only costs a later re-verification, so a
 * failure is reported, not returned.
 */
export async function flushVerificationMarkersAfterRead(
  store: AccessManifestVerificationMarkerStore,
  executor: DatabaseSession,
): Promise<void> {
  try {
    await store.flush({ executor, rowsPerStatement: 1 });
  } catch (error) {
    console.error(
      "Failed to write access manifest verification markers:",
      error,
    );
    reportBackgroundFailure(error);
  }
}

/**
 * Whether stored-history verification already accepted this exact stored
 * bundle, after its dependencies, with this signer key, under the current
 * rules and server secret.
 */
export async function hasAccessManifestVerificationMarker(
  store: AccessManifestVerificationMarkerStore,
  bundle: AccessManifestBundleWireResponse,
  signerPublicKey: Uint8Array,
): Promise<boolean> {
  const stored = await store.load(bundle.manifestHash);
  if (stored === null) return false;
  const expected = markerMac(bundle, signerPublicKey);
  return expected !== null && sameMac(stored, expected);
}

/**
 * Record that stored-history verification accepted this bundle, signed by this
 * key, after accepting every dependency. A marker from older rules, another
 * secret or another signer key is replaced.
 */
export async function recordAccessManifestVerificationMarker(
  store: AccessManifestVerificationMarkerStore,
  bundle: AccessManifestBundleWireResponse,
  signerPublicKey: Uint8Array,
): Promise<void> {
  const mac = markerMac(bundle, signerPublicKey);
  if (mac !== null) await store.save(bundle.manifestHash, mac);
}
