import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
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

test("an old organization read-model cursor replays only the lanes stamped after it", async () => {
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
  await db.transaction(async (tx) => {
    for (let index = 0; index < 3; index += 1) {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        lanes: ["directory"],
        organizationId,
      });
    }
  });

  // No retention window exists: any cursor at or below the head is a delta.
  const replayResponse = await routeApp.request(
    readModelPath(organizationId, initial.nextCursor),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const replay = await replayResponse.json();
  invariant(
    isOrganizationReadModelResponse(replay) && replay.mode === "delta",
    "expected old-cursor delta",
  );
  expect(Object.keys(replay.lanes)).toEqual(["directory"]);
  expect(
    decodeOrganizationReadModelCursor(replay.nextCursor, organizationId),
  ).toBe(initialCursor + 3n);

  const lastChangeResponse = await routeApp.request(
    readModelPath(
      organizationId,
      encodeOrganizationReadModelCursor(organizationId, initialCursor + 2n),
    ),
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  const lastChange = await lastChangeResponse.json();
  invariant(
    isOrganizationReadModelResponse(lastChange) && lastChange.mode === "delta",
    "expected last-change delta",
  );
  expect(lastChange.lanes.directory).toEqual(replay.lanes.directory);
});
