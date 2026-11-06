import type { KeyingCanonicalJson } from "./canonicalJsonTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";

export type AccessEventType =
  | "attachment.bind"
  | "attachment.detach"
  | "container.create"
  | "container.grant"
  | "container.move"
  | "container.recite"
  | "container.rekey"
  | "container.revoke"
  | "document.link"
  | "document.purge"
  | "document.unlink";

export type AccessObjectKind = "blob" | "container" | "document";

export interface UnsignedAccessEvent {
  version: 1;
  eventId: string;
  eventType: AccessEventType;
  objectKind: AccessObjectKind;
  objectId: string;
  organizationId: string;
  previousManifestHash: string | null;
  dependencyManifestHashes: string[];
  bodyHash: string;
  signerUserId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signedAt: string;
}

export interface AccessEvent extends UnsignedAccessEvent {
  signature: string;
}

const verifiedAccessEventBrand: unique symbol = Symbol("verifiedAccessEvent");

export interface VerifiedAccessEvent {
  readonly event: AccessEvent;
  readonly body: KeyingCanonicalJson;
  readonly eventHash: string;
  readonly [verifiedAccessEventBrand]: true;
}

export function makeVerifiedAccessEvent(
  value: Omit<VerifiedAccessEvent, typeof verifiedAccessEventBrand>,
): VerifiedAccessEvent {
  return {
    ...value,
    [verifiedAccessEventBrand]: verifiedBrandValue,
  };
}

export interface VerifyAccessEventInput {
  readonly event: AccessEvent;
  readonly body: KeyingCanonicalJson;
  readonly signerPublicKey: Uint8Array;
}
