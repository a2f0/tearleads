import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createAuthor } from "../../../test/helpers/containerFixtures";
import {
  buildInitialGroupPolicyRequest,
  readGroupPolicyPayloadName,
} from "../../../test/helpers/groupMetadata";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { canonicalGroupNameKey } from "./principalPolicyRequest";

test("look-alike group names share one canonical key", () => {
  const key = canonicalGroupNameKey("Operators");
  // Zero-width space, fullwidth O, surrounding whitespace and case, and a
  // trailing zero-width joiner all collapse onto the plain name.
  const zeroWidthSpace = String.fromCodePoint(0x200b);
  const zeroWidthJoiner = String.fromCodePoint(0x200d);
  const fullwidthO = String.fromCodePoint(0xff2f);
  // Default-ignorable but not Cf: the Hangul filler and a variation selector
  // survive NFKC and render as nothing.
  const hangulFiller = String.fromCodePoint(0x3164);
  const variationSelector = String.fromCodePoint(0xfe0f);
  expect(canonicalGroupNameKey(`Oper${zeroWidthSpace}ators`)).toBe(key);
  expect(canonicalGroupNameKey(`${fullwidthO}perators`)).toBe(key);
  expect(canonicalGroupNameKey("  OPERATORS\t")).toBe(key);
  expect(canonicalGroupNameKey(`Operators${zeroWidthJoiner}`)).toBe(key);
  expect(canonicalGroupNameKey(`Oper${hangulFiller}ators`)).toBe(key);
  expect(canonicalGroupNameKey(`Operators${variationSelector}`)).toBe(key);
  expect(canonicalGroupNameKey("Operator")).not.toBe(key);
});

// The encrypted group name is committed in the signed payload, so a share
// checks the chosen label against authenticated client-decrypted metadata.

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
  expect(request).not.toHaveProperty("name");
  expect(await readGroupPolicyPayloadName(bundle)).toBe("Operators");
  expect(bundle.currentState.payloadCiphertextHash).toBe(
    request.initialGroupPolicy.encryptedPayload.ciphertextHash,
  );
});

// Payload shape errors remain distinct from signature-verification incidents.
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
  await expect(readGroupPolicyPayloadName(withoutName)).rejects.toThrow();
  await expect(
    readGroupPolicyPayloadName(withoutName),
  ).rejects.not.toBeInstanceOf(KeyingVerificationError);
  await expect(
    readGroupPolicyPayloadName({
      ...bundle,
      currentPayload: { ...bundle.currentPayload, ciphertext: "not-json" },
    }),
  ).rejects.toThrow();
});

test("a group name with control or format characters is refused when signed", async () => {
  await expect(
    createGroupBundle(`Writers${String.fromCodePoint(0x202e)}`),
  ).rejects.toThrow("control, format, or surrogate");
  await expect(createGroupBundle("Wri\nters")).rejects.toThrow(
    "control, format, or surrogate",
  );
  // A lone surrogate would be re-encoded as U+FFFD in the signed payload.
  await expect(createGroupBundle("Writers\ud83d")).rejects.toThrow(
    "control, format, or surrogate",
  );
  // Default-ignorable code points outside Cf render as nothing too.
  await expect(
    createGroupBundle(`Writ${String.fromCodePoint(0x3164)}ers`),
  ).rejects.toThrow("control, format, or surrogate");
  await expect(createGroupBundle("   ")).rejects.toThrow("non-empty");
});
