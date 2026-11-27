import { expect, test } from "bun:test";
import { normalizeScenarioRoute } from "./routeNormalize";

test("normalizes keying, revocation, and baseline staging routes", () => {
  expect(
    normalizeScenarioRoute(
      "put",
      "http://127.0.0.1:4123/organizations/org-1/groups/grp-2/policy-commit",
    ),
  ).toBe("PUT /organizations/:organizationId/groups/:groupId/policy-commit");
  expect(
    normalizeScenarioRoute(
      "POST",
      "http://127.0.0.1:4123/containers/c-123/revoke",
    ),
  ).toBe("POST /containers/:containerId/revoke");
  expect(
    normalizeScenarioRoute(
      "PUT",
      "http://127.0.0.1:4123/documents/doc-1/baseline-stages/stg-9/segments/2/write-header",
    ),
  ).toBe(
    "PUT /documents/:documentId/baseline-stages/:stageId/segments/:index/write-header",
  );
  expect(
    normalizeScenarioRoute(
      "PUT",
      "http://127.0.0.1:4123/documents/doc-1/baseline-stages/stg-9/segments/2",
    ),
  ).toBe("PUT /documents/:documentId/baseline-stages/:stageId/segments/:index");
  expect(
    normalizeScenarioRoute(
      "GET",
      "http://127.0.0.1:4123/documents/doc-1/baseline-stages/stg-9?raw=1",
    ),
  ).toBe("GET /documents/:documentId/baseline-stages/:stageId");
  expect(
    normalizeScenarioRoute(
      "GET",
      "http://127.0.0.1:4123/principals/group/g-1/history?since=1",
    ),
  ).toBe("GET /principals/group/:principalId/history");
  expect(
    normalizeScenarioRoute(
      "POST",
      "/api/containers/550e8400-e29b-41d4-a716-446655440000/custom",
    ),
  ).toBe("POST /containers/:id/custom");
  expect(
    normalizeScenarioRoute(
      "POST",
      "http://127.0.0.1:4123/containers/c-1/rekey",
    ),
  ).toBe("POST /containers/:containerId/rekey");
  expect(
    normalizeScenarioRoute(
      "GET",
      "http://127.0.0.1:4123/containers/c-1/kek-log",
    ),
  ).toBe("GET /containers/:containerId/kek-log");
  expect(
    normalizeScenarioRoute(
      "PUT",
      "http://127.0.0.1:4123/containers/c-1/replacement-authorizations/org-old",
    ),
  ).toBe(
    "PUT /containers/:containerId/replacement-authorizations/:replacesOrganizationId",
  );
  expect(
    normalizeScenarioRoute(
      "GET",
      "http://127.0.0.1:4123/principals/group/g-1/policy/member-envelopes",
    ),
  ).toBe("GET /principals/group/:principalId/policy/member-envelopes");
  expect(
    normalizeScenarioRoute(
      "GET",
      "http://127.0.0.1:4123/organizations/org-1/policy-history",
    ),
  ).toBe("GET /organizations/:organizationId/policy-history");
  expect(
    normalizeScenarioRoute("POST", "http://127.0.0.1:4123/documents/d-1/purge"),
  ).toBe("POST /documents/:documentId/purge");
  expect(
    normalizeScenarioRoute(
      "GET",
      "http://127.0.0.1:4123/documents/d-1/purge-proof",
    ),
  ).toBe("GET /documents/:documentId/purge-proof");
  expect(
    normalizeScenarioRoute("DELETE", "http://127.0.0.1:4123/containers/c-1"),
  ).toBe("DELETE /containers/:containerId");
  expect(
    normalizeScenarioRoute(
      "POST",
      "http://127.0.0.1:4123/containers/with-metadata-document",
    ),
  ).toBe("POST /containers/with-metadata-document");
  expect(
    normalizeScenarioRoute(
      "GET",
      "http://127.0.0.1:4123/documents/d-1/attribution/ranges",
    ),
  ).toBe("GET /documents/:documentId/attribution/ranges");
});
