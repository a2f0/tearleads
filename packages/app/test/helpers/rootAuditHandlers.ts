import type {
  RootAuditEventResponse,
  RootAuditEventsResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  ROOT_TEST_IDENTITIES,
  ROOT_TEST_ORGANIZATION,
} from "./rootConsoleFixtures";

const [operator, member] = ROOT_TEST_IDENTITIES;
if (!operator || !member) {
  throw new Error("Expected root test identities.");
}

/** Audit events served by `GET /root/audit-events`, newest first. */
const ROOT_TEST_AUDIT_EVENTS: ReadonlyArray<RootAuditEventResponse> = [
  {
    action: "root.identities.get",
    actorSigningKeyFingerprint: operator.signingKeyFingerprint,
    actorUserId: operator.userId,
    filter: null,
    id: "a0000000-0000-4000-8000-000000000001",
    occurredAt: "2026-10-22T12:00:00.000Z",
    sourceIpAddress: "198.51.100.4",
    targetOrganizationId: null,
    targetUserId: member.userId,
  },
  {
    action: "root.organizations.get",
    actorSigningKeyFingerprint: operator.signingKeyFingerprint,
    actorUserId: operator.userId,
    filter: null,
    id: "a0000000-0000-4000-8000-000000000002",
    occurredAt: "2026-10-22T11:00:00.000Z",
    sourceIpAddress: "198.51.100.4",
    targetOrganizationId: ROOT_TEST_ORGANIZATION.organization.organizationId,
    targetUserId: null,
  },
  {
    action: "root.access.grant",
    actorSigningKeyFingerprint: null,
    actorUserId: null,
    filter: null,
    id: "a0000000-0000-4000-8000-000000000003",
    occurredAt: "2026-10-22T10:00:00.000Z",
    sourceIpAddress: null,
    targetOrganizationId: null,
    targetUserId: operator.userId,
  },
  {
    action: "root.identities.list",
    actorSigningKeyFingerprint: operator.signingKeyFingerprint,
    actorUserId: operator.userId,
    filter: `fingerprint=${member.signingKeyFingerprint}`,
    id: "a0000000-0000-4000-8000-000000000004",
    occurredAt: "2026-10-22T09:00:00.000Z",
    sourceIpAddress: "198.51.100.4",
    targetOrganizationId: null,
    targetUserId: null,
  },
];

const PAGE_SIZE = 3;

export const rootAuditHandlers = [
  http.get("http://localhost:3001/root/audit-events", ({ request }) => {
    const query = new URL(request.url).searchParams;
    const subjectId = query.get("subjectId");
    const events = ROOT_TEST_AUDIT_EVENTS.filter(
      (event) =>
        subjectId === null ||
        [
          event.actorUserId,
          event.targetUserId,
          event.targetOrganizationId,
        ].includes(subjectId),
    );
    const start = query.get("cursor") === "page-2" ? PAGE_SIZE : 0;
    const page = events.slice(start, start + PAGE_SIZE);
    return HttpResponse.json<RootAuditEventsResponse>({
      events: page,
      nextCursor: start + PAGE_SIZE < events.length ? "page-2" : null,
    });
  }),
];
