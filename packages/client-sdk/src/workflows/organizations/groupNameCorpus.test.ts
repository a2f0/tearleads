import { expect, test } from "bun:test";
import {
  encryptGroupMetadata,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  SIGNED_GROUP_INVALID_PAYLOADS,
  SIGNED_GROUP_NAME_CASES,
} from "@tearleads/test-utils";
import {
  buildInitialGroupPolicyRequest,
  groupPolicyNameMismatch,
  testGroupMetadataKey,
} from "../../../test/helpers/groupMetadata";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";

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

test.each([...SIGNED_GROUP_INVALID_PAYLOADS])(
  "SDK rejects malformed signed-name encoding: %s",
  async (ciphertext) => {
    const base = await baseBundle;
    const bundle = {
      ...base,
      currentPayload: { ...base.currentPayload, ciphertext },
    };
    await expect(
      groupPolicyNameMismatch(bundle, "Operators"),
    ).rejects.toThrow();
  },
);

test.each([...SIGNED_GROUP_NAME_CASES])(
  "SDK signed-name corpus: %j",
  async ({ name, displayName, allowed }) => {
    const base = await baseBundle;
    // This exercises the pure name predicate, not signature verification; the
    // membership integration tests separately prove verification runs first.
    const bundle = {
      ...base,
      currentPayload: {
        ...base.currentPayload,
        ciphertext: await encryptGroupMetadata({
          key: testGroupMetadataKey(),
          groupId: base.currentState.principalId,
          name: name ?? "",
        }),
      },
    };
    const check = groupPolicyNameMismatch(bundle, displayName);
    if (allowed) await expect(check).resolves.toBeNull();
    else await expect(check).rejects.toThrow("Group metadata name is invalid");
  },
);
