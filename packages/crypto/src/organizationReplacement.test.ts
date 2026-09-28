import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import type { OrganizationReplacementAuthorization } from "@tearleads/validators/util";
import {
  organizationReplacementSigningBytes,
  verifyOrganizationReplacementAuthorization,
} from "./organizationReplacement";
import { generateSigningSeedAndKeyPair } from "./signing/generateKeyPair";
import { sign } from "./signing/sign";

const keys = generateSigningSeedAndKeyPair();
const payload = {
  replacesOrganizationId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  rootContainerId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  organizationStateHash: "a".repeat(64),
  adminGroupId: crypto.randomUUID(),
  adminGroupStateHash: "b".repeat(64),
  memberGroupId: crypto.randomUUID(),
  memberGroupStateHash: "c".repeat(64),
  rootManifestHash: "d".repeat(64),
  rootMetadataDocumentId: crypto.randomUUID(),
};
const authorization: OrganizationReplacementAuthorization = {
  ...payload,
  signature: bytesToBase64(
    sign(organizationReplacementSigningBytes(payload), keys.signingPrivateKey),
  ),
};

test("replacement authorization verifies under the locally held identity key", () => {
  expect(
    verifyOrganizationReplacementAuthorization(
      authorization,
      keys.signingPublicKey,
    ),
  ).toMatchObject(authorization);
  expect(() =>
    verifyOrganizationReplacementAuthorization(
      authorization,
      generateSigningSeedAndKeyPair().signingPublicKey,
    ),
  ).toThrow("signature is invalid");
});

for (const field of Object.keys(payload) as Array<keyof typeof payload>) {
  test(`replacement authorization binds ${field}`, () => {
    const changed = {
      ...authorization,
      [field]: field.endsWith("Hash") ? "e".repeat(64) : crypto.randomUUID(),
    };
    expect(() =>
      verifyOrganizationReplacementAuthorization(
        changed,
        keys.signingPublicKey,
      ),
    ).toThrow("signature is invalid");
  });
}

test("an ordinary signature cannot be replayed as replacement authorization", () => {
  const signature = bytesToBase64(
    sign(
      new TextEncoder().encode(JSON.stringify(payload)),
      keys.signingPrivateKey,
    ),
  );
  expect(() =>
    verifyOrganizationReplacementAuthorization(
      { ...authorization, signature },
      keys.signingPublicKey,
    ),
  ).toThrow("signature is invalid");
});

test.each([
  null,
  {},
  { ...authorization, signature: "!" },
  { ...authorization, extra: true },
])("missing or malformed replacement authorization is refused", (value) =>
  expect(() =>
    verifyOrganizationReplacementAuthorization(value, keys.signingPublicKey),
  ).toThrow(),
);
