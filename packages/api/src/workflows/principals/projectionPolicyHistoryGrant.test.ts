import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { createHmac, hkdfSync } from "node:crypto";
import {
  issueProjectionPolicyHistoryGrant,
  type ProjectionPolicyHistoryGrant,
  readProjectionPolicyHistoryGrant,
} from "./projectionPolicyHistoryGrant";

function grant(): ProjectionPolicyHistoryGrant {
  return {
    organizationId: crypto.randomUUID(),
    objectKind: "container",
    objectId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    head: {
      principalType: "group",
      principalId: crypto.randomUUID(),
      version: 65,
      keyEpoch: 1,
      stateHash: "a".repeat(64),
      keyFingerprint: "b".repeat(64),
    },
  };
}

test("projection history grants bind the user, authorized object, and exact policy head", () => {
  const input = grant();
  const token = issueProjectionPolicyHistoryGrant(input);
  expect(readProjectionPolicyHistoryGrant(token, input.userId)).toEqual(input);
  expect(() =>
    readProjectionPolicyHistoryGrant(token, crypto.randomUUID()),
  ).toThrow("grant is invalid");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Missing issued token fields");
  for (const substitution of [
    { objectId: crypto.randomUUID() },
    { objectKind: "document" },
    { organizationId: crypto.randomUUID() },
    { head: { ...input.head, version: 66 } },
    { head: { ...input.head, stateHash: "c".repeat(64) } },
  ]) {
    const changed = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        ...substitution,
      }),
    ).toString("base64url");
    expect(() =>
      readProjectionPolicyHistoryGrant(`${changed}.${signature}`, input.userId),
    ).toThrow("grant is invalid");
  }
  for (const malformed of ["", "a.b", `${token}.extra`, "a".repeat(4097)])
    expect(() =>
      readProjectionPolicyHistoryGrant(malformed, input.userId),
    ).toThrow("grant is invalid");
});

test("the public development cursor fallback cannot forge a projection read grant", () => {
  const input = grant();
  const [payload] = issueProjectionPolicyHistoryGrant(input).split(".");
  if (!payload) throw new Error("Missing payload");
  const domain = "tearleads.projection-policy-history.read-grant.v1";
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      "tearleads-development-document-sync-cursor-key",
      Buffer.alloc(0),
      domain,
      32,
    ),
  );
  const signature = createHmac("sha256", key)
    .update(domain)
    .update("\0")
    .update(payload)
    .digest("base64url");
  expect(() =>
    readProjectionPolicyHistoryGrant(`${payload}.${signature}`, input.userId),
  ).toThrow("grant is invalid");
});
