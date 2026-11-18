import { expect, test } from "bun:test";
import { type ApiDatabase, db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { createOrganizationRequestBody } from "../../../test/helpers/api";
import { createRegistrationRequestBody } from "../../../test/helpers/api/submitRegistration";
import { API_TEST_IDENTITY_TRUST_DOMAIN } from "../../../test/helpers/policyProjection";
import { registerUser as registerTestUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { runCreateOrganizationWorkflow } from "../../workflows/organizations/createOrganization";
import { registerUser } from "./registration";

/**
 * The database, recording in order each transaction's start and successful
 * commit and each root-level raw query. Registration issues one such query:
 * the commit position read.
 */
function observedDatabase(options: { readonly failRootReads?: boolean }) {
  const events: ("begin" | "commit" | "read")[] = [];
  // The first column of each root-level read's first row, as the server read it.
  const readValues: unknown[] = [];
  const observed: ApiDatabase = new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return async (...args: Parameters<ApiDatabase["transaction"]>) => {
          events.push("begin");
          const result = await target.transaction(...args);
          events.push("commit");
          return result;
        };
      }
      if (property === "execute") {
        return async (...args: Parameters<ApiDatabase["execute"]>) => {
          events.push("read");
          if (options.failRootReads)
            throw new Error("WAL position unavailable");
          const result = await target.execute(...args);
          readValues.push(Object.values(result.rows[0] ?? {})[0]);
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { events, observed, readValues };
}

async function registrationRequest() {
  const user = createTestUser();
  return createRegistrationRequestBody(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
  );
}

test("registration reads its commit position after the transaction commits", async () => {
  const { events, observed, readValues } = observedDatabase({});
  const response = await registerUser(
    createServiceTestRuntime(observed),
    await registrationRequest(),
  );
  expect(events).toEqual(["begin", "commit", "read"]);
  expect(response.commitLsnMode).toBe("tracked");
  expect(response.commitLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/u);
  // Exactly the position the post-commit read returned, not an older one.
  expect(readValues).toEqual([response.commitLsn]);
});

test("organization creation reports no commit position", async () => {
  const user = createTestUser();
  await registerTestUser(user);
  const { events, observed } = observedDatabase({});
  const response = await runCreateOrganizationWorkflow(
    observed,
    await createOrganizationRequestBody(user),
    API_TEST_IDENTITY_TRUST_DOMAIN,
  );
  // Another session of the creator could edit the new seeded documents
  // before this device subscribes, so no position lets it skip a read.
  expect(events).toEqual(["begin", "commit"]);
  expect(response).not.toHaveProperty("commitLsn");
  expect(response).not.toHaveProperty("commitLsnMode");
});

test("a failed commit position read still acknowledges the committed registration", async () => {
  const { events, observed } = observedDatabase({ failRootReads: true });
  const request = await registrationRequest();
  const response = await registerUser(
    createServiceTestRuntime(observed),
    request,
  );
  expect(events).toEqual(["begin", "commit", "read"]);
  expect(response).toMatchObject({
    commitLsn: null,
    commitLsnMode: "tracked",
    userId: request.userId,
  });
  expect(response.challenge.length).toBeGreaterThan(0);
  expect(
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, request.userId)),
  ).toEqual([{ id: request.userId }]);
});
