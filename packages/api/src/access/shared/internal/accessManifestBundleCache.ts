import {
  type DatabaseSession,
  isDatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import type {
  AccessManifest,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
} from "@tearleads/crypto";

export interface StoredAccessManifestBundle {
  readonly event: VerifiedAccessEvent;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly state: KeyingCanonicalJson;
  /** Untrusted stored-history marker; honored only after its MAC verifies. */
  readonly verificationMac: string | null;
}

const bundlesByTransaction = new WeakMap<
  DatabaseSession,
  Map<string, StoredAccessManifestBundle>
>();

/**
 * Stored manifest bundles one transaction has read, by manifest hash. A
 * manifest and its event are content-addressed and never rewritten; only the
 * verification marker changes, and `noteAccessManifestVerificationMac` keeps
 * the memo in step with this transaction's own writes. Deleting manifests
 * forgets the whole memo. Only rows that converted are kept, so a malformed
 * row is read, and fails, again. The root executor keeps no memo.
 */
export function transactionAccessManifestBundles(
  executor: DatabaseSession,
): Map<string, StoredAccessManifestBundle> | undefined {
  if (!isDatabaseTransaction(executor)) return undefined;
  let bundles = bundlesByTransaction.get(executor);
  if (!bundles) {
    bundles = new Map();
    bundlesByTransaction.set(executor, bundles);
  }
  return bundles;
}

export function noteAccessManifestVerificationMac(
  executor: DatabaseSession,
  manifestHash: string,
  verificationMac: string,
): void {
  const bundles = bundlesByTransaction.get(executor);
  const bundle = bundles?.get(manifestHash);
  if (bundles && bundle) {
    bundles.set(manifestHash, { ...bundle, verificationMac });
  }
}

/** Call before a transaction deletes stored manifests or events. */
export function forgetTransactionAccessManifestBundles(
  executor: DatabaseSession,
): void {
  bundlesByTransaction.delete(executor);
}
