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
 * The database, recording whether each root-level raw query ran while a
 * transaction was open. Provisioning issues one: the commit position read.
 */
function observedDatabase(options: { readonly failRootReads?: boolean }) {
  const rootReads: { readonly duringTransaction: boolean }[] = [];
  let openTransactions = 0;
  const observed: ApiDatabase = new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return async (...args: Parameters<ApiDatabase["transaction"]>) => {
          openTransactions += 1;
          try {
            return await target.transaction(...args);
          } finally {
            openTransactions -= 1;
          }
        };
      }
      if (property === "execute") {
        return async (...args: Parameters<ApiDatabase["execute"]>) => {
          rootReads.push({ duringTransaction: openTransactions > 0 });
          if (options.failRootReads)
            throw new Error("WAL position unavailable");
          return target.execute(...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { observed, rootReads };
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
  const { observed, rootReads } = observedDatabase({});
  const response = await registerUser(
    createServiceTestRuntime(observed),
    await registrationRequest(),
  );
  expect(rootReads).toEqual([{ duringTransaction: false }]);
  expect(response.commitLsnMode).toBe("tracked");
  expect(response.commitLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/u);
});

test("organization creation reads its commit position after the transaction commits", async () => {
  const user = createTestUser();
  await registerTestUser(user);
  const { observed, rootReads } = observedDatabase({});
  const response = await runCreateOrganizationWorkflow(
    observed,
    await createOrganizationRequestBody(user),
    API_TEST_IDENTITY_TRUST_DOMAIN,
  );
  expect(rootReads).toEqual([{ duringTransaction: false }]);
  expect(response.commitLsnMode).toBe("tracked");
  expect(response.commitLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/u);
});

test("a failed commit position read still acknowledges the committed registration", async () => {
  const { observed, rootReads } = observedDatabase({ failRootReads: true });
  const request = await registrationRequest();
  const response = await registerUser(
    createServiceTestRuntime(observed),
    request,
  );
  expect(rootReads).toEqual([{ duringTransaction: false }]);
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
