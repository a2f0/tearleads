import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
  createOrganizationGroupRequest,
  createPrincipalPolicyBundleResponse,
  createPrincipalPolicyRequest,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const organizationId = "11111111-1111-4111-8111-111111111111";

function policyBundle(stateHash: string) {
  const bundle = createPrincipalPolicyBundleResponse();
  return {
    ...bundle,
    currentState: { ...bundle.currentState, stateHash },
  };
}

function groupMutationResponse(
  groupId: string,
  organizationPolicy: ReturnType<typeof policyBundle>,
) {
  return {
    group: {
      createdAt: "2026-05-12T12:00:00.000Z",
      currentState: {
        keyEpoch: 1,
        keyFingerprint: "key-fingerprint",
        memberCount: 1,
        stateHash: "group-state-hash",
        version: 1,
      },
      groupId,
      isBuiltin: false,
      name: "Operators",
      organizationId,
    },
    organizationPolicy: { ...organizationPolicy, containerMutations: [] },
  };
}

async function assertMutationEvictsInFlightPolicyReads(
  mutation: "create" | "delete",
) {
  const groupRequest = createOrganizationGroupRequest();
  const groupId = groupRequest.groupId;
  const policyRequest = createPrincipalPolicyRequest();
  const stale = policyBundle("stale-state-hash");
  const fresh = policyBundle("fresh-state-hash");
  const organizationReadStarted = createDeferred<void>();
  const groupReadStarted = createDeferred<void>();
  const releaseStaleReads = createDeferred<void>();
  const policyReadCounts = new Map<string, number>();
  let containerProjectionReads = 0;
  let documentProjectionReads = 0;

  server.use(
    http.get(
      `${apiBaseUrl}/principals/:principalType/:principalId/policy`,
      async ({ params }) => {
        const { principalId, principalType } = params;
        const key = `${principalType}:${principalId}`;
        const count = (policyReadCounts.get(key) ?? 0) + 1;
        policyReadCounts.set(key, count);
        if (count === 1) {
          if (principalType === "organization") {
            organizationReadStarted.resolve();
          } else {
            groupReadStarted.resolve();
          }
          await releaseStaleReads.promise;
          return HttpResponse.json(stale);
        }
        return HttpResponse.json(fresh);
      },
    ),
    http.get(`${apiBaseUrl}/containers/:containerId/writer-projection`, () => {
      containerProjectionReads += 1;
      return HttpResponse.json(createContainerWriterProjectionResponse());
    }),
    http.get(`${apiBaseUrl}/documents/:documentId/writer-projection`, () => {
      documentProjectionReads += 1;
      return HttpResponse.json(createDocumentWriterProjectionResponse());
    }),
    http.post(`${apiBaseUrl}/organizations/:organizationId/groups`, () =>
      HttpResponse.json(groupMutationResponse(groupId, fresh)),
    ),
    http.delete(
      `${apiBaseUrl}/organizations/:organizationId/groups/:groupId`,
      () =>
        HttpResponse.json({
          deleted: true,
          groupId,
          organizationId,
          organizationPolicy: { ...fresh, containerMutations: [] },
        }),
    ),
  );

  const client = new ApiClient(apiBaseUrl);
  const staleOrganizationRead = client.getCurrentPrincipalPolicy(
    "organization",
    organizationId,
  );
  const staleGroupRead = client.getCurrentPrincipalPolicy("group", groupId);
  await Promise.all([
    organizationReadStarted.promise,
    groupReadStarted.promise,
  ]);

  if (mutation === "create") {
    await client.getContainerWriterProjection("container-1");
    await client.getDocumentWriterProjection("document-1");
    await client.createOrganizationGroup(organizationId, {
      ...groupRequest,
      organizationPolicy: policyRequest,
    });
  } else {
    await client.deleteOrganizationGroup(organizationId, groupId, {
      organizationPolicy: policyRequest,
    });
  }

  const freshOrganizationRead = client.getCurrentPrincipalPolicy(
    "organization",
    organizationId,
  );
  const freshGroupRead = client.getCurrentPrincipalPolicy("group", groupId);
  releaseStaleReads.resolve();

  await expect(
    Promise.all([freshOrganizationRead, freshGroupRead]),
  ).resolves.toEqual([fresh, fresh]);
  await expect(
    Promise.all([staleOrganizationRead, staleGroupRead]),
  ).resolves.toEqual([stale, stale]);
  expect(policyReadCounts).toEqual(
    new Map([
      [`organization:${organizationId}`, 2],
      [`group:${groupId}`, 2],
    ]),
  );

  if (mutation === "create") {
    await client.getContainerWriterProjection("container-1");
    await client.getDocumentWriterProjection("document-1");
    expect(containerProjectionReads).toBe(2);
    expect(documentProjectionReads).toBe(2);
  }
}

testApiClient(
  "group creation evicts in-flight policy reads and writer projections",
  () => assertMutationEvictsInFlightPolicyReads("create"),
);

testApiClient("group deletion evicts in-flight policy reads", () =>
  assertMutationEvictsInFlightPolicyReads("delete"),
);
