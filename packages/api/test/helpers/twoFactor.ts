import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { TestUser } from "@tearleads/test-utils";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";
import { totpCode, totpStep } from "../../src/workflows/auth/twoFactor/totp";
import { requestChallenge } from "./api";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** What an authenticator app does with the manual setup key. */
function decodeBase32(encoded: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of encoded) {
    const value = BASE32_ALPHABET.indexOf(character);
    invariant(value >= 0, "expected a base32 character");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** The authenticator code for a setup key, `offset` steps from now. */
export function authenticatorCode(secret: string, offset = 0): string {
  return totpCode(decodeBase32(secret), totpStep(Date.now()) + offset);
}

export function twoFactorRequest(
  token: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const authorization = { Authorization: `Bearer ${token}` };
  return Promise.resolve(
    routeApp.request(
      `/auth/two-factor${path}`,
      body === undefined
        ? { headers: authorization, method: path === "" ? "GET" : "POST" }
        : {
            body: JSON.stringify(body),
            headers: { ...authorization, "Content-Type": "application/json" },
            method: "POST",
          },
    ),
  );
}

/** Signs in with an optional second factor and returns the raw response. */
export async function verifyWithSecondFactor(
  user: TestUser,
  secondFactor: {
    readonly twoFactor?: {
      readonly code: string;
      readonly method: "recovery_code" | "totp";
      readonly rememberDevice: boolean;
    };
    readonly twoFactorDeviceToken?: string;
  } = {},
): Promise<Response> {
  const challengeResponse = await requestChallenge(user.fingerprint);
  const { challenge } = await challengeResponse.json();
  invariant(typeof challenge === "string", "expected challenge string");
  const signature = sign(
    authChallengeSigningBytes({
      apiOrigin: "http://localhost",
      challengeHex: challenge,
      fingerprint: user.fingerprint,
    }),
    user.signing.signingPrivateKey,
  );
  return routeApp.request("/auth/verify", {
    body: JSON.stringify({
      fingerprint: user.fingerprint,
      signature: bytesToBase64(signature),
      ...secondFactor,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

/** Turns two-factor on for the session's identity; returns its setup key. */
export async function enableTwoFactorForTest(
  token: string,
  rememberDevice = false,
): Promise<{
  readonly deviceToken?: string;
  /** The code that turned it on, whose step is now spent. */
  readonly enablingCode: string;
  readonly recoveryCodes: readonly string[];
  readonly secret: string;
}> {
  const setup = await twoFactorRequest(token, "/setup");
  invariant(setup.status === 200, `setup failed with ${setup.status}`);
  const { secret } = await setup.json();
  invariant(typeof secret === "string", "expected setup key");
  const enablingCode = authenticatorCode(secret);
  const enable = await twoFactorRequest(token, "/enable", {
    code: enablingCode,
    rememberDevice,
  });
  invariant(enable.status === 200, `enable failed with ${enable.status}`);
  const body = await enable.json();
  return { ...body, enablingCode, secret };
}
