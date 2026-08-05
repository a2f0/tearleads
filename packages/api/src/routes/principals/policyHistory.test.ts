import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("the retired principal policy-history route returns 404", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);

  const response = await routeApp.request(
    `/principals/group/${crypto.randomUUID()}/policy-history`,
    { headers: { Authorization: `Bearer ${user.token}` } },
  );

  expect(response.status).toBe(404);
});
