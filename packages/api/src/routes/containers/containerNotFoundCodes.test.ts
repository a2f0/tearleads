import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("behavior-bearing container 404s carry the exact absence code", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const containerId = crypto.randomUUID();
  const requests = [
    [`/containers/${containerId}/writer-projection`, "GET"],
    [`/containers/${containerId}/documents`, "GET"],
    [`/containers/${containerId}`, "DELETE"],
  ] as const;

  for (const [path, method] of requests) {
    const response = await routeApp.request(path, {
      method,
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      error: "Container not found",
    });
  }
});
