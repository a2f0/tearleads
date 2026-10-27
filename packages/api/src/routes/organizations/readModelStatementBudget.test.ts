import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { isOrganizationReadModelResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function registeredOrganization(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return row.organizationId;
}

async function countedReadModelRequest(input: {
  readonly cursor?: string;
  readonly organizationId: string;
  readonly user: TestUser;
}) {
  const query =
    input.cursor === undefined
      ? ""
      : `?${new URLSearchParams({ cursor: input.cursor }).toString()}`;
  const counter = { statements: 0 };
  const response = await withDatabaseStatementCounter(counter, () =>
    routeApp.request(
      `/organizations/${input.organizationId}/read-model${query}`,
      { headers: { Authorization: `Bearer ${input.user.token}` } },
    ),
  );
  return { response, statements: counter.statements };
}

test("a read-model request verifies organization access once", async () => {
  const owner = createTestUser();
  const organizationId = await registeredOrganization(owner);
  const snapshot = await countedReadModelRequest({
    organizationId,
    user: owner,
  });
  const body = await snapshot.response.json();
  invariant(isOrganizationReadModelResponse(body), "expected read model");
  const delta = await countedReadModelRequest({
    cursor: body.nextCursor,
    organizationId,
    user: owner,
  });
  expect(delta.response.status).toBe(200);

  // Measured with PGlite / SQLite: snapshot 63 / 65 and empty delta 52 / 54
  // when access was verified both before and after the head lock; 39 / 41 and
  // 28 / 30 with a one-statement screen before the lock; empty delta 27 / 29
  // once lane stamps on the locked head row replaced the change-log read;
  // snapshot 38 / 40 once member rows stopped loading users for their keys.
  expect(snapshot.statements).toBeLessThanOrEqual(44);
  expect(delta.statements).toBeLessThanOrEqual(33);
});

test("an outsider is refused before signed access verification", async () => {
  const owner = createTestUser();
  const organizationId = await registeredOrganization(owner);
  const outsider = createTestUser();
  await registeredOrganization(outsider);

  const refused = await countedReadModelRequest({
    organizationId,
    user: outsider,
  });
  expect(refused.response.status).toBe(403);
  const missing = await countedReadModelRequest({
    organizationId: crypto.randomUUID(),
    user: outsider,
  });
  expect(missing.response.status).toBe(404);
  const member = await countedReadModelRequest({ organizationId, user: owner });
  expect(member.response.status).toBe(200);

  // Signed access verification alone costs over twenty statements.
  expect(refused.statements).toBeLessThan(member.statements - 20);
  expect(missing.statements).toBe(refused.statements);
});
