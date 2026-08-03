import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

testApiClient(
  "returns typed organization read-model results with opaque cursors",
  async () => {
    const calls: CapturedHttpCall[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/organizations/:organizationId/read-model`,
        async ({ params, request }) => {
          calls.push(await captureHttpCall(request));
          const { organizationId } = params as { organizationId: string };
          return HttpResponse.json({
            version: 5,
            mode: "snapshot",
            organizationId,
            nextCursor: "next-cursor",
            hasMore: false,
            currentUser: { isOrgAdmin: true },
            lanes: {
              directory: {
                organizationId,
                profileDocumentId: null,
                users: [],
              },
              grants: {
                organizationId,
                grants: [],
              },
              groupMemberships: {
                organizationId,
                deletedGroupIds: [],
                groups: [
                  {
                    groupId: "member-group-1",
                    stateHash: "member-group-state-1",
                    members: [],
                  },
                ],
              },
              groups: {
                organizationId,
                memberGroupId: "member-group-1",
                groups: [],
              },
              organizationPolicy: {
                organizationId,
                currentState: {
                  stateHash: "organization-state-1",
                  version: 1,
                  keyEpoch: 1,
                  keyFingerprint: "organization-key-fingerprint-1",
                  memberCount: 1,
                },
              },
            },
          });
        },
      ),
    );

    const client = new ApiClient(apiBaseUrl);
    const result = await client.getOrganizationReadModelResult(
      "org/1",
      "opaque+/=cursor",
      { reportErrors: false },
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `${apiBaseUrl}/organizations/org%2F1/read-model?cursor=opaque%2B%2F%3Dcursor`,
    );
  },
);
