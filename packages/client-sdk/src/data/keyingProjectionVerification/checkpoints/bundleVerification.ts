import {
  KeyingVerificationError,
  readKeyingCanonicalJson,
  type VerifiedAccessEvent,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import type { AccessEventBundleWireResponse } from "@tearleads/validators/util";
import {
  canonicalKeyingJsonString,
  readCanonicalRecord,
} from "../../keying/canonicalJson";
import { ProjectionDependencyUnavailableError } from "../../shared/dependencyUnavailable";
import { readKeyingVerificationShape } from "../error";
import {
  readAccessEvent,
  readRecordString,
  readRequiredRecordValue,
} from "../readers";
import type { ProjectionUserKeyResolver } from "../types";

function canonicalBundleJson(value: unknown, label: string): string {
  return readKeyingVerificationShape(() =>
    canonicalKeyingJsonString(value, label),
  );
}

export function assertCanonicalEqual(input: {
  readonly actual: unknown;
  readonly expected: unknown;
  readonly label: string;
}): void {
  if (
    canonicalBundleJson(input.actual, `${input.label} actual`) !==
    canonicalBundleJson(input.expected, `${input.label} expected`)
  ) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      `${input.label} mismatch`,
    );
  }
}

/**
 * A copy of a manifest already verified under its hash: its event, body,
 * manifest and state must be exactly the verified ones, or a warm cache would
 * vouch for bytes no verification saw.
 */
export function assertVerifiedCopy(
  input: {
    readonly bundle: AccessManifestBundleWireResponse;
    readonly label: string;
  },
  verified: {
    readonly event: VerifiedAccessEvent;
    readonly manifest: unknown;
    readonly state: unknown;
  },
): void {
  const { bundle } = input;
  assertCanonicalEqual({
    actual: {
      body: bundle.event.body,
      event: bundle.event.event,
      eventHash: bundle.event.eventHash,
      manifest: bundle.manifest,
      state: bundle.state,
    },
    expected: {
      body: verified.event.body,
      event: verified.event.event,
      eventHash: verified.event.eventHash,
      manifest: verified.manifest,
      state: verified.state,
    },
    label: `${input.label} cached copy`,
  });
}

export function addBundleByHash(
  bundlesByHash: Map<string, AccessManifestBundleWireResponse>,
  bundle: AccessManifestBundleWireResponse,
  label: string,
): void {
  const existing = bundlesByHash.get(bundle.manifestHash);
  if (!existing) {
    bundlesByHash.set(bundle.manifestHash, bundle);
    return;
  }

  if (
    canonicalBundleJson(existing, `${label} existing`) !==
    canonicalBundleJson(bundle, `${label} duplicate`)
  ) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      `Writer projection has equivocal manifest bundle ${bundle.manifestHash}`,
    );
  }
}

function readStandaloneEventBundle(
  bundle: AccessEventBundleWireResponse,
  label: string,
) {
  return readKeyingVerificationShape(() => {
    const eventBundle = readCanonicalRecord(bundle, `${label} event bundle`);
    const eventHash = readRecordString(
      eventBundle,
      "eventHash",
      `${label} event bundle`,
    );
    const event = readAccessEvent(
      readRequiredRecordValue(eventBundle, "event", `${label} event bundle`),
      `${label} signed event`,
    );
    const body = readKeyingCanonicalJson(
      readRequiredRecordValue(eventBundle, "body", `${label} event bundle`),
      `${label} event body`,
    );
    return { eventHash, event, body };
  });
}

export async function verifyStandaloneAccessEventBundle(input: {
  readonly bundle: AccessEventBundleWireResponse;
  readonly label: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}) {
  const { eventHash, event, body } = readStandaloneEventBundle(
    input.bundle,
    input.label,
  );
  const userKey = await input.resolveUserKey(event.signerUserId);
  if (!userKey) {
    throw new ProjectionDependencyUnavailableError(
      `${input.label} signer public key could not be resolved for ${event.signerUserId}`,
    );
  }

  const verified = await verifySignedAccessEvent({
    body,
    event,
    signerPublicKey: userKey.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  if (verified.value.eventHash !== eventHash) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      `${input.label} event hash mismatch`,
    );
  }

  return verified.value;
}

export function verifyAccessEventBundle(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly label: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}) {
  return verifyStandaloneAccessEventBundle({
    bundle: input.bundle.event,
    label: input.label,
    resolveUserKey: input.resolveUserKey,
  });
}
