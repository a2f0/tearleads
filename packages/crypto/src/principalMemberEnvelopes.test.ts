import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
} from "./encapsulation/generateKeyPair";
import {
  computePrincipalMemberEnvelopesRoot,
  normalizePrincipalStateMemberEnvelopes,
} from "./principalMemberEnvelopes";
import type { PrincipalStateMemberEnvelope } from "./principalStateTypes";
import { AES_GCM_TAG_BYTES } from "./symmetric";

function memberEnvelope(input: {
  memberPrincipalId: string;
  memberPrincipalType: "group" | "user";
  seed: number;
}): PrincipalStateMemberEnvelope {
  return {
    memberPrincipalType: input.memberPrincipalType,
    memberPrincipalId: input.memberPrincipalId,
    memberKeyFingerprint: input.seed.toString(16).padStart(64, "0"),
    kemCipherText: bytesToBase64(
      new Uint8Array(ML_KEM1024_CIPHERTEXT_BYTES).fill(input.seed),
    ),
    wrappedKey: bytesToBase64(
      new Uint8Array(ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES).fill(
        input.seed,
      ),
    ),
  };
}

test("principal member envelope roots are canonical across input ordering", async () => {
  const group = memberEnvelope({
    memberPrincipalType: "group",
    memberPrincipalId: "nested-group",
    seed: 1,
  });
  const user = memberEnvelope({
    memberPrincipalType: "user",
    memberPrincipalId: "user-alice",
    seed: 2,
  });

  expect(normalizePrincipalStateMemberEnvelopes([user, group])).toEqual([
    group,
    user,
  ]);
  expect(await computePrincipalMemberEnvelopesRoot([user, group])).toBe(
    await computePrincipalMemberEnvelopesRoot([group, user]),
  );
});

test("principal member envelopes use deterministic code-unit ordering", () => {
  const uppercase = memberEnvelope({
    memberPrincipalType: "user",
    memberPrincipalId: "Z-user",
    seed: 1,
  });
  const lowercase = memberEnvelope({
    memberPrincipalType: "user",
    memberPrincipalId: "a-user",
    seed: 2,
  });

  expect(
    normalizePrincipalStateMemberEnvelopes([lowercase, uppercase]),
  ).toEqual([uppercase, lowercase]);
});

test("principal member envelope root matches the protocol golden vector", async () => {
  const group = {
    ...memberEnvelope({
      memberPrincipalType: "group" as const,
      memberPrincipalId: "alpha",
      seed: 1,
    }),
    memberKeyFingerprint: "a".repeat(64),
  };
  const userZeta = {
    ...memberEnvelope({
      memberPrincipalType: "user" as const,
      memberPrincipalId: "zeta",
      seed: 2,
    }),
    memberKeyFingerprint: "b".repeat(64),
  };
  const userAlpha = {
    ...memberEnvelope({
      memberPrincipalType: "user" as const,
      memberPrincipalId: "alpha",
      seed: 3,
    }),
    memberKeyFingerprint: "c".repeat(64),
  };

  expect(
    await computePrincipalMemberEnvelopesRoot([userZeta, group, userAlpha]),
  ).toBe("484b1db23861177163ca9c6c5102fc2abf08f7fe43ae389a46bef57a1fcacff0");
});

test("principal member envelopes reject duplicate recipient identities", () => {
  const envelope = memberEnvelope({
    memberPrincipalType: "user",
    memberPrincipalId: "user-alice",
    seed: 1,
  });

  expect(() =>
    normalizePrincipalStateMemberEnvelopes([
      envelope,
      { ...envelope, memberKeyFingerprint: "2".repeat(64) },
    ]),
  ).toThrow("cannot contain duplicate member envelopes");
});

test("principal member envelopes require canonical base64", () => {
  const envelope = memberEnvelope({
    memberPrincipalType: "user",
    memberPrincipalId: "user-alice",
    seed: 1,
  });

  expect(() =>
    normalizePrincipalStateMemberEnvelopes([
      { ...envelope, kemCipherText: `${envelope.kemCipherText}\n` },
    ]),
  ).toThrow("KEM ciphertext must use canonical base64 encoding");
  expect(() =>
    normalizePrincipalStateMemberEnvelopes([
      { ...envelope, wrappedKey: `${envelope.wrappedKey}\n` },
    ]),
  ).toThrow("wrapped key must use canonical base64 encoding");
});

test("principal member envelopes require exact ML-KEM field sizes", () => {
  const envelope = memberEnvelope({
    memberPrincipalType: "user",
    memberPrincipalId: "user-alice",
    seed: 1,
  });

  expect(() =>
    normalizePrincipalStateMemberEnvelopes([
      {
        ...envelope,
        kemCipherText: bytesToBase64(
          new Uint8Array(ML_KEM1024_CIPHERTEXT_BYTES - 1),
        ),
      },
    ]),
  ).toThrow(
    `KEM ciphertext must contain exactly ${ML_KEM1024_CIPHERTEXT_BYTES} bytes`,
  );
  expect(() =>
    normalizePrincipalStateMemberEnvelopes([
      {
        ...envelope,
        kemCipherText: bytesToBase64(
          new Uint8Array(ML_KEM1024_CIPHERTEXT_BYTES + 1),
        ),
      },
    ]),
  ).toThrow(
    `KEM ciphertext must contain exactly ${ML_KEM1024_CIPHERTEXT_BYTES} bytes`,
  );
  expect(() =>
    normalizePrincipalStateMemberEnvelopes([
      {
        ...envelope,
        wrappedKey: bytesToBase64(
          new Uint8Array(ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES - 1),
        ),
      },
    ]),
  ).toThrow(
    `wrapped key must contain exactly ${ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES} bytes`,
  );
  expect(() =>
    normalizePrincipalStateMemberEnvelopes([
      {
        ...envelope,
        wrappedKey: bytesToBase64(
          new Uint8Array(ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES + 1),
        ),
      },
    ]),
  ).toThrow(
    `wrapped key must contain exactly ${ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES} bytes`,
  );
});
