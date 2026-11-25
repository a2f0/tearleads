import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import {
  TWO_FACTOR_ERROR_CODES,
  VERIFY_ERROR_CODES,
} from "@tearleads/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import {
  authenticatorCode,
  enableTwoFactorForTest,
  twoFactorRequest,
  verifyWithSecondFactor,
} from "../../../test/helpers/twoFactor";

async function signedInUser(): Promise<TestUser> {
  const user = createTestUser();
  await registerAndAuthenticate(user);
  return user;
}

async function signedInToken(
  user: TestUser,
  secondFactor: Parameters<typeof verifyWithSecondFactor>[1],
): Promise<{ deviceToken?: string; token: string }> {
  const response = await verifyWithSecondFactor(user, secondFactor);
  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(typeof body.token === "string", "expected session token");
  return { deviceToken: body.twoFactorDeviceToken, token: body.token };
}

function totp(code: string, rememberDevice = false) {
  return { twoFactor: { code, method: "totp" as const, rememberDevice } };
}

test("turning two-factor on verifies this session and revokes the others", async () => {
  const user = await signedInUser();
  const first = user.token;
  await authenticate(user);
  const second = user.token;

  const initial = await twoFactorRequest(first, "");
  expect(await initial.json()).toEqual({
    enabled: false,
    recoveryCodesRemaining: 0,
    requiredByOrganizationIds: [],
    sessionVerified: false,
  });

  const setup = await twoFactorRequest(first, "/setup");
  expect(setup.status).toBe(200);
  const { otpauthUri, secret } = await setup.json();
  expect(otpauthUri).toStartWith("otpauth://totp/Tearleads:");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  const wrong = await twoFactorRequest(first, "/enable", {
    code: "000000" === authenticatorCode(secret) ? "111111" : "000000",
    rememberDevice: false,
  });
  expect(wrong.status).toBe(400);
  expect(await wrong.json()).toMatchObject({
    code: TWO_FACTOR_ERROR_CODES.invalidCode,
  });

  const enable = await twoFactorRequest(first, "/enable", {
    code: authenticatorCode(secret),
    rememberDevice: false,
  });
  expect(enable.status).toBe(200);
  const enabled = await enable.json();
  expect(enabled.enabled).toBe(true);
  expect(enabled.recoveryCodes).toHaveLength(10);
  expect(enabled.deviceToken).toBeUndefined();

  expect((await twoFactorRequest(second, "")).status).toBe(401);
  expect(await (await twoFactorRequest(first, "")).json()).toEqual({
    enabled: true,
    recoveryCodesRemaining: 10,
    requiredByOrganizationIds: [],
    sessionVerified: true,
  });
  const again = await twoFactorRequest(first, "/setup");
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({
    code: TWO_FACTOR_ERROR_CODES.alreadyEnabled,
  });
});

test("sign-in asks for a code, refuses a replayed one, and remembers a device", async () => {
  const user = await signedInUser();
  const { enablingCode, secret } = await enableTwoFactorForTest(user.token);

  const missing = await verifyWithSecondFactor(user);
  expect(missing.status).toBe(401);
  expect(await missing.json()).toMatchObject({
    authenticated: false,
    code: VERIFY_ERROR_CODES.twoFactorRequired,
  });

  // The enabling code's step is spent.
  const replayed = await verifyWithSecondFactor(user, totp(enablingCode));
  expect(replayed.status).toBe(401);
  expect(await replayed.json()).toMatchObject({
    code: VERIFY_ERROR_CODES.twoFactorInvalid,
  });

  const remembered = await signedInToken(
    user,
    totp(authenticatorCode(secret, 1), true),
  );
  expect(remembered.deviceToken).toMatch(/^[0-9a-f]{64}$/);
  expect(
    await (await twoFactorRequest(remembered.token, "")).json(),
  ).toMatchObject({ sessionVerified: true });

  invariant(remembered.deviceToken, "expected a device token");
  const trusted = await signedInToken(user, {
    twoFactorDeviceToken: remembered.deviceToken,
  });
  expect(trusted.deviceToken).toBeUndefined();

  const forged = await verifyWithSecondFactor(user, {
    twoFactorDeviceToken: "a".repeat(64),
  });
  expect(forged.status).toBe(401);
});

test("each recovery code signs in once", async () => {
  const user = await signedInUser();
  const { recoveryCodes } = await enableTwoFactorForTest(user.token);
  const [code] = recoveryCodes;
  invariant(code, "expected a recovery code");
  const answer = {
    twoFactor: {
      code: code.toUpperCase(),
      method: "recovery_code" as const,
      rememberDevice: false,
    },
  };

  const { token } = await signedInToken(user, answer);
  const reused = await verifyWithSecondFactor(user, answer);
  expect(reused.status).toBe(401);
  expect(await (await twoFactorRequest(token, "")).json()).toMatchObject({
    recoveryCodesRemaining: 9,
  });
});

test("five wrong codes lock code entry, even for a correct code", async () => {
  const user = await signedInUser();
  const { secret } = await enableTwoFactorForTest(user.token);
  const wrong = authenticatorCode(secret, 1) === "000000" ? "111111" : "000000";

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await verifyWithSecondFactor(user, totp(wrong));
    expect(response.status).toBe(401);
  }
  const fifth = await verifyWithSecondFactor(user, totp(wrong));
  expect(fifth.status).toBe(429);
  expect(await fifth.json()).toMatchObject({
    code: VERIFY_ERROR_CODES.twoFactorLocked,
  });

  const correct = await verifyWithSecondFactor(
    user,
    totp(authenticatorCode(secret, 1)),
  );
  expect(correct.status).toBe(429);
});

test("new recovery codes replace the old ones", async () => {
  const user = await signedInUser();
  const { recoveryCodes, secret } = await enableTwoFactorForTest(user.token);

  const response = await twoFactorRequest(user.token, "/recovery-codes", {
    code: authenticatorCode(secret, 1),
    method: "totp",
  });
  expect(response.status).toBe(200);
  const { recoveryCodes: replacement } = await response.json();
  expect(replacement).toHaveLength(10);

  const [old] = recoveryCodes;
  invariant(old, "expected a recovery code");
  const stale = await verifyWithSecondFactor(user, {
    twoFactor: { code: old, method: "recovery_code", rememberDevice: false },
  });
  expect(stale.status).toBe(401);
});

test("turning two-factor off revokes every session and forgets devices", async () => {
  const user = await signedInUser();
  const { deviceToken, secret } = await enableTwoFactorForTest(
    user.token,
    true,
  );
  invariant(deviceToken, "expected a device token");

  const disabled = await twoFactorRequest(user.token, "/disable", {
    code: authenticatorCode(secret, 1),
    method: "totp",
  });
  expect(disabled.status).toBe(200);
  expect(await disabled.json()).toEqual({
    enabled: false,
    recoveryCodesRemaining: 0,
    requiredByOrganizationIds: [],
    sessionVerified: false,
  });
  expect((await twoFactorRequest(user.token, "")).status).toBe(401);

  const { token } = await signedInToken(user, {});
  const { secret: next } = await enableTwoFactorForTest(token);
  // The device was remembered for the earlier enrollment only.
  const stale = await verifyWithSecondFactor(user, {
    twoFactorDeviceToken: deviceToken,
  });
  expect(stale.status).toBe(401);
  expect(next).not.toBe(secret);
});

test("disabling and new codes need two-factor to be on", async () => {
  const user = await signedInUser();
  for (const path of ["/disable", "/recovery-codes"]) {
    const response = await twoFactorRequest(user.token, path, {
      code: "000000",
      method: "totp",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: TWO_FACTOR_ERROR_CODES.notEnabled,
    });
  }
});
