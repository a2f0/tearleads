import { expect, test } from "bun:test";
import { openTwoFactorSecret, sealTwoFactorSecret } from "./secretSeal";

const SERVER_SECRET = "two-factor-seal-test-secret";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

test("a sealed secret opens for its own user and key only", async () => {
  const secret = crypto.getRandomValues(new Uint8Array(20));
  const sealed = await sealTwoFactorSecret({
    secret,
    serverSecret: SERVER_SECRET,
    userId: USER_ID,
  });

  expect(sealed.startsWith("v1.")).toBe(true);
  expect(sealed).not.toContain(Buffer.from(secret).toString("base64"));
  await expect(
    openTwoFactorSecret({
      sealed,
      serverSecret: SERVER_SECRET,
      userId: USER_ID,
    }),
  ).resolves.toEqual(secret);
  await expect(
    openTwoFactorSecret({
      sealed,
      serverSecret: SERVER_SECRET,
      userId: OTHER_USER_ID,
    }),
  ).rejects.toThrow();
  await expect(
    openTwoFactorSecret({
      sealed,
      serverSecret: `${SERVER_SECRET}-rotated`,
      userId: USER_ID,
    }),
  ).rejects.toThrow();
});

test("sealing twice gives different ciphertexts", async () => {
  const secret = new Uint8Array(20);
  const input = { secret, serverSecret: SERVER_SECRET, userId: USER_ID };
  expect(await sealTwoFactorSecret(input)).not.toBe(
    await sealTwoFactorSecret(input),
  );
});

test("malformed sealed values are refused", async () => {
  for (const sealed of ["", "v2.a.b", "v1.a", "v1.a.b.c"]) {
    await expect(
      openTwoFactorSecret({
        sealed,
        serverSecret: SERVER_SECRET,
        userId: USER_ID,
      }),
    ).rejects.toThrow("Malformed two-factor secret");
  }
});
