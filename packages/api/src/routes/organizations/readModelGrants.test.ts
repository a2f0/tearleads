import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { users } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { isOrganizationReadModelResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { appendOrganizationReadModelChangeInTransaction } from "../../workflows/organizations/readModelChanges";

test("grants invalidations hydrate the whole organization lane", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const [user] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, actor.userId));
  invariant(user, "expected registered user row");
  const path = `/organizations/${user.organizationId}/read-model`;
  const headers = { Authorization: `Bearer ${actor.token}` };
  const snapshotResponse = await routeApp.request(path, { headers });
  const snapshot = await snapshotResponse.json();
  invariant(
    isOrganizationReadModelResponse(snapshot) && snapshot.mode === "snapshot",
    "expected grants snapshot",
  );

  await db.transaction((tx) =>
    appendOrganizationReadModelChangeInTransaction(tx, {
      organizationId: user.organizationId,
      lane: "grants",
      entityId: user.organizationId,
      operation: "replace",
    }),
  );
  const cursorQuery = new URLSearchParams({ cursor: snapshot.nextCursor });
  const deltaResponse = await routeApp.request(`${path}?${cursorQuery}`, {
    headers,
  });
  const delta = await deltaResponse.json();
  invariant(
    isOrganizationReadModelResponse(delta) && delta.mode === "delta",
    "expected grants delta",
  );
  expect(delta.lanes).toEqual({ grants: snapshot.lanes.grants });
});
