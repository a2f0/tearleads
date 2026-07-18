import { expect } from "bun:test";
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
  const first = client.getCurrentPrincipalPolicy("group", "group-1");
  await firstRequestStarted.promise;
  const concurrent = client.getCurrentPrincipalPolicy("group", "group-1");
  finishFirstRequest.resolve();
  await expect(Promise.all([first, concurrent])).resolves.toEqual([
    bundle,
    bundle,
  ]);
  await expect(
    client.getCurrentPrincipalPolicy("group", "group-1"),
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
          return HttpResponse.json({
            organizationId: "org-1",
            blobs: {
              blobCount: 2,
              byteLength: 96,
            },
            documents: {
              breakdown: [
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
          });
        }
        if (request.url.endsWith("/members")) {
          return HttpResponse.json({
            organizationId: "org-1",
            groupId: "group-1",
            members: [],
          });
        }
        if (request.url.endsWith("/roster/user-1")) {
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
          return HttpResponse.json(createPrincipalPolicyBundleResponse());
        }
        if (request.method === "POST") {
          return HttpResponse.json({
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
          });
        }
        if (request.method === "DELETE") {
          return HttpResponse.json({
            deleted: true,
            groupId: "group-1",
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

    expect(await client.getOrganizationDataUsage("org-1")).not.toBeNull();
    expect(
      await client.updateOrganizationRosterEntry("org-1", "user-1", {
        profileDocumentId: null,
      }),
    ).not.toBeNull();
    expect(
      await client.updateOrganizationProfile("org-1", {
        profileDocumentId: null,
      }),
    ).not.toBeNull();
    expect(
      await client.createOrganizationGroup("org-1", groupRequest),
    ).not.toBeNull();
    expect(
      await client.deleteOrganizationGroup("org-1", "group-1"),
    ).not.toBeNull();
    expect(
      await client.listOrganizationGroupMembers("org-1", "group-1"),
    ).not.toBeNull();
    expect(
      await client.putPrincipalPolicy("group", "group-1", policyRequest),
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
        input: `${apiBaseUrl}/organizations/org-1/data-usage`,
        method: "GET",
      },
      {
        body: JSON.stringify({ profileDocumentId: null }),
        input: `${apiBaseUrl}/organizations/org-1/roster/user-1`,
        method: "PUT",
      },
      {
        body: JSON.stringify({ profileDocumentId: null }),
        input: `${apiBaseUrl}/organizations/org-1/profile`,
        method: "PUT",
      },
      {
        body: JSON.stringify(groupRequest),
        input: `${apiBaseUrl}/organizations/org-1/groups`,
        method: "POST",
      },
      {
        body: "",
        input: `${apiBaseUrl}/organizations/org-1/groups/group-1`,
        method: "DELETE",
      },
      {
        body: null,
        input: `${apiBaseUrl}/organizations/org-1/groups/group-1/members`,
        method: "GET",
      },
      {
        body: JSON.stringify(policyRequest),
        input: `${apiBaseUrl}/principals/group/group-1/policy`,
        method: "PUT",
      },
    ]);
  },
);
