import { toFingerprint } from "../fingerprint";
import type { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import {
  computeAccessEventBodyHash,
  computeAccessEventHash,
} from "./accessEvent";
import { normalizeCanonicalJsonValue } from "./canonical";
import type { signAccessEvent } from "./index";
import {
  type ContainerAccessEventBody,
  type DocumentAccessEventBody,
  type KeyingCanonicalJson,
  makeVerifiedAccessEvent,
  type VerifiedAccessEvent,
} from "./types";

// What verifySignedAccessEvent returns for an event the fixture just signed. It
// hashed this body and signed with this signer, so no check can fail. The two
// fields an override could change are re-derived, so an override fails here
// rather than reaching consumers branded as verified.
export async function trustFixtureSignature(
  body: ContainerAccessEventBody | DocumentAccessEventBody,
  event: Awaited<ReturnType<typeof signAccessEvent>>,
  signer: ReturnType<typeof generateSigningSeedAndKeyPair>,
): Promise<VerifiedAccessEvent> {
  if (
    event.bodyHash !==
      (await computeAccessEventBodyHash(
        body as unknown as KeyingCanonicalJson,
      )) ||
    event.signerKeyFingerprint !==
      (await toFingerprint(signer.signingPublicKey))
  ) {
    throw new Error(
      "An access event fixture with overridden fields must use verifySignedAccessEvent",
    );
  }
  return makeVerifiedAccessEvent({
    body: normalizeCanonicalJsonValue(
      body as unknown as KeyingCanonicalJson,
      "access event body",
    ),
    event,
    eventHash: await computeAccessEventHash(event),
  });
}
