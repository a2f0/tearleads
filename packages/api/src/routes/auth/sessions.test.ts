import { expect, test } from "bun:test";
import {
  authChallengeSigningBytes,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import type { ListSessionsResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import {
  requestChallenge,
  submitRegistration,
  submitVerify,
} from "../../../test/helpers/api";
import { routeApp } from "../../routeApp";

interface RegisteredTestUser {
  fingerprint: string;
  signingPrivateKey: Uint8Array;
}

async function registerTestUser(): Promise<RegisteredTestUser> {
  const signingKeys = generateSigningSeedAndKeyPair();
  const kemKeys = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingKeys.signingPublicKey);

  const res = await submitRegistration(
    signingKeys.signingPublicKey,
    signingKeys.signingPrivateKey,
    kemKeys.publicKey,
  );
  expect(res.status).toBe(200);

  return {
    fingerprint,
    signingPrivateKey: signingKeys.signingPrivateKey,
  };
}

async function authenticate(user: RegisteredTestUser): Promise<string> {
  const challengeRes = await requestChallenge(user.fingerprint);
  const { challenge } = await challengeRes.json();
  invariant(typeof challenge === "string", "expected challenge string");

  const signature = sign(
    authChallengeSigningBytes({
      challengeHex: challenge,
      fingerprint: user.fingerprint,
    }),
    user.signingPrivateKey,
  );
  const res = await submitVerify(user.fingerprint, signature);
  const body = await res.json();
  invariant(typeof body.token === "string", "expected token string");
  return body.token;
}

async function listSessions(token: string): Promise<Response> {
  return routeApp.request("/auth/sessions", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function destroySession(
  token: string,
  sessionId: string,
): Promise<Response> {
  return routeApp.request(`/auth/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

test("lists active sessions for the current user without exposing bearer tokens", async () => {
  const user = await registerTestUser();
  const firstToken = await authenticate(user);
  const secondToken = await authenticate(user);

  const res = await listSessions(secondToken);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListSessionsResponse;

  expect(body.sessions).toHaveLength(2);
  expect(body.sessions.some((session) => session.id === firstToken)).toBe(
    false,
  );
  expect(body.sessions.some((session) => session.id === secondToken)).toBe(
    false,
  );
  expect(body.sessions.every((session) => session.id.length === 64)).toBe(true);
  expect(body.sessions.filter((session) => session.isCurrent)).toHaveLength(1);
  expect(
    body.sessions.every(
      (session) => session.signingKeyFingerprint === user.fingerprint,
    ),
  ).toBe(true);
});

test("destroys another session owned by the current user", async () => {
  const user = await registerTestUser();
  const firstToken = await authenticate(user);
  const secondToken = await authenticate(user);

  const before = (await (
    await listSessions(secondToken)
  ).json()) as ListSessionsResponse;
  const firstSession = before?.sessions.find((session) => !session.isCurrent);
  invariant(firstSession, "expected non-current session");

  const destroyRes = await destroySession(secondToken, firstSession.id);
  expect(destroyRes.status).toBe(200);
  expect(await destroyRes.json()).toEqual({ message: "ok" });

  const firstSessionRes = await listSessions(firstToken);
  expect(firstSessionRes.status).toBe(401);

  const after = (await (
    await listSessions(secondToken)
  ).json()) as ListSessionsResponse;
  expect(after?.sessions.map((session) => session.id)).not.toContain(
    firstSession.id,
  );
});

test("destroys the current session", async () => {
  const user = await registerTestUser();
  const token = await authenticate(user);

  const before = (await (
    await listSessions(token)
  ).json()) as ListSessionsResponse;
  const currentSession = before?.sessions.find((session) => session.isCurrent);
  invariant(currentSession, "expected current session");

  const destroyRes = await destroySession(token, currentSession.id);
  expect(destroyRes.status).toBe(200);

  const after = await listSessions(token);
  expect(after.status).toBe(401);
});

test("does not allow destroying another user's session", async () => {
  const firstUser = await registerTestUser();
  const secondUser = await registerTestUser();
  const firstToken = await authenticate(firstUser);
  const secondToken = await authenticate(secondUser);

  const secondSessions = (await (
    await listSessions(secondToken)
  ).json()) as ListSessionsResponse;
  const secondSession = secondSessions?.sessions[0];
  invariant(secondSession, "expected second user session");

  const destroyRes = await destroySession(firstToken, secondSession.id);
  expect(destroyRes.status).toBe(404);

  const secondStillActive = await listSessions(secondToken);
  expect(secondStillActive.status).toBe(200);
});
