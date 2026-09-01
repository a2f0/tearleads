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
  userId: string;
  seed: number;
}): PrincipalStateMemberEnvelope {
  return {
    userId: input.userId,
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
  const first = memberEnvelope({
    userId: "aaa-first",
    seed: 1,
  });
  const second = memberEnvelope({
    userId: "zzz-second",
    seed: 2,
  });

  expect(normalizePrincipalStateMemberEnvelopes([second, first])).toEqual([
    first,
    second,
  ]);
  expect(await computePrincipalMemberEnvelopesRoot([second, first])).toBe(
    await computePrincipalMemberEnvelopesRoot([first, second]),
  );
});

test("principal member envelopes use deterministic code-unit ordering", () => {
  const uppercase = memberEnvelope({
    userId: "Z-user",
    seed: 1,
  });
  const lowercase = memberEnvelope({
    userId: "a-user",
    seed: 2,
  });

  expect(
    normalizePrincipalStateMemberEnvelopes([lowercase, uppercase]),
  ).toEqual([uppercase, lowercase]);
});

test("principal member envelope root matches the protocol golden vector", async () => {
  // Previously this pinned that a GROUP "alpha" and a USER "alpha" encode
  // distinctly — the (type, id) pair being the identity. Group members no
  // longer exist, so what remains worth pinning is that the root is order
  // independent and stable across distinct user members.
  const userAlpha = {
    ...memberEnvelope({
      userId: "alpha",
      seed: 1,
    }),
    memberKeyFingerprint: "a".repeat(64),
  };
  const userZeta = {
    ...memberEnvelope({
      userId: "zeta",
      seed: 2,
    }),
    memberKeyFingerprint: "b".repeat(64),
  };
  const userMid = {
    ...memberEnvelope({
      userId: "mid",
      seed: 3,
    }),
    memberKeyFingerprint: "c".repeat(64),
  };

  const root = await computePrincipalMemberEnvelopesRoot([
    userZeta,
    userAlpha,
    userMid,
  ]);
  expect(root).toBe(
    "2c4ef0599d93306b6b05c38b9fee8c04e69f496dfc992da5e6e68953fb395de2",
  );
  // Order independent: normalization sorts before hashing.
  expect(
    await computePrincipalMemberEnvelopesRoot([userAlpha, userMid, userZeta]),
  ).toBe(root);
});

test("principal member envelopes reject duplicate recipient identities", () => {
  const envelope = memberEnvelope({
    userId: "user-alice",
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
    userId: "user-alice",
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
    userId: "user-alice",
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
