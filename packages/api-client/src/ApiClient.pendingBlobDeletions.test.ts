import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const organizationId = "11111111-1111-4111-8111-111111111111";
const blob = {
  blobId: "22222222-2222-1222-8222-222222222222",
  organizationId,
  byteLength: 123,
  status: "eligible" as const,
  dereferencedAt: "2026-11-10T00:00:00.000Z",
  eligibleAfter: "2026-11-11T00:00:00.000Z",
  reclaimAttemptedAt: null,
  prunedAt: null,
  objectDeleteAttemptedAt: null,
};

for (const scope of ["root", "organization"] as const) {
  const path =
    scope === "root"
      ? "/root/blobs/pending-deletion"
      : `/organizations/${organizationId}/blobs/pending-deletion`;
  const request = (client: ApiClient) =>
    scope === "root"
      ? client.listRootPendingBlobDeletionsResult({
          cursor: "opaque +/",
          limit: 1,
          organizationId,
        })
      : client.listOrganizationPendingBlobDeletionsResult(organizationId, {
          cursor: "opaque +/",
          limit: 1,
        });

  testApiClient(
    `${scope} pending deletion validates pagination and lifecycle fields`,
    async () => {
      let invalid = false;
      server.use(
        http.get(`${apiBaseUrl}${path}`, ({ request }) => {
          expect(new URL(request.url).searchParams.get("cursor")).toBe(
            "opaque +/",
          );
          return HttpResponse.json({
            blobs: [{ ...blob, byteLength: invalid ? -1 : blob.byteLength }],
            nextAfterId: "continuation",
          });
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      expect(await request(client)).toEqual({
        ok: true,
        data: { blobs: [blob], nextAfterId: "continuation" },
      });
      invalid = true;
      expect((await request(client)).ok).toBe(false);
    },
  );
}
