import { verifySignedAccessEvent } from "@symcrypt/crypto";
import type { AccessManifestBundleWireResponse } from "@symcrypt/validators/response";
import {
  canonicalKeyingJsonString,
  readCanonicalJson,
  readCanonicalRecord,
} from "../keyingCanonicalJson";
import {
  readAccessEvent,
  readRecordString,
  readRequiredRecordValue,
} from "./readers";
import type { ProjectionUserKeyResolver } from "./types";

export function assertCanonicalEqual(input: {
  readonly actual: unknown;
  readonly expected: unknown;
  readonly label: string;
}): void {
  if (
    canonicalKeyingJsonString(input.actual, `${input.label} actual`) !==
    canonicalKeyingJsonString(input.expected, `${input.label} expected`)
  ) {
    throw new Error(`${input.label} mismatch`);
  }
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
    canonicalKeyingJsonString(existing, `${label} existing`) !==
    canonicalKeyingJsonString(bundle, `${label} duplicate`)
  ) {
    throw new Error(
      `Writer projection has equivocal manifest bundle ${bundle.manifestHash}`,
    );
  }
}

export async function verifyAccessEventBundle(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly label: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}) {
  const eventBundle = readCanonicalRecord(
    input.bundle.event,
    `${input.label} event bundle`,
  );
  const eventHash = readRecordString(
    eventBundle,
    "eventHash",
    `${input.label} event bundle`,
  );
  const event = readAccessEvent(
    readRequiredRecordValue(
      eventBundle,
      "event",
      `${input.label} event bundle`,
    ),
    `${input.label} signed event`,
  );
  const body = readCanonicalJson(
    readRequiredRecordValue(eventBundle, "body", `${input.label} event bundle`),
    `${input.label} event body`,
  );
  const userKey = await input.resolveUserKey(event.signerUserId);
  if (!userKey) {
    throw new Error(
      `${input.label} signer public key could not be resolved for ${event.signerUserId}`,
    );
  }

  const verified = await verifySignedAccessEvent({
    body,
    event,
    signerPublicKey: userKey.signingPublicKey,
  });
  if (!verified.ok) {
    throw new Error(`${input.label} signature verification failed`);
  }
  if (verified.value.eventHash !== eventHash) {
    throw new Error(`${input.label} event hash mismatch`);
  }

  return verified.value;
}
