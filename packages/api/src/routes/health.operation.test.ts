import { expect, test } from "bun:test";
import {
  getHealthOperation,
  operationRoutePath,
} from "@symcrypt/validators/operation";
import { createHealthRoute } from "./health";

test("health route registers from the shared operation", () => {
  const route = createHealthRoute();

  expect(route.routes).toContainEqual(
    expect.objectContaining({
      method: getHealthOperation.method,
      path: operationRoutePath(getHealthOperation),
    }),
  );
});
