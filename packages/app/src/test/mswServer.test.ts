import { afterEach, expect, test } from "bun:test";
import { registerIdentity as registerClientIdentity } from "@tearleads/client-sdk";
import type { ExecSql, ExecSqlClientLike } from "@tearleads/client-sdk/sqlite";
import {
  authChallengeSigningBytes,
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type SigningKeyPair,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { isRegistrationResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import {
  getProxiedApiNetworkActivitySnapshot,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../test/helpers/mswServer";

const apiBaseUrl = "http://localhost:3001";

afterEach(async () => {
  await resetMockServer();
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDbClient(execSql: ExecSql): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

async function waitForActiveProxiedApiRequest(): Promise<void> {
  const deadline = Date.now() + 100;

  while (Date.now() <= deadline) {
    if (getProxiedApiNetworkActivitySnapshot().activeRequestCount > 0) {
      return;
    }

    await delay(1);
  }

  throw new Error("Expected an active proxied API request.");
}

async function registerIdentity(
  signingKeyPair: SigningKeyPair,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<{ userId: string }> {
  const { close, execSql } = await createTestExecSql("app-msw-registration");
  try {
    const registration = await registerClientIdentity({
      apiClient: {
        async registerUser(
          userId,
          organizationId,
          rootContainerId,
          signingPublicKey,
          encapsulationPublicKey,
          initialAdminGroup,
          initialMemberGroup,
          initialOrganizationPolicy,
          initialRootContainer,
          initialRootMetadataDocument,
          initialRosterProfileContainer,
          initialRosterProfileDocument,
          initialOrganizationMetadataContainer,
          initialOrganizationProfileDocument,
          initialSystemContainers,
        ) {
          const response = await fetch(`${apiBaseUrl}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              organizationId,
              rootContainerId,
              signingPublicKey: Array.from(signingPublicKey),
              encapsulationPublicKey: Array.from(encapsulationPublicKey),
              initialAdminGroup,
              initialMemberGroup,
              initialOrganizationPolicy,
              initialRootContainer,
              initialRootMetadataDocument,
              initialRosterProfileContainer,
              initialRosterProfileDocument,
              initialOrganizationMetadataContainer,
              initialOrganizationProfileDocument,
              initialSystemContainers,
            }),
          });
          if (!response.ok) {
            return null;
          }

          const body: unknown = await response.json();
          return isRegistrationResponse(body) ? body : null;
        },
      },
      containerId: crypto.randomUUID(),
      dbClient: createDbClient(execSql),
      encapsulationKeyPair,
      pinLocalUserIdentity: async () => undefined,
      signingKeyPair,
    });
    invariant(registration, "Expected registration response.");

    return {
      userId: registration.userId,
    };
  } finally {
    close();
  }
}

async function requestChallenge(fingerprint: string): Promise<Response> {
  return fetch(`${apiBaseUrl}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint }),
  });
}

async function verifySession(
  fingerprint: string,
  signature: Uint8Array,
): Promise<Response> {
  return fetch(`${apiBaseUrl}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fingerprint,
      signature: Array.from(signature),
    }),
  });
}

async function requestUserIdentity(
  token: string,
  userId: string,
): Promise<Response> {
  return fetch(`${apiBaseUrl}/auth/user-identity/${userId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

test("resetMockServer recreates isolated auth state for the proxied test API app", async () => {
  useTestApiAppHandlers();

  const signingKeys = generateSigningSeedAndKeyPair();
  const kemKeys = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingKeys.signingPublicKey);
  const { userId } = await registerIdentity(signingKeys, kemKeys);

  const challengeResponse = await requestChallenge(fingerprint);
  expect(challengeResponse.status).toBe(200);
  const challengeBody = await challengeResponse.json();
  invariant(
    typeof challengeBody.challenge === "string",
    "Expected challenge string.",
  );

  const tokenResponse = await verifySession(
    fingerprint,
    sign(
      authChallengeSigningBytes({
        challengeHex: challengeBody.challenge,
        fingerprint,
      }),
      signingKeys.signingPrivateKey,
    ),
  );
  expect(tokenResponse.status).toBe(200);
  const tokenBody = await tokenResponse.json();
  invariant(typeof tokenBody.token === "string", "Expected session token.");

  const authenticatedResponse = await requestUserIdentity(
    tokenBody.token,
    userId,
  );
  expect(authenticatedResponse.status).toBe(200);

  await resetMockServer();
  useTestApiAppHandlers();

  const staleSessionResponse = await requestUserIdentity(
    tokenBody.token,
    userId,
  );
  expect(staleSessionResponse.status).toBe(401);

  const resetChallengeResponse = await requestChallenge(fingerprint);
  expect(resetChallengeResponse.status).toBe(404);
}, 30_000);

test("resetMockServer leaves active proxied API accounting intact when idle times out", async () => {
  useTestApiAppHandlers({ responseDelayMs: 100 });

  const pendingResponse = fetch(`${apiBaseUrl}/`);
  await waitForActiveProxiedApiRequest();

  await expect(
    resetMockServer({ proxiedApiQuietMs: 1, proxiedApiTimeoutMs: 10 }),
  ).rejects.toThrow("Timed out waiting for proxied API network idle");

  expect(getProxiedApiNetworkActivitySnapshot()).toEqual({
    activeRequestCount: 1,
    completedRequestCount: 0,
  });

  const response = await pendingResponse;
  expect(response.status).toBe(200);
  expect(getProxiedApiNetworkActivitySnapshot()).toEqual({
    activeRequestCount: 0,
    completedRequestCount: 1,
  });

  await resetMockServer();
});
