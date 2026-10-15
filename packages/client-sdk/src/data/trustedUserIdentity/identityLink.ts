import { KeyingVerificationError, toFingerprint } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { resolveIdentityTrustDomain } from "./trustDomain";
import {
  TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE,
  TRUSTED_USER_IDENTITY_SIGNING_SUITE,
  type ValidatedUserIdentityCandidate,
} from "./types";
import { assertTrustedUserIdentityUserId } from "./validation";

const LINK_PATH = "/app/contacts/import/";

interface IdentityLinkExpectation {
  readonly identityTrustDomain: string;
  readonly userId: string;
  readonly fingerprint: string;
}

function invalidLink(): never {
  throw new Error("Enter a complete Tearleads identity link.");
}

function httpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidLink();
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return invalidLink();
  return url;
}

function encodeExpectation(expectation: IdentityLinkExpectation): string {
  return bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify([
        1,
        expectation.identityTrustDomain,
        expectation.userId,
        expectation.fingerprint,
      ]),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function parseIdentityLink(value: string): IdentityLinkExpectation {
  if (value.length > 4096) return invalidLink();
  const url = httpUrl(value.trim());
  if (url.search || url.hash || !url.pathname.startsWith(LINK_PATH)) {
    return invalidLink();
  }
  const token = url.pathname.slice(LINK_PATH.length);
  if (!/^[A-Za-z0-9_-]+$/u.test(token)) return invalidLink();
  let payload: unknown;
  try {
    const base64 = token.replaceAll("-", "+").replaceAll("_", "/");
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        base64ToBytes(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
      ),
    );
  } catch {
    return invalidLink();
  }
  if (
    !Array.isArray(payload) ||
    payload.length !== 4 ||
    payload[0] !== 1 ||
    typeof payload[1] !== "string" ||
    typeof payload[2] !== "string" ||
    typeof payload[3] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(payload[3])
  )
    return invalidLink();
  const expectation = {
    identityTrustDomain: payload[1],
    userId: payload[2],
    fingerprint: payload[3],
  };
  assertTrustedUserIdentityUserId(expectation.userId);
  if (
    resolveIdentityTrustDomain({
      apiBaseUrl: expectation.identityTrustDomain,
    }) !== expectation.identityTrustDomain ||
    encodeExpectation(expectation) !== token
  )
    return invalidLink();
  return expectation;
}

/** Versioned, domain-separated tuple: exact keys, algorithms and account scope. */
export function identityLinkFingerprint(
  identity: ValidatedUserIdentityCandidate,
): Promise<string> {
  return toFingerprint(
    new TextEncoder().encode(
      JSON.stringify([
        "tearleads.identity-link.v1",
        identity.identityTrustDomain,
        identity.userId,
        TRUSTED_USER_IDENTITY_SIGNING_SUITE,
        bytesToBase64(identity.signingPublicKey),
        TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE,
        bytesToBase64(identity.encapsulationPublicKey),
      ]),
    ),
  );
}

export async function createIdentityLink(
  identity: ValidatedUserIdentityCandidate,
  appUrl: string,
): Promise<string> {
  const url = httpUrl(appUrl);
  url.pathname =
    LINK_PATH +
    encodeExpectation({
      identityTrustDomain: identity.identityTrustDomain,
      userId: identity.userId,
      fingerprint: await identityLinkFingerprint(identity),
    });
  url.search = "";
  url.hash = "";
  return url.href;
}

export async function assertIdentityLinkMatches(
  expectation: IdentityLinkExpectation,
  identity: ValidatedUserIdentityCandidate,
): Promise<void> {
  if ((await identityLinkFingerprint(identity)) !== expectation.fingerprint) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      "The identity keys do not match this link. Ask the person to confirm their identity link through your trusted channel.",
    );
  }
}
