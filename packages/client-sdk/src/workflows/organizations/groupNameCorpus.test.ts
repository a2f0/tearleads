import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  SIGNED_GROUP_INVALID_PAYLOADS,
  SIGNED_GROUP_NAME_CASES,
} from "@tearleads/test-utils";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { buildInitialGroupPolicyRequest } from "./principalPolicy";
import { groupPolicyNameMismatch } from "./principalPolicyRequest";

async function createBaseBundle() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  return policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      groupId: "name-corpus-group",
      name: "Operators",
      signerUserId: "owner",
      signingFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
      signingKeyPair,
    }),
  );
}

const baseBundle = createBaseBundle();

test.each([
  ...SIGNED_GROUP_INVALID_PAYLOADS,
])("SDK rejects malformed signed-name encoding: %s", async (ciphertext) => {
  const base = await baseBundle;
  const bundle = {
    ...base,
    currentPayload: { ...base.currentPayload, ciphertext },
  };
  expect(() => groupPolicyNameMismatch(bundle, "Operators")).toThrow(
    "not canonical JSON",
  );
});

test.each([...SIGNED_GROUP_NAME_CASES])("SDK signed-name corpus: %j", async ({
  name,
  displayName,
  allowed,
}) => {
  const base = await baseBundle;
  // This exercises the pure name predicate, not signature verification; the
  // membership integration tests separately prove verification runs first.
  const bundle = {
    ...base,
    currentPayload: {
      ...base.currentPayload,
      ciphertext: Buffer.from(
        JSON.stringify(name === null ? {} : { name }),
      ).toString("base64"),
    },
  };
  const check = () => groupPolicyNameMismatch(bundle, displayName);
  if (name === null || name.trim().length === 0) {
    expect(check).toThrow("must be reprovisioned");
  } else {
    expect(check()).toBe(allowed ? null : "forbidden_characters");
  }
});
