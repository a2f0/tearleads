import { expect, test } from "bun:test";
import {
  decodeIdentityLink,
  encodeIdentityLinkToken,
  IDENTITY_LINK_PATH,
} from "./identityLink";

const expectation = {
  fingerprint: "ab".repeat(32),
  identityTrustDomain: "https://api.example.test/v1",
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

function linkFor(payload: unknown): string {
  const token = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `https://app.example.test${IDENTITY_LINK_PATH}${token}`;
}

test("an identity link decodes to the expectation its token encodes", () => {
  const link = `https://app.example.test${IDENTITY_LINK_PATH}${encodeIdentityLinkToken(expectation)}`;
  expect(decodeIdentityLink(link)).toEqual(expectation);
  expect(decodeIdentityLink(`  ${link}\n`)).toEqual(expectation);
  expect(
    linkFor([
      1,
      expectation.identityTrustDomain,
      expectation.userId,
      expectation.fingerprint,
    ]),
  ).toBe(link);
});

test("anything but one complete canonical identity link decodes to null", () => {
  const { fingerprint, identityTrustDomain, userId } = expectation;
  const link = linkFor([1, identityTrustDomain, userId, fingerprint]);
  for (const malformed of [
    "",
    fingerprint,
    "x".repeat(4097),
    `${link}?extra=1`,
    `${link}#extra`,
    `${link}/extra`,
    `${link}=`,
    link.replace("https:", "javascript:"),
    link.replace("https://", "https://user:pass@"),
    link.replace(IDENTITY_LINK_PATH, "/app/contacts/"),
    linkFor([2, identityTrustDomain, userId, fingerprint]),
    linkFor([1, identityTrustDomain, userId, fingerprint, "extra"]),
    linkFor([1, identityTrustDomain, "not-a-user", fingerprint]),
    linkFor([1, identityTrustDomain, userId.toUpperCase(), fingerprint]),
    linkFor([1, `${identityTrustDomain}/`, userId, fingerprint]),
    linkFor([1, "/v1", userId, fingerprint]),
    linkFor([1, identityTrustDomain, userId, "short"]),
    linkFor([1, identityTrustDomain, userId, fingerprint.toUpperCase()]),
  ]) {
    expect(decodeIdentityLink(malformed)).toBeNull();
  }
});
