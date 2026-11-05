import {
  type AccessEvent,
  type AccessEventType,
  type AccessObjectKind,
  type ContainerCreateAccessEventBody,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  type DocumentLinkAccessEventBody,
  signAccessEvent,
  type UnsignedAccessEvent,
} from "@tearleads/crypto";
import { toWireJson } from "./wire";

export const REGISTER_SIGNED_AT = "2026-04-07T00:00:00.000Z";

interface SignedRegistrationEventInput {
  body: ContainerCreateAccessEventBody | DocumentLinkAccessEventBody;
  dependencyManifestHashes?: readonly string[];
  eventType: AccessEventType;
  objectId: string;
  objectKind: AccessObjectKind;
  organizationId: string;
  previousManifestHash: string | null;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}

export function createSignerDeviceId(signingFingerprint: string): string {
  return `signing-key:${signingFingerprint}`;
}

export async function signRegistrationEvent(
  input: SignedRegistrationEventInput,
): Promise<{ event: AccessEvent; eventHash: string }> {
  const unsigned: UnsignedAccessEvent = {
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: input.eventType,
    objectKind: input.objectKind,
    objectId: input.objectId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifestHash,
    dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
    bodyHash: await computeAccessEventBodyHash(
      toWireJson(input.body, `${input.eventType} event body`),
    ),
    signerUserId: input.signerUserId,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signedAt: REGISTER_SIGNED_AT,
  };
  const event = await signAccessEvent(unsigned, input.signerPrivateKey);

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}
