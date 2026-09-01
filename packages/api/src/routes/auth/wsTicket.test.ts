import { expect, test } from "bun:test";
import {
  authChallengeSigningBytes,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import invariant from "invariant";
import {
  requestChallenge,
  submitRegistration,
  submitVerify,
} from "../../../test/helpers/api";
import { consumeWebSocketTicket } from "../../realtime/wsTicket";
import { routeApp } from "../../routeApp";

async function authenticatedToken(): Promise<string> {
  const signingKeys = generateSigningSeedAndKeyPair();
  const kemKeys = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingKeys.signingPublicKey);

  const registration = await submitRegistration(
    signingKeys.signingPublicKey,
    signingKeys.signingPrivateKey,
    kemKeys.publicKey,
  );
  expect(registration.status).toBe(200);

  const { challenge } = await (await requestChallenge(fingerprint)).json();
  invariant(typeof challenge === "string", "expected challenge string");
  const signature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    signingKeys.signingPrivateKey,
  );
  const body = await (await submitVerify(fingerprint, signature)).json();
  invariant(typeof body.token === "string", "expected token string");
  return body.token;
}

test("rejects ws-ticket requests without a session", async () => {
  const res = await routeApp.request("/auth/ws-ticket", { method: "POST" });
  expect(res.status).toBe(401);
});

test("mints a single-use ticket bound to the authenticated session", async () => {
  const token = await authenticatedToken();
  const res = await routeApp.request("/auth/ws-ticket", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);

  const body = await res.json();
  invariant(typeof body.ticket === "string", "expected ticket string");
  expect(body.ticket).toMatch(/^[0-9a-f]{64}$/);

  const identity = await consumeWebSocketTicket(body.ticket);
  expect(identity).not.toBeNull();
  expect(typeof identity?.userId).toBe("string");
  expect((identity?.userId.length ?? 0) > 0).toBe(true);
  expect(typeof identity?.sessionId).toBe("string");
  expect((identity?.sessionId.length ?? 0) > 0).toBe(true);
  // The ticket is consumed by the line above; it cannot be reused.
  expect(await consumeWebSocketTicket(body.ticket)).toBeNull();
});
