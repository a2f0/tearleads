import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createAuthor } from "../../../test/helpers/containerFixtures";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import {
  buildInitialGroupPolicyRequest,
  canonicalGroupNameKey,
  readGroupPolicyPayloadName,
} from "./principalPolicyRequest";

test("look-alike group names share one canonical key", () => {
  const key = canonicalGroupNameKey("Operators");
  // Zero-width space, fullwidth O, surrounding whitespace and case, and a
  // trailing zero-width joiner all collapse onto the plain name.
  const zeroWidthSpace = String.fromCodePoint(0x200b);
  const zeroWidthJoiner = String.fromCodePoint(0x200d);
  const fullwidthO = String.fromCodePoint(0xff2f);
  expect(canonicalGroupNameKey(`Oper${zeroWidthSpace}ators`)).toBe(key);
  expect(canonicalGroupNameKey(`${fullwidthO}perators`)).toBe(key);
  expect(canonicalGroupNameKey("  OPERATORS\t")).toBe(key);
  expect(canonicalGroupNameKey(`Operators${zeroWidthJoiner}`)).toBe(key);
  expect(canonicalGroupNameKey("Operator")).not.toBe(key);
});

// The group display name is committed in the signed payload, not only in the
// server's mutable `groups.name` column, so a share can check the name the
// user chose against signed state.

async function createGroupBundle(name: string) {
  const { author, signingPublicKey } = await createAuthor({
    organizationId: "organization-1",
    userId: "signer-user-1",
  });
  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
    groupId: "group-1",
    name,
    signerUserId: author.signerUserId,
    signingFingerprint: author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: author.signerPrivateKey,
      signingPublicKey,
    },
  });
  return { bundle: await policyBundleFromInitialRequest(request), request };
}

test("the group name is committed in the signed payload", async () => {
  const { bundle, request } = await createGroupBundle("  Operators ");
  expect(request.name).toBe("Operators");
  expect(readGroupPolicyPayloadName(bundle)).toBe("Operators");
  expect(bundle.currentState.payloadCiphertextHash).toBe(
    request.initialGroupPolicy.encryptedPayload.ciphertextHash,
  );
});

test("a payload without a committed name fails closed", async () => {
  const { bundle } = await createGroupBundle("Operators");
  const withoutName = {
    ...bundle,
    currentPayload: {
      ...bundle.currentPayload,
      ciphertext: bytesToBase64(
        new TextEncoder().encode(JSON.stringify({ members: [] })),
      ),
    },
  };
  expect(() => readGroupPolicyPayloadName(withoutName)).toThrow(
    "does not commit a display name",
  );
  expect(() =>
    readGroupPolicyPayloadName({
      ...bundle,
      currentPayload: { ...bundle.currentPayload, ciphertext: "not-json" },
    }),
  ).toThrow("not canonical JSON");
});

test("a group name with control or format characters is refused when signed", async () => {
  await expect(
    createGroupBundle(`Writers${String.fromCodePoint(0x202e)}`),
  ).rejects.toThrow("control or format characters");
  await expect(createGroupBundle("Wri\nters")).rejects.toThrow(
    "control or format characters",
  );
  await expect(createGroupBundle("   ")).rejects.toThrow("non-empty");
});
