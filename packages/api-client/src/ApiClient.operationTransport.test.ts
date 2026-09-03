import { expect } from "bun:test";
import {
  generateSigningKeyPair,
  ML_DSA87_SIGNATURE_BYTES,
} from "@tearleads/crypto";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import {
  createOrganizationRequestFixture,
  createRegistrationRequestFixture,
} from "../test/helpers/provisioningFixtures";
import { ApiClient } from "./ApiClient";

testApiClient(
  "auth transport sends schema-derived JSON and decodes verification",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const fingerprint = "b".repeat(64);
    const challenge = "a".repeat(64);
    server.use(
      http.post(`${apiBaseUrl}/auth/challenge`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json({ challenge });
      }),
      http.post(`${apiBaseUrl}/auth/verify`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json({
          authenticated: true,
          organizationId: "organization-1",
          token: "token-1",
          userId: "user-1",
        });
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    const { signingPrivateKey } = generateSigningKeyPair(new Uint8Array(32));

    await expect(
      client.authenticate(fingerprint, signingPrivateKey),
    ).resolves.toEqual({
      authenticated: true,
      organizationId: "organization-1",
      token: "token-1",
      userId: "user-1",
    });

    expect(calls).toHaveLength(2);
    expect(
      calls.map(({ authorization, contentType, method, url }) => ({
        authorization,
        contentType,
        method,
        url,
      })),
    ).toEqual([
      {
        authorization: null,
        contentType: "application/json",
        method: "POST",
        url: `${apiBaseUrl}/auth/challenge`,
      },
      {
        authorization: null,
        contentType: "application/json",
        method: "POST",
        url: `${apiBaseUrl}/auth/verify`,
      },
    ]);
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({ fingerprint });
    const verifyBody = JSON.parse(calls[1]?.body ?? "null");
    expect(verifyBody).toMatchObject({ fingerprint });
    expect(verifyBody.signature).toHaveLength(ML_DSA87_SIGNATURE_BYTES);
  },
);

testApiClient(
  "provisioning transport preserves payloads, headers, and HTTP failures",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.post(`${apiBaseUrl}/auth/register`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json(
          { error: "registration conflict" },
          { status: 409, statusText: "Conflict" },
        );
      }),
      http.post(`${apiBaseUrl}/organizations`, async ({ request }) => {
        calls.push(await captureHttpCall(request));
        return HttpResponse.json(
          { error: "organization conflict" },
          { status: 409, statusText: "Conflict" },
        );
      }),
    );
    const registration = createRegistrationRequestFixture();
    const registrationClient = new ApiClient(apiBaseUrl);
    const errors: string[] = [];
    registrationClient.setOnError((message) => errors.push(message));

    await expect(
      registrationClient.registerUser(
        registration.userId,
        registration.organizationId,
        registration.rootContainerId,
        new Uint8Array(registration.signingPublicKey),
        new Uint8Array(registration.encapsulationPublicKey),
        registration.initialAdminGroup,
        registration.initialMemberGroup,
        registration.initialOrganizationPolicy,
        registration.initialRootContainer,
        registration.initialRootMetadataDocument,
      ),
    ).resolves.toBeNull();

    const organization = createOrganizationRequestFixture();
    const organizationClient = new ApiClient(apiBaseUrl);
    organizationClient.setAuthToken("session-token");
    organizationClient.setOnError((message) => errors.push(message));
    await expect(
      organizationClient.createOrganization(organization),
    ).resolves.toBeNull();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      authorization: null,
      contentType: "application/json",
      method: "POST",
      url: `${apiBaseUrl}/auth/register`,
    });
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual(registration);
    expect(calls[1]).toMatchObject({
      authorization: "Bearer session-token",
      contentType: "application/json",
      method: "POST",
      url: `${apiBaseUrl}/organizations`,
    });
    expect(JSON.parse(calls[1]?.body ?? "null")).toEqual(organization);
    expect(errors).toEqual([
      "POST /auth/register: 409 Conflict: registration conflict",
      "POST /organizations: 409 Conflict: organization conflict",
    ]);
  },
);
