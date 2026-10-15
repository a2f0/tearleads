import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  createIdentityLink,
  identityLinkFingerprint,
  parseIdentityLink,
} from "./identityLink";
import {
  identityLinkFixture,
  LINK_TRUST_DOMAIN,
  LINK_USER_ID,
} from "./identityLink.testFixtures";

test("identity link commits the exact two-key bundle with an independent hash oracle", async () => {
  const { identity, remote, link } = await identityLinkFixture();
  const bytes = JSON.stringify([
    "tearleads.identity-link.v1",
    LINK_TRUST_DOMAIN,
    LINK_USER_ID,
    "ML-DSA-87",
    remote.signingPublicKey,
    "ML-KEM-1024",
    remote.encapsulationPublicKey,
  ]);
  const fingerprint = createHash("sha256").update(bytes, "utf8").digest("hex");
  expect(await identityLinkFingerprint(identity)).toBe(fingerprint);
  expect(parseIdentityLink(link)).toEqual({
    fingerprint,
    identityTrustDomain: LINK_TRUST_DOMAIN,
    userId: LINK_USER_ID,
  });
  expect(
    await createIdentityLink(
      identity,
      "https://app.example.test/ignored?query#fragment",
    ),
  ).toBe(link);
  expect(
    await createIdentityLink(identity, "https://other-app.example.test"),
  ).not.toBe(link);
  expect(
    parseIdentityLink(
      await createIdentityLink(identity, "https://other-app.example.test"),
    ),
  ).toEqual(parseIdentityLink(link));
});

test("identity link rejects malformed, ambiguous, unsupported and non-HTTP links", async () => {
  const { link } = await identityLinkFixture();
  const url = new URL(link);
  const token = url.pathname.split("/").at(-1) ?? "";
  const payload: unknown[] = JSON.parse(
    Buffer.from(token, "base64url").toString(),
  );
  const withPayload = (value: unknown) =>
    `${url.origin}/app/contacts/import/${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
  for (const malformed of [
    LINK_USER_ID,
    "",
    "x".repeat(4097),
    `${link}?extra=1`,
    `${link}#extra`,
    `${link}/extra`,
    `${link}=`,
    link.replace("https:", "javascript:"),
    link.replace("https://", "https://user:pass@"),
    withPayload([2, ...payload.slice(1)]),
    withPayload([...payload, "extra"]),
    withPayload([1, LINK_TRUST_DOMAIN, "not-a-user", payload[3]]),
    withPayload([1, `${LINK_TRUST_DOMAIN}/`, LINK_USER_ID, payload[3]]),
    withPayload([1, LINK_TRUST_DOMAIN, LINK_USER_ID, "short"]),
  ])
    expect(() => parseIdentityLink(malformed)).toThrow();
});
