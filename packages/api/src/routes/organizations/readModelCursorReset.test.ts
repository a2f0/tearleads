import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isOrganizationReadModelResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { appendOrganizationReadModelChangeInTransaction } from "../../workflows/organizations/readModelChanges";
import {
  decodeOrganizationReadModelCursor,
  encodeOrganizationReadModelCursor,
} from "../../workflows/organizations/readModelCursor";
import { pruneOrganizationReadModelChangesInTransaction } from "../../workflows/organizations/readModelRetention";

async function registeredActor() {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, actor.userId));
  invariant(row, "expected registered user row");
  return { actor, organizationId: row.organizationId };
}

function readModelPath(organizationId: string, cursor?: string): string {
  const path = `/organizations/${organizationId}/read-model`;
  return cursor === undefined
    ? path
    : `${path}?${new URLSearchParams({ cursor }).toString()}`;
}

test("an ahead organization read-model cursor requests a reset snapshot", async () => {
  const { actor, organizationId } = await registeredActor();
  const response = await routeApp.request(
    readModelPath(
      organizationId,
      encodeOrganizationReadModelCursor(organizationId, 99n),
    ),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const body = await response.json();

  invariant(
    isOrganizationReadModelResponse(body),
    "expected organization read-model response",
  );
  expect(body.mode).toBe("snapshot");
});

test("an expired organization read-model cursor requests a reset snapshot", async () => {
  const { actor, organizationId } = await registeredActor();
  const initialResponse = await routeApp.request(
    readModelPath(organizationId),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const initial = await initialResponse.json();
  invariant(
    isOrganizationReadModelResponse(initial),
    "expected initial organization read model",
  );
  const initialCursor = decodeOrganizationReadModelCursor(
    initial.nextCursor,
    organizationId,
  );
  const currentCursor = initialCursor + 3n;
  await db.transaction(async (tx) => {
    for (let index = 0; index < 3; index += 1) {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        entityId: organizationId,
        lane: "directory",
        operation: "replace",
        organizationId,
      });
    }
    await pruneOrganizationReadModelChangesInTransaction({
      currentCursor,
      organizationId,
      retainedChangeCount: 1n,
      tx,
    });
  });

  const expiredResponse = await routeApp.request(
    readModelPath(organizationId, initial.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const expired = await expiredResponse.json();
  invariant(
    isOrganizationReadModelResponse(expired),
    "expected expired-cursor response",
  );
  expect(expired.mode).toBe("snapshot");

  const boundaryResponse = await routeApp.request(
    readModelPath(
      organizationId,
      encodeOrganizationReadModelCursor(organizationId, currentCursor - 1n),
    ),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const boundary = await boundaryResponse.json();
  invariant(
    isOrganizationReadModelResponse(boundary),
    "expected retained-boundary response",
  );
  expect(boundary.mode).toBe("delta");
  expect(boundary.lanes.directory).toBeDefined();
});
