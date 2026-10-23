import { expect } from "bun:test";
import { generateSigningKeyPair } from "@tearleads/crypto";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { AccountSuspendedError } from "./accountSuspension";

const userId = "11111111-1111-4111-8111-111111111111";
const identity = {
  createdAt: "2026-10-01T00:00:00.000Z",
  defaultOrganizationId: "22222222-2222-4222-8222-222222222222",
  isRoot: false,
  lastActiveAt: null,
  registrationSourceIpAddress: null,
  signingKeyFingerprint: "ab".repeat(32),
  suspendedAt: "2026-10-22T00:00:00.000Z",
  userId,
};

testApiClient("root suspension transport places and lifts", async () => {
  const methods: string[] = [];
  server.use(
    http.put(`${apiBaseUrl}/root/identities/${userId}/suspension`, () => {
      methods.push("PUT");
      return HttpResponse.json({ identity });
    }),
    http.delete(`${apiBaseUrl}/root/identities/${userId}/suspension`, () => {
      methods.push("DELETE");
      return HttpResponse.json({
        identity: { ...identity, suspendedAt: null },
      });
    }),
  );
  const client = new ApiClient(apiBaseUrl);

  expect(await client.suspendRootIdentityResult(userId)).toEqual({
    data: { identity },
    ok: true,
  });
  expect(await client.liftRootIdentitySuspensionResult(userId)).toEqual({
    data: { identity: { ...identity, suspendedAt: null } },
    ok: true,
  });
  expect(methods).toEqual(["PUT", "DELETE"]);
});

function serveVerifyFailure(status: number, body: Record<string, unknown>) {
  let verifies = 0;
  server.use(
    http.post(`${apiBaseUrl}/auth/challenge`, () =>
      HttpResponse.json({ challenge: "a".repeat(64) }),
    ),
    http.post(`${apiBaseUrl}/auth/verify`, () => {
      verifies += 1;
      return HttpResponse.json(body, { status });
    }),
  );
  return () => verifies;
}

testApiClient("a suspended sign-in is a typed terminal failure", async () => {
  const verifies = serveVerifyFailure(403, {
    authenticated: false,
    code: "account_suspended",
    error: "Account suspended",
  });
  const client = new ApiClient(apiBaseUrl);
  const { signingPrivateKey } = generateSigningKeyPair(new Uint8Array(32));

  await expect(
    client.authenticate("b".repeat(64), signingPrivateKey),
  ).rejects.toBeInstanceOf(AccountSuspendedError);
  expect(verifies()).toBe(1);
});

testApiClient("an ordinary refused sign-in still resolves null", async () => {
  serveVerifyFailure(401, {
    authenticated: false,
    error: "Invalid signature",
  });
  const client = new ApiClient(apiBaseUrl);
  const { signingPrivateKey } = generateSigningKeyPair(new Uint8Array(32));

  await expect(
    client.authenticate("b".repeat(64), signingPrivateKey),
  ).resolves.toBeNull();
});
