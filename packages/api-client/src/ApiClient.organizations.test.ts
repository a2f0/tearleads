import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createOrganizationGroupRequest,
  createOrganizationGroupSummary,
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
  "caches organization group lists and invalidates on group changes",
  async () => {
    const calls: CapturedHttpCall[] = [];
    const groupCreateStarted = createDeferred<void>();
    const finishGroupCreate = createDeferred<void>();
    server.use(
      http.get(
        `${apiBaseUrl}/organizations/:organizationId/groups`,
        async ({ params, request }) => {
          calls.push(await captureHttpCall(request));
          const { organizationId } = params as { organizationId: string };
          return HttpResponse.json({
            organizationId,
            memberGroupId: "member-group-1",
            groups: [createOrganizationGroupSummary(organizationId)],
          });
        },
      ),
      http.post(
        `${apiBaseUrl}/organizations/:organizationId/groups`,
        async ({ params, request }) => {
          calls.push(await captureHttpCall(request));
          groupCreateStarted.resolve();
          await finishGroupCreate.promise;
          const { organizationId } = params as { organizationId: string };
          return HttpResponse.json(
            createOrganizationGroupSummary(organizationId),
          );
        },
      ),
      http.delete(
        `${apiBaseUrl}/organizations/:organizationId/groups/:groupId`,
        async ({ params, request }) => {
          calls.push(await captureHttpCall(request));
          const { groupId, organizationId } = params as {
            groupId: string;
            organizationId: string;
          };
          return HttpResponse.json({ deleted: true, groupId, organizationId });
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const first = await client.listOrganizationGroups("org-1");
    const second = await client.listOrganizationGroups("org-1");
    expect(second).toEqual(first);

    const createdGroup = client.createOrganizationGroup(
      "org-1",
      createOrganizationGroupRequest(),
    );
    await groupCreateStarted.promise;
    const duringGroupCreate = await client.listOrganizationGroups("org-1");
    expect(duringGroupCreate).toEqual(first);

    finishGroupCreate.resolve();
    await expect(createdGroup).resolves.not.toBeNull();
    const third = await client.listOrganizationGroups("org-1");
    expect(third).toEqual(first);
    await expect(
      client.deleteOrganizationGroup("org-1", "group-1"),
    ).resolves.toEqual({
      deleted: true,
      groupId: "group-1",
      organizationId: "org-1",
    });
    const fourth = await client.listOrganizationGroups("org-1");
    expect(fourth).toEqual(first);

    expect(
      calls.map((call) => ({
        body: call.body,
        input: call.url,
        method: call.method,
      })),
    ).toEqual([
      {
        body: null,
        input: `${apiBaseUrl}/organizations/org-1/groups`,
        method: "GET",
      },
      {
        body: JSON.stringify(createOrganizationGroupRequest()),
        input: `${apiBaseUrl}/organizations/org-1/groups`,
        method: "POST",
      },
      {
        body: null,
        input: `${apiBaseUrl}/organizations/org-1/groups`,
        method: "GET",
      },
      {
        body: "",
        input: `${apiBaseUrl}/organizations/org-1/groups/group-1`,
        method: "DELETE",
      },
      {
        body: null,
        input: `${apiBaseUrl}/organizations/org-1/groups`,
        method: "GET",
      },
    ]);
  },
);

testApiClient(
  "uses organization manager and principal policy route namespaces",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.all(`${apiBaseUrl}/*`, async ({ request }) => {
        calls.push(await captureHttpCall(request));

        if (request.url.endsWith("/directory")) {
          return HttpResponse.json({
            organizationId: "org-1",
            profileDocumentId: null,
            currentUser: { isOrgAdmin: true },
            users: [],
          });
        }
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
        if (request.url.endsWith("/containers")) {
          return HttpResponse.json({
            organizationId: "org-1",
            groupId: "group-1",
            containers: [
              {
                accessLevel: "admin",
                containerId: "container-1",
                createdAt: "2026-05-12T12:00:00.000Z",
                depth: 0,
                isBuiltin: false,
                metadataAccessEpoch: 1,
                metadataAccessStateHash: "access-state-hash",
                metadataDocumentId: "metadata-document-1",
                parentId: null,
                updatedAt: "2026-05-12T12:00:00.000Z",
              },
            ],
          });
        }
        if (request.url.endsWith("/grants")) {
          return HttpResponse.json({
            organizationId: "org-1",
            grants: [
              {
                accessLevel: "admin",
                containerId: "container-1",
                createdAt: "2026-05-12T12:00:00.000Z",
                depth: 0,
                isBuiltin: false,
                metadataAccessEpoch: 1,
                metadataAccessStateHash: "access-state-hash",
                metadataDocumentId: "metadata-document-1",
                parentId: null,
                updatedAt: "2026-05-12T12:00:00.000Z",
                subjectType: "group",
                subjectId: "group-1",
                userId: null,
                signingKeyFingerprint: null,
                groupId: "group-1",
                groupName: "Operators",
                organizationName: null,
              },
            ],
          });
        }
        if (request.url.endsWith("/users/user-1/detail")) {
          return HttpResponse.json({
            organizationId: "org-1",
            user: {
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
            },
            groups: [
              {
                groupId: "group-1",
                organizationId: "org-1",
                name: "Operators",
                createdAt: "2026-05-12T12:00:00.000Z",
                isBuiltin: false,
                currentState: null,
              },
            ],
            grants: {
              directGrants: [],
              groupGrants: [
                {
                  accessLevel: "admin",
                  containerId: "container-1",
                  createdAt: "2026-05-12T12:00:00.000Z",
                  depth: 0,
                  isBuiltin: false,
                  metadataAccessEpoch: 1,
                  metadataAccessStateHash: "access-state-hash",
                  metadataDocumentId: "metadata-document-1",
                  parentId: null,
                  updatedAt: "2026-05-12T12:00:00.000Z",
                  subjectType: "group",
                  subjectId: "group-1",
                  userId: null,
                  signingKeyFingerprint: null,
                  groupId: "group-1",
                  groupName: "Operators",
                  organizationName: null,
                },
              ],
              organizationGrants: [],
            },
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

    expect(await client.listOrganizationDirectory("org-1")).not.toBeNull();
    expect(await client.getOrganizationDataUsage("org-1")).not.toBeNull();
    expect(await client.listOrganizationGroups("org-1")).not.toBeNull();
    expect(
      await client.listOrganizationContainerGrants("org-1"),
    ).not.toBeNull();
    expect(
      await client.getOrganizationUserDetail("org-1", "user-1"),
    ).not.toBeNull();
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
      await client.listOrganizationGroupContainers("org-1", "group-1"),
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
        input: `${apiBaseUrl}/organizations/org-1/directory`,
        method: "GET",
      },
      {
        body: null,
        input: `${apiBaseUrl}/organizations/org-1/data-usage`,
        method: "GET",
      },
      {
        body: null,
        input: `${apiBaseUrl}/organizations/org-1/groups`,
        method: "GET",
      },
      {
        body: null,
        input: `${apiBaseUrl}/organizations/org-1/grants`,
        method: "GET",
      },
      {
        body: null,
        input: `${apiBaseUrl}/organizations/org-1/users/user-1/detail`,
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
        body: null,
        input: `${apiBaseUrl}/organizations/org-1/groups/group-1/containers`,
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
