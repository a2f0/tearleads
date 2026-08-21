import { expect } from "bun:test";
import type { OrganizationBillingResponse } from "@symcrypt/validators/response";
import { HttpResponse, http } from "msw";
import {
  createOrganizationGroupRequest,
  createPrincipalPolicyBundleResponse,
  createPrincipalPolicyRequest,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const dataUsageOrganizationId = "11111111-1111-4111-8111-111111111111";
const organizationGroupId = "22222222-2222-4222-8222-222222222222";
const organizationRosterUserId = "33333333-3333-4333-8333-333333333333";
const principalPolicyId = "44444444-4444-4444-8444-444444444444";

function organizationDataUsageResponse() {
  return {
    organizationId: "org-1",
    blobs: {
      blobCount: 2,
      byteLength: 96,
    },
    documents: {
      breakdown: [
        {
          category: "containerMetadata",
          byteLength: 0,
          documentCount: 0,
          updateCount: 0,
        },
        {
          category: "rosterProfiles",
          byteLength: 0,
          documentCount: 0,
          updateCount: 0,
        },
        {
          category: "organizationMetadata",
          byteLength: 0,
          documentCount: 0,
          updateCount: 0,
        },
        {
          category: "user",
          byteLength: 32,
          documentCount: 1,
          updateCount: 2,
        },
      ],
      byteLength: 32,
      documentCount: 1,
      updateCount: 2,
    },
    totalByteLength: 128,
  };
}

function organizationBillingResponse(): OrganizationBillingResponse {
  return {
    activeMemberCount: 1,
    assignedSeatCount: 1,
    assignedUserIds: ["user-1"],
    currentUserHasSyncSeat: true,
    currentPeriodEndsAt: null,
    currentPeriodStartsAt: null,
    disabledAt: null,
    organizationId: "org-1",
    provider: "revenuecat",
    purgeAfter: null,
    seatCount: 1,
    pendingSeatCount: null,
    status: "active",
    trialEndsAt: null,
  };
}

testApiClient(
  "posts a native subscription claim to its store route",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.post(
        `${apiBaseUrl}/organizations/:organizationId/billing/native/:store/claim`,
        async ({ request }) => {
          calls.push(await captureHttpCall(request));
          return HttpResponse.json(organizationBillingResponse());
        },
      ),
    );

    const result = await new ApiClient(
      apiBaseUrl,
    ).claimNativeOrganizationSubscription("org-1", "app_store");
    expect(result).toEqual({ data: organizationBillingResponse(), ok: true });
    expect(calls).toEqual([
      {
        authorization: null,
        body: "",
        contentType: null,
        method: "POST",
        url: `${apiBaseUrl}/organizations/org-1/billing/native/app_store/claim`,
      },
    ]);
  },
);

testApiClient("coalesces only in-flight principal policy reads", async () => {
  let callCount = 0;
  const firstRequestStarted = createDeferred<void>();
  const finishFirstRequest = createDeferred<void>();
  const bundle = createPrincipalPolicyBundleResponse();
  server.use(
    http.get(`${apiBaseUrl}/principals/group/:groupId/policy`, async () => {
      callCount += 1;
      if (callCount === 1) {
        firstRequestStarted.resolve();
        await finishFirstRequest.promise;
      }
      return HttpResponse.json(bundle);
    }),
  );

  const client = new ApiClient(apiBaseUrl);
  const first = client.getCurrentPrincipalPolicy("group", principalPolicyId);
  await firstRequestStarted.promise;
  const concurrent = client.getCurrentPrincipalPolicy(
    "group",
    principalPolicyId,
  );
  finishFirstRequest.resolve();
  await expect(Promise.all([first, concurrent])).resolves.toEqual([
    bundle,
    bundle,
  ]);
  await expect(
    client.getCurrentPrincipalPolicy("group", principalPolicyId),
  ).resolves.toEqual(bundle);
  expect(callCount).toBe(2);
});

testApiClient(
  "uses organization manager and principal policy route namespaces",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.all(`${apiBaseUrl}/*`, async ({ request }) => {
        calls.push(await captureHttpCall(request));

        if (request.url.endsWith("/profile")) {
          return HttpResponse.json({
            organizationId: "org-1",
            profileDocumentId: null,
          });
        }
        if (request.url.endsWith("/data-usage")) {
          return HttpResponse.json(organizationDataUsageResponse());
        }
        if (request.url.endsWith("/members")) {
          return HttpResponse.json({
            organizationId: "org-1",
            groupId: "group-1",
            members: [],
          });
        }
        if (request.url.endsWith(`/roster/${organizationRosterUserId}`)) {
          return HttpResponse.json({
            userId: "user-1",
            signingKeyFingerprint: "signing-fingerprint",
            signingPublicKey: "signing-key",
            encapsulationPublicKey: "encapsulation-key",
            encapsulationKeyFingerprint: "encapsulation-fingerprint",
            createdAt: "2026-05-12T12:00:00.000Z",
            isSelf: true,
            status: "active",
            profileDocumentId: null,
            joinedAt: "2026-05-12T12:00:00.000Z",
            updatedAt: "2026-05-12T12:00:00.000Z",
            disabledAt: null,
            disabledByUserId: null,
          });
        }
        if (request.url.endsWith("/policy")) {
          return HttpResponse.json({
            ...createPrincipalPolicyBundleResponse(),
            ...(request.method === "PUT" ? { containerMutations: [] } : {}),
          });
        }
        if (request.method === "POST") {
          return HttpResponse.json({
            group: {
              groupId: "group-1",
              organizationId: "org-1",
              name: "Operators",
              createdAt: "2026-05-12T12:00:00.000Z",
              isBuiltin: false,
              currentState: {
                stateHash: "state-hash",
                version: 1,
                keyEpoch: 1,
                keyFingerprint: "key-fingerprint",
                memberCount: 1,
              },
            },
            organizationPolicy: {
              ...createPrincipalPolicyBundleResponse(),
              containerMutations: [],
            },
          });
        }
        if (request.method === "DELETE") {
          return HttpResponse.json({
            deleted: true,
            groupId: "group-1",
            organizationPolicy: {
              ...createPrincipalPolicyBundleResponse(),
              containerMutations: [],
            },
            organizationId: "org-1",
          });
        }

        return HttpResponse.json({
          organizationId: "org-1",
          memberGroupId: "member-group-1",
          groups: [],
        });
      }),
    );

    const client = new ApiClient(apiBaseUrl);
    const groupRequest = createOrganizationGroupRequest();
    const policyRequest = createPrincipalPolicyRequest();
    const authenticatedGroupRequest = {
      ...groupRequest,
      organizationPolicy: policyRequest,
    };

    expect(
      (await client.getOrganizationDataUsageResult(dataUsageOrganizationId)).ok,
    ).toBe(true);
    expect(
      await client.updateOrganizationRosterEntry(
        dataUsageOrganizationId,
        organizationRosterUserId,
        { profileDocumentId: null },
      ),
    ).not.toBeNull();
    expect(
      await client.updateOrganizationProfile(dataUsageOrganizationId, {
        profileDocumentId: null,
      }),
    ).not.toBeNull();
    expect(
      await client.createOrganizationGroup(
        dataUsageOrganizationId,
        authenticatedGroupRequest,
      ),
    ).not.toBeNull();
    expect(
      await client.deleteOrganizationGroup(
        dataUsageOrganizationId,
        organizationGroupId,
        { organizationPolicy: policyRequest },
      ),
    ).not.toBeNull();
    expect(
      await client.listOrganizationGroupMembers(
        dataUsageOrganizationId,
        organizationGroupId,
      ),
    ).not.toBeNull();
    expect(
      await client.putPrincipalPolicy(
        "organization",
        principalPolicyId,
        policyRequest,
      ),
    ).not.toBeNull();

    expect(
      calls.map((call) => ({
        body: call.body,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: null,
        input: `${apiBaseUrl}/organizations/${dataUsageOrganizationId}/data-usage`,
        method: "GET",
      },
      {
        body: JSON.stringify({ profileDocumentId: null }),
        input: `${apiBaseUrl}/organizations/${dataUsageOrganizationId}/roster/${organizationRosterUserId}`,
        method: "PUT",
      },
      {
        body: JSON.stringify({ profileDocumentId: null }),
        input: `${apiBaseUrl}/organizations/${dataUsageOrganizationId}/profile`,
        method: "PUT",
      },
      {
        body: JSON.stringify(authenticatedGroupRequest),
        input: `${apiBaseUrl}/organizations/${dataUsageOrganizationId}/groups`,
        method: "POST",
      },
      {
        body: JSON.stringify({ organizationPolicy: policyRequest }),
        input: `${apiBaseUrl}/organizations/${dataUsageOrganizationId}/groups/${organizationGroupId}`,
        method: "DELETE",
      },
      {
        body: null,
        input: `${apiBaseUrl}/organizations/${dataUsageOrganizationId}/groups/${organizationGroupId}/members`,
        method: "GET",
      },
      {
        body: JSON.stringify(policyRequest),
        input: `${apiBaseUrl}/principals/organization/${principalPolicyId}/policy`,
        method: "PUT",
      },
    ]);
  },
);

testApiClient(
  "returns typed organization data-usage failures without a nullable fallback",
  async () => {
    let responseKind: "forbidden" | "invalid" = "forbidden";
    server.use(
      http.get(`${apiBaseUrl}/organizations/:organizationId/data-usage`, () =>
        responseKind === "forbidden"
          ? HttpResponse.json({ error: "Forbidden" }, { status: 403 })
          : HttpResponse.json({
              ...organizationDataUsageResponse(),
              blobs: {
                ...organizationDataUsageResponse().blobs,
                unexpected: true,
              },
            }),
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const forbidden = await client.getOrganizationDataUsageResult(
      dataUsageOrganizationId,
      { reportErrors: false },
    );
    expect(forbidden).toMatchObject({
      kind: "http",
      ok: false,
      status: 403,
    });

    responseKind = "invalid";
    const invalid = await client.getOrganizationDataUsageResult(
      dataUsageOrganizationId,
      { reportErrors: false },
    );
    expect(invalid).toMatchObject({
      kind: "shape",
      ok: false,
      status: 200,
    });
  },
);
