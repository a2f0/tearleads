import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client/types";
import { createMockApiClient } from "@tearleads/test-utils";
import type { PendingBlobDeletionsResponse } from "@tearleads/validators/response";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { denyOrganizationPresentationAccess } from "../../workflows/organizations/readModel/organizationPresentationAccessState";
import { listPendingBlobDeletions } from "./pendingBlobDeletions";

function fixture() {
  const pending =
    Promise.withResolvers<RequestResult<PendingBlobDeletionsResponse>>();
  let calls = 0;
  let current = createWorkflowInputFixture({
    apiClient: createMockApiClient({
      listOrganizationPendingBlobDeletionsResult: () => {
        calls += 1;
        return pending.promise;
      },
    }),
    auth: { organizationId: "org", userId: "admin" },
    execSql: async () => [],
  });
  const service = createInternalRuntimeFixture(() => current);
  return {
    service,
    pending,
    calls: () => calls,
    changeSession: () => {
      current = { ...current, auth: { ...current.auth, userId: "other" } };
    },
    denyAccess: () =>
      denyOrganizationPresentationAccess(
        {
          execSql: current.infra.execSql,
          organizationId: "org",
          requesterUserId: "admin",
        },
        ["readModel", "usage"],
      ),
  };
}

for (const change of ["changeSession", "denyAccess"] as const) {
  test(`pending deletion reply is discarded after ${change}`, async () => {
    const f = fixture();
    const request = listPendingBlobDeletions(f.service, "org");
    f[change]();
    f.pending.resolve({ ok: true, data: { blobs: [], nextAfterId: "opaque" } });
    expect(await request).toEqual({
      ok: false,
      status: null,
      message:
        "The session or organization access changed while the request was in flight.",
    });
  });
}

test("inactive organization does not dispatch and successful snapshots are not cached", async () => {
  const f = fixture();
  expect((await listPendingBlobDeletions(f.service, "other")).ok).toBe(false);
  expect(f.calls()).toBe(0);
  const page = { blobs: [], nextAfterId: "opaque" };
  f.pending.resolve({ ok: true, data: page });
  expect(await listPendingBlobDeletions(f.service, "org")).toEqual({
    ok: true,
    data: page,
  });
  await listPendingBlobDeletions(f.service, "org");
  expect(f.calls()).toBe(2);
});

test("server denial keeps status and message without exposing transport internals", async () => {
  const f = fixture();
  f.pending.resolve({
    ok: false,
    kind: "http",
    status: 403,
    message: "Admin access required",
    method: "GET",
    path: "/organizations/org/blobs/pending-deletion",
    statusText: "Forbidden",
    report: () => {},
  });
  expect(await listPendingBlobDeletions(f.service, "org")).toEqual({
    ok: false,
    status: 403,
    message: "Admin access required",
  });
});
