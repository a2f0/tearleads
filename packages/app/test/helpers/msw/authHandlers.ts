import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isRegistrationRequest } from "@tearleads/validators/request";
import type {
  DestroySessionResponse,
  ListSessionsResponse,
  UserIdentityResponse,
  VerifyResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import { proxyRequestToApiApp } from "./proxiedApi";

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const mockUserIdentitiesByUserId = new Map<
  string,
  Promise<UserIdentityResponse>
>();
interface MockAuthContext {
  organizationId: string;
  userId: string;
}

let mockAuthContext: MockAuthContext | null = null;

function getMockUserIdentityResponse(
  userId: string,
): Promise<UserIdentityResponse> {
  let response = mockUserIdentitiesByUserId.get(userId);
  if (!response) {
    response = (async () => {
      const signingKeyPair = generateSigningSeedAndKeyPair();
      const encapsulationKeyPair = generateKemSeedAndKeyPair();
      return {
        encapsulationKeyFingerprint: await toFingerprint(
          encapsulationKeyPair.publicKey,
        ),
        userId,
        signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
        signingKeyFingerprint: await toFingerprint(
          signingKeyPair.signingPublicKey,
        ),
        encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
      };
    })();
    mockUserIdentitiesByUserId.set(userId, response);
  }
  return response;
}

export const authHandlers = [
  http.post("http://localhost:3001/auth/register", async ({ request }) => {
    const requestBody = await request
      .clone()
      .json()
      .catch(() => null);
    const response = await proxyRequestToApiApp(request);
    if (response.ok && isRegistrationRequest(requestBody)) {
      mockAuthContext = {
        organizationId: requestBody.organizationId,
        userId: requestBody.userId,
      };
    }
    return response;
  }),
  http.post("http://localhost:3001/auth/challenge", () =>
    HttpResponse.json({ challenge: randomHex(32) }),
  ),
  http.post("http://localhost:3001/auth/verify", () => {
    const context = mockAuthContext ?? {
      organizationId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    };
    mockAuthContext = context;
    return HttpResponse.json<VerifyResponse>({
      rootContainerId: null,
      authenticated: true,
      isRoot: false,
      organizationId: context.organizationId,
      token: randomHex(64),
      userId: context.userId,
      wsTicket: randomHex(32),
    });
  }),
  http.get("http://localhost:3001/auth/sessions", () => {
    return HttpResponse.json<ListSessionsResponse>({
      sessions: [
        {
          createdAt: "2026-05-22T10:00:00.000Z",
          id: randomHex(32),
          ipAddresses: ["198.51.100.10"],
          isCurrent: true,
          lastActiveAt: "2026-05-22T10:05:00.000Z",
          lastActiveIp: "198.51.100.10",
          signingKeyFingerprint: randomHex(32),
        },
      ],
    });
  }),
  http.delete("http://localhost:3001/auth/sessions/:sessionId", () => {
    return HttpResponse.json<DestroySessionResponse>({ message: "ok" });
  }),
  http.post("http://localhost:3001/auth/logout", () => {
    return HttpResponse.json<DestroySessionResponse>({ message: "ok" });
  }),
  http.post("http://localhost:3001/auth/ws-ticket", () => {
    return HttpResponse.json({ ticket: randomHex(32) });
  }),
  http.get<{ userId: string }>(
    "http://localhost:3001/auth/user-identity/:userId",
    async ({ params }) => {
      return HttpResponse.json<UserIdentityResponse>(
        await getMockUserIdentityResponse(params.userId),
      );
    },
  ),
];

export function resetMockAuth(): void {
  mockAuthContext = null;
  mockUserIdentitiesByUserId.clear();
}
