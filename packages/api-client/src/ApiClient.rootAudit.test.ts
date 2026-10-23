import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const subjectId = "11111111-1111-4111-8111-111111111111";
const event = {
  action: "root.identities.get" as const,
  actorSigningKeyFingerprint: "ab".repeat(32),
  actorUserId: "22222222-2222-4222-8222-222222222222",
  filter: null,
  id: "33333333-3333-4333-8333-333333333333",
  occurredAt: "2026-10-22T00:00:00.000Z",
  sourceIpAddress: "198.51.100.4",
  targetOrganizationId: null,
  targetUserId: subjectId,
};

testApiClient(
  "root audit transport encodes the subject filter and decodes events",
  async () => {
    server.use(
      http.get(`${apiBaseUrl}/root/audit-events`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("subjectId")).toBe(subjectId);
        expect(query.get("cursor")).toBe("opaque");
        return HttpResponse.json({ events: [event], nextCursor: null });
      }),
    );
    const client = new ApiClient(apiBaseUrl);
    expect(
      await client.listRootAuditEventsResult({ cursor: "opaque", subjectId }),
    ).toEqual({ ok: true, data: { events: [event], nextCursor: null } });
  },
);

testApiClient("root audit transport rejects unknown actions", async () => {
  server.use(
    http.get(`${apiBaseUrl}/root/audit-events`, () =>
      HttpResponse.json({
        events: [{ ...event, action: "root.unknown" }],
        nextCursor: null,
      }),
    ),
  );
  const client = new ApiClient(apiBaseUrl);
  expect((await client.listRootAuditEventsResult()).ok).toBe(false);
});
