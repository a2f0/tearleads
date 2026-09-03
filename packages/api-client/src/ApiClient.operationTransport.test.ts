import { expect } from "bun:test";
import {
  generateSigningKeyPair,
  ML_DSA87_SIGNATURE_BYTES,
} from "@tearleads/crypto";
import { BILLING_ERROR_CODES } from "@tearleads/validators/billing";
import { DOCUMENT_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  createContainerMutationRequest,
  createDocumentSyncRequest,
} from "../test/helpers/apiClientTestFactories";
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

testApiClient("rejects failures at undeclared operation statuses", async () => {
  server.use(
    http.get(`${apiBaseUrl}/`, () =>
      HttpResponse.json(
        {
          code: "session_refresh_required",
          error: "Untrusted session failure",
        },
        { status: 401 },
      ),
    ),
  );

  let refreshCount = 0;
  const errors: string[] = [];
  const client = new ApiClient(apiBaseUrl);
  client.setAuthToken("session-token");
  client.setOnError((message) => errors.push(message));
  client.setOnSessionExpired(() => {
    refreshCount += 1;
    return true;
  });

  await expect(client.getHealth()).resolves.toBeNull();

  expect(refreshCount).toBe(0);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("Invalid failure response body");
  expect(errors[0]?.includes("Untrusted session failure")).toBe(false);
});

testApiClient("accepts the global database-unavailable failure", async () => {
  server.use(
    http.get(`${apiBaseUrl}/auth/user-identity/:userId`, () =>
      HttpResponse.json(
        {
          code: "session_refresh_required",
          error: "Database temporarily unavailable",
        },
        { status: 503, statusText: "Service Unavailable" },
      ),
    ),
  );
  const errors: string[] = [];
  const client = new ApiClient(apiBaseUrl);
  client.setOnError((message) => errors.push(message));

  await expect(client.getUserIdentity("user-1")).resolves.toBeNull();

  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("Database temporarily unavailable");
  expect(errors[0]?.includes("Invalid failure response body")).toBe(false);
  expect(
    client.getRequestFailure({
      method: "GET",
      path: "/auth/user-identity/user-1",
    }),
  ).not.toHaveProperty("code");
});

testApiClient("rejects malformed coded writer-projection absence", async () => {
  server.use(
    http.get(`${apiBaseUrl}/documents/:documentId/writer-projection`, () =>
      HttpResponse.json(
        { code: DOCUMENT_NOT_FOUND_ERROR_CODE, error: "" },
        { status: 404, statusText: "Not Found" },
      ),
    ),
  );
  const client = new ApiClient(apiBaseUrl);

  const result = await client.getDocumentWriterProjectionResult("document-1", {
    reportErrors: false,
  });

  expect(result).toMatchObject({ ok: false, status: 404 });
  expect(result.ok ? undefined : result.code).toBeUndefined();
  expect(result.ok ? "" : result.message).toContain(
    "Invalid failure response body",
  );
});

testApiClient(
  "preserves validated Stripe checkout option codes without diagnostics",
  async () => {
    server.use(
      http.get(
        `${apiBaseUrl}/organizations/:organizationId/billing/stripe/options`,
        () =>
          HttpResponse.json(
            {
              code: BILLING_ERROR_CODES.rosterOverCapacity,
              error: "",
            },
            { status: 409, statusText: "Conflict" },
          ),
      ),
    );
    const client = new ApiClient(apiBaseUrl);

    const result = await client.getStripeCheckoutOptions("organization-1", {
      reportErrors: false,
    });

    expect(result).toMatchObject({
      code: BILLING_ERROR_CODES.rosterOverCapacity,
      ok: false,
      status: 409,
    });
  },
);

testApiClient(
  "legacy requests notify from validated operation failures",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/containers`, () =>
        HttpResponse.json(
          {
            error: "Organization cannot sync",
            organizationId: "organization-1",
            reason: "billing_inactive",
          },
          { status: 402, statusText: "Payment Required" },
        ),
      ),
    );
    const blockedOrganizations: (string | null)[] = [];
    const client = new ApiClient(apiBaseUrl);
    client.setOnPaymentRequired((organizationId) => {
      blockedOrganizations.push(organizationId);
    });

    await expect(
      client.createContainerResult(createContainerMutationRequest(), {
        expectedPaymentRequiredOrganizationId: "organization-1",
        reportErrors: false,
      }),
    ).resolves.toMatchObject({ ok: false, status: 402 });

    expect(blockedOrganizations).toEqual(["organization-1"]);
  },
);

testApiClient(
  "notifies from a validated payment target when its error is blank",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/containers`, () =>
        HttpResponse.json(
          {
            error: "   ",
            organizationId: "organization-1",
            reason: "billing_inactive",
          },
          { status: 402, statusText: "Payment Required" },
        ),
      ),
    );
    const blockedOrganizations: (string | null)[] = [];
    const client = new ApiClient(apiBaseUrl);
    client.setOnPaymentRequired((organizationId) => {
      blockedOrganizations.push(organizationId);
    });

    const result = await client.createContainerResult(
      createContainerMutationRequest(),
      {
        expectedPaymentRequiredOrganizationId: "organization-1",
        reportErrors: false,
      },
    );

    expect(result).toMatchObject({ ok: false, status: 402 });
    expect(result.ok ? "" : result.message).not.toContain(
      "Invalid failure response body",
    );
    expect(blockedOrganizations).toEqual(["organization-1"]);
  },
);

testApiClient(
  "validates payment failures without an organization callback binding",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/containers`, () =>
        HttpResponse.json(
          {
            error: "Organization cannot sync",
            organizationId: "organization-1",
            reason: "billing_inactive",
          },
          { status: 402, statusText: "Payment Required" },
        ),
      ),
    );
    const blockedOrganizations: (string | null)[] = [];
    const client = new ApiClient(apiBaseUrl);
    client.setOnPaymentRequired((organizationId) => {
      blockedOrganizations.push(organizationId);
    });

    const result = await client.createContainerResult(
      createContainerMutationRequest(),
      { reportErrors: false },
    );

    expect(result).toMatchObject({ ok: false, status: 402 });
    expect(result.ok ? "" : result.message).toContain(
      "Organization cannot sync",
    );
    expect(result.ok ? "" : result.message).not.toContain(
      "Invalid failure response body",
    );
    expect(blockedOrganizations).toEqual([]);
  },
);

testApiClient(
  "ignores malformed declared payment-required failures",
  async () => {
    server.use(
      http.post(`${apiBaseUrl}/documents/:documentId/sync`, () =>
        HttpResponse.json(
          {
            error: "Untrusted payment failure",
            organizationId: "organization-1",
          },
          { status: 402, statusText: "Payment Required" },
        ),
      ),
    );
    const blockedOrganizations: (string | null)[] = [];
    const client = new ApiClient(apiBaseUrl);
    client.setOnPaymentRequired((organizationId) => {
      blockedOrganizations.push(organizationId);
    });

    const result = await client.syncDocumentResult(
      "document-1",
      createDocumentSyncRequest(),
      {
        expectedPaymentRequiredOrganizationId: "organization-1",
        reportErrors: false,
      },
    );

    expect(result).toMatchObject({ ok: false, status: 402 });
    expect(result.ok ? "" : result.message).toContain(
      "Invalid failure response body",
    );
    expect(blockedOrganizations).toEqual([]);
  },
);

testApiClient(
  "ignores payment-shaped failures at undeclared statuses",
  async () => {
    server.use(
      http.get(`${apiBaseUrl}/auth/user-identity/:userId`, () =>
        HttpResponse.json(
          {
            error: "Untrusted payment failure",
            organizationId: "organization-1",
            reason: "billing_inactive",
          },
          { status: 402, statusText: "Payment Required" },
        ),
      ),
    );
    const blockedOrganizations: (string | null)[] = [];
    const client = new ApiClient(apiBaseUrl);
    client.setOnPaymentRequired((organizationId) => {
      blockedOrganizations.push(organizationId);
    });

    await expect(client.getUserIdentity("user-1")).resolves.toBeNull();

    expect(blockedOrganizations).toEqual([]);
  },
);
