import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers, users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("GET /containers surfaces the owner root container after a peer joins the admin group", async () => {
  const owner = createTestUser();
  const peer = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(peer);
  await authenticate(peer);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner user row");

  // Before joining: peer only sees their own root container.
  const beforeResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: { Authorization: `Bearer ${peer.token}` },
  });
  expect(beforeResponse.status).toBe(200);
  const beforeBody = await beforeResponse.json();
  expect(
    beforeBody.items.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);

  await addUserToAdminGroup({
    actor: owner,
    member: peer,
    organizationId: ownerRow.organizationId,
  });

  // After joining the admin group, the owner's root container (granted to the
  // admin group at registration) should be reachable for the peer.
  const afterResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: { Authorization: `Bearer ${peer.token}` },
  });
  expect(afterResponse.status).toBe(200);
  const afterBody = await afterResponse.json();
  expect(
    afterBody.items.map((container: { id: string }) => container.id),
  ).toContain(owner.rootContainerId);
});

test("GET /containers root lane resume hides a newly shared root behind a stale watermark", async () => {
  const owner = createTestUser();
  const peer = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(peer);
  await authenticate(peer);

  const [ownerRow] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner user row");

  // A warm-cache peer keeps a root-lane watermark from a prior sync. Joining a
  // group does not bump the owner root container's updatedAt, so the resume
  // query (updatedAt, id) > (watermark) filters the newly granted root out.
  const [ownerRootRow] = await db
    .select({ updatedAt: containers.updatedAt })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  invariant(ownerRootRow, "expected owner root container row");
  const staleWatermarkUpdatedAt = new Date(
    new Date(ownerRootRow.updatedAt).getTime() + 1,
  ).toISOString();

  await addUserToAdminGroup({
    actor: owner,
    member: peer,
    organizationId: ownerRow.organizationId,
  });

  // Without a watermark, the peer sees the shared root (proven above).
  const freshResponse = await routeApp.request("/containers?parentId=null", {
    method: "GET",
    headers: { Authorization: `Bearer ${peer.token}` },
  });
  expect(freshResponse.status).toBe(200);
  const freshBody = await freshResponse.json();
  expect(
    freshBody.items.map((container: { id: string }) => container.id),
  ).toContain(owner.rootContainerId);

  // Resuming from the stale watermark, the refresh re-probe returns nothing new
  // and the share never appears — the real-app symptom.
  const resumeResponse = await routeApp.request(
    `/containers?parentId=null&watermarkUpdatedAt=${encodeURIComponent(
      staleWatermarkUpdatedAt,
    )}&watermarkId=${encodeURIComponent(crypto.randomUUID())}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${peer.token}` },
    },
  );
  expect(resumeResponse.status).toBe(200);
  const resumeBody = await resumeResponse.json();
  expect(
    resumeBody.items.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);
});
