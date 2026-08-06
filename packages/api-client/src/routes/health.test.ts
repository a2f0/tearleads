import { expect, test } from "bun:test";
import { getHealthOperation } from "@tearleads/validators/operation";
import { getHealth } from "./health";

test("health client metadata derives from the shared operation", () => {
  expect(getHealth).toMatchObject({
    method: getHealthOperation.method,
    path: "/",
  });
  expect(getHealth.isResponse).toBeDefined();
});
